import { performance } from 'node:perf_hooks';
import { command, RUNNER_PREFIX, cleanupDockerExecution } from './capsule.mjs';
import {
  capsuleConfiguration,
  localDockerEngine,
  removeAndVerify,
} from './docker-engine.mjs';
import { inspectDockerRuntime } from './docker-runtime.mjs';
import { verifyKernelControls } from './kernel-controls.mjs';

const owner = 'alunza-edu-laboratorio';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const cid = /^[a-f0-9]{64}$/;
function cleanupSignal(deadlineMs) {
  const remaining = Math.floor(deadlineMs - Date.now());
  return remaining <= 0
    ? AbortSignal.abort()
    : AbortSignal.timeout(Math.min(10000, remaining));
}

async function durable(operation, signal) {
  signal?.throwIfAborted();
  if (!signal) return operation();
  let remove;
  const cancelled = new Promise((_, reject) => {
    const abort = () => reject(new Error('Docker durable operation deadline'));
    signal.addEventListener('abort', abort, { once: true });
    remove = () => signal.removeEventListener('abort', abort);
    if (signal.aborted) abort();
  });
  try {
    return await Promise.race([Promise.resolve().then(operation), cancelled]);
  } finally {
    remove();
  }
}

function labels(pair, slot) {
  return {
    'org.alunza.runner': owner,
    'org.alunza.prepared-pair': pair.pairId,
    'org.alunza.resource': slot.resourceId,
    'org.alunza.creator': pair.creatorToken,
    'org.alunza.engine': pair.context.engineId,
    'org.alunza.expires': String(Date.parse(pair.expiresAt)),
  };
}

function validatePreparedOwnership(value, pair, slot) {
  const c = value?.Config;
  const expected = labels(pair, slot);
  if (
    !cid.test(value?.Id ?? '') ||
    value?.Name !== `/${slot.name}` ||
    value.Image !== pair.context.image ||
    !c ||
    value?.HostConfig?.Runtime !== pair.context.runtimeName ||
    Object.entries(expected).some(([key, data]) => c.Labels?.[key] !== data) ||
    c.Labels?.['org.alunza.execution'] !== undefined ||
    (slot.containerId !== null && slot.containerId !== value.Id)
  )
    throw new Error('Prepared capsule ownership mismatch');
}

export function validatePreparedInspection(
  value,
  pair,
  slot,
  requireRunning = false,
) {
  validatePreparedOwnership(value, pair, slot);
  const h = value.HostConfig,
    c = value.Config;
  if (
    c.Tty !== false ||
    c.OpenStdin !== true ||
    c.StdinOnce !== true ||
    h.Runtime !== pair.context.runtimeName ||
    h.Memory !== 134217728 ||
    h.MemorySwap !== 134217728 ||
    h.NanoCpus !== 1000000000 ||
    h.PidsLimit !== 32 ||
    h.NetworkMode !== 'none' ||
    h.ReadonlyRootfs !== true ||
    h.Privileged !== false ||
    h.Binds?.length ||
    h.Mounts?.length ||
    Object.keys(h.PortBindings ?? {}).length ||
    h.PidMode !== '' ||
    h.IpcMode === 'host' ||
    h.CapDrop?.join(',') !== 'ALL' ||
    [...(h.CapAdd ?? [])]
      .map((v) => v.replace(/^CAP_/, ''))
      .sort()
      .join(',') !== 'KILL,SETGID,SETPCAP,SETUID' ||
    !h.SecurityOpt?.includes('no-new-privileges:true') ||
    (requireRunning &&
      (value.State?.Running !== true ||
        !Number.isSafeInteger(value.State.Pid) ||
        value.State.Pid < 1))
  )
    throw new Error('Prepared capsule ownership or controls mismatch');
}

async function targetEngine(context, signal) {
  const engine = await localDockerEngine(command, signal);
  const info = await engine.request('GET', '/info', { signal });
  if (info.status !== 200 || info.data?.ID !== context.engineId)
    throw new Error('Admitted Docker engine changed');
  return engine;
}
export async function cleanupBoundDockerExecution(
  executionId,
  context,
  signal,
) {
  await targetEngine(context, signal);
  return cleanupDockerExecution(executionId, signal);
}

