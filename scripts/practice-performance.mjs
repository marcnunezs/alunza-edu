import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { hostSnapshot, startupPhaseTimings } from './lab-observability.mjs';
import {
  submitTimingEvents,
  submitBackgroundEvents,
  backgroundForSample,
  timingsForSample,
  hasCompleteSubmitTimings,
  dockerVmSnapshot,
} from './submit-measurements.mjs';
import { createClient } from '@supabase/supabase-js';
import { root, run } from './local.mjs';
import {
  withTestEnvironment,
  testApi,
  buildApi,
  report,
} from './test-environment.mjs';
import { seedAcademic } from './academic-fixture.mjs';
import {
  additionalStudents,
  classes,
  activities,
  exercises,
} from '../fixtures/demo/academic.mjs';

const mode = process.argv.includes('--submit') ? 'SUBMIT' : 'RUN';
const measurements = [];
const correlations = new Map();
const timingCoverage = [];
const backgroundProfiles = [];
const summary = {
  environment: 'isolated-local-supabase-and-docker',
  mode,
  host: hostSnapshot(),
  profile: {
    sequential: 50,
    concurrent: 50,
    concurrency: 4,
    actorConcurrency: mode === 'SUBMIT' ? 2 : 1,
    organizationConcurrency: 4,
    actorRequestsPerMinute: 100,
    timeoutMs: 45000,
    rateOverride:
      'Only this isolated measurement process raises the rate ceiling to avoid measuring intentional HTTP 429 responses.',
    temperature:
      'API restarted before each profile; first batch cold service, subsequent requests warm service. Every test capsule is new; no warm capsule reuse.',
  },
  percentile: 'nearest-rank',
  targetMs: 5000,
  samples: measurements,
  phases: [],
  diagnostics: {
    enabled: mode === 'SUBMIT',
    channel: 'private-test-only',
    interpretation:
      'Durations are nested and overlap: submission.execute includes Docker phases, and docker.wait runs alongside docker.streams. Component durations and percentiles must not be added. Background overlap uses the shared API monotonic clock and approximates intervals; coincidence does not establish causality. Background spans emit on completion; work still open when the API stops may be absent, so missing overlap does not prove inactivity. Derived Docker evidence timestamps mark publication, not the original interval. Host and VM kernel counters are observed outside measured requests at profile boundaries. TEST timing callbacks execute inside the API request and may add observation overhead.',
    timingCoverage,
    backgroundProfiles,
  },
};
const p95 = (values) =>
  values.length
    ? [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1]
    : null;
