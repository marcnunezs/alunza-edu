import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import {
  withTestEnvironment,
  testApi,
  buildApi,
  report,
} from './test-environment.mjs';
import { candidateFingerprint } from './evaluation-manifest.mjs';
import { createDashboardHarness } from '../tests/e2e/dashboard-fixture.mjs';

export function dashboardPerformanceSummary(
  samples,
  concurrency,
  expected = 50,
) {
  assert.ok([1, 4].includes(concurrency));
  assert.ok(Array.isArray(samples));
  const selected = samples.filter(
    (sample) => sample.concurrency === concurrency,
  );
  assert.ok(
    selected.every(
      (sample) =>
        Number.isFinite(sample.durationMs) &&
        sample.durationMs >= 0 &&
        typeof sample.valid === 'boolean',
    ),
  );
  const ordered = selected
    .map((sample) => sample.durationMs)
    .sort((left, right) => left - right);
  const p95Ms = ordered.length
    ? ordered[Math.ceil(ordered.length * 0.95) - 1]
    : null;
  const failures = selected.filter((sample) => !sample.valid).length;
  return {
    concurrency,
    expected,
    count: selected.length,
    failures,
    p95Ms,
    passed: selected.length === expected && failures === 0 && p95Ms < 3000,
  };
}

export async function runDashboardPerformance() {
  const samples = [];
  const coldSamples = [];
  const summary = {
    increment: 'IMP-05.07',
    environment:
      'isolated LAB TEST Auth/PostgreSQL/NestJS; synthetic canonical attempt results; no external providers',
    profile: {
      sequential: 50,
      concurrent: 50,
      concurrency: 4,
      students: 2,
      requiredPerStudent: 3,
      attempts: 5,
      completed: 1,
      pageSize: 1,
      pages: 2,
      timeoutMs: 45_000,
    },
    percentile: 'nearest-rank',
    targetMs: 3000,
    temperature:
      'API restarts before each profile. First request/group is recorded separately in coldSamples with its own gate; then 50 warm requests alternate both pages. Ready probes are not dashboard warmups. Every cold and warm sample is retained.',
    samples,
    coldSamples,
  };
  let failure;
  try {
    await withTestEnvironment(async ({ ctx, state }) => {
      await buildApi();
      const { dashboardResponseSchema } = await import('@alunza/contracts');
      const api = testApi(ctx, state);
      const harness = await createDashboardHarness(state);
      try {
        await api.start(`http://127.0.0.1:${ctx.apiPort}/health/ready`);
        const scope = await harness.prepare();
        summary.candidateFingerprint = await candidateFingerprint();
        const firstPath = `/classes/${scope.classroomId}/dashboard?asOf=${encodeURIComponent(scope.asOf)}&limit=1`;
        const discovered = await harness.request(firstPath);
        assert.equal(discovered.status, 200);
        assert.ok(discovered.data.students.page.nextCursor);
        const paths = [
          firstPath,
          `${firstPath}&cursor=${encodeURIComponent(discovered.data.students.page.nextCursor)}`,
        ];
        const firstId = discovered.data.students.data[0].studentId;
        async function measure(concurrency, index, cold) {
          const started = performance.now();
          let valid = false;
          let status = null;
          let code = null;
          const page = index % 2;
          try {
            const response = await harness.request(paths[page]);
            status = response.status;
            const parsed = dashboardResponseSchema.safeParse({
              data: response.data,
              requestId: response.requestId,
            });
            valid =
              response.status === 200 &&
              response.noStore &&
              parsed.success &&
              response.data.summary.completed === 1 &&
              response.data.summary.required === 6 &&
              response.data.summary.period.attempts === 5 &&
              response.data.students.data.length === 1 &&
              (response.data.students.data[0].studentId === firstId) ===
                (page === 0);
            if (!valid) code = 'INVALID_RESPONSE';
          } catch {
            code = 'REQUEST_FAILED';
          }
          (cold ? coldSamples : samples).push({
            concurrency,
            index,
            page: page + 1,
            temperature: cold ? 'first-query' : 'warm-service',
            durationMs: performance.now() - started,
            valid,
            status,
            code,
          });
        }
        for (const concurrency of [1, 4]) {
          await api.stop();
          await api.start(`http://127.0.0.1:${ctx.apiPort}/health/ready`);
          await Promise.all(
            Array.from({ length: concurrency }, (_, index) =>
              measure(concurrency, index, true),
            ),
          );
          let next = 0;
          await Promise.all(
            Array.from({ length: concurrency }, async () => {
              while (next < 50) {
                const index = next++;
                await measure(concurrency, index, false);
              }
            }),
          );
        }
      } finally {
        await api.stop();
        await harness.close();
      }
    });
  } catch (error) {
    failure = error;
  }
  const profiles = [1, 4].map((concurrency) =>
    dashboardPerformanceSummary(samples, concurrency),
  );
  const coldProfiles = [1, 4].map((concurrency) =>
    dashboardPerformanceSummary(coldSamples, concurrency, concurrency),
  );
  const passed =
    !failure &&
    [...profiles, ...coldProfiles].every((profile) => profile.passed);
  await report(
    'dashboard-performance',
    {
      ...summary,
      profiles,
      coldProfiles,
      status: passed ? 'passed' : 'failed',
      preparationFailed: Boolean(failure),
    },
    'imp-05',
  );
  if (!passed)
    throw new Error(
      'La medición del tablero no aprobó ambos perfiles completos de 50 muestras, cero errores y p95 <3000 ms.',
    );
  return profiles;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runDashboardPerformance()
    .then((profiles) => {
      for (const profile of profiles)
        console.log(
          `Tablero concurrencia ${profile.concurrency}: ${profile.count} muestras, p95 ${profile.p95Ms.toFixed(2)} ms.`,
        );
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
