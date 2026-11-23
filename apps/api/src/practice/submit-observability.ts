const submissionPhases = new Set([
  'authorizeInitial',
  'inspect',
  'admit',
  'suite',
  'execute',
  'cleanupFallback',
  'stage',
  'finish',
  'authorizeFinal',
  'total',
]);
const dockerPhases = new Set([
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
const backgroundPhases = new Set([
  'total',
  'sweep',
  'purge',
  'claim',
  'recover',
]);
const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && value.length === 36 && uuid.test(value);
}

export interface SubmitTimingContext {
  requestId: string;
  executionId?: string;
}
export interface SubmitTimingObservation {
  source: 'docker' | 'submission';
  phase: string;
  durationMs: number;
  completed: boolean;
}
export type SubmitTimingObserver = (timing: SubmitTimingObservation) => void;
export type SubmitBackgroundPhase =
  'total' | 'sweep' | 'purge' | 'claim' | 'recover';
export interface SubmitBackgroundTimingObservation {
  phase: SubmitBackgroundPhase;
  durationMs: number;
  completed: boolean;
  count?: number;
}
export type SubmitBackgroundTimingObserver = (
  timing: SubmitBackgroundTimingObservation,
) => void;

function validCount(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 10000
  );
}

function observedAtMs(): number | undefined {
  try {
    const now = performance.now();
    return Number.isFinite(now) && now >= 0 ? now : undefined;
  } catch {
    return undefined;
  }
}

function ignoreRejectedObservation(result: unknown) {
  // A callback typed void can still be implemented with an async function.
  if (result && typeof (result as { then?: unknown }).then === 'function')
    void Promise.resolve(result).catch(() => undefined);
}

function emitSubmitClockAnchor(
  requestId: string,
  boundary: 'start' | 'end',
  output: (line: string) => void,
) {
  try {
    const before = performance.now();
    const utcMs = Date.now();
    const after = performance.now();
    const uncertaintyMs = after - before;
    const monotonicMs = before + uncertaintyMs / 2;
    if (
      !Number.isFinite(before) ||
      before < 0 ||
      !Number.isFinite(after) ||
      after < 0 ||
      !Number.isFinite(monotonicMs) ||
      monotonicMs < 0 ||
      !Number.isSafeInteger(utcMs) ||
      utcMs < 0 ||
      !Number.isFinite(uncertaintyMs) ||
      uncertaintyMs < 0 ||
      uncertaintyMs > 10
    )
      return;
    ignoreRejectedObservation(
      output(
        JSON.stringify({
          event: 'TEST_SUBMIT_CLOCK',
          version: 1,
          requestId,
          boundary,
          monotonicMs,
          utcMs,
          uncertaintyMs,
        }),
      ),
    );
  } catch {
    // Clock alignment is optional and cannot suppress the timing observation.
  }
}

/** Private TEST diagnostics: no DTO, persisted evidence or arbitrary log payload. */
export function createSubmitTimingObserver(
  environment: string,
  context: SubmitTimingContext,
  flag = process.env.ALUNZA_TEST_SUBMIT_TIMINGS,
  output: (line: string) => void = (line) => console.log(line),
  continuousFlag = process.env.ALUNZA_TEST_SUBMIT_CONTINUOUS_DIAGNOSTICS,
): SubmitTimingObserver | undefined {
  if (environment !== 'test' || flag !== '1') return undefined;
  let clockStarted = false;
  let clockEnded = false;
  return (timing) => {
    // Diagnostics are optional even when the observer or stdout is unavailable.
    try {
      const phases =
        timing.source === 'docker'
          ? dockerPhases
          : timing.source === 'submission'
            ? submissionPhases
            : null;
      if (
        !phases?.has(timing.phase) ||
        !Number.isFinite(timing.durationMs) ||
        timing.durationMs < 0 ||
        typeof timing.completed !== 'boolean' ||
        !isUuid(context.requestId) ||
        (context.executionId !== undefined && !isUuid(context.executionId))
      )
        return;
      if (continuousFlag === '1' && timing.source === 'submission') {
        if (!clockStarted) {
          clockStarted = true;
          emitSubmitClockAnchor(context.requestId, 'start', output);
        }
        if (timing.phase === 'total' && !clockEnded) {
          clockEnded = true;
          emitSubmitClockAnchor(context.requestId, 'end', output);
        }
      }
      const observed = observedAtMs();
      if (observed === undefined) return;
      ignoreRejectedObservation(
        output(
          JSON.stringify({
            event: 'TEST_SUBMIT_TIMING',
            version: 2,
            requestId: context.requestId,
            ...(context.executionId !== undefined
              ? { executionId: context.executionId }
              : {}),
            source: timing.source,
            phase: timing.phase,
            observedAtMs: observed,
            durationMs: timing.durationMs,
            completed: timing.completed,
          }),
        ),
      );
    } catch {
      // Never change submission, cleanup or persistence because of an observer.
    }
  };
}

