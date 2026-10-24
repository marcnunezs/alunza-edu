import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SAMPLE_COUNT = 50;
const TARGET_MS = 5000;
const REQUEST_TIMEOUT_MS = 45000;
const SOURCE = 'function solve(a, b) { return a + b; }';
const TIMING_PHASES = {
  submission: new Set(
    'authorizeInitial inspect admit suite execute cleanupFallback stage finish authorizeFinal total'.split(
      ' ',
    ),
  ),
  docker: new Set(
    'engineResolve imageResolve create preInspect attachOutput attachInput start send streams wait postInspect delete verifyAbsent hostStartAttach containerWall supervisor'.split(
      ' ',
    ),
  ),
  background: new Set('total sweep purge claim recover'.split(' ')),
};
const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

// Copy only bounded diagnostic fields; never export raw service logs or source.
export function collectTimingEvents(output, concurrency) {
  if (![1, 4].includes(concurrency)) throw new Error('Invalid timing profile.');
  const observations = [];
  for (const line of output.split(/\r?\n/)) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (
      !event ||
      typeof event !== 'object' ||
      !Number.isFinite(event.durationMs) ||
      event.durationMs < 0 ||
      !Number.isFinite(event.observedAtMs) ||
      event.observedAtMs < 0 ||
      typeof event.completed !== 'boolean'
    )
      continue;
    const common = {
      concurrency,
      phase: event.phase,
      durationMs: event.durationMs,
      observedAtMs: event.observedAtMs,
      completed: event.completed,
    };
    if (
      event.event === 'TEST_SUBMIT_TIMING' &&
      event.version === 2 &&
      ['submission', 'docker'].includes(event.source) &&
      TIMING_PHASES[event.source].has(event.phase) &&
      typeof event.requestId === 'string' &&
      UUID.test(event.requestId) &&
      (event.executionId === undefined ||
        (typeof event.executionId === 'string' && UUID.test(event.executionId)))
    ) {
      observations.push({
        ...common,
        source: event.source,
        requestId: event.requestId,
        ...(event.executionId === undefined
          ? {}
          : { executionId: event.executionId }),
      });
    } else if (
      event.event === 'TEST_SUBMIT_BACKGROUND' &&
      event.version === 1 &&
      ['RUN', 'SUBMIT'].includes(event.worker) &&
      TIMING_PHASES.background.has(event.phase) &&
      (event.count === undefined ||
        (Number.isInteger(event.count) &&
          event.count >= 0 &&
          event.count <= 10000))
    ) {
      observations.push({
        ...common,
        source: 'background',
        worker: event.worker,
        ...(event.count === undefined ? {} : { count: event.count }),
      });
    }
  }
  return observations;
}

export function percentile95(values) {
  return values.length
    ? [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1]
    : null;
}

export function summarizeProfiles(samples) {
  return [1, 4].map((concurrency) => {
    const selected = samples.filter(
      (sample) => sample.concurrency === concurrency,
    );
    return {
      concurrency,
      count: selected.length,
      failed: selected.filter((sample) => !sample.valid).length,
      p95Ms: percentile95(selected.map((sample) => sample.durationMs)),
      coldP95Ms: percentile95(
        selected
          .filter((sample) => sample.temperature === 'cold-service')
          .map((sample) => sample.durationMs),
      ),
      warmP95Ms: percentile95(
        selected
          .filter((sample) => sample.temperature === 'warm-service')
          .map((sample) => sample.durationMs),
      ),
    };
  });
}

export function performancePassed(summary) {
  return (
    summary.cleanupVerified === true &&
    summary.runner?.imageUnchanged === true &&
    summary.distinctExecutions === SAMPLE_COUNT * 2 &&
    (summary.mode !== 'SUBMIT' ||
      summary.distinctAttempts === SAMPLE_COUNT * 2) &&
    summary.profiles?.length === 2 &&
    summary.profiles.every(
      (profile, index) =>
        profile.concurrency === [1, 4][index] &&
        profile.count === SAMPLE_COUNT &&
        profile.failed === 0 &&
        Number.isFinite(profile.p95Ms) &&
        profile.p95Ms < TARGET_MS,
    )
  );
}

export function assertPerformanceEnvironment(ctx, state) {
  const database = new URL(state.migrationUrl);
  if (
    ctx.test !== true ||
    state.projectId !== 'alunza-edu-foundation-test' ||
    state.authUrl !== 'http://127.0.0.1:16421' ||
    database.hostname !== '127.0.0.1' ||
    database.port !== '16422' ||
    ctx.apiPort !== 4100
  )
    throw new Error('El perfil solo opera en el entorno TEST local aislado.');
}

