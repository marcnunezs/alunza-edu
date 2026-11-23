import { signalReviewPerformanceSummary } from '../../scripts/signal-review-performance.mjs';
const profile = (surface = 'first-review', concurrency = 1) =>
  Array.from({ length: 50 }, (_, index) => ({
    surface,
    concurrency,
    signalId: `episode-${index}`,
    durationMs: index + 1,
    valid: true,
  }));
test('first review requires 50 distinct episodes, not repeated requests for one episode', () => {
  const samples = profile();
  expect(
    signalReviewPerformanceSummary(samples, 'first-review', 1),
  ).toMatchObject({ passed: true, count: 50, distinctEpisodes: 50, p95Ms: 48 });
  expect(
    signalReviewPerformanceSummary(
      samples.map((sample) => ({ ...sample, signalId: 'same-episode' })),
      'first-review',
      1,
    ),
  ).toMatchObject({ passed: false, count: 50, distinctEpisodes: 1 });
});
test('surfaces and concurrency remain separate; incomplete profiles and failed operations cannot pass', () => {
  const samples = [...profile(), ...profile('replay', 4)];
  samples[0].valid = false;
  expect(
    signalReviewPerformanceSummary(samples, 'first-review', 1),
  ).toMatchObject({ passed: false, failures: 1 });
  expect(signalReviewPerformanceSummary(samples, 'replay', 4)).toMatchObject({
    passed: true,
    failures: 0,
  });
  expect(
    signalReviewPerformanceSummary(profile().slice(1), 'first-review', 1)
      .passed,
  ).toBe(false);
});
test('3000 ms is a strict limit and the first group has an explicit sample count', () => {
  expect(
    signalReviewPerformanceSummary(
      profile().map((sample) => ({ ...sample, durationMs: 3000 })),
      'first-review',
      1,
    ).passed,
  ).toBe(false);
  expect(
    signalReviewPerformanceSummary(
      profile('replay', 4).slice(0, 4),
      'replay',
      4,
      4,
    ),
  ).toMatchObject({ passed: true, count: 4, distinctEpisodes: 4 });
});
