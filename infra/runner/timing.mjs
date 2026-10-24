import { performance } from 'node:perf_hooks';

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