/** Fixed background counters share the TEST process clock with request spans. */
export function createSubmitBackgroundObserver(
  environment: string,
  worker: 'RUN' | 'SUBMIT',
  flag = process.env.ALUNZA_TEST_SUBMIT_TIMINGS,
  output: (line: string) => void = (line) => console.log(line),
): SubmitBackgroundTimingObserver | undefined {
  if (
    environment !== 'test' ||
    flag !== '1' ||
    !['RUN', 'SUBMIT'].includes(worker)
  )
    return undefined;
  return (timing) => {
    try {
      if (
        !backgroundPhases.has(timing.phase) ||
        !Number.isFinite(timing.durationMs) ||
        timing.durationMs < 0 ||
        typeof timing.completed !== 'boolean' ||
        (timing.count !== undefined && !validCount(timing.count))
      )
        return;
      const observed = observedAtMs();
      if (observed === undefined) return;
      ignoreRejectedObservation(
        output(
          JSON.stringify({
            event: 'TEST_SUBMIT_BACKGROUND',
            version: 1,
            worker,
            phase: timing.phase,
            observedAtMs: observed,
            durationMs: timing.durationMs,
            completed: timing.completed,
            ...(timing.count === undefined ? {} : { count: timing.count }),
          }),
        ),
      );
    } catch {
      // Recovery and capsule cleanup are independent from diagnostics.
    }
  };
}

export async function measureSubmitBackgroundPhase<T>(
  observer: SubmitBackgroundTimingObserver | undefined,
  phase: SubmitBackgroundPhase,
  operation: () => Promise<T>,
  countOf?: (result: T) => number,
): Promise<T> {
  if (!observer) return operation();
  const started = observedAtMs();
  if (started === undefined) return operation();
  let completed = false;
  let count: number | undefined;
  try {
    const result = await operation();
    completed = true;
    if (countOf) {
      try {
        const projected = countOf(result);
        if (validCount(projected)) count = projected;
        else ignoreRejectedObservation(projected);
      } catch {
        // Only the bounded numeric projection may be lost, never the result.
      }
    }
    return result;
  } finally {
    try {
      const finished = observedAtMs();
      if (finished !== undefined)
        ignoreRejectedObservation(
          observer({
            phase,
            durationMs: Math.max(0, finished - started),
            completed,
            ...(count === undefined ? {} : { count }),
          }),
        );
    } catch {
      // Optional callbacks, including async ones, cannot change a worker result.
    }
  }
}

export async function measureSubmitPhase<T>(
  observer: SubmitTimingObserver | undefined,
  phase: string,
  operation: () => Promise<T>,
): Promise<T> {
  if (!observer) return operation();
  const started = observedAtMs();
  if (started === undefined) return operation();
  let completed = false;
  try {
    const result = await operation();
    completed = true;
    return result;
  } finally {
    try {
      const finished = observedAtMs();
      if (finished !== undefined)
        ignoreRejectedObservation(
          observer({
            source: 'submission',
            phase,
            durationMs: Math.max(0, finished - started),
            completed,
          }),
        );
    } catch {
      // This seam also tolerates a failing observer supplied by a unit test.
    }
  }
}
