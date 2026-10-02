import { Inject, Injectable } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  HELP_QUERY_VERSION,
  TOKENIZER_VERSION,
  HELP_LIMITS,
  HelpBoundaryError,
  buildHelpQuery,
  buildHelpInput,
  validateHelpCandidate,
  validateHelpVerification,
  validateVectors,
  helpMeasurementHash,
  calibrateHelpEvidenceFromReceipts,
} from '@alunza/ai';
import type {
  EmbeddingsPort,
  HelpVerificationPort,
  HelpTokenizer,
  RetrievedChunk,
  HelpCalibrationBinding,
} from '@alunza/ai';
import { ragHelpSchema } from '@alunza/contracts';
import type { RagHelp } from '@alunza/contracts';
import { EvaluationRepository } from '../evaluation/evaluation.repository';
import { EvaluationGateway } from '../evaluation/evaluation.gateway';
import {
  EVALUATION_CONFIG,
  EvaluationCallError,
} from '../evaluation/evaluation.types';
import type {
  EvaluationConfig,
  EvaluationCalibrationJob,
  EvaluationCalibrationContext,
} from '../evaluation/evaluation.types';

export const CALIBRATION_PROVIDER_FACTORY = Symbol(
  'CALIBRATION_PROVIDER_FACTORY',
);
export interface EvaluationCalibrationProviders {
  embeddings: EmbeddingsPort;
  embeddingFingerprint: string;
  verification?: HelpVerificationPort;
  verificationProfile?: { id: string; model: string; fingerprint: string };
  tokenizer?: HelpTokenizer;
}
export type EvaluationCalibrationProviderFactory =
  () => EvaluationCalibrationProviders | null;

// Database uncertainty leaves durable work for lease recovery. It must not
// become an extra paid request or a fabricated terminal result.
class CalibrationCheckpointUncertain extends Error {}

