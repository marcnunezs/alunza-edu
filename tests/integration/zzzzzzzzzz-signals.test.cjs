/* eslint @typescript-eslint/no-require-imports: "off" */
const { randomUUID, createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const pg = require('pg');
const { createClient } = require('@supabase/supabase-js');
const { submitTechnicalResultSchema } = require('@alunza/contracts');
const { assertLaboratoryTestState } = require('../laboratory-test-state.cjs');
const fixture = require('../../fixtures/foundation/identity.json');
const [admin, teacher, student, foreignAdmin, foreignTeacher] = fixture.users;
const sessions = new Map();
let owner, application, base, ids, processSignalSnapshot;

async function asApplication(actor, action) {
  const client = await application.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT set_config('app.actor_id',$1,true),set_config('app.session_id',$2,true),set_config('app.organization_id','',true)",
      [actor?.id ?? '', actor ? sessions.get(actor.id).sessionId : ''],
    );
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function api(path, actor, method = 'GET', body, key = randomUUID()) {
  const response = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${sessions.get(actor.id).token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      'Idempotency-Key': key,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(45000),
  });
  const payload = await response.json();
  expect(JSON.stringify(payload)).not.toContain('SIGNALS_HIDDEN_SENTINEL');
  return { status: response.status, ...payload };
}

async function createScope() {
  const scope = Object.fromEntries(
    [
      'org',
      'course',
      'class',
      'otherClass',
      'concept',
      'conceptVersion',
      'exercise',
      'version',
      'activity',
      'assignment',
    ].map((key) => [key, randomUUID()]),
  );
  const client = await owner.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO app.organizations(id,code,name) VALUES($1,$2,$3)',
      [
        scope.org,
        `SIGNALS-${scope.org.slice(0, 8).toUpperCase()}`,
        'Señales ficticias aisladas',
      ],
    );
    for (const actor of [admin, teacher, student, foreignTeacher])
      await client.query(
        "INSERT INTO app.organization_memberships(organization_id,user_id,role,state,joined_at) VALUES($1,$2,$3,'ACTIVE',clock_timestamp())",
        [scope.org, actor.id, actor.role],
      );
    await client.query(
      "INSERT INTO app.courses(id,organization_id,code,name,academic_period) VALUES($1,$2,'SIGNALS','Programación','2026-2')",
      [scope.course, scope.org],
    );
    for (const [index, classroom] of [scope.class, scope.otherClass].entries())
      await client.query(
        'INSERT INTO app.classes(id,organization_id,course_id,teacher_id,code,name) VALUES($1,$2,$3,$4,$5,$6)',
        [
          classroom,
          scope.org,
          scope.course,
          index ? foreignTeacher.id : teacher.id,
          `SIGNALS-${index}`,
          `Clase ficticia ${index}`,
        ],
      );
    await client.query(
      'INSERT INTO app.class_memberships(organization_id,class_id,user_id) VALUES($1,$2,$3)',
      [scope.org, scope.class, student.id],
    );
    await client.query(
      "INSERT INTO app.concept_tags(id,organization_id,normalized_name) VALUES($1,$2,'contar')",
      [scope.concept, scope.org],
    );
    await client.query(
      "INSERT INTO app.concept_versions(id,organization_id,concept_id,version,name,description,created_by) VALUES($1,$2,$3,1,'Contar','Contar casos',$4)",
      [scope.conceptVersion, scope.org, scope.concept, admin.id],
    );
    await client.query(
      'UPDATE app.concept_tags SET current_version_id=$2 WHERE id=$1',
      [scope.concept, scope.conceptVersion],
    );
    await client.query(
      'INSERT INTO app.exercises(id,organization_id,owner_id) VALUES($1,$2,$3)',
      [scope.exercise, scope.org, teacher.id],
    );
    await client.query(
      "INSERT INTO app.exercise_versions(id,organization_id,exercise_id,version,title,statement,starter_code,difficulty,created_by) VALUES($1,$2,$3,1,'Contar casos','Devuelve uno para cada caso','module.exports.solve=()=>0;','BEGINNER',$4)",
      [scope.version, scope.org, scope.exercise, teacher.id],
    );
    await client.query(
      'INSERT INTO app.exercise_version_concepts(organization_id,exercise_version_id,concept_version_id) VALUES($1,$2,$3)',
      [scope.org, scope.version, scope.conceptVersion],
    );
    for (let index = 0; index < 3; index++)
      await client.query(
        "INSERT INTO app_private.exercise_tests(organization_id,exercise_version_id,test_id,position,visibility,args,expected) VALUES($1,$2,$3,$4,'visible',$5::jsonb,'1')",
        [
          scope.org,
          scope.version,
          `visible-${index + 1}`,
          index,
          JSON.stringify([index + 1]),
        ],
      );
    await client.query(
      "INSERT INTO app_private.exercise_tests(organization_id,exercise_version_id,test_id,position,visibility,args,expected) VALUES($1,$2,'SIGNALS_HIDDEN_SENTINEL',3,'hidden','[9]','1')",
      [scope.org, scope.version],
    );
    await client.query(
      'UPDATE app.exercises SET current_version_id=$2 WHERE id=$1',
      [scope.exercise, scope.version],
    );
    await client.query(
      "INSERT INTO app.activities(id,organization_id,class_id,created_by,title,type) VALUES($1,$2,$3,$4,'Episodios ficticios','FORMATIVE')",
      [scope.activity, scope.org, scope.class, teacher.id],
    );
    await client.query(
      'INSERT INTO app.activity_exercises(id,organization_id,activity_id,exercise_version_id,position) VALUES($1,$2,$3,$4,0)',
      [scope.assignment, scope.org, scope.activity, scope.version],
    );
    await client.query(
      "UPDATE app.activities SET state='PUBLISHED' WHERE id=$1",
      [scope.activity],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return scope;
}

async function activate(type) {
  const parameters =
    type === 'INACTIVITY'
      ? { inactivityDays: 7 }
      : type === 'REPEATED_ERROR'
        ? { repeatedErrorAttempts: 3, repeatedErrorWindowDays: 14 }
        : { stagnationAttempts: 3 };
  const created = await api(
    `/organizations/${ids.org}/signal-rules`,
    admin,
    'POST',
    {
      type,
      schemaVersion: 1,
      algorithmVersion: 'DEC005_V1',
      parameters,
    },
  );
  expect(created.status).toBe(201);
  const activated = await api(
    `/signal-rules/${created.data.id}/activate`,
    admin,
    'POST',
    {
      expectedCurrentVersionId: null,
    },
  );
  expect(activated.status).toBe(200);
  return activated.data;
}

async function submit(passed, key = randomUUID()) {
  const result = await api(
    `/activities/${ids.activity}/exercises/${ids.assignment}/attempts`,
    student,
    'POST',
    {
      code: `module.exports.solve=(value)=>value<=${passed}?1:0;`,
      exerciseVersionId: ids.version,
    },
    key,
  );
  expect(result.status).toBe(201);
  return result.data;
}