/** Observation/removal only. An unknown dispatch is never released on a 404. */
export async function cleanupPreparedSlot(
  pair,
  originalSlot,
  resources,
  signal,
) {
  const slot = { ...originalSlot };
  const engine = await targetEngine(pair.context, signal);
  const key = slot.containerId ?? slot.name;
  const inspected = await engine.request(
    'GET',
    `/containers/${encodeURIComponent(key)}/json`,
    { signal },
  );
  if (inspected.status === 404) {
    if (slot.creationState === 'UNKNOWN') return false;
    if (slot.creationState === 'PREPARED')
      await durable(
        () =>
          resources.markClean(pair.pairId, slot.resourceId, {
            kind: 'NOT_DISPATCHED',
          }),
        signal,
      );
    else if (
      slot.creationState === 'CONFIRMED' &&
      cid.test(slot.containerId ?? '')
    )
      await durable(
        () =>
          resources.markClean(pair.pairId, slot.resourceId, {
            kind: 'ABSENT',
            containerId: slot.containerId,
          }),
        signal,
      );
    else return false;
    return true;
  }
  if (inspected.status !== 200) return false;
  validatePreparedOwnership(inspected.data, pair, slot);
  slot.containerId = inspected.data.Id;
  // This accepts a late identity only to persist evidence and retire it.
  await durable(
    () =>
      resources.confirmCreated(pair.pairId, slot.resourceId, slot.containerId),
    signal,
  );
  if (!(await removeAndVerify(engine, slot.containerId, signal))) return false;
  await durable(
    () =>
      resources.markClean(pair.pairId, slot.resourceId, {
        kind: 'ABSENT',
        containerId: slot.containerId,
      }),
    signal,
  );
  return true;
}

