import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { root, redactDiagnostics } from './local.mjs';
import {
  withTestEnvironment,
  testApi,
  buildApi,
  report,
} from './test-environment.mjs';
import { candidateFingerprint } from './evaluation-manifest.mjs';
import { createExerciseBankHarness } from '../tests/e2e/exercise-bank-fixture.mjs';

const samples = [];
const firstRequests = [];
const summary = {
  increment: 'IMP-06.01',
  environment: 'isolated LAB TEST Auth/PostgreSQL/NestJS',
  profile: {
    exercises: 25,
    versions: 25,
    uses: 25,
    pageSize: 20,
    samplesPerSurface: 50,
    concurrency: 1,
  },
  percentile: 'nearest-rank',
  targetMs: 3000,
  temperature:
    'API restarts before each surface; first request is recorded separately, followed by 50 warm requests. Every error and timeout is retained.',
  samples,
  firstRequests,
};
let failure;
try {
  await withTestEnvironment(async ({ ctx, state }) => {
    await buildApi();
    const c = await import('@alunza/contracts');
    const api = testApi(ctx, state);
    const harness = createExerciseBankHarness(state);
    try {
      const scope = await harness.prepare();
      summary.candidateFingerprint = await candidateFingerprint();
      const base = `/exercises/${scope.exerciseId}/governance`;
      const surfaces = [
        [
          'list',
          `/organizations/${scope.organizationId}/exercise-bank?limit=20`,
          c.exerciseBankListResponseSchema,
          25,
        ],
        ['detail', base, c.exerciseBankDetailResponseSchema, null],
        [
          'versions',
          `${base}/versions?limit=20`,
          c.exerciseBankVersionsResponseSchema,
          25,
        ],
        ['uses', `${base}/uses?limit=20`, c.exerciseBankUsesResponseSchema, 25],
      ];
      for (const [surface, path, schema, count] of surfaces) {
        await api.stop();
        await api.start(`http://127.0.0.1:${ctx.apiPort}/health/ready`);
        const paths = [path];
        async function measure(index, first) {
          const start = performance.now();
          let valid = false,
            status = null,
            code = null;
          try {
            const response = await harness.request(
              scope,
              paths[index % paths.length],
            );
            status = response.status;
            const parsed = schema.safeParse(response.body);
            valid =
              status === 200 &&
              response.noStore &&
              parsed.success &&
              (count === null
                ? response.data.currentVersion.id === scope.currentVersionId &&
                  response.data.useCounts.total === 25
                : response.data.page.totalFiltered === count &&
                  response.data.items.length ===
                    (index % paths.length === 0 ? 20 : 5));
            if (!valid) code = 'INVALID_RESPONSE';
            if (first && valid && response.data.page?.nextCursor)
              paths.push(
                `${path}&cursor=${encodeURIComponent(response.data.page.nextCursor)}`,
              );
          } catch {
            code = 'REQUEST_FAILED';
          }
          (first ? firstRequests : samples).push({
            surface,
            index,
            durationMs: performance.now() - start,
            status,
            valid,
            code,
          });
        }
        await measure(0, true);
        for (let index = 0; index < 50; index++) await measure(index, false);
      }
      assert.equal(
        await candidateFingerprint(),
        summary.candidateFingerprint,
        'El candidato cambió durante la medición.',
      );
    } finally {
      await api.stop();
      await harness.close();
    }
  });
} catch (error) {
  failure = error;
  const directory = join(root, '.local/evidence/imp-06');
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, 'bank-performance-error.log'),
    redactDiagnostics(error.output ?? error.stack ?? error.message),
    { mode: 0o600 },
  );
}
const profiles = ['list', 'detail', 'versions', 'uses'].map((surface) => {
  const selected = samples.filter((sample) => sample.surface === surface);
  const durations = selected
    .map((sample) => sample.durationMs)
    .sort((a, b) => a - b);
  const p95Ms = durations.length
    ? durations[Math.ceil(durations.length * 0.95) - 1]
    : null;
  const errors = selected.filter((sample) => !sample.valid).length;
  return {
    surface,
    count: selected.length,
    errors,
    p95Ms,
    passed: selected.length === 50 && errors === 0 && p95Ms < 3000,
  };
});
const passed =
  !failure &&
  firstRequests.length === 4 &&
  firstRequests.every((sample) => sample.valid && sample.durationMs < 3000) &&
  profiles.every((profile) => profile.passed);
await report(
  'bank-api-performance',
  {
    ...summary,
    profiles,
    status: passed ? 'passed' : 'failed',
    preparationFailed: Boolean(failure),
  },
  'imp-06',
);
for (const profile of profiles)
  console.log(
    `${profile.surface}: ${profile.count} muestras; errores ${profile.errors}; p95 ${profile.p95Ms?.toFixed(2) ?? 'N/D'} ms.`,
  );
if (!passed) {
  console.error(
    'La medición del banco no cumple el perfil completo; revisar el informe local imp-06/bank-api-performance.',
  );
  process.exitCode = 1;
}