// A typed execution-result fixture for temporal transaction tests. Admission,
// result validation, canonical attempt/events and source capture remain real.
// The suite separately exercises the Docker/HTTP SUBMIT and RUN producers.
async function submitInHeldTransaction(client, passed) {
  await client.query(
    "SELECT set_config('app.actor_id',$1,true),set_config('app.session_id',$2,true),set_config('app.organization_id',$3,true)",
    [student.id, sessions.get(student.id).sessionId, ids.org],
  );
  const source = `module.exports.solve=(value)=>value<=${passed}?1:0;`;
  const runnerVersion = 'signals-temporal-fixture-v1';
  const reservation = (
    await client.query(
      'SELECT app_private.admit_practice_submit($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,NULL::uuid,$8,$9::uuid,true,1,32,120) AS value',
      [
        randomUUID(),
        ids.activity,
        ids.assignment,
        ids.version,
        randomUUID(),
        createHash('sha256').update(source).digest('hex'),
        source,
        runnerVersion,
        randomUUID(),
      ],
    )
  ).rows[0].value;
  expect(reservation.kind).toBe('reserved');
  const technical = submitTechnicalResultSchema.parse({
    runnerVersion,
    diagnosisCode: 'FAILED_TEST',
    terminationReason: 'ASSERTION_FAILED',
    infrastructureStatus: 'OK',
    visibleTestResults: [1, 2, 3].map((position) => ({
      id: `visible-${position}`,
      passed: position <= passed,
      stdout: '',
      stderr: '',
    })),
    visiblePassed: passed,
    visibleTotal: 3,
    outputTruncated: false,
    outputBytes: 0,
    runtimeMs: 1,
    lifecycleMs: 1,
    hiddenChecksPassed: false,
    allRequiredPassed: false,
  });
  await client.query(
    "SELECT set_config('app.actor_id','',true),set_config('app.session_id','',true),set_config('app.organization_id','',true)",
  );
  expect(
    (
      await client.query(
        'SELECT app_private.stage_practice_submit_result($1,$2,$3::jsonb,$4::jsonb) AS value',
        [
          reservation.executionId,
          reservation.leaseToken,
          JSON.stringify(technical),
          JSON.stringify([{ id: 'SIGNALS_HIDDEN_SENTINEL', passed: false }]),
        ],
      )
    ).rows[0].value,
  ).toBe(true);
  return (
    await client.query(
      'SELECT app_private.finish_practice_submit($1,$2,true) AS value',
      [reservation.executionId, reservation.leaseToken],
    )
  ).rows[0].value;
}

async function lane(type) {
  await asApplication(null, (client) =>
    client.query('SELECT app_private.signal_discover_lanes()'),
  );
  const { rows } = await owner.query(
    'SELECT id FROM app_private.signal_lanes WHERE organization_id=$1 AND activity_id=$2 AND student_id=$3 AND type=$4',
    [ids.org, ids.activity, student.id, type],
  );
  expect(rows).toHaveLength(1);
  return rows[0].id;
}

async function claim(laneId) {
  return asApplication(
    null,
    async (client) =>
      (
        await client.query(
          'SELECT app_private.signal_claim_job($1::uuid) AS value',
          [laneId],
        )
      ).rows[0].value,
  );
}

async function capture(job) {
  return asApplication(
    null,
    async (client) =>
      (
        await client.query(
          'SELECT app_private.signal_capture_snapshot($1::uuid,$2::uuid) AS value',
          [job.laneId, job.leaseToken],
        )
      ).rows[0].value,
  );
}

async function finalize(job, snapshot, batch) {
  return asApplication(
    null,
    async (client) =>
      (
        await client.query(
          'SELECT app_private.signal_finalize_batch($1::uuid,$2::uuid,$3::uuid,$4::jsonb,$5::jsonb) AS value',
          [
            job.laneId,
            job.leaseToken,
            snapshot.snapshot.id,
            JSON.stringify(batch.evaluations),
            JSON.stringify(batch.checkpoint),
          ],
        )
      ).rows[0].value,
  );
}

async function processLane(laneId, maxBoundaries = 100) {
  const runs = [];
  for (let step = 0; step < (maxBoundaries === 1 ? 100 : 20); step++) {
    const job = await claim(laneId);
    expect(job).not.toBeNull();
    const snapshot = await capture(job);
    expect(snapshot).not.toBeNull();
    const batch = processSignalSnapshot(snapshot, maxBoundaries);
    const result = await finalize(job, snapshot, batch);
    expect(['COMMITTED', 'REPLAY']).toContain(result.status);
    runs.push({ job, snapshot, batch, result });
    if (!batch.checkpoint.hasMore) return runs;
  }
  throw new Error('La recuperación no agotó el fixture acotado de señales.');
}

async function expectAiIndependentReplay(laneId) {
  const {
    signalSnapshotSchema,
  } = require('../../apps/api/dist/signals/signals.schemas.js');
  const {
    evaluateSignalBoundary,
  } = require('../../apps/api/dist/signals/signal-processing.js');
  const asOf = (
    await owner.query(
      'SELECT app_private.signal_instant(clock_timestamp()) AS value',
    )
  ).rows[0].value;
  const inputs = await asApplication(
    null,
    async (client) =>
      (
        await client.query(
          'SELECT app_private.signal_replay_inputs($1::jsonb) AS value',
          [
            JSON.stringify({
              organizationId: ids.org,
              classId: ids.class,
              studentId: student.id,
              activityId: ids.activity,
              asOf,
            }),
          ],
        )
      ).rows[0].value,
  );
  const input = inputs.find(
    (entry) =>
      entry.snapshot.lane.laneId === laneId && entry.evaluations.length > 0,
  );
  expect(input).toBeDefined();
  const snapshot = signalSnapshotSchema.parse(input.snapshot);
  const evaluate = () => ({
    batch: processSignalSnapshot(snapshot, 100),
    boundaries: input.evaluations.map((entry) =>
      evaluateSignalBoundary(snapshot, entry.boundary),
    ),
  });
  const previousFetch = globalThis.fetch;
  let rejectingCalls = 0;
  let alteredCalls = 0;
  let rejectingResult, alteredResult;
  // Two local transport conditions over the same real, rehydrated snapshot.
  // No provider is invoked; this does not simulate an Azure service outage.
  try {
    globalThis.fetch = async () => {
      rejectingCalls++;
      throw new Error('LOCAL_AI_TRANSPORT_UNAVAILABLE');
    };
    rejectingResult = evaluate();
    globalThis.fetch = async () => {
      alteredCalls++;
      return new Response(
        JSON.stringify({
          diagnosis_code: 'SUCCESS',
          explanation: 'Ayuda deliberadamente alterada por el fixture local.',
          hint: 'Afirmación no autorizada de logro.',
          source_refs: [],
          status: 'SUPPORTED',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };
    alteredResult = evaluate();
  } finally {
    globalThis.fetch = previousFetch;
  }
  expect(rejectingCalls).toBe(0);
  expect(alteredCalls).toBe(0);
  expect(alteredResult).toEqual(rejectingResult);
  expect(rejectingResult.boundaries).toEqual(
    input.evaluations.map((entry) => entry.result),
  );
  expect(rejectingResult.batch.evaluations.length).toBeGreaterThan(0);
}

const reviewBaseSql =
  'SELECT *,app_private.signal_instant(reviewed_at) AS reviewed_at_exact FROM app_private.signal_reviews WHERE episode_id=$1';

async function reviewConcurrently(episodeId) {
  const firstReviewer = await owner.connect();
  let secondReviewer;
  try {
    secondReviewer = await owner.connect();
    const firstPid = (
      await firstReviewer.query('SELECT pg_backend_pid() AS pid')
    ).rows[0].pid;
    const secondPid = (
      await secondReviewer.query('SELECT pg_backend_pid() AS pid')
    ).rows[0].pid;
    await firstReviewer.query('BEGIN');
    await secondReviewer.query('BEGIN');
    await firstReviewer.query("SET LOCAL statement_timeout='15s'");
    await secondReviewer.query("SET LOCAL statement_timeout='15s'");
    // The private laboratory helper authorizes the current assigned teacher.
    // Two concurrent connections therefore use the same actor, not two teachers
    // or the future public RF019 review workflow.
    const reviewSql =
      'SELECT app_private.signal_review_fixture($1::uuid,$2::uuid) AS value';
    const reviewed = (
      await firstReviewer.query(reviewSql, [episodeId, teacher.id])
    ).rows[0].value;
    expect(reviewed.state).toBe('REVIEWED');
    const firstBase = (await firstReviewer.query(reviewBaseSql, [episodeId]))
      .rows[0];
    let outcome;
    const competing = secondReviewer
      .query(reviewSql, [episodeId, teacher.id])
      .then(
        (result) => {
          outcome = { ok: true, result };
          return outcome;
        },
        () => {
          outcome = { ok: false };
          return outcome;
        },
      );
    let barrierObserved = false;
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      barrierObserved = (
        await owner.query(
          'SELECT $1::integer=ANY(pg_blocking_pids($2::integer)) AND EXISTS(SELECT 1 FROM pg_locks WHERE pid=$2 AND NOT granted) AS blocked',
          [firstPid, secondPid],
        )
      ).rows[0].blocked;
      if (barrierObserved) break;
      expect(outcome).toBeUndefined();
      await delay(25);
    }
    // Waiting is only bounded polling; an observed PostgreSQL lock is the oracle.
    expect(barrierObserved).toBe(true);
    expect(outcome).toBeUndefined();
    expect((await owner.query(reviewBaseSql, [episodeId])).rows).toHaveLength(
      0,
    );
    await firstReviewer.query('COMMIT');
    const secondOutcome = await competing;
    expect(secondOutcome.ok).toBe(true);
    await secondReviewer.query('COMMIT');
    expect(secondOutcome.result.rows[0].value).toEqual(reviewed);
    const reviews = (await owner.query(reviewBaseSql, [episodeId])).rows;
    expect(reviews).toEqual([firstBase]);
    return { reviewed, savedReview: reviews[0] };
  } finally {
    await Promise.allSettled([
      firstReviewer.query('ROLLBACK'),
      ...(secondReviewer ? [secondReviewer.query('ROLLBACK')] : []),
    ]);
    firstReviewer.release();
    secondReviewer?.release();
  }
}

async function episodes(laneId) {
  return (
    await owner.query(
      'SELECT * FROM app_private.signal_episodes WHERE lane_id=$1 ORDER BY qualified_at,calculated_at,id',
      [laneId],
    )
  ).rows;
}

async function evidence(actor, laneId) {
  return asApplication(
    actor,
    async (client) =>
      (
        await client.query(
          'SELECT app_private.signal_read_evidence($1::uuid) AS value',
          [laneId],
        )
      ).rows[0].value,
  );
}

function runMaintenanceChild(path, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path, ...args], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(
        new Error('El mantenimiento propio superó su límite de 30 segundos.'),
      );
    }, 30000);
    child.stdout.on('data', (value) => {
      stdout = (stdout + value.toString()).slice(-65536);
    });
    child.stderr.on('data', (value) => {
      stderr = (stderr + value.toString()).slice(-65536);
    });
    child.once('error', () => {
      clearTimeout(timeout);
      reject(new Error('No se pudo iniciar el mantenimiento propio.'));
    });
    child.once('close', (code) => {
      clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    });
  });
}

