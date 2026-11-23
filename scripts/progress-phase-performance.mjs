import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  withTestEnvironment,
  testApi,
  buildApi,
  report,
} from './test-environment.mjs';
import { candidateFingerprint } from './evaluation-manifest.mjs';
import { root, redactDiagnostics } from './local.mjs';

export const phaseSurfaces = ['progress', 'dashboard', 'rules'];
export function phasePerformanceSummary(
  samples,
  surface,
  concurrency,
  expected = 50,
) {
  assert.ok(phaseSurfaces.includes(surface));
  assert.ok([1, 4].includes(concurrency));
  assert.ok(Number.isInteger(expected) && expected > 0);
  const selected = samples.filter(
    (sample) =>
      sample.surface === surface && sample.concurrency === concurrency,
  );
  assert.ok(
    selected.every(
      (sample) =>
        Number.isFinite(sample.durationMs) &&
        sample.durationMs >= 0 &&
        typeof sample.valid === 'boolean',
    ),
  );
  const durations = selected
    .map((sample) => sample.durationMs)
    .sort((a, b) => a - b);
  const p95Ms = durations.length
    ? durations[Math.ceil(durations.length * 0.95) - 1]
    : null;
  const failures = selected.filter((sample) => !sample.valid).length;
  return {
    surface,
    concurrency,
    expected,
    count: selected.length,
    failures,
    p95Ms,
    passed: selected.length === expected && failures === 0 && p95Ms < 3000,
  };
}

export async function runProgressPhasePerformance() {
  const samples = [],
    coldSamples = [];
  const summary = {
    increment: 'IMP-05.08',
    environment:
      'isolated LAB TEST Auth/PostgreSQL/NestJS, canonical staged capacity results; no external providers',
    fixture: {
      activeStudents: 60,
      activities: 2,
      requiredPerActivity: 3,
      required: 360,
      attempts: 201,
      personalAttempts: 51,
      signals: 51,
      ruleVersions: 51,
      completed: 1,
    },
    percentile: 'nearest-rank',
    targetMs: 3000,
    timeoutMs: 45000,
    pageSize: 50,
    profilesDescription:
      'Three surfaces, 50 warm sequential and 50 warm at concurrency4 each. API restarts before every profile: first1/4 requests retained separately; ready probes are not query warmups. Alternate two real pages; retain every error and timeout.',
    samples,
    coldSamples,
  };
  let failure;
  let privateValues = [];
  try {
    await withTestEnvironment(async ({ ctx, state }) => {
      privateValues = [
        state.fixturePassword,
        state.applicationPassword,
        state.authAdminKey,
        state.migrationUrl,
      ].filter(Boolean);
      await buildApi();
      const { createProgressPhaseHarness } =
        await import('../tests/e2e/progress-phase-fixture.mjs');
      const api = testApi(ctx, state);
      const harness = await createProgressPhaseHarness(state);
      try {
        await api.start(`http://127.0.0.1:${ctx.apiPort}/health/ready`);
        const scope = await harness.prepare({ profile: 'capacity' });
        summary.candidateFingerprint = await candidateFingerprint();
        for (const surface of phaseSurfaces) {
          const first = await harness.readSurface({ ...scope, surface });
          assert.equal(
            harness.validateSurface({ ...scope, surface }, first, 0),
            true,
          );
          const cursor =
            surface === 'rules'
              ? first.page.nextCursor
              : surface === 'progress'
                ? first.data.observation.page.nextCursor
                : first.data.students.page.nextCursor;
          assert.ok(cursor);
          const second = await harness.readSurface({
            ...scope,
            surface,
            cursor,
          });
          assert.equal(
            harness.validateSurface({ ...scope, surface }, second, 1),
            true,
          );
          const ids = (response) =>
            surface === 'rules'
              ? response.data.map((entry) => entry.id)
              : surface === 'progress'
                ? response.data.observation.attempts.map((entry) => entry.id)
                : response.data.students.data.map((entry) => entry.studentId);
          const expectedPages = [ids(first), ids(second)];
          assert.equal(
            new Set(expectedPages.flat()).size,
            surface === 'dashboard' ? 60 : 51,
          );
          async function measure(concurrency, index, cold) {
            const page = index % 2,
              started = performance.now();
            let valid = false,
              status = null,
              code = null;
            try {
              const response = await harness.readSurface({
                ...scope,
                surface,
                ...(page ? { cursor } : {}),
              });
              status = response.status;
              valid =
                harness.validateSurface(
                  { ...scope, surface },
                  response,
                  page,
                ) &&
                JSON.stringify(ids(response)) ===
                  JSON.stringify(expectedPages[page]);
              if (!valid) code = 'INVALID_RESPONSE';
            } catch {
              code = 'REQUEST_FAILED';
            }
            (cold ? coldSamples : samples).push({
              surface,
              concurrency,
              index,
              page: page + 1,
              temperature: cold
                ? 'first-query-after-api-restart'
                : 'warm-service',
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
                while (next < 50) await measure(concurrency, next++, false);
              }),
            );
          }
        }
        summary.candidateUnchanged =
          (await candidateFingerprint()) === summary.candidateFingerprint;
      } finally {
        await api.stop();
        await harness.close();
      }
    });
  } catch (error) {
    failure = error;
    let diagnostic = error.output ?? error.stack ?? error.message;
    for (const value of privateValues)
      diagnostic = diagnostic.split(value).join('[redacted]');
    const directory = join(root, '.local/evidence/imp-05-08');
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, 'phase-performance-error.log'),
      redactDiagnostics(diagnostic),
      { mode: 0o600 },
    );
  }
  const profiles = phaseSurfaces.flatMap((surface) =>
    [1, 4].map((concurrency) =>
      phasePerformanceSummary(samples, surface, concurrency),
    ),
  );
  const coldProfiles = phaseSurfaces.flatMap((surface) =>
    [1, 4].map((concurrency) =>
      phasePerformanceSummary(coldSamples, surface, concurrency, concurrency),
    ),
  );
  const passed =
    !failure &&
    summary.candidateUnchanged === true &&
    [...profiles, ...coldProfiles].every((profile) => profile.passed);
  await report(
    'phase-api-performance',
    {
      ...summary,
      status: passed ? 'passed' : 'failed',
      preparationFailed: Boolean(failure),
      profiles,
      coldProfiles,
    },
    'imp-05',
  );
  if (!passed)
    throw new Error(
      'La medición de fase no aprobó los seis perfiles completos, candidato estable, cero errores y p95 <3000 ms.',
    );
  return profiles;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  runProgressPhasePerformance()
    .then((profiles) => {
      for (const profile of profiles)
        console.log(
          `Fase ${profile.surface}, concurrencia ${profile.concurrency}: ${profile.count} muestras, p95 ${profile.p95Ms.toFixed(2)} ms.`,
        );
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
