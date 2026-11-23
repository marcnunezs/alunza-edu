import { performance } from 'node:perf_hooks';

// Process protocol of the trusted remote driver. Only this marker and an exit
// code cross the command channel. The private result uses a separate file.
export const remoteDriverFailureMarker = 'REMOTE_CAPSULE_FAILED\n';
export const remoteDriverExitCodes = Object.freeze({
  ARGUMENTS: 64,
  INPUT_STAT: 65,
  INPUT_READ: 66,
  INPUT_DECODE: 67,
  CAPSULE: 68,
  ENGINE_RESOLVE: 69,
  IMAGE_RESOLVE: 70,
  CREATE: 71,
  PRE_INSPECT: 72,
  ATTACH_OUTPUT: 73,
  ATTACH_INPUT: 74,
  START: 75,
  SEND: 76,
  STREAMS: 77,
  WAIT: 78,
  FINAL_STATE: 79,
  CONTAINER_CLEANUP: 80,
  RESULT_ENCODE: 81,
  RESULT_WRITE: 82,
  RESULT_CHOWN: 83,
  INPUT_UNLINK: 84,
  FILE_CLEANUP: 85,
});

const startOutcomes = new Set([
  'HTTP_RESPONSE',
  'INCOMPLETE_RESPONSE',
  'INVALID_RESPONSE',
  'RESPONSE_LIMIT',
  'SOCKET_ERROR',
  'CANCELLED',
  'DEADLINE',
]);
const startRuntimeCauses = new Set(['CGROUP', 'MOUNT', 'PERMISSION', null]);
const startContainerStates = new Set([
  'created',
  'running',
  'paused',
  'restarting',
  'removing',
  'exited',
  'dead',
  'absent',
  'unknown',
]);
const startDetailFields = new Set([
  'httpStatus',
  'outcome',
  'runtimeCause',
  'containerState',
  'hasStarted',
  'oomKilled',
]);

// The supervisor, API adapter and journal share this projection. A future
// producer cannot accidentally pass a daemon message through any of them.
export function safeRemoteStartFailureDetail(value) {
  if (!value || typeof value !== 'object') return null;
  const keys = Object.keys(value);
  if (
    keys.length !== startDetailFields.size ||
    !keys.every((key) => startDetailFields.has(key))
  )
    return null;
  const {
    httpStatus,
    outcome,
    runtimeCause,
    containerState,
    hasStarted,
    oomKilled,
  } = value;
  if (
    (httpStatus !== null &&
      (!Number.isInteger(httpStatus) ||
        httpStatus < 100 ||
        httpStatus > 599)) ||
    !startOutcomes.has(outcome) ||
    (outcome === 'HTTP_RESPONSE' &&
      (httpStatus === null || httpStatus === 204)) ||
    !startRuntimeCauses.has(runtimeCause) ||
    !startContainerStates.has(containerState) ||
    (hasStarted !== null && typeof hasStarted !== 'boolean') ||
    (oomKilled !== null && typeof oomKilled !== 'boolean')
  )
    return null;
  return {
    httpStatus,
    outcome,
    runtimeCause,
    containerState,
    hasStarted,
    oomKilled,
  };
}

export function recordDriverFailure(observer, phase) {
  if (
    typeof observer !== 'function' ||
    !Object.hasOwn(remoteDriverExitCodes, phase)
  )
    return;
  try {
    const result = observer(phase);
    if (result && typeof result.then === 'function')
      void Promise.resolve(result).catch(() => undefined);
  } catch {
    /* An observer cannot prevent cleanup or mask the original exception. */
  }
}

const phases = new Set([
  'engineResolve',
  'imageResolve',
  'create',
  'preInspect',
  'attachOutput',
  'attachInput',
  'start',
  'send',
  'streams',
  'wait',
  'postInspect',
  'delete',
  'verifyAbsent',
  'hostStartAttach',
  'containerWall',
  'supervisor',
]);

function observedTimeMs() {
  try {
    const value = performance.now();
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Optional private observation; it never controls execution or carries inputs. */
export function observeDuration(observer, phase, durationMs, completed = true) {
  if (
    typeof observer !== 'function' ||
    !phases.has(phase) ||
    !Number.isFinite(durationMs) ||
    durationMs < 0 ||
    typeof completed !== 'boolean'
  )
    return;
  try {
    const result = observer(Object.freeze({ phase, durationMs, completed }));
    // A caller may accidentally provide an async observer despite the void type.
    // Never await it or let its rejection affect the runner or cleanup.
    if (result && typeof result.then === 'function')
      void Promise.resolve(result).catch(() => undefined);
  } catch {
    /* Observation failures cannot change the operation's result. */
  }
}

/** Completion means this observed operation fulfilled, not student success. */
export async function measureTiming(observer, phase, operation) {
  if (typeof observer !== 'function') return operation();
  const started = observedTimeMs();
  if (started === undefined) return operation();
  let completed = false;
  try {
    const result = await operation();
    completed = true;
    return result;
  } finally {
    const finished = observedTimeMs();
    if (finished !== undefined)
      observeDuration(
        observer,
        phase,
        Math.max(0, finished - started),
        completed,
      );
  }
}