function childWorker() {
  const child = spawn(
    process.execPath,
    [join(__dirname, 'helpers/signal-worker.cjs')],
    {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      windowsHide: true,
    },
  );
  const received = [];
  const waiters = new Map();
  let exited = false;
  let output = '';
  const exit = new Promise((resolve) =>
    child.once('exit', (code, signal) => {
      exited = true;
      for (const waiter of waiters.values())
        waiter.reject(
          new Error('El worker propio terminó antes de su barrera IPC.'),
        );
      waiters.clear();
      resolve({ code, signal });
    }),
  );
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (value) => {
      output = (output + value.toString()).slice(-65536);
    });
  child.on('message', (message) => {
    if (message.type === 'failed') {
      for (const waiter of waiters.values())
        waiter.reject(new Error(message.code));
      waiters.clear();
      received.push(message);
      return;
    }
    const waiter = waiters.get(message.type);
    if (waiter) {
      waiters.delete(message.type);
      waiter.resolve(message);
    } else received.push(message);
  });
  return {
    send: (message) => child.send(message),
    message(type) {
      const failure = received.find((message) => message.type === 'failed');
      if (failure) return Promise.reject(new Error(failure.code));
      const position = received.findIndex((message) => message.type === type);
      if (position !== -1)
        return Promise.resolve(received.splice(position, 1)[0]);
      if (exited)
        return Promise.reject(new Error('El proceso propio ya terminó.'));
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          waiters.delete(type);
          reject(
            new Error(`No se recibió la barrera ${type} del worker propio.`),
          );
        }, 20000);
        waiters.set(type, {
          resolve: (value) => {
            clearTimeout(timeout);
            resolve(value);
          },
          reject: (error) => {
            clearTimeout(timeout);
            reject(error);
          },
        });
      });
    },
    async stop() {
      if (!exited) child.kill('SIGKILL');
      let timer;
      const result = await Promise.race([
        exit,
        new Promise((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(
                  'No terminó el worker propio después del cierre acotado.',
                ),
              ),
            5000,
          );
        }),
      ]).finally(() => clearTimeout(timer));
      expect(output).not.toContain('SIGNALS_HIDDEN_SENTINEL');
      expect(output).not.toContain('module.exports');
      return result;
    },
  };
}

