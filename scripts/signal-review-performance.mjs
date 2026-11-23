import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
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
import { dashboardPerformanceSummary } from './dashboard-performance.mjs';
import { createSignalReviewHarness } from '../tests/e2e/signal-review-fixture.mjs';

export async function prepareSignalReviewBatch(harness, count) {
  assert.ok(Number.isInteger(count) && count >= 1 && count <= 200);
  const scopes = [];
  for (let index = 0; index < count; index++)
    scopes.push(await harness.prepare({ realSubmit: false }));
  assert.equal(new Set(scopes.map((scope) => scope.signalId)).size, count);
  return scopes;
}

export function signalReviewPerformanceSummary(
  samples,
  surface,
  concurrency,
  expected = 50,
) {
  assert.ok(['first-review', 'replay'].includes(surface));
  const selected = samples.filter((sample) => sample.surface === surface);
  const result = dashboardPerformanceSummary(selected, concurrency, expected);
  const profile = selected.filter(
    (sample) => sample.concurrency === concurrency,
  );
  const distinctEpisodes = new Set(profile.map((sample) => sample.signalId))
    .size;
  return {
    surface,
    ...result,
    distinctEpisodes,
    passed: result.passed && distinctEpisodes === expected,
  };
}

export async function runSignalReviewPerformance() {
  const samples = [],
    coldSamples = [],
    profiles = [];
  let failure, before, after, protectedState;
  try {
    await withTestEnvironment(async ({ ctx, state }) => {
      protectedState = state;
      await buildApi();
      const contracts = await import('@alunza/contracts');
      const api = testApi(ctx, state, ctx.webPort, {
        SIGNALS_WORKER_ENABLED: 'false',
      });
      const harness = await createSignalReviewHarness(state);
      try {
        await api.start(`http://127.0.0.1:${ctx.apiPort}/health/ready`);
        // Only preparation uses the documented canonical-result test fixture.
        // Every measured first review addresses a different evaluated episode.
        const scopes = await prepareSignalReviewBatch(harness, 105);
        before = await candidateFingerprint();
        let offset = 0;
        for (const concurrency of [1, 4]) {
          const selected = scopes.slice(offset, offset + 50 + concurrency);
          offset += 50 + concurrency;
          const originalResults = new Map();
          for (const surface of ['first-review', 'replay']) {
            await api.stop();
            await api.start(`http://127.0.0.1:${ctx.apiPort}/health/ready`);
            async function measure(scope, index, cold) {
              const started = performance.now();
              let valid = false,
                status = null,
                code = null;
              try {
                const response = await harness.request(
                  `/signals/${scope.signalId}/review`,
                  { method: 'PUT', body: {} },
                );
                status = response.status;
                valid =
                  status === 200 &&
                  response.noStore &&
                  contracts.signalReviewResponseSchema.safeParse({
                    data: response.data,
                    requestId: response.requestId,
                  }).success &&
                  response.data.signalId === scope.signalId &&
                  response.data.reviewedBy === harness.actors.teacher.id;
                if (valid && surface === 'first-review')
                  originalResults.set(scope.signalId, response.data);
                if (surface === 'replay')
                  valid =
                    valid &&
                    JSON.stringify(response.data) ===
                      JSON.stringify(originalResults.get(scope.signalId));
                if (!valid) code = 'INVALID_RESPONSE';
              } catch {
                code = 'REQUEST_FAILED';
              }
              (cold ? coldSamples : samples).push({
                surface,
                concurrency,
                index,
                signalId: scope.signalId,
                temperature: cold ? 'first-request' : 'warm-service',
                durationMs: performance.now() - started,
                valid,
                status,
                code,
              });
            }
            await Promise.all(
              selected
                .slice(0, concurrency)
                .map((scope, index) => measure(scope, index, true)),
            );
            let next = 0;
            await Promise.all(
              Array.from({ length: concurrency }, async () => {
                while (next < 50) {
                  const index = next++;
                  await measure(selected[concurrency + index], index, false);
                }
              }),
            );
            profiles.push({
              temperature: 'warm',
              ...signalReviewPerformanceSummary(samples, surface, concurrency),
            });
            profiles.push({
              temperature: 'first-request',
              ...signalReviewPerformanceSummary(
                coldSamples,
                surface,
                concurrency,
                concurrency,
              ),
            });
          }
        }
        const counts = await harness.database.query(
          `SELECT count(*)::integer AS reviews,
          (SELECT count(*)::integer FROM app.audit_events WHERE entity_id=ANY($1::uuid[]) AND action='SIGNAL_REVIEWED') AS audits
          FROM app_private.signal_reviews WHERE episode_id=ANY($1::uuid[])`,
          [scopes.map((scope) => scope.signalId)],
        );
        assert.deepEqual(counts.rows[0], { reviews: 105, audits: 105 });
        after = await candidateFingerprint();
        assert.equal(after, before);
      } finally {
        await api.stop();
        await harness.close();
      }
    });
  } catch (error) {
    failure = error;
    let diagnostic = error.output ?? error.stack ?? error.message;
    for (const field of [
      'applicationPassword',
      'fixturePassword',
      'authAdminKey',
      'publishableKey',
      'migrationUrl',
    ])
      if (protectedState?.[field])
        diagnostic = diagnostic.split(protectedState[field]).join('[redacted]');
    const directory = join(root, '.local/evidence/imp-06');
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, 'signal-review-performance-error.log'),
      redactDiagnostics(diagnostic),
      { mode: 0o600 },
    );
  }
  const passed =
    !failure &&
    profiles.length === 8 &&
    profiles.every((profile) => profile.passed);
  await report(
    'signal-review-api-performance',
    {
      increment: 'IMP-06.04',
      status: passed ? 'passed' : 'failed',
      preparationFailed: Boolean(failure),
      candidateFingerprint: before,
      finalCandidateFingerprint: after,
      candidateUnchanged: Boolean(before) && before === after,
      profile: {
        surfaces: ['first-review', 'replay'],
        sequential: 50,
        concurrent: 50,
        concurrency: 4,
        distinctEpisodes: 105,
        timeoutMs: 45000,
      },
      environment:
        'Isolated LAB TEST Auth/NestJS/PostgreSQL; independently evaluated episodes from the documented deterministic dashboard fixture, no external providers.',
      temperature:
        'API restarted for each surface/profile. First request/group is separate; each first-review sample uses a distinct ACTIVE episode. Replays preserve first author/date. Every error retained.',
      percentile: 'nearest-rank',
      targetMs: 3000,
      profiles,
      coldSamples,
      samples,
    },
    'imp-06',
  );
  if (!passed)
    throw new Error(
      'La revisión no aprobó perfiles completos, episodios distintos, cero errores y p95 <3000 ms.',
      { cause: failure },
    );
  return profiles;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  runSignalReviewPerformance()
    .then((profiles) => {
      for (const profile of profiles)
        console.log(
          `${profile.surface} ${profile.temperature} concurrencia ${profile.concurrency}: ${profile.count} muestras, p95 ${profile.p95Ms.toFixed(2)} ms.`,
        );
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
