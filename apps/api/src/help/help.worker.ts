import { Inject, Injectable, Optional } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  AiBoundaryError,
  HelpBoundaryError,
  buildHelpInput,
  buildHelpQuery,
  validatePreparedHelpInput,
  validateHelpCandidate,
  validateHelpVerification,
  validateVectors,
  HELP_QUERY_VERSION,
  HELP_LIMITS,
} from '@alunza/ai';
import type {
  PreparedHelpInput,
  HelpUsage,
  AiSettlementObserver,
} from '@alunza/ai';
import type { RagHelp } from '@alunza/contracts';
import { APP_CONFIG } from '../config';
import type { AppConfig } from '../config';
import { HELP_PROVIDER_FACTORY } from './help.ports';
import type { HelpProviderFactory } from './help.ports';
import { HelpRepository } from './help.repository';
import type { HelpJob, HelpPhase } from './help.types';
import { EvaluationGateway } from '../evaluation/evaluation.gateway';
import type { EvaluationCallSpec } from '../evaluation/evaluation.types';
import { evaluationProviderProfile } from '../evaluation-profiles';

// A database response may be lost after commit. Never convert that uncertainty
// into a new provider dispatch or overwrite the durable checkpoint with a guess.
class CheckpointUncertain extends Error {}
@Injectable()
export class HelpWorker implements OnModuleInit, OnModuleDestroy {
  private stopped = false;
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;
  constructor(
    private readonly repository: HelpRepository,
    @Inject(HELP_PROVIDER_FACTORY)
    private readonly factory: HelpProviderFactory,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Optional() private readonly evaluation?: EvaluationGateway,
  ) {}
  onModuleInit() {
    if (this.config.helpWorkerEnabled) this.schedule();
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
    } catch (error) {
      if (error instanceof HelpBoundaryError) throw error;
      throw new CheckpointUncertain();
    }
  }
  private async call<T extends { usage?: HelpUsage }>(
    job: HelpJob,
    phase: HelpPhase,
    invoke: (observer?: AiSettlementObserver) => Promise<T>,
    signal: AbortSignal,
    specification: Omit<EvaluationCallSpec, 'owner' | 'phase' | 'logicalKey'>,
  ): Promise<T> {
    signal.throwIfAborted();
    const call = await this.checkpoint(() =>
      this.repository.beginCall(job, phase),
    );
    if (call.state === 'STOP') throw new CheckpointUncertain();
    if (call.state === 'COMPLETED') return call.result as T;
    let result: T;
    let onAbort: (() => void) | undefined;
    try {
      const aborted = new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(new HelpBoundaryError('CANCELLED'));
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) onAbort();
      });
      const dispatched = this.evaluation
        ? this.evaluation.execute(
            {
              ...specification,
              owner: { kind: 'HELP', id: job.id, token: job.token },
              phase,
              logicalKey: phase,
            },
            invoke,
          )
        : invoke();
      result = await Promise.race([dispatched, aborted]);
    } catch (error) {
      if (
        error instanceof HelpBoundaryError &&
        error.usage &&
        !signal.aborted
      ) {
        const observed = error;
        if (
          !(await this.checkpoint(() =>
            this.repository.completeCall(
              job,
              phase,
              { failure: observed.code, usage: observed.usage },
              observed.usage,
            ),
          ))
        )
          throw new CheckpointUncertain();
      }
      if (
        error instanceof HelpBoundaryError ||
        error instanceof AiBoundaryError
      )
        throw error;
      throw new HelpBoundaryError('PROVIDER_UNAVAILABLE');
    } finally {
      if (onAbort) signal.removeEventListener('abort', onAbort);
    }
    signal.throwIfAborted();
    if (
      !(await this.checkpoint(() =>
        this.repository.completeCall(job, phase, result, result.usage),
      ))
    )
      throw new CheckpointUncertain();
    return result;
  }
  async tick() {
    const job = await this.repository.claim();
    if (!job) return;
    const controller = new AbortController();
    const remaining = Date.parse(job.deadlineAt) - Date.now();
    if (remaining <= 0) return; // The next claim persists the deadline fallback.
    const timeout = setTimeout(() => controller.abort(), remaining);
    let renewal: Promise<void> | undefined;
    let leaseLost = false;
    const relinquish = () => {
      leaseLost = true;
      controller.abort();
    };
    const heartbeat = setInterval(() => {
      if (renewal || leaseLost) return;
      renewal = this.repository
        .renew(job)
        .then(async (valid) => {
          if (
            !valid ||
            (this.evaluation &&
              !(await this.evaluation.canContinue({
                kind: 'HELP',
                id: job.id,
                token: job.token,
              })))
          )
            relinquish();
        })
        .catch(relinquish)
        .finally(() => {
          renewal = undefined;
        });
    }, 3000);
    heartbeat.unref();
    try {
      const snapshot = await this.checkpoint(() =>
        this.repository.context(job),
      );
      if (!snapshot) return;
      if (snapshot.context.infrastructureStatus === 'FAILED') {
        await this.checkpoint(() =>
          this.repository.finish(
            job,
            {
              diagnosis_code: snapshot.context.diagnosisCode,
              explanation:
                'La ejecución no pudo evaluarse por una falla del servicio. No hay información técnica suficiente para atribuir un error a tu solución.',
              hint: '',
              source_refs: [],
              status: 'NO_EVIDENCE',
            },
            { reason: 'INFRASTRUCTURE_FAILURE', deterministic: true },
          ),
        );
        return;
      }
      const providers = await this.factory();
      if (!providers) throw new HelpBoundaryError('CONFIGURATION_MISSING');
      const profile = {
        configurationId: providers.configurationId,
        configurationFingerprint: providers.configurationFingerprint,
        embeddingConfiguration: providers.embeddings.configuration,
        policyVersion: providers.evidence.version,
        queryVersion: HELP_QUERY_VERSION,
      };
      if (
        !(await this.checkpoint(() =>
          this.repository.configurationMatches(job, profile),
        ))
      )
        throw new HelpBoundaryError('INVALID_CONFIGURATION');
      let input: PreparedHelpInput | null = await this.checkpoint(() =>
        this.repository.getInput(job),
      );
      if (!input) {
        const query = buildHelpQuery(snapshot.context);
        const queryHash = createHash('sha256').update(query).digest('hex');
        const receipt = await this.call(
          job,
          'EMBEDDING',
          async (observer) => {
            const vectors = await providers.embeddings.embed(
              [query],
              controller.signal,
              observer,
            );
            validateVectors(
              vectors,
              1,
              providers.embeddings.configuration.dimensions,
            );
            return {
              vectors,
              configuration: providers.embeddings.configuration,
              queryVersion: HELP_QUERY_VERSION,
              queryHash,
              usage: providers.embeddings.lastUsage,
            };
          },
          controller.signal,
          {
            inputHash: queryHash,
            configuration: evaluationProviderProfile(
              this.config,
              'EMBEDDING',
              providers.embeddings.configuration,
            ),
            reservedInputTokens: HELP_LIMITS.queryTokens,
            maxOutputTokens: 0,
          },
        );
        const expected = providers.embeddings.configuration;
        if (
          receipt.queryVersion !== HELP_QUERY_VERSION ||
          receipt.queryHash !== queryHash ||
          receipt.configuration?.id !== expected.id ||
          receipt.configuration?.model !== expected.model ||
          receipt.configuration?.dimensions !== expected.dimensions
        )
          throw new HelpBoundaryError('INVALID_CONFIGURATION');
        validateVectors(receipt.vectors, 1, expected.dimensions);
        const vector = receipt.vectors[0];
        if (!vector) throw new HelpBoundaryError('INVALID_OUTPUT');
        const chunks = await this.checkpoint(() =>
          this.repository.retrieve(job, vector, expected),
        );
        if (chunks === null) return;
        const selected = providers.evidence.select(chunks);
        if (selected.reason !== 'SUPPORTED' || !selected.chunks.length) {
          await this.checkpoint(() =>
            this.repository.finish(
              job,
              {
                diagnosis_code: snapshot.context.diagnosisCode,
                explanation:
                  'No se encontró evidencia pertinente y suficiente en los materiales autorizados para explicar este resultado.',
                hint: '',
                source_refs: [],
                status: 'NO_EVIDENCE',
              },
              {
                reason: selected.reason,
                policyVersion: providers.evidence.version,
              },
            ),
          );
          return;
        }
        // A policy may filter or rank, but cannot substitute provider context.
        if (selected.chunks.some((chunk) => !chunks.includes(chunk)))
          throw new HelpBoundaryError('INVALID_CONTEXT');
        const prepared = buildHelpInput(
          {
            context: snapshot.context,
            kind: job.kind,
            hintLevel: job.hintLevel,
            chunks: selected.chunks,
          },
          providers.tokenizer,
        );
        input = await this.checkpoint(() =>
          this.repository.prepareInput(job, prepared, profile),
        );
        if (!input) return;
      }
      input = validatePreparedHelpInput(input);
      if (
        input.context.attemptId !== job.attemptId ||
        input.kind !== job.kind ||
        input.hintLevel !== job.hintLevel ||
        input.tokenizer !== providers.tokenizer
      )
        throw new HelpBoundaryError('INVALID_CONTEXT');
      const prepared = input;
      const generated = await this.call(
        job,
        'GENERATION',
        (observer) =>
          providers.generation.generate(prepared, controller.signal, observer),
        controller.signal,
        {
          inputHash: prepared.contextHash,
          configuration: evaluationProviderProfile(this.config, 'GENERATION', {
            id: providers.configurationId,
            model: 'test-fixture-only',
          }),
          reservedInputTokens: HELP_LIMITS.callInputTokens,
          maxOutputTokens: HELP_LIMITS.generationOutputTokens,
        },
      );
      const candidate = validateHelpCandidate(prepared, generated.candidate);
      if (candidate.status !== 'SUPPORTED') {
        await this.checkpoint(() =>
          this.repository.fail(job, candidate.status),
        );
        return;
      }
      const reviewed = await this.call(
        job,
        'REVIEW',
        (observer) =>
          providers.verification.verify(
            prepared,
            candidate,
            controller.signal,
            observer,
          ),
        controller.signal,
        {
          inputHash: createHash('sha256')
            .update(
              JSON.stringify({ contextHash: prepared.contextHash, candidate }),
            )
            .digest('hex'),
          configuration: evaluationProviderProfile(this.config, 'REVIEW', {
            id: providers.configurationId,
            model: 'test-fixture-only',
          }),
          reservedInputTokens: HELP_LIMITS.callInputTokens,
          maxOutputTokens: HELP_LIMITS.verificationOutputTokens,
        },
      );
      const verdict = validateHelpVerification(
        prepared,
        candidate,
        reviewed.verification,
      );
      if (verdict.verdict !== 'ACCEPT') {
        await this.checkpoint(() =>
          this.repository.fail(
            job,
            verdict.verdict === 'NO_EVIDENCE' ? 'NO_EVIDENCE' : verdict.reason,
          ),
        );
        return;
      }
      controller.signal.throwIfAborted();
      if (!(await this.checkpoint(() => this.repository.revalidate(job))))
        return;
      if (
        this.evaluation &&
        !(await this.evaluation.canContinue({
          kind: 'HELP',
          id: job.id,
          token: job.token,
        }))
      )
        return;
      await this.checkpoint(() =>
        this.repository.finish(job, candidate as RagHelp, {
          contextHash: prepared.contextHash,
          promptVersion: prepared.promptVersion,
          schemaVersion: prepared.schemaVersion,
          policyVersion: providers.evidence.version,
          configurationId: providers.configurationId,
          verification: verdict.reason,
        }),
      );
    } catch (error) {
      if (leaseLost || error instanceof CheckpointUncertain) return;
      const code = controller.signal.aborted
        ? 'DEADLINE_EXCEEDED'
        : error instanceof HelpBoundaryError
          ? error.code
          : error instanceof AiBoundaryError
            ? error.reason
            : 'PROCESSING_FAILED';
      try {
        await this.repository.fail(job, code);
      } catch {
        /* Durable claim reconciles expiry. */
      }
    } finally {
      clearTimeout(timeout);
      clearInterval(heartbeat);
      await renewal;
    }
  }
}