beforeAll(async () => {
  const state = JSON.parse(readFileSync(process.env.ALUNZA_TEST_STATE, 'utf8'));
  assertLaboratoryTestState(state);
  base = process.env.ALUNZA_TEST_API_URL;
  if (base !== 'http://127.0.0.1:4300')
    throw new Error('Signals require isolated LAB TEST.');
  owner = new pg.Pool({ connectionString: state.migrationUrl, max: 5 });
  const limited = new URL(state.migrationUrl);
  limited.username = 'alunza_app';
  limited.password = state.applicationPassword;
  application = new pg.Pool({ connectionString: limited.href, max: 5 });
  for (const actor of [admin, teacher, student, foreignAdmin, foreignTeacher]) {
    const auth = createClient(state.authUrl, state.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const login = await auth.auth.signInWithPassword({
      email: actor.email,
      password: state.fixturePassword,
    });
    if (login.error || !login.data.session)
      throw new Error('No se obtuvo sesión ficticia de señales.');
    const token = login.data.session.access_token;
    sessions.set(actor.id, {
      token,
      sessionId: JSON.parse(
        Buffer.from(token.split('.')[1], 'base64url').toString(),
      ).session_id,
    });
  }
  ({
    processSignalSnapshot,
  } = require('../../apps/api/dist/signals/signal-processing.js'));
}, 120000);

beforeEach(async () => {
  ids = await createScope();
}, 120000);
afterAll(async () => {
  await Promise.all([owner?.end(), application?.end()]);
});

test('trabajo interno rechaza identidad de navegador y no concede lectura directa de ledgers', async () => {
  const laneId = await lane('INACTIVITY');
  for (const actor of [admin, teacher, student, foreignAdmin])
    await expect(
      asApplication(actor, (client) =>
        client.query('SELECT app_private.signal_claim_job($1::uuid)', [laneId]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  await expect(
    application.query('SELECT * FROM app_private.signal_snapshots'),
  ).rejects.toMatchObject({ code: '42501' });
  await expect(
    application.query('SELECT * FROM app_private.signal_episodes'),
  ).rejects.toMatchObject({ code: '42501' });
});

test('dos claims concurrentes obtienen un solo lease y el token vencido no modifica el checkpoint', async () => {
  await activate('INACTIVITY');
  const laneId = await lane('INACTIVITY');
  const claims = await Promise.all([claim(laneId), claim(laneId)]);
  expect(claims.filter(Boolean)).toHaveLength(1);
  const original = claims.find(Boolean);
  const oldSnapshot = await capture(original);
  const oldBatch = processSignalSnapshot(oldSnapshot);
  await owner.query(
    "UPDATE app_private.signal_jobs SET lease_until=clock_timestamp()-interval '1 millisecond' WHERE lane_id=$1",
    [laneId],
  );
  const replacement = await claim(laneId);
  expect(replacement.leaseToken).not.toBe(original.leaseToken);
  const renewed = await asApplication(
    null,
    async (client) =>
      (
        await client.query(
          'SELECT app_private.signal_renew_job($1::uuid,$2::uuid) AS value',
          [laneId, original.leaseToken],
        )
      ).rows[0].value,
  );
  expect(renewed).toBe(false);
  expect((await finalize(original, oldSnapshot, oldBatch)).status).toBe(
    'LEASE_LOST',
  );
  const state = (
    await owner.query(
      'SELECT lease_token,through_time FROM app_private.signal_jobs WHERE lane_id=$1',
      [laneId],
    )
  ).rows[0];
  expect(state.lease_token).toBe(replacement.leaseToken);
  expect(state.through_time).toBeNull();
  const snapshot = await capture(replacement);
  expect(
    (await finalize(replacement, snapshot, processSignalSnapshot(snapshot)))
      .status,
  ).toBe('COMMITTED');
});

test('commit ordinario tardío invalida el snapshot, sin publicar evidencia ni adelantar el checkpoint', async () => {
  await activate('INACTIVITY');
  const laneId = await lane('INACTIVITY');
  const job = await claim(laneId);
  const producer = await application.connect();
  let transaction = false;
  try {
    await producer.query('BEGIN');
    transaction = true;
    await producer.query(
      "SELECT set_config('app.actor_id',$1,true),set_config('app.session_id',$2,true)",
      [student.id, sessions.get(student.id).sessionId],
    );
    const opening = (
      await producer.query(
        'SELECT app_private.record_activity_open($1::uuid,$2::text) AS value',
        [ids.activity, randomUUID()],
      )
    ).rows[0].value;
    const snapshot = await capture(job);
    expect(snapshot.events.some((event) => event.id === opening.eventId)).toBe(
      false,
    );
    expect(
      (
        await owner.query(
          'SELECT count(*)::integer AS count FROM app_private.signal_input_changes WHERE source_id=$1',
          [opening.eventId],
        )
      ).rows[0].count,
    ).toBe(0);
    await producer.query('COMMIT');
    transaction = false;
    const source = (
      await owner.query(
        'SELECT finalized_revision,finalized_at FROM app_private.signal_input_changes WHERE source_id=$1',
        [opening.eventId],
      )
    ).rows;
    expect(source).toHaveLength(1);
    expect(source[0].finalized_revision).not.toBeNull();
    expect(source[0].finalized_at).not.toBeNull();
    expect(
      (await finalize(job, snapshot, processSignalSnapshot(snapshot))).status,
    ).toBe('STALE');
    expect(
      (
        await owner.query(
          'SELECT count(*)::integer AS count FROM app_private.signal_evaluations WHERE lane_id=$1',
          [laneId],
        )
      ).rows[0].count,
    ).toBe(0);
    expect(
      (
        await owner.query(
          'SELECT through_time FROM app_private.signal_jobs WHERE lane_id=$1',
          [laneId],
        )
      ).rows[0].through_time,
    ).toBeNull();
  } finally {
    if (transaction) await producer.query('ROLLBACK');
    producer.release();
  }
});

test('rollback de productor y replay de apertura no fabrican cambios confirmados', async () => {
  const producer = await application.connect();
  const key = randomUUID();
  try {
    await producer.query('BEGIN');
    await producer.query(
      "SELECT set_config('app.actor_id',$1,true),set_config('app.session_id',$2,true)",
      [student.id, sessions.get(student.id).sessionId],
    );
    const rolledBack = (
      await producer.query(
        'SELECT app_private.record_activity_open($1::uuid,$2::text) AS value',
        [ids.activity, key],
      )
    ).rows[0].value;
    await producer.query('ROLLBACK');
    expect(
      (
        await owner.query(
          'SELECT count(*)::integer AS count FROM app_private.signal_input_changes WHERE source_id=$1',
          [rolledBack.eventId],
        )
      ).rows[0].count,
    ).toBe(0);
  } finally {
    producer.release();
  }
  const first = await api(
    `/activities/${ids.activity}/open-events`,
    student,
    'POST',
    {},
    key,
  );
  const repeated = await api(
    `/activities/${ids.activity}/open-events`,
    student,
    'POST',
    {},
    key,
  );
  expect(first.status).toBe(201);
  expect(repeated.data).toEqual(first.data);
  expect(
    (
      await owner.query(
        'SELECT count(*)::integer AS count FROM app_private.signal_input_changes WHERE source_id=$1',
        [first.data.eventId],
      )
    ).rows[0].count,
  ).toBe(1);
});

test('flush anticipado prohíbe DML posterior aun sin cambiar estado y rollback borra la apertura', async () => {
  const client = await application.connect();
  let eventId;
  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT set_config('app.actor_id',$1,true),set_config('app.session_id',$2,true)",
      [student.id, sessions.get(student.id).sessionId],
    );
    eventId = (
      await client.query(
        'SELECT app_private.record_activity_open($1,$2) AS value',
        [ids.activity, randomUUID()],
      )
    ).rows[0].value.eventId;
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    await expect(
      client.query(
        'UPDATE app.profiles SET display_name=display_name WHERE id=$1',
        [student.id],
      ),
    ).rejects.toMatchObject({
      code: '23514',
      message: 'SIGNAL_DML_AFTER_FLUSH',
    });
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
  expect(
    (
      await owner.query(
        'SELECT count(*)::integer AS count FROM app_private.student_activity_observations WHERE id=$1',
        [eventId],
      )
    ).rows[0].count,
  ).toBe(0);
  expect(
    (
      await owner.query(
        'SELECT count(*)::integer AS count FROM app_private.signal_input_changes WHERE source_id=$1',
        [eventId],
      )
    ).rows[0].count,
  ).toBe(0);
});

test('E17: worker atrasado preserva la mejora intermedia, dos episodios de estancamiento y un episodio de error', async () => {
  await activate('STAGNATION');
  await activate('REPEATED_ERROR');
  const submitted = [];
  for (const passed of [1, 1, 1, 2, 2, 2]) submitted.push(await submit(passed));
  expect(new Set(submitted.map((attempt) => attempt.attemptId)).size).toBe(6);
  const stagnantLane = await lane('STAGNATION');
  const repeatedLane = await lane('REPEATED_ERROR');
  const runs = await processLane(stagnantLane);
  await processLane(repeatedLane);
  const stagnant = await episodes(stagnantLane);
  const repeated = await episodes(repeatedLane);
  expect(stagnant).toHaveLength(2);
  expect(repeated).toHaveLength(1);
  expect(stagnant[0].stopped_at).not.toBeNull();
  expect(stagnant[1].previous_episode_id).toBe(stagnant[0].id);
  expect(stagnant[1].stopped_at).toBeNull();
  expect(stagnant.map((episode) => episode.state)).toEqual([
    'ACTIVE',
    'ACTIVE',
  ]);
  expect(repeated[0].state).toBe('ACTIVE');
  await expect(
    owner.query(
      `INSERT INTO app_private.signal_episodes(lane_id,rule_version_id,first_witness_key,first_evaluation_id,initial_cause,initial_evidence,qualified_at)
    SELECT lane_id,rule_version_id,first_witness_key,$2,initial_cause,initial_evidence,qualified_at FROM app_private.signal_episodes WHERE id=$1`,
      [stagnant[0].id, repeated[0].first_evaluation_id],
    ),
  ).rejects.toMatchObject({ code: '23514', message: 'SIGNAL_EPISODE_SCOPE' });
  await expect(
    owner.query(
      `INSERT INTO app_private.signal_episodes(lane_id,rule_version_id,first_witness_key,first_evaluation_id,initial_cause,initial_evidence,qualified_at,previous_episode_id)
    SELECT lane_id,rule_version_id,first_witness_key,first_evaluation_id,initial_cause,initial_evidence,qualified_at,$2 FROM app_private.signal_episodes WHERE id=$1`,
      [stagnant[0].id, stagnant[1].id],
    ),
  ).rejects.toMatchObject({ code: '23514', message: 'SIGNAL_EPISODE_CHAIN' });
  await expect(
    owner.query(
      'INSERT INTO app_private.signal_episode_evaluations(episode_id,evaluation_id) VALUES($1,$2)',
      [repeated[0].id, stagnant[0].first_evaluation_id],
    ),
  ).rejects.toMatchObject({ code: '23514', message: 'SIGNAL_LINK_SCOPE' });
  expect(await episodes(stagnantLane)).toEqual(stagnant);
  expect(await episodes(repeatedLane)).toEqual(repeated);
  const before = await episodes(stagnantLane);
  const last = runs.at(-1);
  const receipt = (
    await owner.query(
      'SELECT checkpoint,control_state FROM app_private.signal_finalize_receipts WHERE lane_id=$1 AND lease_token=$2 AND snapshot_id=$3',
      [stagnantLane, last.job.leaseToken, last.snapshot.snapshot.id],
    )
  ).rows[0];
  expect(receipt.checkpoint).toEqual(last.batch.checkpoint);
  const operational = (
    await owner.query(
      'SELECT app_private.signal_instant(through_time) AS through_time,through_submission_sequence::text,boundary_key,continuation,pending_reconciliation_break,next_deadline_micros::text,last_revision FROM app_private.signal_jobs WHERE lane_id=$1',
      [stagnantLane],
    )
  ).rows[0];
  expect(receipt.control_state).toEqual({
    throughTime: operational.through_time,
    throughSubmissionSequence: operational.through_submission_sequence,
    boundaryKey: operational.boundary_key,
    continuation: operational.continuation,
    pendingReconciliationBreak: operational.pending_reconciliation_break,
    nextDeadlineMicros: operational.next_deadline_micros,
    lastRevision: operational.last_revision,
  });
  expect((await finalize(last.job, last.snapshot, last.batch)).status).toBe(
    'REPLAY',
  );
  expect(await episodes(stagnantLane)).toEqual(before);
  const authorized = await evidence(teacher, stagnant[1].id);
  expect(authorized).not.toBeNull();
  for (const sentinel of [
    'SIGNALS_HIDDEN_SENTINEL',
    'module.exports',
    'stdout',
    'stderr',
  ])
    expect(JSON.stringify(authorized)).not.toContain(sentinel);
  for (const actor of [admin, student, foreignAdmin, foreignTeacher])
    await expect(evidence(actor, stagnant[1].id)).rejects.toMatchObject({
      code: 'P0001',
    });
  const nextRule = await api(
    `/organizations/${ids.org}/signal-rules`,
    admin,
    'POST',
    {
      type: 'STAGNATION',
      schemaVersion: 1,
      algorithmVersion: 'DEC005_V1',
      parameters: { stagnationAttempts: 3 },
    },
  );
  expect(nextRule.status).toBe(201);
  expect(
    (
      await api(`/signal-rules/${nextRule.data.id}/activate`, admin, 'POST', {
        expectedCurrentVersionId: stagnant[1].rule_version_id,
      })
    ).status,
  ).toBe(200);
  await processLane(stagnantLane);
  const changedRule = await episodes(stagnantLane);
  expect(changedRule).toHaveLength(3);
  expect(changedRule[2].id).not.toBe(stagnant[1].id);
  expect(changedRule[2]).toMatchObject({
    previous_episode_id: stagnant[1].id,
    rule_version_id: nextRule.data.id,
    state: 'ACTIVE',
  });
  expect(
    changedRule[2].initial_cause.startsWith('Nueva versión de regla. '),
  ).toBe(true);
  expect(changedRule[1].stopped_at).not.toBeNull();
  expect(['NEW_RULE_VERSION', 'RULE_VERSION_CHANGED']).toContain(
    changedRule[1].stop_reason,
  );
  expect(changedRule[1]).toMatchObject({
    state: stagnant[1].state,
    first_evaluation_id: stagnant[1].first_evaluation_id,
    first_witness_key: stagnant[1].first_witness_key,
    initial_cause: stagnant[1].initial_cause,
  });
  expect(
    (
      await owner.query(
        'SELECT count(*)::integer AS count FROM app.attempts WHERE activity_exercise_id=$1',
        [ids.assignment],
      )
    ).rows[0].count,
  ).toBe(6);
}, 180000);

test('reconciliación tardía paginada corta continuidad sin reescribir evaluaciones históricas', async () => {
  await activate('STAGNATION');
  const initial = [];
  for (let index = 0; index < 3; index++) initial.push(await submit(1));
  const laneId = await lane('STAGNATION');
  await processLane(laneId);
  const first = (await episodes(laneId))[0];
  expect(first).toBeDefined();
  const originalLinks = (
    await owner.query(
      'SELECT episode_id,evaluation_id FROM app_private.signal_episode_evaluations WHERE episode_id=$1 ORDER BY evaluation_id',
      [first.id],
    )
  ).rows;
  const producer = await application.connect();
  const late = [];
  let open = false;
  try {
    await producer.query('BEGIN');
    open = true;
    for (let index = 0; index < 3; index++)
      late.push(await submitInHeldTransaction(producer, 2));
    // Request a current reconciliation in TEST while the source transaction is
    // still invisible. No evidence timestamp, revision or result is changed.
    await owner.query(
      'UPDATE app_private.signal_jobs SET boundary_key=NULL,available_at=clock_timestamp() WHERE lane_id=$1',
      [laneId],
    );
    const job = await claim(laneId);
    expect(job).not.toBeNull();
    const snapshot = await capture(job);
    expect(snapshot.submissions.map((attempt) => attempt.id).sort()).toEqual(
      initial.map((attempt) => attempt.attemptId).sort(),
    );
    const batch = processSignalSnapshot(snapshot);
    expect(['COMMITTED', 'REPLAY']).toContain(
      (await finalize(job, snapshot, batch)).status,
    );
    expect(
      (
        await owner.query(
          'SELECT through_time>=$2::timestamptz AS late FROM app_private.signal_jobs WHERE lane_id=$1',
          [laneId, late.at(-1).submittedAt],
        )
      ).rows[0].late,
    ).toBe(true);
    await producer.query('COMMIT');
    open = false;
  } finally {
    if (open) await producer.query('ROLLBACK');
    producer.release();
  }
  await processLane(laneId, 1);
  const resulting = await episodes(laneId);
  expect(resulting).toHaveLength(2);
  expect(resulting[0]).toMatchObject({
    id: first.id,
    state: 'ACTIVE',
    stop_reason: 'RECONCILIATION_INTERRUPTION',
  });
  expect(resulting[0].stopped_at).not.toBeNull();
  expect(resulting[1].previous_episode_id).toBe(first.id);
  expect(resulting[1].stopped_at).toBeNull();
  expect(
    (
      await owner.query(
        'SELECT result FROM app_private.signal_evaluations WHERE id=$1',
        [resulting[1].first_evaluation_id],
      )
    ).rows[0].result.selectedAttemptIds,
  ).toEqual(late.map((attempt) => attempt.attemptId));
  expect(
    (
      await owner.query(
        'SELECT episode_id,evaluation_id FROM app_private.signal_episode_evaluations WHERE episode_id=$1 AND evaluation_id=ANY($2::uuid[]) ORDER BY evaluation_id',
        [first.id, originalLinks.map((link) => link.evaluation_id)],
      )
    ).rows,
  ).toEqual(originalLinks);
}, 180000);

test('SIG-14 y REVIEWED: revisión concurrente conserva primera base; IA y reconstrucción no alteran evidencia ni reactivan episodios', async () => {
  await activate('REPEATED_ERROR');
  for (let index = 0; index < 3; index++) await submit(1);
  const laneId = await lane('REPEATED_ERROR');
  await processLane(laneId);
  const first = (await episodes(laneId))[0];
  expect(first).toBeDefined();
  await expectAiIndependentReplay(laneId);
  const { reviewed, savedReview } = await reviewConcurrently(first.id);
  expect(
    (
      await owner.query(
        'SELECT app_private.signal_review_fixture($1::uuid,$2::uuid) AS value',
        [first.id, teacher.id],
      )
    ).rows[0].value,
  ).toEqual(reviewed);
  expect(savedReview.reviewed_by).toBe(teacher.id);
  expect(savedReview.base_witness_keys.length).toBeGreaterThan(0);
  await submit(1);
  await processLane(laneId);
  const current = await episodes(laneId);
  expect(current).toHaveLength(2);
  expect(current[0].state).toBe('REVIEWED');
  expect(current[0].reviewed_by).toBe(teacher.id);
  expect(current[0].reviewed_at).toEqual(savedReview.reviewed_at);
  expect(current[1].state).toBe('ACTIVE');
  expect(current[1].previous_episode_id).toBe(first.id);
  const checkpoint = (
    await owner.query(
      'SELECT through_time,boundary_key FROM app_private.signal_jobs WHERE lane_id=$1',
      [laneId],
    )
  ).rows[0];
  const asOf = (
    await owner.query(
      'SELECT app_private.signal_instant(clock_timestamp()) AS value',
    )
  ).rows[0].value;
  const scope = {
    organizationId: ids.org,
    classId: ids.class,
    studentId: student.id,
    activityId: ids.activity,
    asOf,
  };
  const projections = (
    await owner.query(
      'SELECT episode_id,lane_id,payload,digest FROM app_private.signal_projections WHERE lane_id=$1 ORDER BY episode_id',
      [laneId],
    )
  ).rows;
  expect(projections).toHaveLength(2);
  await owner.query(
    'UPDATE app_private.signal_projections SET payload=\'{"tampered":true}\'::jsonb WHERE episode_id=$1',
    [first.id],
  );
  const maintenance = async (mode) => {
    const response = await runMaintenanceChild(
      join(__dirname, '../../scripts/signals-rebuild.mjs'),
      [
        mode,
        '--target',
        'test',
        '--organization',
        scope.organizationId,
        '--class',
        scope.classId,
        '--student',
        scope.studentId,
        '--activity',
        scope.activityId,
        '--as-of',
        scope.asOf,
      ],
    );
    expect(response.code).toBe(0);
    expect(response.stderr).toBe('');
    expect(response.stdout).not.toContain('SIGNALS_HIDDEN_SENTINEL');
    return JSON.parse(response.stdout);
  };
  const detected = await maintenance('check');
  expect(detected.consistent).toBe(false);
  expect(detected.mismatches).toBeGreaterThan(0);
  expect(detected.verifiedEvaluations).toBeGreaterThan(0);
  const corrupted = await runMaintenanceChild(
    join(__dirname, 'helpers/signal-maintenance.cjs'),
    [JSON.stringify(scope)],
  );
  expect(corrupted.code).toBe(0);
  expect(JSON.parse(corrupted.stdout)).toEqual({
    errorCode: 'SIGNAL_HISTORICAL_RESULT_MISMATCH',
    tamperedResponses: 1,
    reconstructionCalls: 0,
  });
  const rebuilt = await maintenance('rebuild');
  expect(rebuilt.consistent).toBe(true);
  expect(rebuilt.mismatches).toBe(0);
  expect(rebuilt.verifiedEvaluations).toBe(detected.verifiedEvaluations);
  const reported = await maintenance('report');
  expect(reported.consistent).toBe(true);
  expect(
    (
      await owner.query(
        'SELECT episode_id,lane_id,payload,digest FROM app_private.signal_projections WHERE lane_id=$1 ORDER BY episode_id',
        [laneId],
      )
    ).rows,
  ).toEqual(projections);
  expect(await episodes(laneId)).toEqual(current);
  expect(
    (
      await owner.query(
        'SELECT through_time,boundary_key FROM app_private.signal_jobs WHERE lane_id=$1',
        [laneId],
      )
    ).rows[0],
  ).toEqual(checkpoint);
  expect((await owner.query(reviewBaseSql, [first.id])).rows).toEqual([
    savedReview,
  ]);
  await expect(
    owner.query(
      "UPDATE app_private.signal_reviews SET base_witness_keys='{}' WHERE episode_id=$1",
      [first.id],
    ),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    owner.query('DELETE FROM app_private.signal_evaluations WHERE lane_id=$1', [
      laneId,
    ]),
  ).rejects.toMatchObject({ code: '23514' });
}, 180000);

test('cobertura comienza en instalación real y su reinicio conserva el hueco sin inventar siete días observables', async () => {
  await activate('INACTIVITY');
  const laneId = await lane('INACTIVITY');
  const job = await claim(laneId);
  const snapshot = await capture(job);
  const batch = processSignalSnapshot(snapshot);
  expect(
    batch.evaluations.some(
      (evaluation) => evaluation.result.outcome === 'MATCH',
    ),
  ).toBe(false);
  expect((await finalize(job, snapshot, batch)).status).toBe('COMMITTED');
  expect(await episodes(laneId)).toEqual([]);
  const previous = (
    await owner.query(
      "SELECT id,starts_at FROM app_private.signal_coverage_epochs WHERE source='RUN' AND ends_at IS NULL",
    )
  ).rows;
  expect(previous).toHaveLength(1);
  await expect(
    asApplication(null, (client) =>
      client.query(
        "SELECT app_private.signal_restart_coverage('RUN','test-gap')",
      ),
    ),
  ).rejects.toMatchObject({ code: '42501' });
  const maintenance = await owner.connect();
  try {
    await maintenance.query('BEGIN');
    await maintenance.query(
      "SELECT app_private.signal_restart_coverage('RUN','test-gap')",
    );
    const epochs = (
      await maintenance.query(
        "SELECT id,starts_at,ends_at,reason FROM app_private.signal_coverage_epochs WHERE source='RUN' ORDER BY starts_at,id",
      )
    ).rows;
    expect(
      epochs.find((epoch) => epoch.id === previous[0].id).ends_at,
    ).not.toBeNull();
    const active = epochs.filter((epoch) => epoch.ends_at === null);
    expect(active).toHaveLength(1);
    expect(active[0].id).not.toBe(previous[0].id);
    expect(active[0].starts_at.getTime()).toBeGreaterThanOrEqual(
      previous[0].starts_at.getTime(),
    );
  } finally {
    await maintenance.query('ROLLBACK');
    maintenance.release();
  }
});

test('dos procesos reales recuperan una caída tras snapshot y una respuesta perdida después del commit', async () => {
  await activate('REPEATED_ERROR');
  for (let index = 0; index < 3; index++) await submit(1);
  const laneId = await lane('REPEATED_ERROR');
  const children = [];
  try {
    const first = childWorker();
    const second = childWorker();
    children.push(first, second);
    await Promise.all([first.message('ready'), second.message('ready')]);
    first.send({ type: 'run', laneId, barrier: 'capture' });
    await first.message('captured');
    second.send({ type: 'run', laneId, barrier: null });
    expect((await second.message('finished')).metrics.cycles).toBe(0);
    expect(await episodes(laneId)).toEqual([]);
    expect(
      (
        await owner.query(
          'SELECT through_time FROM app_private.signal_jobs WHERE lane_id=$1',
          [laneId],
        )
      ).rows[0].through_time,
    ).toBeNull();
    await first.stop();
    await owner.query(
      "UPDATE app_private.signal_jobs SET lease_until=clock_timestamp()-interval '1 millisecond' WHERE lane_id=$1",
      [laneId],
    );
    second.send({ type: 'run', laneId, barrier: 'finalize' });
    const committed = await second.message('committed');
    expect(committed.status).toBe('COMMITTED');
    const persisted = await episodes(laneId);
    expect(persisted).toHaveLength(1);
    expect(persisted[0].state).toBe('ACTIVE');
    const persistedIds = (
      await owner.query(
        'SELECT id FROM app_private.signal_evaluations WHERE lane_id=$1 ORDER BY id',
        [laneId],
      )
    ).rows.map((row) => row.id);
    expect(persistedIds.length).toBeGreaterThan(0);
    await second.stop();
    // A new legitimate opening schedules the lane, without creating a SUBMIT.
    expect(
      (
        await api(
          `/activities/${ids.activity}/open-events`,
          student,
          'POST',
          {},
        )
      ).status,
    ).toBe(201);
    const recovered = childWorker();
    children.push(recovered);
    await recovered.message('ready');
    recovered.send({ type: 'run', laneId, barrier: null });
    const finished = await recovered.message('finished');
    expect(finished.metrics.cycles).toBe(1);
    expect(finished.metrics.failed).toBe(0);
    expect(await episodes(laneId)).toEqual(persisted);
    const recoveredIds = (
      await owner.query(
        'SELECT id FROM app_private.signal_evaluations WHERE lane_id=$1',
        [laneId],
      )
    ).rows.map((row) => row.id);
    expect(recoveredIds).toEqual(expect.arrayContaining(persistedIds));
    expect(
      (
        await owner.query(
          'SELECT count(*)::integer AS count FROM app.attempts WHERE activity_exercise_id=$1',
          [ids.assignment],
        )
      ).rows[0].count,
    ).toBe(3);
  } finally {
    await Promise.all(children.map((child) => child.stop()));
  }
}, 180000);

test('RUN real y replay capturan una sola ejecución elegible sin fabricar SUBMIT', async () => {
  await activate('INACTIVITY');
  const key = randomUUID();
  const path = `/activities/${ids.activity}/exercises/${ids.assignment}/executions`;
  const body = {
    exerciseVersionId: ids.version,
    code: 'module.exports.solve=()=>1;',
  };
  const executed = await api(path, student, 'POST', body, key);
  expect(executed.status).toBe(201);
  expect(executed.data.technicalResult.visiblePassed).toBe(3);
  expect((await api(path, student, 'POST', body, key)).data).toEqual(
    executed.data,
  );
  const laneId = await lane('INACTIVITY');
  const job = await claim(laneId);
  const snapshot = await capture(job);
  const events = snapshot.events.filter((event) => event.source === 'RUN');
  expect(events).toHaveLength(1);
  expect(events[0].eligible).toBe(true);
  expect(
    (
      await owner.query(
        'SELECT count(*)::integer AS count FROM app_private.signal_input_changes WHERE source_id=$1',
        [events[0].id],
      )
    ).rows[0].count,
  ).toBe(1);
  expect(
    (
      await owner.query(
        'SELECT count(*)::integer AS count FROM app.attempts WHERE activity_exercise_id=$1',
        [ids.assignment],
      )
    ).rows[0].count,
  ).toBe(0);
  expect(
    (await finalize(job, snapshot, processSignalSnapshot(snapshot))).status,
  ).toBe('COMMITTED');
  expect(await episodes(laneId)).toEqual([]);
}, 90000);

test('HELP real sin fuente y ACK explícito capturan una sola lectura elegible del fallback', async () => {
  await activate('INACTIVITY');
  const submitted = await submit(1);
  const request = await api(
    `/attempts/${submitted.attemptId}/feedback-requests`,
    student,
    'POST',
    { kind: 'FEEDBACK' },
  );
  expect(request.status).toBe(202);
  const deadline = Date.now() + 20000;
  let feedback;
  while (Date.now() < deadline) {
    const current = await api(`/feedback-requests/${request.data.id}`, student);
    expect(current.status).toBe(200);
    if (current.data.feedbackId) {
      const response = await api(
        `/feedback/${current.data.feedbackId}`,
        student,
      );
      expect(response.status).toBe(200);
      feedback = response.data;
      break;
    }
    await delay(100);
  }
  expect(feedback).toBeDefined();
  expect(feedback.help.status).toBe('NO_EVIDENCE');
  expect(feedback.presentationToken).not.toBeNull();
  const laneId = await lane('INACTIVITY');
  const priorJob = await claim(laneId);
  const priorSnapshot = await capture(priorJob);
  expect(
    priorSnapshot.events.filter(
      (event) => event.source === 'HELP' && event.eligible,
    ),
  ).toEqual([]);
  expect(
    (
      await finalize(
        priorJob,
        priorSnapshot,
        processSignalSnapshot(priorSnapshot),
      )
    ).status,
  ).toBe('COMMITTED');
  for (let index = 0; index < 2; index++) {
    const viewed = await api(
      `/feedback/${feedback.id}/viewed`,
      student,
      'POST',
      { presentationToken: feedback.presentationToken },
    );
    expect(viewed.status).toBe(200);
  }
  const job = await claim(laneId);
  expect(job).not.toBeNull();
  const snapshot = await capture(job);
  const eligible = snapshot.events.filter(
    (event) => event.source === 'HELP' && event.eligible,
  );
  expect(eligible).toHaveLength(1);
  expect(eligible[0].type).toBe('FEEDBACK_VIEWED');
  expect(eligible[0].activityId).toBe(ids.activity);
  const durable = (
    await owner.query(
      'SELECT event_type,count(*)::integer AS count FROM app_private.help_events WHERE attempt_id=$1 GROUP BY event_type ORDER BY event_type',
      [submitted.attemptId],
    )
  ).rows;
  expect(durable).toEqual([
    { event_type: 'FEEDBACK_VIEWED', count: 1 },
    { event_type: 'HELP_REQUESTED', count: 1 },
  ]);
  expect(
    (
      await owner.query(
        'SELECT count(*)::integer AS count FROM app_private.signal_input_changes WHERE source_id=$1',
        [eligible[0].id],
      )
    ).rows[0].count,
  ).toBe(1);
  expect(
    (
      await owner.query(
        'SELECT count(*)::integer AS count FROM app.attempts WHERE activity_exercise_id=$1',
        [ids.assignment],
      )
    ).rows[0].count,
  ).toBe(1);
}, 120000);

test('capturador desactivado y restaurado con worker apagado deja un hueco durable y nueva época', async () => {
  const prior = (
    await owner.query(
      "SELECT id,starts_at FROM app_private.signal_coverage_epochs WHERE source='ACTIVITY_OPEN' AND ends_at IS NULL",
    )
  ).rows;
  expect(prior).toHaveLength(1);
  let disabled = false;
  try {
    await owner.query(
      'ALTER TABLE app_private.student_activity_observations DISABLE TRIGGER signal_source_capture',
    );
    disabled = true;
    const changed = (
      await owner.query(
        'SELECT app_private.signal_coverage_at(clock_timestamp(),clock_timestamp(),true) AS value',
      )
    ).rows[0].value;
    expect(changed.status).toBe('UNKNOWN');
  } finally {
    if (disabled)
      await owner.query(
        'ALTER TABLE app_private.student_activity_observations ENABLE TRIGGER signal_source_capture',
      );
  }
  const restored = (
    await owner.query(
      'SELECT app_private.signal_coverage_at(clock_timestamp(),clock_timestamp(),true) AS value',
    )
  ).rows[0].value;
  expect(restored.status).toBe('CONTINUOUS');
  const source = restored.sources.find(
    (entry) => entry.source === 'ACTIVITY_OPEN',
  );
  expect(source.referenceId).not.toBe(prior[0].id);
  const epochs = (
    await owner.query(
      'SELECT old.ends_at IS NOT NULL AND old.ends_at<=fresh.starts_at AS gap_preserved,fresh.reason FROM app_private.signal_coverage_epochs old CROSS JOIN app_private.signal_coverage_epochs fresh WHERE old.id=$1 AND fresh.id=$2',
      [prior[0].id, source.referenceId],
    )
  ).rows[0];
  expect(epochs).toEqual({ gap_preserved: true, reason: 'CAPTURE_RESTORED' });
});

test.each(['rule', 'membership'])(
  'cambio %s posterior a snapshot impide publicar con permisos o regla obsoletos',
  async (change) => {
    const originalRule = await activate('INACTIVITY');
    const laneId = await lane('INACTIVITY');
    const job = await claim(laneId);
    const snapshot = await capture(job);
    if (change === 'rule') {
      const next = await api(
        `/organizations/${ids.org}/signal-rules`,
        admin,
        'POST',
        {
          type: 'INACTIVITY',
          schemaVersion: 1,
          algorithmVersion: 'DEC005_V1',
          parameters: { inactivityDays: 8 },
        },
      );
      expect(next.status).toBe(201);
      expect(
        (
          await api(`/signal-rules/${next.data.id}/activate`, admin, 'POST', {
            expectedCurrentVersionId: originalRule.id,
          })
        ).status,
      ).toBe(200);
    } else {
      await owner.query(
        "UPDATE app.organization_memberships SET state='DISABLED' WHERE organization_id=$1 AND user_id=$2",
        [ids.org, student.id],
      );
    }
    expect(
      (await finalize(job, snapshot, processSignalSnapshot(snapshot))).status,
    ).toBe('STALE');
    expect(await episodes(laneId)).toEqual([]);
    const replacement = await claim(laneId);
    expect(replacement).not.toBeNull();
    const current = await capture(replacement);
    expect(current.snapshot.revision).not.toBe(snapshot.snapshot.revision);
    if (change === 'membership')
      expect(current.activity.studentActive).toBe(false);
    expect(
      (await finalize(replacement, current, processSignalSnapshot(current)))
        .status,
    ).toBe('COMMITTED');
    expect(await episodes(laneId)).toEqual([]);
  },
);

test('reintentos 1/5/15/60 segundos suspenden el quinto fallo y requieren reanudación explícita', async () => {
  await activate('INACTIVITY');
  const laneId = await lane('INACTIVITY');
  for (const [index, seconds] of [1, 5, 15, 60, 60].entries()) {
    const job = await claim(laneId);
    expect(job).not.toBeNull();
    const timing = await asApplication(null, async (client) => {
      const started = (
        await client.query('SELECT clock_timestamp()::text AS value')
      ).rows[0].value;
      const failed = (
        await client.query(
          "SELECT app_private.signal_fail_job($1,$2,'PROCESSING_FAILED') AS value",
          [laneId, job.leaseToken],
        )
      ).rows[0].value;
      const finished = (
        await client.query('SELECT clock_timestamp()::text AS value')
      ).rows[0].value;
      return { started, finished, failed };
    });
    expect(timing.failed).toBe(true);
    const persisted = (
      await owner.query(
        'SELECT attempts,last_error_code,failed_at IS NOT NULL AS suspended,through_time,lease_token,available_at>=$2::timestamptz+make_interval(secs=>$4) AND available_at<=$3::timestamptz+make_interval(secs=>$4) AS exact_delay FROM app_private.signal_jobs WHERE lane_id=$1',
        [laneId, timing.started, timing.finished, seconds],
      )
    ).rows[0];
    expect(persisted).toEqual({
      attempts: index + 1,
      last_error_code: 'PROCESSING_FAILED',
      suspended: index === 4,
      through_time: null,
      lease_token: null,
      exact_delay: true,
    });
    // The delay itself is asserted against the server interval above. Hold
    // availability far ahead here so slow CI cannot turn this gate into a race.
    await owner.query(
      "UPDATE app_private.signal_jobs SET available_at=clock_timestamp()+interval '1 hour' WHERE lane_id=$1",
      [laneId],
    );
    expect(await claim(laneId)).toBeNull();
    await owner.query(
      'UPDATE app_private.signal_jobs SET available_at=clock_timestamp() WHERE lane_id=$1',
      [laneId],
    );
  }
  expect(await claim(laneId)).toBeNull();
  await expect(
    asApplication(teacher, (client) =>
      client.query('SELECT app_private.signal_resume_job($1)', [laneId]),
    ),
  ).rejects.toMatchObject({ code: '42501' });
  expect(
    (
      await asApplication(null, (client) =>
        client.query('SELECT app_private.signal_resume_job($1) AS resumed', [
          laneId,
        ]),
      )
    ).rows[0].resumed,
  ).toBe(true);
  const job = await claim(laneId);
  expect(job).not.toBeNull();
  const snapshot = await capture(job);
  expect(
    (await finalize(job, snapshot, processSignalSnapshot(snapshot))).status,
  ).toBe('COMMITTED');
  expect(
    (
      await owner.query(
        'SELECT attempts,last_error_code,failed_at FROM app_private.signal_jobs WHERE lane_id=$1',
        [laneId],
      )
    ).rows[0],
  ).toEqual({ attempts: 0, last_error_code: null, failed_at: null });
});

test('worker detecta CLOCK_REGRESSION sin avanzar checkpoint y reanuda tras corregir reloj del fixture', async () => {
  await activate('INACTIVITY');
  const laneId = await lane('INACTIVITY');
  const future = (
    await owner.query(
      "UPDATE app_private.signal_jobs SET through_time=clock_timestamp()+interval '1 day' WHERE lane_id=$1 RETURNING through_time::text AS value",
      [laneId],
    )
  ).rows[0].value;
  const failing = childWorker();
  try {
    await failing.message('ready');
    failing.send({ type: 'run', laneId, barrier: null });
    expect((await failing.message('finished')).metrics).toMatchObject({
      cycles: 1,
      failed: 1,
      committed: 0,
    });
  } finally {
    await failing.stop();
  }
  expect(
    (
      await owner.query(
        'SELECT through_time::text AS checkpoint,attempts,last_error_code FROM app_private.signal_jobs WHERE lane_id=$1',
        [laneId],
      )
    ).rows[0],
  ).toEqual({
    checkpoint: future,
    attempts: 1,
    last_error_code: 'CLOCK_REGRESSION',
  });
  expect(await episodes(laneId)).toEqual([]);
  await owner.query(
    'UPDATE app_private.signal_jobs SET through_time=NULL,available_at=clock_timestamp() WHERE lane_id=$1',
    [laneId],
  );
  const recovered = childWorker();
  try {
    await recovered.message('ready');
    recovered.send({ type: 'run', laneId, barrier: null });
    expect((await recovered.message('finished')).metrics).toMatchObject({
      cycles: 1,
      failed: 0,
      committed: 1,
    });
  } finally {
    await recovered.stop();
  }
  expect(
    (
      await owner.query(
        'SELECT through_time IS NOT NULL AS advanced,attempts,last_error_code FROM app_private.signal_jobs WHERE lane_id=$1',
        [laneId],
      )
    ).rows[0],
  ).toEqual({ advanced: true, attempts: 0, last_error_code: null });
}, 90000);
