import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { DockerPreparedPoolContract } from '@alunza/runner';
import { APP_CONFIG } from '../config';
import type { AppConfig } from '../config';
import { configuredDockerExecutionContextSchema } from './execution.port';
import type {
  ConfiguredDockerExecutionContext,
  ExecutionAuthority,
  ExecutionContext,
  ExecutionRequestClosure,
  PracticeExecutionInput,
  RunnerInspection,
} from './execution.port';
import type { SubmissionExecutionInput } from './submission-execution.port';
import { DockerPreparedResourceRepository } from './docker-prepared-resource.repository';

/** Shared by RUN and SUBMIT. Reserve ownership is durable; handles stay process-local. */
@Injectable()
export class DockerRunnerService implements OnModuleDestroy {
  private readonly logger = new Logger(DockerRunnerService.name);
  private readonly ownerToken = randomUUID();
  private readonly active = new Set<Promise<unknown>>();
  private readonly closing = new Map<string, Promise<void>>();
  private readonly serviceClosures = new Map<
    string,
    { done: Promise<void>; finish(): void }
  >();
  private pool: Promise<DockerPreparedPoolContract> | undefined;
  private stopped = false;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly resources: DockerPreparedResourceRepository,
  ) {}

  get configured() {
    return !!this.config.dockerConfiguration;
  }

  async inspect(): Promise<RunnerInspection> {
    const runner = await import('@alunza/runner');
    if (this.stopped || !this.config.dockerConfiguration)
      return { available: false, runnerVersion: runner.RUNNER_VERSION };
    const inspected = await runner.inspectDockerRunner(
      this.config.dockerConfiguration,
    );
    if (!inspected.available || !inspected.context)
      return { available: false, runnerVersion: runner.RUNNER_VERSION };
    const context = Object.freeze(
      configuredDockerExecutionContextSchema.parse(inspected.context),
    );
    this.assertConfiguration(context, runner.RUNNER_VERSION);
    return { available: true, runnerVersion: runner.RUNNER_VERSION, context };
  }

  private assertConfiguration(
    context: ConfiguredDockerExecutionContext,
    version: string,
  ) {
    const configured = this.config.dockerConfiguration;
    if (
      !configured ||
      context.runnerVersion !== version ||
      !isDeepStrictEqual(
        [
          context.runtimeName,
          context.runtimeVersion,
          context.runtimeSha256,
          context.strategy,
        ],
        [
          configured.runtimeName,
          configured.runtimeVersion,
          configured.runtimeSha256,
          configured.strategy,
        ],
      )
    )
      throw new Error('Docker admission configuration mismatch');
  }

  private getPool() {
    return (this.pool ??= (async () => {
      const runner = await import('@alunza/runner');
      return new runner.DockerPreparedPool({
        runtime: this.config.dockerConfiguration,
        resources: this.resources,
        ownerToken: this.ownerToken,
      });
    })());
  }

  execute(
    input: PracticeExecutionInput | SubmissionExecutionInput,
    context?: ExecutionContext,
    authority?: ExecutionAuthority,
  ) {
    if (!this.stopped && !this.serviceClosures.has(input.executionId)) {
      let finish!: () => void;
      const done = new Promise<void>((resolve) => {
        finish = resolve;
      });
      this.serviceClosures.set(input.executionId, { done, finish });
    }
    const operation = this.executeOwned(input, context, authority);
    this.active.add(operation);
    void operation
      .finally(() => this.active.delete(operation))
      .catch(() => undefined);
    return operation;
  }

  private async executeOwned(
    input: PracticeExecutionInput | SubmissionExecutionInput,
    context?: ExecutionContext,
    authority?: ExecutionAuthority,
  ) {
    const admitted = configuredDockerExecutionContextSchema.parse(context);
    if (
      this.stopped ||
      !authority ||
      !Number.isFinite(authority.normalDeadlineMs) ||
      !Number.isFinite(authority.cleanupDeadlineMs) ||
      authority.normalDeadlineMs <= Date.now() ||
      authority.cleanupDeadlineMs < authority.normalDeadlineMs ||
      authority.cleanupDeadlineMs - authority.normalDeadlineMs > 10_000
    )
      throw new Error('Docker execution authority unavailable');
    const runner = await import('@alunza/runner');
    this.assertConfiguration(admitted, runner.RUNNER_VERSION);
    const validatedInput = runner.executionSchema.parse(input);
    const assertActive = async () => {
      if (this.stopped || authority.normalDeadlineMs <= Date.now())
        throw new Error('Docker execution authority expired');
      await this.resources.assertActive(
        input.executionId,
        authority.leaseToken,
        admitted,
      );
    };
    await assertActive();
    const pool = await this.getPool();
    const adapter = await pool.adapterFor(validatedInput, admitted, {
      ...authority,
      assertActive,
    });
    // A late prepare/claim reply must never regain permission to send code.
    await assertActive();
    const result = await runner.execute(
      validatedInput,
      adapter,
      AbortSignal.timeout(
        Math.max(1, Math.floor(authority.normalDeadlineMs - Date.now())),
      ),
    );
    let cleanupVerified = result.evidence.cleanupVerified;
    if (admitted.strategy === 'prepared-pair-v1') {
      try {
        const pairs = await this.resources.listExecutionPairs(
          input.executionId,
          admitted,
        );
        cleanupVerified &&=
          pairs.length === 1 &&
          pairs.every((pair) =>
            pair.slots.every((slot) => slot.cleanupState === 'VERIFIED'),
          );
      } catch {
        // Keep the deterministic result available for staging and later recovery.
        cleanupVerified = false;
      }
    }
    return { result, cleanupVerified };
  }

  async cleanup(
    executionId: string,
    context: ExecutionContext,
    timeoutMs = 10_000,
  ) {
    try {
      const admitted = configuredDockerExecutionContextSchema.parse(context);
      return await (
        await this.getPool()
      ).cleanup(
        executionId,
        admitted,
        AbortSignal.timeout(
          Math.max(1, Math.min(30_000, Math.floor(timeoutMs))),
        ),
      );
    } catch {
      return false;
    }
  }

  async sweepExpired() {
    let removed = 0;
    try {
      if (this.stopped) return { cleanupVerified: false, removed };
      const runner = await import('@alunza/runner');
      const signal = AbortSignal.timeout(30_000);
      const engineId = await runner.getDockerEngineId(signal);
      const contexts = await this.resources.recoveryContexts(engineId);
      let cleanupVerified = true;
      for (const context of contexts) {
        if (this.stopped) return { cleanupVerified: false, removed };
        const result = await (await this.getPool()).sweep(context, signal);
        removed += result.removed;
        cleanupVerified &&= result.cleanupVerified;
      }
      return { cleanupVerified, removed };
    } catch {
      return { cleanupVerified: false, removed };
    }
  }

  requestClosed(
    executionId: string,
    context: ExecutionContext,
    closure: ExecutionRequestClosure,
  ) {
    this.serviceClosures.get(executionId)?.finish();
    this.serviceClosures.delete(executionId);
    if (this.closing.has(executionId) || !this.pool) return;
    const close = (async () => {
      const delivered = (await closure.responseClosed) ?? true;
      const admitted = configuredDockerExecutionContextSchema.parse(context);
      await (
        await this.pool!
      ).afterRequestClosed(executionId, admitted, {
        replenish:
          !this.stopped &&
          delivered &&
          closure.committed &&
          closure.cleanupVerified,
      });
    })()
      .catch(() => {
        try {
          this.logger.warn({
            event: 'docker.reserve.cleanup.pending',
            executionId,
          });
        } catch {
          // Logging cannot change durable closure or the already sent response.
        }
      })
      .finally(() => this.closing.delete(executionId));
    this.closing.set(executionId, close);
  }

  async onModuleDestroy() {
    this.stopped = true;
    await Promise.allSettled([
      ...this.active,
      ...[...this.serviceClosures.values()].map((entry) => entry.done),
    ]);
    if (this.pool) await (await this.pool).drain();
  }
}
