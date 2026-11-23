import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { URLSearchParams } from 'node:url';
import { root, redactDiagnostics } from './local.mjs';
import {
  withTestEnvironment,
  testApi,
  buildApi,
  report,
} from './test-environment.mjs';
import { candidateFingerprint } from './evaluation-manifest.mjs';
import { createAuditHarness } from '../tests/e2e/audit-fixture.mjs';

const samples = [],
  firstRequests = [];
const summary = {
  increment: 'IMP-06.05',
  environment: 'isolated LAB TEST Auth/PostgreSQL/NestJS',
  profile: {
    events: 10000,
    foreignEvents: 1000,
    pageSize: 20,
    samplesPerSurface: 50,
    concurrency: 1,
  },
  percentile: 'nearest-rank',
  targetMs: 3000,
  temperature:
    'API restarts before each surface; first request separate from 50 warm samples; every error and timeout retained.',
  samples,
  firstRequests,
};
let failure;
try {
  await withTestEnvironment(async ({ ctx, state }) => {
    await buildApi();
    const { auditListResponseSchema } = await import('@alunza/contracts');
    const api = testApi(ctx, state),
      harness = createAuditHarness(state);
    try {
      const scope = await harness.prepare({ profile: 'capacity' });
      summary.candidateFingerprint = await candidateFingerprint();
      const base = `/organizations/${scope.organizationId}/audit-events`;
      const initial = { asOf: scope.asOf, limit: 20 };
      await api.start(`http://127.0.0.1:${ctx.apiPort}/health/ready`);
      const seed = await harness.request(
        scope,
        `${base}?${new URLSearchParams(initial)}`,
      );
      assert.equal(seed.status, 200);
      assert.ok(seed.data.page.nextCursor);
      const surfaces = [
        ['first', initial, scope.oracle.total],
        [
          'second',
          { ...initial, cursor: seed.data.page.nextCursor },
          scope.oracle.total,
        ],
        [
          'combined',
          { ...scope.filters, limit: 20 },
          scope.oracle.combinedTotal,
        ],
      ];
      for (const [surface, query, total] of surfaces) {
        await api.stop();
        await api.start(`http://127.0.0.1:${ctx.apiPort}/health/ready`);
        async function measure(index, first) {
          const started = performance.now();
          let valid = false,
            status = null,
            code = null;
          try {
            const response = await harness.request(
              scope,
              `${base}?${new URLSearchParams(query)}`,
            );
            status = response.status;
            valid =
              status === 200 &&
              response.noStore &&
              auditListResponseSchema.safeParse(response.body).success &&
              response.data.page.totalFiltered === total &&
              response.data.items.length === 20;
            if (valid) {
              const expected =
                surface === 'combined'
                  ? scope.oracle.combinedIds.slice(0, 20)
                  : harness
                      .expected(scope)
                      .slice(
                        surface === 'second' ? 20 : 0,
                        surface === 'second' ? 40 : 20,
                      )
                      .map((row) => row.eventId);
              valid =
                JSON.stringify(
                  response.data.items.map((row) => row.eventId),
                ) === JSON.stringify(expected);
            }
            if (!valid) code = 'INVALID_RESPONSE';
          } catch {
            code = 'REQUEST_FAILED';
          }
          (first ? firstRequests : samples).push({
            surface,
            index,
            durationMs: performance.now() - started,
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
        'AUDIT_CANDIDATE_CHANGED',
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
    join(directory, 'audit-performance-error.log'),
    redactDiagnostics(error.output ?? error.stack ?? error.message),
    { mode: 0o600 },
  );
}
const profiles = ['first', 'second', 'combined'].map((surface) => {
  const selected = samples.filter((sample) => sample.surface === surface),
    durations = selected
      .map((sample) => sample.durationMs)
      .sort((a, b) => a - b);
  const p95Ms = durations.length
      ? durations[Math.ceil(durations.length * 0.95) - 1]
      : null,
    errors = selected.filter((sample) => !sample.valid).length;
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
  firstRequests.length === 3 &&
  firstRequests.every((sample) => sample.valid && sample.durationMs < 3000) &&
  profiles.every((profile) => profile.passed);
await report(
  'audit-api-performance',
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
    'La medición de auditoría no cumple el perfil completo; consultar el informe local imp-06/audit-api-performance.',
  );
  process.exitCode = 1;
}