export async function measureRequest({
  baseUrl,
  actor,
  mode,
  schema,
  fetcher = fetch,
  clock = () => performance.now(),
}) {
  const started = clock();
  let status = 0,
    diagnosis = null,
    valid = false,
    errorCode = null,
    technical = null;
  let executionId = null,
    attemptId = null;
  try {
    const response = await fetcher(`${baseUrl}${actor.path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${actor.token}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': randomUUID(),
      },
      body: JSON.stringify(actor.body),
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    status = response.status;
    const payload = await response.json();
    const parsed = schema.safeParse(payload);
    if (parsed.success) {
      const record = parsed.data.data;
      const result = record.technicalResult;
      diagnosis = result.diagnosisCode;
      executionId = record.executionId;
      attemptId = mode === 'SUBMIT' ? record.attemptId : null;
      valid =
        status === 201 &&
        response.headers.get('cache-control')?.includes('no-store') === true &&
        record.exerciseVersionId === actor.body.exerciseVersionId &&
        diagnosis === 'SUCCESS' &&
        result.runnerVersion === actor.runnerVersion &&
        result.infrastructureStatus === 'OK' &&
        result.terminationReason === 'COMPLETED' &&
        result.visibleTotal === 1 &&
        result.visiblePassed === 1 &&
        (mode === 'RUN' ||
          (record.activityId === actor.activityId &&
            record.assignmentId === actor.assignmentId &&
            record.code === actor.body.code &&
            result.allRequiredPassed === true &&
            result.hiddenChecksPassed === true));
      technical = {
        runtimeMs: result.runtimeMs,
        lifecycleMs: result.lifecycleMs,
        terminationReason: result.terminationReason,
        infrastructureStatus: result.infrastructureStatus,
        runnerVersion: result.runnerVersion,
      };
      if (!valid) errorCode = 'UNEXPECTED_EXECUTION_RESULT';
    } else {
      errorCode =
        typeof payload?.error?.code === 'string' &&
        /^[A-Z][A-Z0-9_]{0,79}$/.test(payload.error.code)
          ? payload.error.code
          : 'INVALID_HTTP_RESPONSE';
    }
  } catch (error) {
    errorCode =
      error?.name === 'TimeoutError'
        ? 'CLIENT_DEADLINE'
        : 'CLIENT_REQUEST_FAILED';
  }
  // Keep every attempt, including HTTP failures, invalid payloads and deadlines.
  return {
    durationMs: clock() - started,
    status,
    diagnosis,
    valid,
    errorCode,
    technical,
    executionId,
    attemptId,
  };
}

export async function measureProfile({
  concurrency,
  actors,
  samples,
  measure,
  onSample = () => {},
}) {
  if (![1, 4].includes(concurrency) || actors.length < concurrency)
    throw new Error('El perfil requiere uno o cuatro alumnos distintos.');
  if (
    new Set(actors.slice(0, concurrency).map((actor) => actor.id)).size !==
    concurrency
  )
    throw new Error('Cada carril debe usar un alumno distinto.');
  let next = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async (_, lane) => {
      const actor = actors[lane];
      while (next < SAMPLE_COUNT) {
        const index = next++;
        const sample = {
          concurrency,
          index,
          lane,
          temperature: index < concurrency ? 'cold-service' : 'warm-service',
          ...(await measure(actor)),
        };
        samples.push(sample);
        onSample(sample);
      }
    }),
  );
}

async function prepareFixture({
  state,
  baseUrl,
  runnerVersion,
  mode,
  sessions,
}) {
  const { createClient } = await import('@supabase/supabase-js');
  const { root } = await import('./local.mjs');
  const { default: academic } = await import('../tests/academic-fixture.cjs');
  const foundation = JSON.parse(
    await readFile(join(root, 'fixtures/foundation/identity.json'), 'utf8'),
  );
  const users = [
    foundation.users[2],
    ...[7, 8, 9].map((n) => ({
      id: `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
      email: `student.a${n - 5}@alunza.test`,
    })),
  ];
  const tokens = new Map();
  for (const user of [foundation.users[0], foundation.users[1], ...users]) {
    const auth = createClient(state.authUrl, state.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const login = await auth.auth.signInWithPassword({
      email: user.email,
      password: state.fixturePassword,
    });
    if (login.error || !login.data.session)
      throw new Error('No se obtuvo sesión ficticia para el perfil.');
    sessions.push(auth);
    tokens.set(user.id, login.data.session.access_token);
  }
  const org = foundation.organizations[0].id;
  const admin = foundation.users[0].id,
    teacher = foundation.users[1].id;
  const suffix = randomUUID().slice(0, 8).toUpperCase();
  async function create(actorId, path, body, status = 201, revision) {
    const result = await academic.request(baseUrl, tokens.get(actorId), path, {
      method: 'POST',
      body,
      key: randomUUID(),
      revision,
    });
    if (result.status !== status)
      throw Object.assign(
        new Error('La preparación mediante API pública no se completó.'),
        {
          performanceFailure: {
            operation: path,
            status: result.status,
            code:
              typeof result.error?.code === 'string' &&
              /^[A-Z][A-Z0-9_]{0,79}$/.test(result.error.code)
                ? result.error.code
                : 'INVALID_HTTP_RESPONSE',
          },
        },
      );
    return result.data;
  }
  const course = await create(admin, `/organizations/${org}/courses`, {
    code: `PERF-${suffix}`,
    name: 'Curso de medición ficticio',
    academicPeriod: '2026-2',
    startDate: '2026-01-01',
    endDate: '2027-12-31',
  });
  const classroom = await create(teacher, `/organizations/${org}/classes`, {
    courseId: course.id,
    code: `PERF-${suffix}`,
    name: 'Clase de medición ficticia',
    startDate: '2026-02-01',
    endDate: '2027-11-30',
  });
  const concept = await create(admin, `/organizations/${org}/concepts`, {
    name: `Medición ${suffix}`,
    description: 'Suma de valores ficticios.',
  });
  const exercise = await create(
    teacher,
    `/organizations/${org}/exercises`,
    academic.exerciseInput(concept.currentVersionId),
  );
  let activity = await create(teacher, `/classes/${classroom.id}/activities`, {
    title: 'Medición de práctica',
    type: 'FORMATIVE',
    instructions: 'Fixture de rendimiento.',
    exercises: [
      {
        exerciseVersionId: exercise.currentVersionId,
        position: 0,
        required: true,
      },
    ],
  });
  activity = await create(
    teacher,
    `/activities/${activity.id}/publish`,
    {},
    200,
    activity.revision,
  );
  const joinCode = await create(
    teacher,
    `/classes/${classroom.id}/join-codes`,
    { expiresAt: new Date(Date.now() + 86400000).toISOString() },
  );
  for (const user of users)
    await create(user.id, '/class-enrollments', {
      organizationId: org,
      code: joinCode.code,
    });
  const assignment = activity.exercises[0];
  if (
    !assignment?.id ||
    assignment.exerciseVersionId !== exercise.currentVersionId
  )
    throw new Error(
      'La versión publicada no coincide con el fixture de medición.',
    );
  return users.map((user) => ({
    id: user.id,
    token: tokens.get(user.id),
    runnerVersion,
    activityId: activity.id,
    assignmentId: assignment.id,
    path: `/api/v1/activities/${activity.id}/exercises/${assignment.id}/${mode === 'SUBMIT' ? 'attempts' : 'executions'}`,
    body: { code: SOURCE, exerciseVersionId: exercise.currentVersionId },
  }));
}

