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
import { dashboardPerformanceSummary } from './dashboard-performance.mjs';
import { createStudentDetailHarness } from '../tests/e2e/student-detail-fixture.mjs';

export async function runStudentDetailPerformance() {
  const samples = [],
    coldSamples = [],
    profiles = [];
  let failure, before, after;
  try {
    await withTestEnvironment(async ({ ctx, state }) => {
      await buildApi();
      const c = await import('@alunza/contracts'),
        api = testApi(ctx, state),
        harness = await createStudentDetailHarness(state);
      try {
        await api.start(`http://127.0.0.1:${ctx.apiPort}/health/ready`);
        const scope = await harness.prepare();
        before = await candidateFingerprint();
        const base = harness.path(scope),
          query = `?asOf=${encodeURIComponent(scope.asOf)}`;
        const paths = [
          ['progress', '/progress', c.studentDetailProgressResponseSchema],
          ['evidence', '/evidence', c.studentDetailEvidenceResponseSchema],
          [
            'attempt',
            `/attempts/${scope.attemptId}`,
            c.studentDetailAttemptResponseSchema,
          ],
          [
            'history',
            `/attempts/${scope.attemptId}/feedback`,
            c.studentDetailFeedbackHistoryResponseSchema,
          ],
          [
            'feedback',
            `/feedback/${scope.hintId}`,
            c.studentDetailFeedbackResponseSchema,
          ],
          [
            'reference',
            `/feedback/${scope.hintId}/sources/${scope.chunkId}`,
            c.studentDetailReferenceResponseSchema,
          ],
          [
            'content',
            `/feedback/${scope.hintId}/sources/${scope.chunkId}/content`,
            null,
          ],
          ['signals', '/signals', c.studentDetailSignalsResponseSchema],
          [
            'signal',
            `/signals/${scope.signals[0].id}`,
            c.studentDetailSignalResponseSchema,
          ],
        ];
        for (const [surface, suffix, schema] of paths) {
          async function measure(concurrency, index, cold) {
            const started = performance.now();
            let valid = false,
              status = null,
              code = null;
            try {
              const response = schema
                ? await harness.request(base + suffix + query)
                : await harness.content(base + suffix + query);
              status = response.status;
              valid =
                status === 200 &&
                response.noStore &&
                (schema
                  ? schema.safeParse({
                      data: response.data,
                      requestId: response.requestId,
                    }).success
                  : response.text.includes('función'));
              if (surface === 'progress')
                valid =
                  valid &&
                  response.data.progress.summary.required === 3 &&
                  response.data.progress.observation.summary.attempts === 7;
              if (surface === 'history')
                valid = valid && response.data.items.length === 2;
              if (!valid) code = 'INVALID_RESPONSE';
            } catch {
              code = 'REQUEST_FAILED';
            }
            (cold ? coldSamples : samples).push({
              surface,
              concurrency,
              index,
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
                while (next < 50) await measure(concurrency, next++, false);
              }),
            );
            profiles.push({
              surface,
              temperature: 'warm',
              ...dashboardPerformanceSummary(
                samples.filter((s) => s.surface === surface),
                concurrency,
              ),
            });
            profiles.push({
              surface,
              temperature: 'first-query',
              ...dashboardPerformanceSummary(
                coldSamples.filter((s) => s.surface === surface),
                concurrency,
                concurrency,
              ),
            });
          }
        }
        after = await candidateFingerprint();
        assert.equal(after, before);
      } finally {
        await api.stop();
        await harness.close();
      }
    });
  } catch (error) {
    failure = error;
  }
  const passed =
    !failure && profiles.length === 36 && profiles.every((p) => p.passed);
  await report(
    'student-detail-api-performance',
    {
      increment: 'IMP-06.03',
      status: passed ? 'passed' : 'failed',
      preparationFailed: Boolean(failure),
      candidateFingerprint: before,
      finalCandidateFingerprint: after,
      candidateUnchanged: before === after,
      profile: {
        surfaces: 9,
        sequential: 50,
        concurrent: 50,
        concurrency: 4,
        attemptsInClass: 7,
        required: 3,
        completed: 1,
      },
      environment:
        'Isolated LAB TEST NestJS/PostgreSQL/Storage; Docker submissions plus four deterministic capacity attempts; TEST generation/embeddings, no external provider.',
      temperature:
        'API restarts for each surface/profile. First query/group recorded separately, then 50 warm requests. Every sample and error retained.',
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
      'El detalle no aprobó los nueve perfiles API completos, cero errores y p95 <3000 ms.',
    );
  return profiles;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  runStudentDetailPerformance()
    .then((profiles) => {
      for (const p of profiles)
        console.log(
          `${p.surface} ${p.temperature} concurrencia ${p.concurrency}: ${p.count} muestras, p95 ${p.p95Ms.toFixed(2)} ms.`,
        );
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
