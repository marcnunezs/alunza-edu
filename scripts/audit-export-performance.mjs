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
import {
  createAuditExportHarness,
  readAuditCsv,
} from '../tests/e2e/audit-fixture.mjs';

const samples = [],
  firstRequests = [];
const summary = {
  increment: 'IMP-06.06',
  environment: 'isolated LAB TEST Auth/PostgreSQL/NestJS',
  profile: {
    events: 10000,
    foreignEvents: 1000,
    samplesPerSurface: 50,
    concurrency: 1,
    rowLimit: 10000,
    byteLimit: 10485760,
  },
  percentile: 'nearest-rank',
  targetMs: 3000,
  temperature:
    'API restarts before each surface; first request separate from 50 warm samples; every error and timeout retained. Generation returns committed metadata; download includes every response byte.',
  samples,
  firstRequests,
};
let failure;
try {
  await withTestEnvironment(async ({ ctx, state }) => {
    await buildApi();
    const { auditExportResponseSchema } = await import('@alunza/contracts');
    const api = testApi(ctx, state),
      harness = createAuditExportHarness(state);
    try {
      const scope = await harness.prepare({ profile: 'capacity' });
      summary.candidateFingerprint = await candidateFingerprint();
      let metadata;
      const expectedIds = harness.expected(scope).map((row) => row.eventId);
      for (const surface of ['generation', 'download']) {
        await api.stop();
        await api.start(`http://127.0.0.1:${ctx.apiPort}/health/ready`);
        async function measure(index, first) {
          const started = performance.now();
          let valid = false,
            status = null,
            code = null,
            durationMs,
            byteLength = null;
          try {
            if (surface === 'generation') {
              const response = await harness.create(scope);
              durationMs = performance.now() - started;
              status = response.status;
              valid =
                status === 201 &&
                response.noStore &&
                auditExportResponseSchema.safeParse(response.body).success &&
                response.data.rowCount === 10000;
              if (valid) {
                metadata = response.data;
                byteLength = metadata.byteLength;
              }
            } else {
              const response = await harness.content(scope, metadata.exportId);
              durationMs = performance.now() - started;
              status = response.status;
              if (status === 200 && response.noStore) {
                const csv = readAuditCsv(response.bytes);
                byteLength = csv.byteLength;
                valid =
                  csv.rowCount === 10000 &&
                  csv.sha256 === metadata.sha256 &&
                  csv.byteLength === metadata.byteLength &&
                  JSON.stringify(csv.rows.map((row) => row[0])) ===
                    JSON.stringify(expectedIds) &&
                  csv.rows.every((row) => row[6] === scope.organizationId);
              }
            }
            if (!valid) code = 'INVALID_RESPONSE';
          } catch {
            code = 'REQUEST_FAILED';
          }
          (first ? firstRequests : samples).push({
            surface,
            index,
            durationMs: durationMs ?? performance.now() - started,
            status,
            valid,
            code,
            byteLength,
          });
        }
        await measure(0, true);
        for (let index = 0; index < 50; index++) await measure(index, false);
        if (surface === 'generation')
          assert.ok(metadata, 'AUDIT_EXPORT_NO_VALID_ARTIFACT');
      }
      assert.equal(
        await candidateFingerprint(),
        summary.candidateFingerprint,
        'AUDIT_EXPORT_CANDIDATE_CHANGED',
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
    join(directory, 'audit-export-performance-error.log'),
    redactDiagnostics(error.output ?? error.stack ?? error.message),
    { mode: 0o600 },
  );
}
const profiles = ['generation', 'download'].map((surface) => {
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
  firstRequests.length === 2 &&
  firstRequests.every((sample) => sample.valid && sample.durationMs < 3000) &&
  profiles.every((profile) => profile.passed);
await report(
  'audit-export-api-performance',
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
    'La exportación no cumple el perfil completo; consultar imp-06/audit-export-api-performance.',
  );
  process.exitCode = 1;
}
