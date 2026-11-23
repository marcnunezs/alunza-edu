import type { CapsuleAdapter, ExecutionInput } from './index.js';
import { DockerAdapter } from './index.js';
import { validateDockerRuntimeConfig } from '../../../infra/runner/docker-runtime.mjs';
import {
  prepareDockerCapsule,
  cleanupPreparedSlot,
  cleanupBoundDockerExecution,
  type PreparedCapsule,
} from '../../../infra/runner/prepared-capsule.mjs';

/** Server-owned configuration. No client request may select these values. */
export type DockerRuntimeConfig = Readonly<{
  runtime: 'runc' | 'crun';
  runtimeName: string;
  runtimeVersion: string;
  runtimeSha256: string;
  strategy: 'cold' | 'prepared-pair-v1';
}>;

export type DockerRuntimeIdentity = Readonly<{
  engineId: string;
  runtimeName: string;
  runtimeVersion: string;
  runtimeSha256: string;
  strategy: 'cold' | 'prepared-pair-v1';
}>;

export type PreparedDockerContext = DockerRuntimeIdentity &
  Readonly<{
    provider: 'docker';
    image: string;
    runnerVersion: string;
  }>;

export type DockerPreparedSlot = Readonly<{
  resourceId: string;
  name: string;
  containerId: string | null;
  creationState: 'PREPARED' | 'UNKNOWN' | 'CONFIRMED';
  cleanupState: 'PENDING' | 'VERIFIED';
}>;

export type DockerPreparedPair = Readonly<{
  pairId: string;
  context: PreparedDockerContext;
  creatorToken: string;
  ownerToken: string;
  leaseExpiresAt: string;
  expiresAt: string;
  state: 'PREPARING' | 'READY' | 'ASSIGNED' | 'RETIRED';
  executionId: string | null;
  recoveryOnly: boolean;
  slots: readonly [DockerPreparedSlot, DockerPreparedSlot];
}>;

export type DockerCleanupEvidence =
  | Readonly<{ kind: 'NOT_DISPATCHED' }>
  | Readonly<{ kind: 'ABSENT'; containerId: string }>;

/** A SQL implementation must commit each transition before resolving it. */
export interface DockerPreparedResourcePort {
  /** DB clock supplies the 60s lease/expiry; at most one reserve per engine. */
  reservePair(
    context: PreparedDockerContext,
    ownerToken: string,
  ): Promise<DockerPreparedPair | null>;
  authorizeCreate(
    pairId: string,
    resourceId: string,
    ownerToken: string,
  ): Promise<void>;
  /** Late identities are accepted for observation/cleanup, never authority. */
  confirmCreated(
    pairId: string,
    resourceId: string,
    containerId: string,
  ): Promise<void>;
  markPairReady(pairId: string, ownerToken: string): Promise<void>;
  /** SQL rechecks owner, execution lease, context and >40s remaining TTL. */
  assignPair(
    pairId: string,
    ownerToken: string,
    executionId: string,
    executionLeaseToken: string,
  ): Promise<DockerPreparedPair>;
  assertAssignment(
    pairId: string,
    resourceId: string,
    ownerToken: string,
    executionId: string,
    executionLeaseToken: string,
  ): Promise<void>;
  /** UNKNOWN plus a 404 is never sufficient cleanup evidence. */
  markClean(
    pairId: string,
    resourceId: string,
    evidence: DockerCleanupEvidence,
  ): Promise<void>;
  /** ASSIGNED remains exclusive until this post-HTTP-close acknowledgement. */
  releasePair(pairId: string, ownerToken: string): Promise<void>;
  listExecutionPairs(
    executionId: string,
    context: PreparedDockerContext,
  ): Promise<readonly DockerPreparedPair[]>;
  /** Rotates owner tokens and returns only resources eligible for retirement. */
  claimRecovery(
    context: PreparedDockerContext,
    ownerToken: string,
  ): Promise<readonly DockerPreparedPair[]>;
}

export type DockerExecutionAuthority = Readonly<{
  leaseToken: string;
  normalDeadlineMs: number;
  cleanupDeadlineMs: number;
  /** Revalidates the admitted execution, including cold cases after a pair. */
  assertActive(): Promise<void>;
}>;