function profiles() {
  return [1, 4].map((concurrency) => {
    const samples = measurements.filter(
      (item) => item.concurrency === concurrency,
    );
    return {
      concurrency,
      count: samples.length,
      failed: samples.filter((item) => !item.valid).length,
      p95Ms: p95(samples.map((item) => item.durationMs)),
      cold: p95(
        samples
          .filter((item) => item.temperature === 'cold-service')
          .map((item) => item.durationMs),
      ),
      warm: p95(
        samples
          .filter((item) => item.temperature === 'warm-service')
          .map((item) => item.durationMs),
      ),
      ...(mode === 'SUBMIT'
        ? {
            phaseTimings: [
              ...new Set(
                samples.flatMap((item) =>
                  (item.phaseTimings ?? []).map(
                    (event) => `${event.source}.${event.phase}`,
                  ),
                ),
              ),
            ].map((key) => {
              const values = samples.flatMap((sample) => {
                const events = (sample.phaseTimings ?? []).filter(
                  (event) => `${event.source}.${event.phase}` === key,
                );
                return events.length
                  ? [
                      {
                        durationMs: events.reduce(
                          (sum, event) => sum + event.durationMs,
                          0,
                        ),
                        events: events.length,
                        failed: events.filter((event) => !event.completed)
                          .length,
                      },
                    ]
                  : [];
              });
              return {
                phase: key,
                samples: values.length,
                events: values.reduce((sum, value) => sum + value.events, 0),
                failed: values.reduce((sum, value) => sum + value.failed, 0),
                p95Ms: p95(values.map((value) => value.durationMs)),
              };
            }),
          }
        : {}),
    };
  });
}
let phase = 'prepare-test-environment';
try {
  await withTestEnvironment(async ({ ctx, state }) => {
    phase = 'seed-and-build';
    await seedAcademic(state);
    await buildApi();
    const {
      runExecutionResponseSchema,
      attemptResponseSchema,
      errorResponseSchema,
    } = await import('@alunza/contracts');
    const responseSchema =
      mode === 'SUBMIT' ? attemptResponseSchema : runExecutionResponseSchema;
    const runner = await import('@alunza/runner');
    const availability = await runner.getDockerAvailability();
    summary.runner = {
      version: runner.RUNNER_VERSION,
      image: availability.image,
    };
    if (!availability.available)
      throw new Error(
        'La imagen local preparada del ejecutor no está disponible.',
      );
    const identity = JSON.parse(
      await readFile(join(root, 'fixtures/foundation/identity.json'), 'utf8'),
    );
    const users = [identity.users[2], ...additionalStudents.slice(0, 3)];
    const sessions = [];
    const actors = [];
    let api;
    try {
      phase = 'authenticate-fixture-students';
      for (const user of users) {
        const auth = createClient(state.authUrl, state.publishableKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const login = await auth.auth.signInWithPassword({
          email: user.email,
          password: state.fixturePassword,
        });
        if (login.error || !login.data.session)
          throw new Error(
            'No se pudo iniciar una sesión ficticia de medición.',
          );
        sessions.push(auth);
        const classroom = classes.find((item) =>
          item.studentIds.includes(user.id),
        );
        const activity = activities.find(
          (item) => item.classId === classroom.id && item.state === 'PUBLISHED',
        );
        const assignment = activity.exercises[0];
        const exercise = exercises.find(
          (item) => item.versionId === assignment.exerciseVersionId,
        );
        const visibleCount = exercise.tests.filter(
          (test) => test.visibility === 'visible',
        ).length;
        const hiddenCount = exercise.tests.filter(
          (test) => test.visibility === 'hidden',
        ).length;
        if (mode === 'SUBMIT' && hiddenCount < 1)
          throw new Error('La medición SUBMIT exige verificaciones ocultas.');
        summary.fixture = {
          title: exercise.title,
          visibleCount,
          hiddenCount: mode === 'SUBMIT' ? hiddenCount : 0,
        };
        actors.push({
          token: login.data.session.access_token,
          path: `/api/v1/activities/${activity.id}/exercises/${assignment.id}/${mode === 'SUBMIT' ? 'attempts' : 'executions'}`,
          body: {
            code: exercise.referenceSolution,
            exerciseVersionId: exercise.versionId,
          },
        });
      }
      for (const concurrency of [1, 4]) {
        phase = `measure-concurrency-${concurrency}`;
        api = testApi(ctx, state, ctx.webPort, {
          PRACTICE_ACTOR_REQUESTS_PER_MINUTE: '100',
          ...(mode === 'SUBMIT' ? { ALUNZA_TEST_SUBMIT_TIMINGS: '1' } : {}),
        });
        try {
          await api.start(`${ctx.apiUrl}/health/ready`);
        } finally {
          summary.phases.push({
            profile: concurrency,
            phase: 'api-start',
            ...api.startupMeasurements.at(-1),
            phases: startupPhaseTimings(api.output),
            host: hostSnapshot(),
          });
        }
        if (mode === 'SUBMIT')
          summary.phases.push({
            profile: concurrency,
            phase: 'vm-before-profile',
            observation: await dockerVmSnapshot(ctx),
          });
        if (mode === 'SUBMIT')
          summary.phases.push({
            profile: concurrency,
            phase: 'host-before-profile',
            host: hostSnapshot(),
          });
        let next = 0;
        await Promise.all(
          Array.from({ length: concurrency }, async (_, lane) => {
            const actor = actors[lane];
            while (next < 50) {
              const index = next++;
              const started = performance.now();
              let status = 0,
                diagnosis = null,
                valid = false,
                errorCode = null,
                technical = null;
              try {
                const response = await fetch(`${ctx.apiUrl}${actor.path}`, {
                  method: 'POST',
                  headers: {
                    Authorization: `Bearer ${actor.token}`,
                    'Content-Type': 'application/json',
                    'Idempotency-Key': randomUUID(),
                  },
                  body: JSON.stringify(actor.body),
                  signal: AbortSignal.timeout(45000),
                });
                status = response.status;
                const payload = await response.json();
                const parsed = responseSchema.safeParse(payload);
                if (parsed.success) {
                  if (mode === 'SUBMIT')
                    correlations.set(`${concurrency}:${index}`, {
                      requestId: parsed.data.requestId,
                      executionId: parsed.data.data.executionId,
                    });
                  diagnosis = parsed.data.data.technicalResult.diagnosisCode;
                  valid =
                    status === 201 &&
                    diagnosis === 'SUCCESS' &&
                    (mode === 'RUN' ||
                      parsed.data.data.technicalResult.allRequiredPassed);
                  const result = parsed.data.data.technicalResult;
                  technical = {
                    runtimeMs: result.runtimeMs,
                    lifecycleMs: result.lifecycleMs,
                    terminationReason: result.terminationReason,
                    infrastructureStatus: result.infrastructureStatus,
                    runnerVersion: result.runnerVersion,
                    applicationOverheadMs: Math.max(
                      0,
                      performance.now() - started - result.lifecycleMs,
                    ),
                  };
                } else {
                  const parsedError = errorResponseSchema.safeParse(payload);
                  if (mode === 'SUBMIT' && parsedError.success)
                    correlations.set(`${concurrency}:${index}`, {
                      requestId: parsedError.data.requestId,
                    });
                  errorCode =
                    typeof payload?.error?.code === 'string' &&
                    /^[A-Z][A-Z0-9_]{0,79}$/.test(payload.error.code)
                      ? payload.error.code
                      : 'INVALID_HTTP_RESPONSE';
                }
              } catch (error) {
                errorCode =
                  error.name === 'TimeoutError'
                    ? 'CLIENT_DEADLINE'
                    : 'CLIENT_REQUEST_FAILED';
                /* A failed sample remains in latency and failure counts. */
              }
              measurements.push({
                concurrency,
                index,
                temperature:
                  index < concurrency ? 'cold-service' : 'warm-service',
                durationMs:
                  Math.round((performance.now() - started) * 100) / 100,
                status,
                diagnosis,
                valid,
                errorCode,
                technical,
              });
              if (measurements.length % 10 === 0)
                console.log(
                  `${mode} medido: ${measurements.length}/100 respuestas observadas.`,
                );
            }
          }),
        );
        if (mode === 'SUBMIT')
          summary.phases.push({
            profile: concurrency,
            phase: 'host-after-profile',
            host: hostSnapshot(),
          });
        if (mode === 'SUBMIT')
          summary.phases.push({
            profile: concurrency,
            phase: 'vm-after-profile',
            observation: await dockerVmSnapshot(ctx),
          });
        await api.stop();
        if (mode === 'SUBMIT') {
          const parsed = submitTimingEvents(api.output);
          const background = submitBackgroundEvents(api.output);
          backgroundProfiles.push({ concurrency, ...background });
          const samples = measurements.filter(
            (item) => item.concurrency === concurrency,
          );
          for (const sample of samples) {
            sample.phaseTimings = timingsForSample(
              parsed.events,
              correlations.get(`${concurrency}:${sample.index}`),
            );
            sample.backgroundOverlap = backgroundForSample(
              sample.phaseTimings,
              background.events,
            );
          }
          timingCoverage.push({
            concurrency,
            samples: samples.length,
            events: parsed.events.length,
            rejected: parsed.rejected,
            backgroundEvents: background.events.length,
            backgroundRejected: background.rejected,
            backgroundWorkers: ['RUN', 'SUBMIT'].filter((worker) =>
              ['total', 'sweep', 'purge', 'claim'].every((phase) =>
                background.events.some(
                  (event) =>
                    event.worker === worker &&
                    event.phase === phase &&
                    event.completed,
                ),
              ),
            ),
            completeSamples: samples.filter((sample) =>
              hasCompleteSubmitTimings(
                sample.phaseTimings,
                summary.fixture.visibleCount + summary.fixture.hiddenCount,
              ),
            ).length,
          });
        }
        summary.phases.push({
          profile: concurrency,
          phase: 'profile-completed',
          host: hostSnapshot(),
        });
        console.log(
          `${mode} medido: 50 solicitudes, concurrencia ${concurrency}.`,
        );
      }
      phase = 'verify-capsule-cleanup';
      const capsules = await run('docker', [
        'ps',
        '-a',
        '--filter',
        'label=org.alunza.runner=alunza-edu-laboratorio',
        '--format',
        '{{.ID}}',
      ]);
      // TEST owns this measurement exclusively; include failed HTTP requests
      // whose response never supplied an execution id.
      summary.cleanupVerified = capsules.stdout.trim().length === 0;
      const finalAvailability = await runner.getDockerAvailability();
      summary.runner.imageUnchanged =
        finalAvailability.available &&
        finalAvailability.image === summary.runner.image;
      if (!summary.cleanupVerified)
        throw new Error('Una ejecución medida dejó una cápsula propia.');
    } finally {
      phase = `${phase}:stop-owned-services`;
      await api?.stop();
      await Promise.all(sessions.map((auth) => auth.auth.signOut()));
    }
  });
  summary.profiles = profiles();
  summary.status =
    summary.cleanupVerified &&
    summary.runner.imageUnchanged &&
    (mode !== 'SUBMIT' ||
      (timingCoverage.length === 2 &&
        timingCoverage.every(
          (item) =>
            item.samples === 50 &&
            item.completeSamples === 50 &&
            item.rejected === 0 &&
            item.backgroundRejected === 0 &&
            item.backgroundWorkers.length === 2,
        ))) &&
    summary.profiles.every(
      (profile) =>
        profile.count === 50 && profile.failed === 0 && profile.p95Ms < 5000,
    )
      ? 'passed'
      : 'failed';
  await report(
    `${mode.toLowerCase()}-performance`,
    summary,
    'imp-03-submissions',
  );
  console.log(
    JSON.stringify({ status: summary.status, profiles: summary.profiles }),
  );
  if (summary.status !== 'passed') process.exitCode = 1;
} catch {
  await report(
    `${mode.toLowerCase()}-performance`,
    {
      ...summary,
      profiles: profiles(),
      phase,
      status: 'failed',
      error:
        'No se completó la medición local; los datos parciales se conservan.',
    },
    'imp-03-submissions',
  );
  console.error(
    `Medición ${mode} fallida; consultar el reporte local saneado.`,
  );
  process.exitCode = 1;
}
