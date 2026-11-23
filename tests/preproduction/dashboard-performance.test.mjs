import { dashboardPerformanceSummary } from '../../scripts/dashboard-performance.mjs';

const profile = (count = 50, concurrency = 1) =>
  Array.from({ length: count }, (_, index) => ({
    concurrency,
    durationMs: index + 1,
    valid: true,
  }));
test('p95 usa nearest rank sobre todas las muestras, incluido el primer request', () => {
  const samples = profile();
  samples[0].durationMs = 10_000;
  samples[1].durationMs = 8_000;
  samples[2].durationMs = 6_000;
  expect(dashboardPerformanceSummary(samples, 1)).toMatchObject({
    count: 50,
    p95Ms: 6000,
    passed: false,
  });
});
test('un error o perfil incompleto impide aprobar aunque la latencia sea baja', () => {
  const samples = profile();
  samples[0].valid = false;
  expect(dashboardPerformanceSummary(samples, 1)).toMatchObject({
    failures: 1,
    passed: false,
  });
  expect(dashboardPerformanceSummary(profile(49), 1)).toMatchObject({
    count: 49,
    passed: false,
  });
});
test('separa perfiles y el límite de 3000 ms es estricto', () => {
  const samples = [
    ...profile(),
    ...profile(50, 4).map((sample) => ({ ...sample, durationMs: 3000 })),
  ];
  expect(dashboardPerformanceSummary(samples, 1)).toMatchObject({
    count: 50,
    p95Ms: 48,
    passed: true,
  });
  expect(dashboardPerformanceSummary(samples, 4)).toMatchObject({
    count: 50,
    p95Ms: 3000,
    passed: false,
  });
});