export interface DockerPreparedPoolContract {
  /** Explicit operational warmup/replenishment, never a health inspection. */
  prepare(context: PreparedDockerContext, signal?: AbortSignal): Promise<void>;
  adapterFor(
    input: ExecutionInput,
    context: PreparedDockerContext,
    authority: DockerExecutionAuthority,
  ): Promise<CapsuleAdapter>;
  /** Caller invokes only after durable finish, authorization and HTTP close. */
  afterRequestClosed(
    executionId: string,
    context: PreparedDockerContext,
    options: { replenish: boolean },
  ): Promise<void>;
  cleanup(
    executionId: string,
    context: PreparedDockerContext,
    signal?: AbortSignal,
  ): Promise<boolean>;
  sweep(
    context: PreparedDockerContext,
    signal?: AbortSignal,
  ): Promise<{ cleanupVerified: boolean; removed: number }>;
  drain(): Promise<void>;
}

async function bounded<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  signal.throwIfAborted();
  let stop: () => void = () => undefined;
  const cancelled = new Promise<never>((_, reject) => {
    const abort = () => reject(new Error('Docker operation deadline'));
    signal.addEventListener('abort', abort, { once: true });
    stop = () => signal.removeEventListener('abort', abort);
    if (signal.aborted) abort();
  });
  try {
    return await Promise.race([operation, cancelled]);
  } finally {
    stop();
  }
}

type LocalPair = {
  pair: DockerPreparedPair;
  capsules: readonly PreparedCapsule[];
  requestClosed: boolean;
};
const contextFields = [
  'provider',
  'image',
  'runnerVersion',
  'engineId',
  'runtimeName',
  'runtimeVersion',
  'runtimeSha256',
  'strategy',
] as const;
const sameContext = (
  left: PreparedDockerContext,
  right: PreparedDockerContext,
) => contextFields.every((key) => left[key] === right[key]);

/** Owns live channels only. PostgreSQL owns resource identity and authority. */
export class DockerPreparedPool implements DockerPreparedPoolContract {
  private readonly runtime?: DockerRuntimeConfig;
  private readonly resources: DockerPreparedResourcePort;
  private readonly ownerToken: string;
  private ready?: LocalPair;
  private preparation?: Promise<void>;
  private idleTimer?: ReturnType<typeof setTimeout>;
  private claiming = false;
  private stopped = false;
  private readonly active = new Map<string, LocalPair>();
  private readonly changed = new Set<() => void>();
  private readonly operations = new Set<Promise<unknown>>();