export async function prepareDockerCapsule(
  pair,
  originalSlot,
  config,
  resources,
  signal,
  cleanupDeadlineMs = Date.now() + 40000,
) {
  const slot = { ...originalSlot };
  if (
    !uuid.test(pair.pairId) ||
    !uuid.test(pair.creatorToken) ||
    !uuid.test(pair.ownerToken) ||
    !uuid.test(slot.resourceId) ||
    slot.name !== `${RUNNER_PREFIX}${slot.resourceId}` ||
    pair.recoveryOnly ||
    slot.creationState !== 'PREPARED' ||
    slot.cleanupState !== 'PENDING'
  )
    throw new Error('Prepared capsule authorization invalid');
  const expiresAtMs = Date.parse(pair.expiresAt);
  const engine = await targetEngine(pair.context, signal);
  const identity = await inspectDockerRuntime(engine, config, signal);
  if (
    Object.entries(identity).some(([key, value]) => pair.context[key] !== value)
  )
    throw new Error('Prepared capsule runtime changed');
  let channel;
  try {
    signal?.throwIfAborted();
    await durable(
      () =>
        resources.authorizeCreate(
          pair.pairId,
          slot.resourceId,
          pair.ownerToken,
        ),
      signal,
    );
    slot.creationState = 'UNKNOWN';
    signal?.throwIfAborted();
    const made = await engine.request(
      'POST',
      `/containers/create?name=${encodeURIComponent(slot.name)}`,
      {
        signal,
        body: capsuleConfiguration(
          pair.context.image,
          labels(pair, slot),
          undefined,
          pair.context.runtimeName,
        ),
      },
    );
    if (made.status !== 201 || !cid.test(made.data?.Id ?? ''))
      throw new Error('Prepared capsule creation unconfirmed');
    slot.containerId = made.data.Id;
    await durable(
      () =>
        resources.confirmCreated(
          pair.pairId,
          slot.resourceId,
          slot.containerId,
        ),
      cleanupSignal(cleanupDeadlineMs),
    );
    slot.creationState = 'CONFIRMED';
    signal?.throwIfAborted();
    const before = await engine.request(
      'GET',
      `/containers/${slot.containerId}/json`,
      { signal },
    );
    if (before.status !== 200)
      throw new Error('Prepared capsule inspection unavailable');
    validatePreparedInspection(before.data, pair, slot);
    // Persistence of the received ID precedes every start operation.
    channel = await engine.prepareAttach(slot.name, {
      signal,
      containerId: slot.containerId,
      expiresAtMs,
    });
    validatePreparedInspection(channel.inspection, pair, slot, true);
    const boundary = await verifyKernelControls(engine, {
      engineId: pair.context.engineId,
      id: slot.containerId,
      pid: channel.inspection.State.Pid,
      signal,
    });
    signal?.throwIfAborted();
    let consumed = false,
      removed = false;
    const cleanup = async (cleanupSignal) => {
      channel.close();
      const ok = await cleanupPreparedSlot(
        pair,
        slot,
        resources,
        cleanupSignal,
      );
      removed ||= ok;
      return ok;
    };
    return {
      resourceId: slot.resourceId,
      boundary,
      usable: () => !consumed && !removed && channel.usable(),
      cleanup,
      async consume(
        input,
        {
          signal: executionSignal,
          deadlineMs,
          cleanupDeadlineMs: executionCleanupDeadlineMs,
          beforeSend,
        },
      ) {
        if (consumed || removed)
          throw new Error('Prepared capsule already consumed');
        consumed = true;
        const started = performance.now();
        let packet = null,
          exitCode = null,
          oomKilled = false,
          programWallMs = 0,
          containerWallMs = null;
        let failure, cleanupVerified;
        try {
          const value = await channel.consume(JSON.stringify(input), {
            signal: executionSignal,
            deadlineMs,
            beforeSend: async () => {
              await beforeSend();
              // Recheck the observed hierarchy after any idle wait. Runtime and
              // cgroup changes cannot turn a previously ready slot into authority.
              await verifyKernelControls(engine, {
                engineId: pair.context.engineId,
                id: slot.containerId,
                pid: channel.inspection.State.Pid,
                expectedBoundary: boundary,
                signal: executionSignal,
              });
            },
          });
          programWallMs = performance.now() - started;
          try {
            packet = JSON.parse(value.stdout);
          } catch {
            /* incomplete protocol stays null */
          }
          const result = await engine.request(
            'GET',
            `/containers/${slot.containerId}/json`,
            { signal: executionSignal },
          );
          if (result.status !== 200)
            throw new Error('Prepared capsule final state unavailable');
          validatePreparedInspection(result.data, pair, slot);
          const state = result.data.State;
          if (
            state.Running !== false ||
            state.ExitCode !== value.exitCode ||
            typeof state.OOMKilled !== 'boolean'
          )
            throw new Error('Prepared capsule final state unconfirmed');
          exitCode = state.ExitCode;
          oomKilled = state.OOMKilled;
          const beginning = Date.parse(state.StartedAt),
            ending = Date.parse(state.FinishedAt);
          if (beginning > 0 && ending >= beginning)
            containerWallMs = ending - beginning;
        } catch (error) {
          failure = error;
        } finally {
          cleanupVerified = await cleanup(
            cleanupSignal(executionCleanupDeadlineMs),
          ).catch(() => false);
        }
        if (!cleanupVerified)
          throw new Error('Prepared capsule cleanup unconfirmed');
        if (failure) throw failure;
        return {
          packet,
          exitCode,
          oomKilled,
          timedOut: false,
          cancelled: executionSignal?.aborted ?? false,
          cleanupVerified,
          programWallMs,
          containerWallMs,
          lifecycleMs: performance.now() - started,
          image: pair.context.image,
        };
      },
    };
  } catch (error) {
    channel?.close();
    await cleanupPreparedSlot(
      pair,
      slot,
      resources,
      cleanupSignal(cleanupDeadlineMs),
    ).catch(() => false);
    throw error;
  }
}
