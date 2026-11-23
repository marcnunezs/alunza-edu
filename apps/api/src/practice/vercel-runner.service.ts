import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { isDeepStrictEqual } from 'node:util';
import type { PracticeExecutionInput } from './execution.port';
import type { SubmissionExecutionInput } from './submission-execution.port';
import { APP_CONFIG } from '../config';
import type { AppConfig } from '../config';
import type {
  ExecutionAuthority,
  ExecutionContext,
  RunnerInspection,
} from './execution.port';
import { SandboxResourceRepository } from './sandbox-resource.repository';
import type { SandboxResource } from './sandbox-resource.repository';

const OWNER = 'alunza-imp-03-07';
type ExecutionInput = PracticeExecutionInput | SubmissionExecutionInput;

/** Domain-owned ledger is the authority; SDK objects never authorize execution. */
@Injectable()
export class VercelRunnerService implements OnModuleDestroy {
  private readonly logger = new Logger(VercelRunnerService.name);
  private stopped = false;
  private readonly active = new Set<Promise<unknown>>();
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly resources: SandboxResourceRepository,
  ) {}

  async inspect(): Promise<RunnerInspection> {
    const runner = await import('@alunza/runner');
    const configured = this.config.sandboxConfiguration;
    const available =
      !this.stopped &&
      !!configured &&
      configured.context.runnerVersion === runner.RUNNER_VERSION &&
      Date.parse(configured.context.expiresAt) > Date.now();
    return available
      ? {
          available,
          runnerVersion: runner.RUNNER_VERSION,
          context: configured.context,
        }
      : { available: false, runnerVersion: runner.RUNNER_VERSION };
  }

  private credentials(resource: SandboxResource) {
    const configured = this.config.sandboxConfiguration;
    if (
      !configured ||
      configured.context.teamId !== resource.context.teamId ||
      configured.context.projectId !== resource.context.projectId
    )
      throw new Error('Sandbox recovery destination unavailable');
    return configured.token;
  }

  execute(
    input: ExecutionInput,
    context?: ExecutionContext,
    authority?: ExecutionAuthority,
  ) {
    const operation = this.executeOwned(input, context, authority);
    this.active.add(operation);
    void operation
      .finally(() => this.active.delete(operation))
      .catch(() => undefined);
    return operation;
  }

  private async executeOwned(
    input: ExecutionInput,
    context?: ExecutionContext,
    authority?: ExecutionAuthority,
  ) {
    if (
      this.stopped ||
      context?.provider !== 'vercel' ||
      !authority ||
      authority.normalDeadlineMs <= Date.now()
    )
      throw new Error('Sandbox execution authority unavailable');
    const resource = await this.resources.load(input.executionId);
    if (!resource || !isDeepStrictEqual(resource.context, context))
      throw new Error('Sandbox admission context mismatch');
    const token = this.credentials(resource);
    const runner = await import('@alunza/runner');
    if (runner.RUNNER_VERSION !== context.runnerVersion)
      throw new Error('Sandbox runner version mismatch');
    const adapter = new runner.VercelAdapter({
      authorized: true,
      expiresAtMs: Date.parse(context.expiresAt),
      token,
      teamId: context.teamId,
      projectId: context.projectId,
      region: context.region,
      image: context.image,
      sandboxName: resource.sandboxName,
      owner: OWNER,
      correlationId: resource.creationId,
      normalDeadlineMs: authority.normalDeadlineMs,
      cleanupDeadlineMs: authority.cleanupDeadlineMs,
      allowRequest: (cleanup) =>
        this.resources.consumeRequest(
          input.executionId,
          resource.creationId,
          cleanup,
        ),
      recordCorrelation: async () => {
        await this.resources.beginCreation(
          input.executionId,
          authority.leaseToken,
        );
      },
      recordResource: async ({ sandboxId }) => {
        await this.resources.confirmResource(
          input.executionId,
          resource.creationId,
          sandboxId,
        );
      },
      assertActive: async () => {
        if (this.stopped) throw new Error('Sandbox execution draining');
        await this.resources.assertActive(
          input.executionId,
          authority.leaseToken,
        );
      },
    });
    const result = await runner.execute(
      input,
      adapter,
      AbortSignal.timeout(Math.max(1, authority.normalDeadlineMs - Date.now())),
    );
    let cleanupVerified = false;
    if (adapter.evidence.cleanupVerified)
      cleanupVerified = await this.persistCleanup(resource, adapter.evidence);
    this.logger.log({
      event: 'sandbox.execution',
      executionId: input.executionId,
      provider: 'vercel',
      runnerVersion: result.runnerVersion,
      region: context.region,
      lifecycleMs: result.lifecycleMs,
      cleanupVerified,
    });
    return { result, cleanupVerified };
  }

  private async persistCleanup(
    resource: SandboxResource,
    evidence: { cleanupVerified?: boolean; sandboxId?: string | null },
  ) {
    if (!evidence.cleanupVerified) return false;
    if (resource.creationState === 'PREPARED' && !evidence.sandboxId) {
      await this.resources.verifyCleanup(resource.executionId, {
        creationId: resource.creationId,
        kind: 'NOT_DISPATCHED',
      });
    } else {
      const sandboxId = evidence.sandboxId ?? resource.providerResourceId;
      if (!sandboxId) return false;
      await this.resources.verifyCleanup(resource.executionId, {
        creationId: resource.creationId,
        kind: 'ABSENT_AND_ZERO_SNAPSHOTS',
        sandboxId,
        lookupAbsent: true,
        snapshotsRemaining: 0,
        observedAt: new Date().toISOString(),
      });
    }
    return true;
  }

  async cleanup(executionId: string, timeoutMs = 30_000): Promise<boolean> {
    try {
      const resource = await this.resources.load(executionId);
      if (!resource) return false;
      if (resource.cleanupState === 'VERIFIED') return true;
      if (resource.creationState === 'PREPARED') {
        await this.resources.verifyCleanup(executionId, {
          creationId: resource.creationId,
          kind: 'NOT_DISPATCHED',
        });
        return true;
      }
      const runner = await import('@alunza/runner');
      const evidence = await runner.recoverVercelSandbox({
        token: this.credentials(resource),
        teamId: resource.context.teamId,
        projectId: resource.context.projectId,
        sandboxName: resource.sandboxName,
        sandboxId: resource.providerResourceId,
        owner: OWNER,
        correlationId: resource.creationId,
        creationState: resource.creationState,
        image: resource.context.image,
        region: resource.context.region,
        cleanupDeadlineMs:
          Date.now() + Math.max(1, Math.min(30_000, timeoutMs)),
        allowRequest: (cleanup) =>
          this.resources.consumeRequest(
            executionId,
            resource.creationId,
            cleanup,
          ),
        recordResource: async ({ sandboxId }) => {
          await this.resources.confirmResource(
            executionId,
            resource.creationId,
            sandboxId,
          );
        },
      });
      const cleaned = await this.persistCleanup(resource, evidence);
      if (!cleaned)
        this.logger.warn({
          event: 'sandbox.cleanup.pending',
          executionId,
          check: evidence.cleanupCheck,
        });
      return cleaned;
    } catch {
      this.logger.warn({ event: 'sandbox.cleanup.pending', executionId });
      return false;
    }
  }

  async onModuleDestroy() {
    this.stopped = true;
    await Promise.allSettled([...this.active]);
  }
}