  constructor(options: {
    runtime?: DockerRuntimeConfig;
    resources: DockerPreparedResourcePort;
    ownerToken: string;
  }) {
    this.runtime =
      options.runtime === undefined
        ? undefined
        : validateDockerRuntimeConfig(options.runtime);
    if (
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
        options.ownerToken,
      )
    )
      throw new Error('Docker pool owner UUID required');
    this.resources = options.resources;
    this.ownerToken = options.ownerToken;
  }

  private validate(context: PreparedDockerContext) {
    if (
      !this.runtime ||
      context.provider !== 'docker' ||
      !/^sha256:[a-f0-9]{64}$/.test(context.image) ||
      !context.runnerVersion ||
      !context.engineId ||
      context.runtimeName !== this.runtime.runtimeName ||
      context.runtimeVersion !== this.runtime.runtimeVersion ||
      context.runtimeSha256 !== this.runtime.runtimeSha256 ||
      context.strategy !== this.runtime.strategy
    )
      throw new Error(
        'Admitted Docker context differs from configured runtime',
      );
  }

  private notify() {
    for (const wake of [...this.changed]) wake();
  }

  private wait(signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
      const done = () => {
        clearTimeout(timer);
        this.changed.delete(done);
        signal.removeEventListener('abort', abort);
        resolve();
      };
      const abort = () => {
        clearTimeout(timer);
        this.changed.delete(done);
        reject(new Error('Docker pool wait deadline'));
      };
      this.changed.add(done);
      signal.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(done, 100);
      if (signal.aborted) abort();
    });
  }

  private async retire(local: LocalPair, signal = AbortSignal.timeout(10000)) {
    const results = await Promise.allSettled(
      local.capsules.map((capsule) => bounded(capsule.cleanup(signal), signal)),
    );
    return results.every(
      (result) => result.status === 'fulfilled' && result.value === true,
    );
  }

  private async forgetRetiredClosures(signal: AbortSignal) {
    // Another replica can finish retirement after this process lost its close
    // response. Only durable retirement of the exact, already closed request
    // releases the local reference; an absent row or rotated owner is not proof.
    if (this.operations.size) return;
    for (const [executionId, local] of this.active) {
      if (!local.requestClosed) continue;
      const pairs = await bounded(
        this.resources.listExecutionPairs(executionId, local.pair.context),
        signal,
      );
      const retired = pairs.find((pair) => pair.pairId === local.pair.pairId);
      if (
        !retired ||
        retired.state !== 'RETIRED' ||
        retired.executionId !== executionId ||
        retired.creatorToken !== local.pair.creatorToken ||
        !sameContext(retired.context, local.pair.context) ||
        retired.slots.length !== 2 ||
        retired.slots.some((slot, index) => {
          const own = local.pair.slots[index];
          return (
            !own ||
            slot.resourceId !== own.resourceId ||
            slot.containerId !== own.containerId ||
            slot.creationState !== 'CONFIRMED' ||
            slot.creationState !== own.creationState ||
            slot.cleanupState !== 'VERIFIED'
          );
        }) ||
        this.operations.size ||
        this.active.get(executionId) !== local
      )
        continue;
      this.active.delete(executionId);
      this.notify();
    }
  }

  async prepare(
    context: PreparedDockerContext,
    signal?: AbortSignal,
    cleanupDeadlineMs = Date.now() + 40000,
  ): Promise<void> {
    this.validate(context);
    if (this.active.size)
      await this.forgetRetiredClosures(signal ?? AbortSignal.timeout(10000));
    if (
      context.strategy !== 'prepared-pair-v1' ||
      this.stopped ||
      this.ready ||
      this.active.size
    )
      return;
    if (this.preparation) return this.preparation;
    const deadline = AbortSignal.any([
      AbortSignal.timeout(30000),
      ...(signal ? [signal] : []),
    ]);
    const operation = async () => {
      const pair = await bounded(
        this.resources.reservePair(context, this.ownerToken),
        deadline,
      );
      deadline.throwIfAborted();
      if (!pair) return;
      if (
        pair.ownerToken !== this.ownerToken ||
        pair.creatorToken !== this.ownerToken ||
        pair.recoveryOnly ||
        pair.state !== 'PREPARING' ||
        pair.executionId !== null ||
        pair.slots.length !== 2 ||
        pair.slots[0].resourceId === pair.slots[1].resourceId ||
        !sameContext(pair.context, context)
      )
        throw new Error('Docker preparation reservation invalid');
      const made = await Promise.allSettled(
        pair.slots.map((slot) =>
          prepareDockerCapsule(
            pair,
            slot,
            this.runtime!,
            this.resources,
            deadline,
            cleanupDeadlineMs,
          ),
        ),
      );
      const capsules = made.flatMap((result) =>
        result.status === 'fulfilled' ? [result.value] : [],
      );
      const local = { pair, capsules, requestClosed: false };
      try {
        deadline.throwIfAborted();
        const [first, second] = capsules;
        if (
          this.stopped ||
          made.some((result) => result.status === 'rejected') ||
          capsules.length !== 2 ||
          !first ||
          !second
        )
          throw new Error('Docker pair preparation failed');
        if (!first.boundary || first.boundary !== second.boundary)
          throw new Error(
            'Docker pair must share the executor resource boundary',
          );
        await bounded(
          this.resources.markPairReady(pair.pairId, this.ownerToken),
          deadline,
        );
        deadline.throwIfAborted();
        this.ready = local;
        this.idleTimer = setTimeout(
          () => {
            if (this.ready !== local || this.claiming) return;
            this.ready = undefined;
            void this.retire(local)
              .catch(() => false)
              .finally(() => this.notify());
          },
          Math.max(1, Date.parse(pair.expiresAt) - Date.now()),
        );
        this.idleTimer.unref?.();
      } catch (error) {
        const remaining = Math.floor(cleanupDeadlineMs - Date.now());
        await this.retire(
          local,
          remaining <= 0
            ? AbortSignal.abort()
            : AbortSignal.timeout(Math.min(10000, remaining)),
        );
        throw error;
      }
    };
    this.preparation = operation().finally(() => {
      this.preparation = undefined;
      this.notify();
    });
    return this.preparation;
  }

  async adapterFor(
    input: ExecutionInput,
    context: PreparedDockerContext,
    authority: DockerExecutionAuthority,
  ): Promise<CapsuleAdapter> {
    this.validate(context);
    if (
      this.stopped ||
      !Number.isSafeInteger(authority.normalDeadlineMs) ||
      authority.normalDeadlineMs <= Date.now()
    )
      throw new Error('Docker execution authority expired');
    const signal = AbortSignal.timeout(
      Math.max(1, authority.normalDeadlineMs - Date.now()),
    );
    await bounded(authority.assertActive(), signal);
    const coldAdapter = (expectedBoundary?: string) =>
      new DockerAdapter({
        image: context.image,
        runtime: context,
        beforeSend: authority.assertActive,
        deadlineMs: authority.normalDeadlineMs,
        expectedBoundary,
      });
    if (context.strategy === 'cold') return coldAdapter();
    let local: LocalPair;
    for (;;) {
      signal.throwIfAborted();
      if (this.stopped) throw new Error('Docker pool draining');
      if (this.active.size) await this.forgetRetiredClosures(signal);
      if (!this.active.size && !this.ready)
        await bounded(
          this.prepare(context, signal, authority.cleanupDeadlineMs),
          signal,
        );
      if (this.ready && !this.claiming && !this.active.size) {
        this.claiming = true;
        const candidate = this.ready;
        try {
          if (
            !sameContext(candidate.pair.context, context) ||
            Date.parse(candidate.pair.expiresAt) - Date.now() <= 40000 ||
            candidate.capsules.some((capsule) => !capsule.usable())
          ) {
            this.ready = undefined;
            clearTimeout(this.idleTimer);
            await this.retire(candidate);
            continue;
          }
          const assigned = await bounded(
            this.resources.assignPair(
              candidate.pair.pairId,
              this.ownerToken,
              input.executionId,
              authority.leaseToken,
            ),
            signal,
          );
          if (
            assigned.pairId !== candidate.pair.pairId ||
            assigned.creatorToken !== candidate.pair.creatorToken ||
            !sameContext(assigned.context, context) ||
            assigned.slots.some(
              (slot, index) =>
                slot.resourceId !== candidate.pair.slots[index]?.resourceId,
            ) ||
            assigned.executionId !== input.executionId ||
            assigned.state !== 'ASSIGNED' ||
            assigned.recoveryOnly ||
            assigned.ownerToken !== this.ownerToken
          )
            throw new Error('Docker pair assignment unconfirmed');
          local = { ...candidate, pair: assigned };
          this.ready = undefined;
          clearTimeout(this.idleTimer);
          this.active.set(input.executionId, local);
          signal.throwIfAborted();
          break;
        } finally {
          this.claiming = false;
          this.notify();
        }
      }
      await this.wait(signal);
    }
    const boundary = local.capsules[0]?.boundary;
    if (!boundary) throw new Error('Docker pair executor boundary unavailable');
    const cold = coldAdapter(boundary);
    let index = 0,
      closed = false;
    return {
      provider: 'docker',
      execute: async (capsuleInput, executionSignal) => {
        if (
          closed ||
          local.requestClosed ||
          capsuleInput.executionId !== input.executionId ||
          this.stopped
        )
          throw new Error('Docker pair execution unavailable');
        const capsule = local.capsules[index++];
        const call = capsule
          ? capsule.consume(capsuleInput, {
              signal: executionSignal,
              deadlineMs: authority.normalDeadlineMs,
              cleanupDeadlineMs: authority.cleanupDeadlineMs,
              beforeSend: async () => {
                await authority.assertActive();
                await this.resources.assertAssignment(
                  local.pair.pairId,
                  capsule.resourceId,
                  this.ownerToken,
                  input.executionId,
                  authority.leaseToken,
                );
              },
            })
          : cold.execute(capsuleInput, executionSignal);
        this.operations.add(call);
        try {
          return await call;
        } finally {
          this.operations.delete(call);
        }
      },
      close: async () => {
        if (closed) return;
        closed = true;
        await cold.close();
        if (
          !(await this.retire(
            local,
            AbortSignal.timeout(
              Math.max(
                1,
                Math.min(10000, authority.cleanupDeadlineMs - Date.now()),
              ),
            ),
          ))
        )
          throw new Error('Docker pair cleanup unconfirmed');
        // The pair remains ASSIGNED until afterRequestClosed acknowledges the
        // API transaction, authorization and completed HTTP response.
      },
    };
  }

  async cleanup(
    executionId: string,
    context: PreparedDockerContext,
    signal = AbortSignal.timeout(10000),
  ): Promise<boolean> {
    try {
      const pairs = await bounded(
        this.resources.listExecutionPairs(executionId, context),
        signal,
      );
      for (const pair of pairs) {
        for (const slot of pair.slots)
          if (
            !(await bounded(
              cleanupPreparedSlot(pair, slot, this.resources, signal),
              signal,
            ))
          )
            return false;
      }
      return (await cleanupBoundDockerExecution(executionId, context, signal))
        .cleanupVerified;
    } catch {
      return false;
    }
  }

  async afterRequestClosed(
    executionId: string,
    context: PreparedDockerContext,
    options: { replenish: boolean },
  ): Promise<void> {
    const local = this.active.get(executionId);
    if (local) {
      local.requestClosed = true;
      if (!(await this.cleanup(executionId, context)))
        throw new Error('Docker request cleanup pending');
      await this.resources.releasePair(local.pair.pairId, this.ownerToken);
      this.active.delete(executionId);
      this.notify();
    }
    if (options.replenish && !this.stopped) await this.prepare(context);
  }

  async sweep(
    context: PreparedDockerContext,
    signal = AbortSignal.timeout(30000),
  ): Promise<{ cleanupVerified: boolean; removed: number }> {
    let removed = 0;
    try {
      await this.forgetRetiredClosures(signal);
      const pairs = await bounded(
        this.resources.claimRecovery(context, this.ownerToken),
        signal,
      );
      for (const pair of pairs) {
        for (const slot of pair.slots) {
          if (
            !(await bounded(
              cleanupPreparedSlot(pair, slot, this.resources, signal),
              signal,
            ))
          )
            return { cleanupVerified: false, removed };
          if (slot.cleanupState !== 'VERIFIED') removed++;
        }
        await bounded(
          this.resources.releasePair(pair.pairId, pair.ownerToken),
          signal,
        );
        if (pair.executionId) {
          const local = this.active.get(pair.executionId);
          if (local?.requestClosed && !this.operations.size)
            this.active.delete(pair.executionId);
        }
      }
      this.notify();
      return { cleanupVerified: true, removed };
    } catch {
      return { cleanupVerified: false, removed };
    }
  }

  async drain(): Promise<void> {
    const grace = AbortSignal.timeout(50000);
    this.stopped = true;
    clearTimeout(this.idleTimer);
    // Do not cancel a committed create authorization merely because graceful
    // shutdown began: its sole POST may not yet have been dispatched. Let the
    // existing 30s preparation deadline finish and retire its received IDs.
    // Real cancellation/deadline signals still stop preparation normally.
    this.notify();
    await bounded(this.preparation ?? Promise.resolve(), grace).catch(
      () => undefined,
    );
    await bounded(
      Promise.allSettled([...this.operations]),
      AbortSignal.any([grace, AbortSignal.timeout(30000)]),
    ).catch(() => undefined);
    if (this.ready) {
      const ready = this.ready;
      this.ready = undefined;
      await this.retire(
        ready,
        AbortSignal.any([grace, AbortSignal.timeout(10000)]),
      );
    }
    await Promise.allSettled(
      [...this.active.entries()].map(async ([executionId, local]) => {
        if (
          await this.retire(
            local,
            AbortSignal.any([grace, AbortSignal.timeout(10000)]),
          )
        ) {
          // Shutdown never replenishes. SQL still rejects release of an
          // unfinished execution, leaving its durable recovery record intact.
          await bounded(
            this.resources.releasePair(
              local.pair.pairId,
              local.pair.ownerToken,
            ),
            grace,
          );
          this.active.delete(executionId);
        }
      }),
    );
  }
}
