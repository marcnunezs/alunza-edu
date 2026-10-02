import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { hostSnapshot, startupPhaseTimings } from './lab-observability.mjs';
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
    };
  });
}
let phase = 'prepare-test-environment';
try {
  await withTestEnvironment(async ({ ctx, state }) => {
    phase = 'seed-and-build';
    await seedAcademic(state);
    await buildApi();
    const { runExecutionResponseSchema, attemptResponseSchema } =
      await import('@alunza/contracts');
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
        await api.stop();
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
