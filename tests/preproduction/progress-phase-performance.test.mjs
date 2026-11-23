import { phasePerformanceSummary } from '../../scripts/progress-phase-performance.mjs';

const samples = (surface = 'progress', concurrency = 1, count = 50) =>
  Array.from({ length: count }, (_, index) => ({
    surface,
    concurrency,
    durationMs: index + 1,
    valid: true,
  }));
test('phase nearest rank retains high latency samples in the matching surface and load', () => {
  const measured = samples();
  measured[0].durationMs = 9000;
  measured[1].durationMs = 8000;
  measured[2].durationMs = 6000;
  expect(phasePerformanceSummary(measured, 'progress', 1)).toMatchObject({
    count: 50,
    p95Ms: 6000,
    failures: 0,
    passed: false,
  });
});
test('six phase profiles cannot substitute other surfaces or combine loads to meet the sample count', () => {
  const measured = [
    ...samples('progress', 1, 49),
    ...samples('progress', 4),
    ...samples('dashboard'),
    ...samples('rules'),
  ];
  expect(phasePerformanceSummary(measured, 'progress', 1)).toMatchObject({
    count: 49,
    passed: false,
  });
  expect(phasePerformanceSummary(measured, 'progress', 4)).toMatchObject({
    count: 50,
    p95Ms: 48,
    passed: true,
  });
});
test('errors, incomplete cold profiles and the exact 3000ms boundary fail', () => {
  const failed = samples();
  failed[0].valid = false;
  expect(phasePerformanceSummary(failed, 'progress', 1)).toMatchObject({
    failures: 1,
    passed: false,
  });
  expect(
    phasePerformanceSummary(samples('rules', 4, 3), 'rules', 4, 4).passed,
  ).toBe(false);
  expect(
    phasePerformanceSummary(samples('rules', 4, 4), 'rules', 4, 4),
  ).toMatchObject({ count: 4, p95Ms: 4, passed: true });
  expect(
    phasePerformanceSummary(
      samples().map((sample) => ({ ...sample, durationMs: 3000 })),
      'progress',
      1,
    ).passed,
  ).toBe(false);
});
test('invalid durations and surface profiles cannot produce a passing report', () => {
  expect(() =>
    phasePerformanceSummary(
      [{ surface: 'progress', concurrency: 1, durationMs: NaN, valid: true }],
      'progress',
      1,
    ),
  ).toThrow();
  expect(() => phasePerformanceSummary([], 'unknown', 1)).toThrow();
  expect(phasePerformanceSummary([], 'progress', 1)).toMatchObject({
    count: 0,
    p95Ms: null,
    passed: false,
  });
});
