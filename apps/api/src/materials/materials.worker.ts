import { Inject, Injectable, Optional } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  AiBoundaryError,
  MaterialExtractor,
  MaterialIngestionError,
  TOKENIZER_VERSION,
  MATERIAL_INGESTION_LIMITS,
  validateVectors,
} from '@alunza/ai';
import type { EmbeddingsPort } from '@alunza/ai';
import { APP_CONFIG } from '../config';
import type { AppConfig } from '../config';
import { ApiError } from '../http/errors';
import { MATERIALS_EMBEDDINGS, MATERIALS_STORAGE } from './materials.ports';
import type { MaterialsStoragePort } from './materials.ports';
import { MaterialsRepository } from './materials.repository';
import { materialHash } from './materials.service';
import { digest } from '../governance/governance.shared';
import { EvaluationGateway } from '../evaluation/evaluation.gateway';
import { EvaluationCallError } from '../evaluation/evaluation.types';
import { evaluationProviderProfile } from '../evaluation-profiles';

@Injectable()
export class MaterialsWorker implements OnModuleInit, OnModuleDestroy {
  private stopped = false;
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;
  private readonly extractor = new MaterialExtractor();
  constructor(
    private readonly repository: MaterialsRepository,
    @Inject(MATERIALS_STORAGE) private readonly storage: MaterialsStoragePort,
    @Inject(MATERIALS_EMBEDDINGS)
    private readonly embeddings: EmbeddingsPort | null,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Optional() private readonly evaluation?: EvaluationGateway,
  ) {}
  onModuleInit() {
    if (this.config.materialsWorkerEnabled) this.schedule();
  }
  private schedule() {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.running = this.tick()
        .catch(() => undefined)
        .finally(() => {
          this.running = undefined;
          this.schedule();
        });
    }, this.config.materialsPollMs);
    this.timer.unref();
  }
  async onModuleDestroy() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.running;
  }
  async tick() {
    const cleanup = await this.repository.claimCleanup();
    if (cleanup) {
      try {
        await this.storage.remove(cleanup.storageKey);
        await this.repository.finishCleanup(cleanup);
      } catch {
        /* Durable cleanup lease is reclaimed after expiry. */
      }
    }
    const job = await this.repository.claim();
    if (!job) return;
    if (job.kind === 'upload') {
      try {
        const found = await this.storage.stat(job.storageKey);
        if (!found) {
          await this.repository.fail(job, 'UPLOAD_INCOMPLETE');
          return;
        }
        const bytes = await this.storage.download(job.storageKey);
        if (materialHash(bytes) !== job.sha256) {
          await this.repository.fail(job, 'CONTENT_MISMATCH');
          return;
        }
        await this.repository.confirm(job.id, job.token);
      } catch {
        /* Unknown Storage outcome remains recoverable, never confirmed. */
      }
      return;
    }
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 10 * 60_000);
    let renewal: Promise<void> | undefined;
    let leaseLost = false;
    const relinquishLease = () => {
      leaseLost = true;
      controller.abort();
    };
    const heartbeat = setInterval(
      () => {
        if (renewal || leaseLost) return;
        renewal = this.repository
          .renew(job)
          .then(async (valid) => {
            if (
              !valid ||
              (this.evaluation &&
                !(await this.evaluation.canContinue({
                  kind: 'MATERIAL',
                  id: job.id,
                  token: job.token,
                })))
            )
              relinquishLease();
          })
          .catch(relinquishLease)
          .finally(() => {
            renewal = undefined;
          });
      },
      Math.floor(this.config.materialsLeaseMs / 4),
    );
    heartbeat.unref();
    try {
      if (!this.embeddings) {
        await this.repository.fail(job, 'CONFIGURATION_MISSING');
        return;
      }
      if (!(await this.repository.renew(job))) return;
      const bytes = await this.storage.download(job.storageKey);
      if (materialHash(bytes) !== job.sha256) {
        await this.repository.fail(job, 'CONTENT_MISMATCH');
        return;
      }
      const extracted = await this.extractor.extractAndChunk(
        bytes,
        job.format,
        controller.signal,
      );
      const chunks = extracted.chunks;
      const checkpoint = await this.repository.prepare(
        job,
        this.embeddings.configuration,
        extracted.extractionVersion,
        TOKENIZER_VERSION,
        chunks.length,
        digest(
          JSON.stringify(
            chunks.map((chunk) => [
              chunk.index,
              chunk.contentHash,
              chunk.locator,
              chunk.tokenCount,
            ]),
          ),
        ),
      );
      if (checkpoint === -2) {
        await this.repository.fail(job, 'CONFIGURATION_MISMATCH');
        return;
      }
      if (checkpoint < 0) return;
      for (
        let start = checkpoint;
        start < chunks.length;
        start += MATERIAL_INGESTION_LIMITS.embeddingBatchSize
      ) {
        if (controller.signal.aborted || !(await this.repository.renew(job)))
          return;
        const batch = chunks.slice(
          start,
          start + MATERIAL_INGESTION_LIMITS.embeddingBatchSize,
        );
        const texts = batch.map((chunk) => chunk.text);
        const port = this.embeddings;
        const receipt = this.evaluation
          ? await this.evaluation.execute(
              {
                owner: { kind: 'MATERIAL', id: job.id, token: job.token },
                phase: 'EMBEDDING',
                logicalKey: `batch:${start}`,
                inputHash: digest(JSON.stringify(texts)),
                configuration: evaluationProviderProfile(
                  this.config,
                  'EMBEDDING',
                  port.configuration,
                ),
                reservedInputTokens: batch.reduce(
                  (sum, chunk) => sum + chunk.tokenCount,
                  0,
                ),
                maxOutputTokens: 0,
                attempt: job.attempt,
              },
              async (observer) => ({
                vectors: await port.embed(texts, controller.signal, observer),
                usage: port.lastUsage,
              }),
            )
          : {
              vectors: await port.embed(texts, controller.signal),
              usage: port.lastUsage,
            };
        const vectors = receipt.vectors;
        validateVectors(
          vectors,
          batch.length,
          this.embeddings.configuration.dimensions,
        );
        if (
          !(await this.repository.stage(
            job,
            batch.map((chunk, i) => ({ ...chunk, embedding: vectors[i] })),
            receipt.usage,
          ))
        )
          return;
      }
      if (
        !controller.signal.aborted &&
        (!this.evaluation ||
          (await this.evaluation.canContinue({
            kind: 'MATERIAL',
            id: job.id,
            token: job.token,
          })))
      )
        await this.repository.publish(job);
    } catch (error) {
      // A lost or unconfirmed lease cannot authorize a terminal write. Its
      // expiry and next claim recover the durable checkpoint without discarding it.
      if (leaseLost) return;
      const code =
        error instanceof EvaluationCallError
          ? error.code
          : error instanceof MaterialIngestionError
            ? error.code
            : error instanceof AiBoundaryError
              ? error.reason
              : error instanceof ApiError
                ? error.code
                : 'PROCESSING_FAILED';
      const retryable =
        error instanceof EvaluationCallError
          ? error.retryable
          : error instanceof MaterialIngestionError
            ? error.retryable
            : error instanceof AiBoundaryError
              ? error.reason === 'PROVIDER_FAILURE'
              : error instanceof ApiError && error.retryable;
      const retryAfter =
        error instanceof MaterialIngestionError ||
        error instanceof EvaluationCallError
          ? (error.retryAfterMs ?? 0)
          : 0;
      try {
        await this.repository.fail(job, code, retryable, retryAfter);
      } catch {
        /* Lease expiry reconciles uncertain commit. */
      }
    } finally {
      clearInterval(heartbeat);
      clearTimeout(deadline);
      await renewal;
    }
  }
}