export async function main(args = process.argv.slice(2)) {
  if (args.some((argument) => argument !== '--submit'))
    throw new Error('Argumento de medición no admitido.');
  const mode = args.includes('--submit') ? 'SUBMIT' : 'RUN';
  const { withTestEnvironment, testApi, buildApi, report } =
    await import('./test-environment.mjs');
  const { seedAcademic } = await import('./academic-seed.mjs');
  const { run } = await import('./local.mjs');
  const samples = [];
  const timings = [];
  const { sourceFingerprint } = await import('./source-fingerprint.mjs');
  const summary = {
    schemaVersion: 1,
    runId: randomUUID(),
    environment: 'isolated-local-supabase-and-docker',
    mode,
    source: await sourceFingerprint(),
    profile: {
      sequential: SAMPLE_COUNT,
      concurrent: SAMPLE_COUNT,
      concurrency: 4,
      actorConcurrency: 1,
      submitActorConcurrency: 2,
      organizationConcurrency: 4,
      actorRequestsPerMinute: 100,
      timeoutMs: REQUEST_TIMEOUT_MS,
      rateOverride:
        '100 admisiones/minuto únicamente en el proceso TEST de medición; límites de concurrencia sin ampliar.',
      temperature:
        'API reiniciada antes de cada perfil; primer lote frío y solicitudes siguientes calientes; cada prueba crea una cápsula nueva.',
      instrumentation:
        mode === 'SUBMIT'
          ? 'TEST-only phase timings; raw logs excluded'
          : 'none',
    },
    fixture: {
      title: 'Sumar dos valores',
      visibleCount: 1,
      hiddenCount: mode === 'SUBMIT' ? 1 : 0,
      sourceHash: createHash('sha256').update(SOURCE).digest('hex'),
    },
    percentile: 'nearest-rank',
    targetMs: TARGET_MS,
    samples,
    timings,
    cleanupVerified: false,
    profiles: [],
    status: 'failed',
  };
  let phase = 'prepare-test-environment';
  try {
    await withTestEnvironment(async ({ ctx, state }) => {
      assertPerformanceEnvironment(ctx, state);
      phase = 'seed-and-build';
      await seedAcademic(ctx);
      await buildApi();
      const runner = await import('@alunza/runner');
      const { OWNER_LABEL } = await import('../infra/runner/capsule.mjs');
      const { runExecutionResponseSchema, attemptResponseSchema } =
        await import('@alunza/contracts');
      const availability = await runner.getDockerAvailability();
      summary.runner = {
        version: runner.RUNNER_VERSION,
        image: availability.image,
        imageUnchanged: false,
      };
      if (!availability.available)
        throw new Error('Imagen del runner no disponible.');
      const ownedCapsules = async () => {
        const result = await run('docker', [
          'ps',
          '-a',
          '--filter',
          `label=${OWNER_LABEL}`,
          '--format',
          '{{.ID}}',
        ]);
        return result.stdout.trim()
          ? result.stdout.trim().split(/\r?\n/).length
          : 0;
      };
      summary.initialCapsules = await ownedCapsules();
      if (summary.initialCapsules !== 0)
        throw new Error(
          'Ya existen cápsulas principales; no se inicia carga compartida.',
        );
      const baseUrl = `http://127.0.0.1:${ctx.apiPort}`;
      const overrides = {
        PRACTICE_ACTOR_REQUESTS_PER_MINUTE: '100',
        ...(mode === 'SUBMIT' ? { ALUNZA_TEST_SUBMIT_TIMINGS: '1' } : {}),
      };
      const sessions = [];
      let api;
      try {
        phase = 'prepare-public-fixture';
        api = testApi(ctx, state, 3000, overrides);
        await api.start(`${baseUrl}/health/ready`);
        const actors = await prepareFixture({
          state,
          baseUrl,
          runnerVersion: runner.RUNNER_VERSION,
          mode,
          sessions,
        });
        await api.stop();
        for (const concurrency of [1, 4]) {
          phase = `measure-concurrency-${concurrency}`;
          api = testApi(ctx, state, 3000, overrides);
          await api.start(`${baseUrl}/health/ready`);
          try {
            await measureProfile({
              concurrency,
              actors,
              samples,
              measure: (actor) =>
                measureRequest({
                  baseUrl,
                  actor,
                  mode,
                  schema:
                    mode === 'SUBMIT'
                      ? attemptResponseSchema
                      : runExecutionResponseSchema,
                }),
              onSample: () => {
                if (samples.length % 10 === 0)
                  console.log(
                    `${mode}: ${samples.length}/100 solicitudes observadas.`,
                  );
              },
            });
          } finally {
            await api.stop();
            if (mode === 'SUBMIT')
              timings.push(...collectTimingEvents(api.output, concurrency));
          }
        }
      } finally {
        phase = `${phase}:stop-owned-api`;
        await api?.stop();
        await Promise.allSettled(sessions.map((auth) => auth.auth.signOut()));
        summary.remainingCapsules = await ownedCapsules();
        summary.cleanupVerified = summary.remainingCapsules === 0;
        const finalAvailability = await runner.getDockerAvailability();
        summary.runner.imageUnchanged =
          finalAvailability.available &&
          finalAvailability.image === summary.runner.image;
      }
    });
    summary.profiles = summarizeProfiles(samples);
    summary.distinctExecutions = new Set(
      samples.map((sample) => sample.executionId).filter(Boolean),
    ).size;
    summary.distinctAttempts = new Set(
      samples.map((sample) => sample.attemptId).filter(Boolean),
    ).size;
    summary.status = performancePassed(summary) ? 'passed' : 'failed';
  } catch (error) {
    summary.phase = phase;
    if (error.performanceFailure) summary.failure = error.performanceFailure;
    summary.error =
      'Medición incompleta; se conservan todas las muestras observadas sin datos privados.';
    summary.profiles = summarizeProfiles(samples);
  }
  await report(
    `${mode.toLowerCase()}-performance-${summary.runId}`,
    summary,
    'imp-03',
  );
  await report(`${mode.toLowerCase()}-performance`, summary, 'imp-03');
  console.log(
    JSON.stringify({
      mode,
      status: summary.status,
      profiles: summary.profiles,
      cleanupVerified: summary.cleanupVerified,
    }),
  );
  if (summary.status !== 'passed') process.exitCode = 1;
  return summary;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch(() => {
    console.error('No se pudo completar el informe de medición local.');
    process.exitCode = 1;
  });
