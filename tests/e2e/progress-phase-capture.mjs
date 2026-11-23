function matchesOptionalNumber(error, key, expected) {
  if (!(key in error)) return true;
  const value = error[key];
  return (
    (typeof value === 'number' &&
      Number.isFinite(value) &&
      value === expected) ||
    (typeof value === 'string' && value === String(expected))
  );
}

/** Recover only the three post-measurement captures skipped by PHASE-08's p95 assertion. */
export function shouldRecoverProgressCaptures(input) {
  const measurement = input?.measurement;
  const error = input?.error;
  const message =
    typeof error?.message === 'string'
      ? /^expected ([0-9]+(?:\.[0-9]+)?) to be below 3000$/.exec(error.message)
      : null;
  return (
    input?.failed === true &&
    input?.hasContext === true &&
    typeof input?.testTitle === 'string' &&
    input.testTitle.startsWith('IMP05-PHASE-08 · ') &&
    measurement?.surface === 'progress' &&
    measurement.concurrency === 4 &&
    measurement.startedAt === null &&
    measurement.firstNavigationValid === true &&
    Number.isFinite(measurement.firstNavigationMs) &&
    measurement.firstNavigationMs >= 0 &&
    Array.isArray(measurement.samples) &&
    measurement.samples.length === 50 &&
    measurement.samples.every(
      (sample) =>
        sample?.valid === true &&
        Number.isFinite(sample.durationMs) &&
        sample.durationMs >= 0,
    ) &&
    Number.isFinite(measurement.p95GateMs) &&
    measurement.p95GateMs >= 3000 &&
    error?.name === 'AssertionError' &&
    message !== null &&
    message[0] === error.message &&
    Number(message[1]) === measurement.p95GateMs &&
    // Cypress may serialize diff fields to strings or omit them entirely.
    matchesOptionalNumber(error, 'actual', measurement.p95GateMs) &&
    matchesOptionalNumber(error, 'expected', 3000)
  );
}