@Injectable()
export class EvaluationCalibrationWorker
  implements OnModuleInit, OnModuleDestroy
{
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;
  private stopped = false;
  constructor(
    private readonly repository: EvaluationRepository,
    private readonly gateway: EvaluationGateway,
    @Inject(CALIBRATION_PROVIDER_FACTORY)
    private readonly factory: EvaluationCalibrationProviderFactory,
    @Inject(EVALUATION_CONFIG) private readonly config: EvaluationConfig,
  ) {}
  onModuleInit() {
    if (this.config.enabled) this.schedule();
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
    }, 500);
    this.timer.unref();
  }
  async onModuleDestroy() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.running;
  }
  private async checkpoint<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch {
      throw new CalibrationCheckpointUncertain();
    }
  }
  private async bounded<T>(
    operation: Promise<T>,
    signal: AbortSignal,
  ): Promise<T> {
    let onAbort: (() => void) | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_resolve, reject) => {
          onAbort = () => reject(new HelpBoundaryError('CANCELLED'));
          signal.addEventListener('abort', onAbort, { once: true });
          if (signal.aborted) onAbort();
        }),
      ]);
    } finally {
      if (onAbort) signal.removeEventListener('abort', onAbort);
    }
  }
  async tick(): Promise<void> {
    const job = await this.repository.claimCalibration();
    if (!job) {
      const pending = await this.repository.pendingCalibrationRun();
      if (pending) await this.finalize(pending);
      return;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    let leaseLost = false,
      renewal: Promise<void> | undefined;
    const loseLease = () => {
      leaseLost = true;
      controller.abort();
    };
    const heartbeat = setInterval(() => {
      if (renewal || leaseLost) return;
      renewal = this.repository
        .renewCalibration(job)
        .then((valid) => {
          if (!valid) loseLease();
        })
        .catch(loseLease)
        .finally(() => {
          renewal = undefined;
        });
    }, 10_000);
    heartbeat.unref();
    try {
      const snapshot = await this.checkpoint(() =>
        this.repository.calibrationContext(job),
      );
      if (!snapshot) return;
      const providers = this.factory();
      if (!providers) throw new HelpBoundaryError('CONFIGURATION_MISSING');
      const profile = providers.embeddings.configuration;
      if (
        profile.id !== job.profile.id ||
        profile.model !== job.profile.model ||
        profile.dimensions !== job.profile.dimensions ||
        providers.embeddingFingerprint !== job.profile.fingerprint
      )
        throw new HelpBoundaryError('INVALID_CONFIGURATION');
      if (job.kind === 'REVIEW') {
        const parsed = ragHelpSchema.safeParse(job.reviewCase?.candidate);
        if (!parsed.success) {
          await this.checkpoint(() =>
            this.repository.completeReviewCase(job, null, true),
          );
          return;
        }
      }
      const query = buildHelpQuery(snapshot.context);
      const queryHash = createHash('sha256')
        .update(query, 'utf8')
        .digest('hex');
      const storedHash = await this.checkpoint(() =>
        this.repository.prepareCalibrationQuery(job, query),
      );
      if (storedHash !== queryHash)
        throw new HelpBoundaryError('INVALID_CONTEXT');
      controller.signal.throwIfAborted();
      const owner = {
        kind: 'CALIBRATION' as const,
        id: job.id,
        token: job.token,
      };
      const output = await this.bounded(
        this.gateway.execute(
          {
            owner,
            phase: 'EMBEDDING',
            logicalKey: HELP_QUERY_VERSION,
            inputHash: queryHash,
            configuration: {
              ...profile,
              fingerprint: providers.embeddingFingerprint,
            },
            reservedInputTokens: HELP_LIMITS.queryTokens,
            maxOutputTokens: 0,
          },
          async (observe) => {
            const vectors = await providers.embeddings.embed(
              [query],
              controller.signal,
              observe,
            );
            validateVectors(vectors, 1, profile.dimensions);
            return { vectors };
          },
        ),
        controller.signal,
      );
      controller.signal.throwIfAborted();
      validateVectors(output.vectors, 1, profile.dimensions);
      const receipt = await this.checkpoint(() =>
        this.repository.findReceipt(owner, 'EMBEDDING', HELP_QUERY_VERSION),
      );
      if (
        !receipt ||
        receipt.state !== 'COMPLETED' ||
        receipt.inputHash !== queryHash
      )
        throw new CalibrationCheckpointUncertain();
      const chunks = await this.checkpoint(() =>
        this.repository.calibrationRetrieve(
          job,
          output.vectors[0]!,
          queryHash,
          receipt.callId,
          profile,
        ),
      );
      if (chunks === null) return;
      if (job.kind === 'REVIEW')
        await this.review(job, snapshot, chunks, providers, controller.signal);
      else await this.finalize(job.runId);
    } catch (error) {
      if (
        leaseLost ||
        error instanceof CalibrationCheckpointUncertain ||
        (error instanceof EvaluationCallError &&
          error.code === 'CALL_UNCERTAIN')
      )
        return;
      try {
        await this.repository.failCalibration(job);
      } catch {
        /* Reclaim reconciles the durable state. */
      }
    } finally {
      clearTimeout(timeout);
      clearInterval(heartbeat);
      await renewal;
    }
  }
  private async review(
    job: EvaluationCalibrationJob,
    snapshot: EvaluationCalibrationContext,
    chunks: RetrievedChunk[],
    providers: EvaluationCalibrationProviders,
    signal: AbortSignal,
  ) {
    if (
      !job.reviewCase ||
      !providers.verification ||
      !providers.verificationProfile ||
      !providers.tokenizer
    )
      throw new HelpBoundaryError('CONFIGURATION_MISSING');
    const references = await this.checkpoint(() =>
      this.repository.reviewReferences(job),
    );
    let candidate: RagHelp;
    let input;
    try {
      const parsed = ragHelpSchema.safeParse(job.reviewCase.candidate);
      if (!parsed.success) throw new HelpBoundaryError('INVALID_OUTPUT');
      const original = parsed.data;
      const refs = original.source_refs.map((ref) => {
        const mapping = job.reviewCase!.refsMapping.find(
          (entry) =>
            entry.source_id === ref.source_id &&
            entry.source_version_id === ref.source_version_id &&
            entry.chunk_id === ref.chunk_id,
        );
        const actual =
          mapping &&
          references.find(
            (entry) => entry.materialBindingId === mapping.materialBindingId,
          );
        if (!actual) throw new HelpBoundaryError('INVALID_OUTPUT');
        // Do not repair a deliberately false locator supplied by the oracle.
        return {
          source_id: actual.source_id,
          source_version_id: actual.source_version_id,
          chunk_id: actual.chunk_id,
          locator:
            ref.locator === mapping!.locator ? actual.locator : ref.locator,
        };
      });
      input = buildHelpInput(
        {
          context: snapshot.context,
          kind: 'FEEDBACK',
          hintLevel: null,
          chunks,
        },
        providers.tokenizer,
      );
      candidate = validateHelpCandidate(input, {
        ...original,
        source_refs: refs,
      });
    } catch (error) {
      if (!(error instanceof HelpBoundaryError)) throw error;
      await this.checkpoint(() =>
        this.repository.completeReviewCase(job, null, true),
      );
      return;
    }
    signal.throwIfAborted();
    const owner = {
      kind: 'CALIBRATION' as const,
      id: job.id,
      token: job.token,
    };
    const prepared = input;
    const verification = providers.verification;
    const reviewed = await this.bounded(
      this.gateway.execute(
        {
          owner,
          phase: 'REVIEW',
          logicalKey: 'candidate-review-1',
          inputHash: helpMeasurementHash({ input: prepared, candidate }),
          configuration: providers.verificationProfile,
          reservedInputTokens: HELP_LIMITS.callInputTokens,
          maxOutputTokens: HELP_LIMITS.verificationOutputTokens,
        },
        (observe) => verification.verify(prepared, candidate, signal, observe),
      ),
      signal,
    );
    signal.throwIfAborted();
    validateHelpVerification(prepared, candidate, reviewed.verification);
    const receipt = await this.checkpoint(() =>
      this.repository.findReceipt(owner, 'REVIEW', 'candidate-review-1'),
    );
    if (!receipt || receipt.state !== 'COMPLETED')
      throw new CalibrationCheckpointUncertain();
    await this.checkpoint(() =>
      this.repository.completeReviewCase(job, receipt.callId),
    );
  }
  async finalize(runId: string): Promise<void> {
    const stored = await this.checkpoint(() =>
      this.repository.calibrationEvidence(runId),
    );
    if (!stored) return;
    const profile = stored.manifest.profiles.EMBEDDING;
    const binding: HelpCalibrationBinding = {
      configurationId: profile.id,
      embeddingModel: profile.model,
      dimensions: profile.dimensions!,
      tokenizerVersion: TOKENIZER_VERSION,
      queryVersion: HELP_QUERY_VERSION,
      corpusHash: stored.manifest.corpusHash,
    };
    try {
      const artifact = calibrateHelpEvidenceFromReceipts(
        {
          version: 'help-measurement-1',
          origin: stored.manifest.provider,
          runId,
          binding,
          corpus: stored.corpus,
          cases: stored.cases.map((item) => ({
            id: item.metadata.caseId,
            groupId: item.metadata.groupId,
            split: item.metadata.split,
            expected: item.metadata.expected,
            relevantChunkIds: item.relevantChunkIds,
            candidates: item.candidates,
          })),
          queries: stored.queries,
          observations: stored.observations,
        },
        {
          origin: stored.manifest.provider,
          runId,
          binding,
          corpus: stored.corpus,
          observations: stored.observations,
          receipts: stored.receipts,
        },
      );
      await this.checkpoint(() =>
        this.repository.finishCalibration(runId, artifact),
      );
    } catch (error) {
      if (
        error instanceof HelpBoundaryError &&
        error.code === 'CALIBRATION_INVALID'
      ) {
        await this.checkpoint(() =>
          this.repository.failCalibrationRun(runId, 'CALIBRATION_INVALID'),
        );
        return;
      }
      throw error;
    }
  }
}
