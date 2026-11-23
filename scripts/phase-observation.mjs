import { performance } from 'node:perf_hooks';
import { hostSnapshot } from './lab-observability.mjs';

/** Local-only, bounded host sensor. Failed observations never become zeroes. */
export function createPhaseHostObserver({
  snapshot = hostSnapshot,
  now = () => performance.now(),
  wall = () => Date.now(),
  schedule = setInterval,
  cancel = clearInterval,
  maxSamples = 7200,
} = {}) {
  const started = now();
  const startedAtUnixMs = wall();
  const samples = [];
  let totalSelfTimeMs = 0;
  let dropped = 0;
  let failed = 0;
  let result;
  function observe() {
    const tick = now();
    let sample;
    try {
      if (samples.length >= maxSamples) {
        dropped++;
        return;
      }
      sample = {
        timestampUnixMs: wall(),
        elapsedMs: tick - started,
        observerSelfTimeMs: 0,
        host: snapshot(),
      };
      samples.push(sample);
    } catch {
      failed++;
    } finally {
      totalSelfTimeMs += Math.max(0, now() - tick);
      if (sample) sample.observerSelfTimeMs = totalSelfTimeMs;
    }
  }
  observe();
  const timer = schedule(observe, 1000);
  timer?.unref?.();
  return {
    stop() {
      if (result) return result;
      cancel(timer);
      observe();
      result = {
        samples,
        elapsedMs: Math.max(0, now() - started),
        totalSelfTimeMs,
        dropped,
        failed,
        startedAtUnixMs,
        endedAtUnixMs: wall(),
      };
      return result;
    },
  };
}

/** Unrelated service output is neither returned nor parsed as evidence. */
export function readPhaseDiagnosticEvents(output, { maxRecords = 50000 } = {}) {
  const events = [];
  let malformed = 0;
  let dropped = 0;
  for (const line of output.split(/\r?\n/)) {
    if (!line.includes('PHASE_DIAGNOSTIC_')) continue;
    if (Buffer.byteLength(line) > 32768) {
      malformed++;
      continue;
    }
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      malformed++;
      continue;
    }
    if (
      !['PHASE_DIAGNOSTIC_REQUEST', 'PHASE_DIAGNOSTIC_PROCESS'].includes(
        value?.event,
      ) ||
      value.schemaVersion !== 1
    ) {
      malformed++;
      continue;
    }
    if (events.length >= maxRecords) dropped++;
    else events.push(value);
  }
  return { events, malformed, dropped };
}
