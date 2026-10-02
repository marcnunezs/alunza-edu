/* eslint @typescript-eslint/no-require-imports: "off" */
const { randomUUID, createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const pg = require('pg');
const { createClient } = require('@supabase/supabase-js');
const contracts = require('@alunza/contracts');
const { assertLaboratoryTestState } = require('../laboratory-test-state.cjs');
const fixture = require('../../fixtures/foundation/identity.json');
const admin = fixture.users[0],
  teacher = fixture.users[1],
  student = fixture.users[2],
  outsider = fixture.users[5];
const ids = Object.fromEntries(
  [
    'org',
    'course',
    'class',
    'concept',
    'conceptVersion',
    'exercise',
    'version',
    'activity',
    'assignment',
  ].map((name) => [name, randomUUID()]),
);
const sessions = new Map();
let state, pool, base, secondStudent;
const source = 'module.exports.solve=(a,b)=>a+b;';
const path = () =>
  `/activities/${ids.activity}/exercises/${ids.assignment}/executions`;
const hash = (value) => createHash('sha256').update(value).digest('hex');
async function api(
  route,
  {
    actor = student,
    code,
    body,
    key = randomUUID(),
    method = 'POST',
    revision,
  } = {},
) {
  const response = await fetch(`${base}/api/v1${route}`, {
    method,
    headers: {
      Authorization: `Bearer ${sessions.get(actor.id)}`,
      ...(method === 'POST'
        ? { 'Content-Type': 'application/json', 'Idempotency-Key': key }
        : {}),
      ...(revision ? { 'If-Match': `"${revision}"` } : {}),
    },
    ...(method === 'POST'
      ? {
          body: JSON.stringify(
            body ?? { code: code ?? source, exerciseVersionId: ids.version },
          ),
        }
      : {}),
    signal: AbortSignal.timeout(45000),
  });
  const payload = await response.json();
  expect(response.headers.get('cache-control')).toContain('no-store');
  if (response.ok && route.endsWith('/executions'))
    expect(
      contracts.runExecutionResponseSchema.safeParse(payload).success,
    ).toBe(true);
  expect(JSON.stringify(payload)).not.toContain('IMP03_HIDDEN_SENTINEL');
  return {
    status: response.status,
    payload,
    retryAfter: response.headers.get('retry-after'),
  };
}
async function eventually(check, timeout = 20000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('La condición RUN no se cumplió dentro del plazo de prueba.');
}
async function asApplication(user, action) {
  const url = new URL(state.migrationUrl);
  url.username = 'alunza_app';
  url.password = state.applicationPassword;
  const client = new pg.Client({ connectionString: url.href });
  await client.connect();
  try {
    await client.query('BEGIN');
    const sessionId = user
      ? JSON.parse(
          Buffer.from(
            sessions.get(user.id).split('.')[1],
            'base64url',
          ).toString('utf8'),
        ).session_id
      : '';
    await client.query(
      "SELECT set_config('app.actor_id',$1,true),set_config('app.session_id',$2,true),set_config('app.organization_id',$3,true)",
      [user?.id ?? '', sessionId, user ? ids.org : ''],
    );
    return await action(client);
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
}
beforeAll(async () => {
  state = JSON.parse(readFileSync(process.env.ALUNZA_TEST_STATE, 'utf8'));
  assertLaboratoryTestState(state);
  base = process.env.ALUNZA_TEST_API_URL;
  if (
    state.projectId !== 'alunza-edu-laboratorio-test' ||
    base !== 'http://127.0.0.1:4300'
  )
    throw new Error('RUN tests require isolated TEST.');
  pool = new pg.Pool({ connectionString: state.migrationUrl, max: 5 });
  const demo = await import('../../fixtures/demo/academic.mjs');
  secondStudent = demo.additionalStudents[0];
  for (const user of [admin, teacher, student, outsider, secondStudent]) {
    const auth = createClient(state.authUrl, state.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const login = await auth.auth.signInWithPassword({
      email: user.email,
      password: state.fixturePassword,
    });
    if (login.error || !login.data.session)
      throw new Error('No se obtuvo sesión ficticia de RUN.');
    sessions.set(user.id, login.data.session.access_token);
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO app.organizations(id,code,name) VALUES($1,$2,$3)',
      [ids.org, `RUN-${ids.org.slice(0, 8).toUpperCase()}`, 'Práctica aislada'],
    );
    for (const user of [admin, teacher, student, secondStudent])
      await client.query(
        "INSERT INTO app.organization_memberships(organization_id,user_id,role,state,joined_at) VALUES($1,$2,$3,'ACTIVE',now())",
        [ids.org, user.id, user.role],
      );
    await client.query(
      "INSERT INTO app.courses(id,organization_id,code,name,academic_period) VALUES($1,$2,'RUN','Programación','2026-2')",
      [ids.course, ids.org],
    );
    await client.query(
      "INSERT INTO app.classes(id,organization_id,course_id,teacher_id,code,name) VALUES($1,$2,$3,$4,'RUN','Clase RUN')",
      [ids.class, ids.org, ids.course, teacher.id],
    );
    for (const user of [student, secondStudent])
      await client.query(
        'INSERT INTO app.class_memberships(organization_id,class_id,user_id) VALUES($1,$2,$3)',
        [ids.org, ids.class, user.id],
      );
    await client.query(
      "INSERT INTO app.concept_tags(id,organization_id,normalized_name) VALUES($1,$2,'sumar')",
      [ids.concept, ids.org],
    );
    await client.query(
      "INSERT INTO app.concept_versions(id,organization_id,concept_id,version,name,description,created_by) VALUES($1,$2,$3,1,'Sumar','Sumar', $4)",
      [ids.conceptVersion, ids.org, ids.concept, admin.id],
    );
    await client.query(
      'UPDATE app.concept_tags SET current_version_id=$2 WHERE id=$1',
      [ids.concept, ids.conceptVersion],
    );
    await client.query(
      'INSERT INTO app.exercises(id,organization_id,owner_id) VALUES($1,$2,$3)',
      [ids.exercise, ids.org, teacher.id],
    );
    await client.query(
      "INSERT INTO app.exercise_versions(id,organization_id,exercise_id,version,title,statement,starter_code,difficulty,created_by) VALUES($1,$2,$3,1,'Sumar','Suma dos valores',$4,'BEGINNER',$5)",
      [ids.version, ids.org, ids.exercise, source, teacher.id],
    );
    await client.query(
      'INSERT INTO app.exercise_version_concepts VALUES($1,$2,$3)',
      [ids.org, ids.version, ids.conceptVersion],
    );
    await client.query(
      "INSERT INTO app_private.exercise_tests(organization_id,exercise_version_id,test_id,position,visibility,args,expected) VALUES($1,$2,'visible',0,'visible','[2,3]','5'),($1,$2,'IMP03_HIDDEN_SENTINEL',1,'hidden','[7,8]','15')",
      [ids.org, ids.version],
    );
    await client.query(
      'UPDATE app.exercises SET current_version_id=$2 WHERE id=$1',
      [ids.exercise, ids.version],
    );
    await client.query(
      "INSERT INTO app.activities(id,organization_id,class_id,created_by,title,type) VALUES($1,$2,$3,$4,'Actividad RUN','FORMATIVE')",
      [ids.activity, ids.org, ids.class, teacher.id],
    );
    await client.query(
      'INSERT INTO app.activity_exercises(id,organization_id,activity_id,exercise_version_id,position) VALUES($1,$2,$3,$4,0)',
      [ids.assignment, ids.org, ids.activity, ids.version],
    );
    await client.query(
      "UPDATE app.activities SET state='PUBLISHED' WHERE id=$1",
      [ids.activity],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}, 120000);
afterAll(async () => {
  await pool?.end();
});

test('RF009 rechaza actor/versión/ámbito/campos y código excesivo sin admitir', async () => {
  for (const actor of [admin, teacher, outsider])
    expect([403, 404]).toContain((await api(path(), { actor })).status);
  expect(
    (
      await api(path(), {
        body: { code: source, exerciseVersionId: randomUUID() },
      })
    ).payload.error.code,
  ).toBe('VERSION_CONFLICT');
  expect(
    (
      await api(path(), {
        body: { code: source, exerciseVersionId: ids.version, tests: [] },
      })
    ).status,
  ).toBe(422);
  expect(
    (
      await api(path(), {
        body: {
          code: source,
          exerciseVersionId: ids.version,
          limits: { runtimeMs: 9000 },
        },
      })
    ).status,
  ).toBe(422);
  expect(
    (await api(path(), { code: 'x'.repeat(65537) })).payload.error.code,
  ).toBe('CODE_TOO_LARGE');
  expect((await api(path(), { code: 'é'.repeat(32769) })).status).toBe(413);
  expect((await api(path(), { code: '\0' })).status).toBe(422);
  const count = await pool.query(
    'SELECT count(*)::int total FROM app.executions WHERE organization_id=$1',
    [ids.org],
  );
  expect(count.rows[0].total).toBe(0);
});
test('RF009 admite fuente UTF8 de 64 KiB con escapes JSON y solo pruebas visibles', async () => {
  const code = source + '\t'.repeat(65536 - Buffer.byteLength(source));
  const result = await api(path(), { code });
  expect(result.status).toBe(201);
  expect(result.payload.data.technicalResult).toMatchObject({
    diagnosisCode: 'SUCCESS',
    visiblePassed: 1,
    visibleTotal: 1,
  });
  expect(Object.keys(result.payload.data.technicalResult)).not.toContain(
    'hiddenChecksPassed',
  );
  expect(Object.keys(result.payload.data.technicalResult)).not.toContain(
    'allRequiredPassed',
  );
  const row = (
    await pool.query('SELECT * FROM app.executions WHERE id=$1', [
      result.payload.data.executionId,
    ])
  ).rows[0];
  expect(row.purpose).toBe('RUN');
  expect(row.code_hash).toBe(hash(code));
  expect(Object.keys(row)).not.toContain('code');
});
test.each([
  ['SYNTAX_ERROR', 'module.exports.solve=;'],
  ['RUNTIME_ERROR', 'module.exports.solve=()=>{throw new Error("student");};'],
  ['FAILED_TEST', 'module.exports.solve=()=>42;'],
  ['TIMEOUT', 'module.exports.solve=()=>{while(true){}};'],
  ['UNKNOWN', 'module.exports.solve=()=>"x".repeat(65536);'],
])(
  'RF009 conserva diagnóstico %s desde Docker real',
  async (diagnosis, code) => {
    const result = await api(path(), { actor: secondStudent, code });
    expect(result.status).toBe(201);
    expect(result.payload.data.technicalResult.diagnosisCode).toBe(diagnosis);
  },
  45000,
);
test('RF009 sanea consola NUL para JSONB sin expandir bytes ni ocultar éxito', async () => {
  const result = await api(path(), {
    actor: secondStudent,
    code: 'module.exports.solve=(a,b)=>{console.log("\\0".repeat(100));return a+b;};',
  });
  expect(result.status).toBe(201);
  expect(result.payload.data.technicalResult.diagnosisCode).toBe('SUCCESS');
  expect(
    result.payload.data.technicalResult.visibleTestResults[0].stdout,
  ).toContain('?'.repeat(100));
});
test('Idempotencia concurrente reserva una vez, responde Retry-After y permite repetición deliberada', async () => {
  const key = randomUUID(),
    code = 'module.exports.solve=()=>{while(true){}};';
  const first = api(path(), { key, code });
  await eventually(
    async () =>
      (
        await pool.query(
          'SELECT count(*)::int total FROM app.operation_keys WHERE organization_id=$1 AND key=$2',
          [ids.org, key],
        )
      ).rows[0].total === 1,
  );
  const duplicate = await api(path(), { key, code });
  expect(duplicate.status).toBe(409);
  expect(duplicate.payload.error.code).toBe('REQUEST_IN_PROGRESS');
  expect(duplicate.retryAfter).toBe('1');
  const done = await first;
  expect(done.status).toBe(201);
  const replay = await api(path(), { key, code });
  expect(replay.status).toBe(201);
  expect(replay.payload.data).toEqual(done.payload.data);
  expect((await api(path(), { key, code: source })).payload.error.code).toBe(
    'IDEMPOTENCY_CONFLICT',
  );
  const intentional = await api(path(), { code: source });
  expect(intentional.status).toBe(201);
  expect(intentional.payload.data.executionId).not.toBe(
    done.payload.data.executionId,
  );
  const rows = await pool.query(
    'SELECT count(*)::int total FROM app.executions e JOIN app.operation_keys k ON k.id=e.operation_id WHERE k.organization_id=$1 AND k.key=$2',
    [ids.org, key],
  );
  expect(rows.rows[0].total).toBe(1);
}, 45000);
test('Una reserva expirada se reconcilia UNKNOWN sin reejecutar y cerca el token anterior', async () => {
  const executionId = randomUUID(),
    operationId = randomUUID(),
    token = randomUUID(),
    key = randomUUID();
  const code = 'module.exports.solve=()=>{throw new Error("must not run");};';
  const payloadHash = hash(
    JSON.stringify({
      activityId: ids.activity,
      assignmentId: ids.assignment,
      exerciseVersionId: ids.version,
      code,
    }),
  );
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "INSERT INTO app.operation_keys(id,organization_id,actor_id,operation,key,payload_hash,state,resource_type,resource_id,lease_until) VALUES($1,$2,$3,'practice.run',$4,$5,'RUNNING','execution',$6,clock_timestamp()-interval '1 second')",
      [operationId, ids.org, student.id, key, payloadHash, executionId],
    );
    await client.query(
      "INSERT INTO app.executions(id,organization_id,class_id,activity_id,activity_exercise_id,exercise_version_id,student_id,operation_id,code_hash,test_suite_hash,limits_snapshot,runner_version,visible_total,admitted_at,started_at,lease_until,lease_token,response_expires_at,request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'{\"memoryBytes\":134217728,\"runtimeMs\":3000,\"outputBytes\":65536}','recovery-fixture',1,clock_timestamp(),clock_timestamp(),clock_timestamp()-interval '1 second',$11,clock_timestamp()+interval '24 hours',$12)",
      [
        executionId,
        ids.org,
        ids.class,
        ids.activity,
        ids.assignment,
        ids.version,
        student.id,
        operationId,
        hash(code),
        'a'.repeat(64),
        token,
        randomUUID(),
      ],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  await eventually(
    async () =>
      (
        await pool.query(
          'SELECT lifecycle_status FROM app.executions WHERE id=$1',
          [executionId],
        )
      ).rows[0].lifecycle_status === 'COMPLETED',
    25000,
  );
  const replay = await api(path(), { key, code });
  expect(replay.status).toBe(201);
  expect(replay.payload.data.technicalResult).toMatchObject({
    diagnosisCode: 'UNKNOWN',
    infrastructureStatus: 'FAILED',
    visibleTestResults: [],
  });
  expect(replay.payload.data.executionId).toBe(executionId);
  await expect(
    asApplication(null, (client) =>
      client.query('SELECT app_private.finish_practice_run($1,$2,$3,true)', [
        executionId,
        token,
        JSON.stringify(replay.payload.data.technicalResult),
      ]),
    ),
  ).rejects.toMatchObject({ message: 'REQUEST_IN_PROGRESS' });
  await pool.query(
    "UPDATE app.operation_keys SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
    [operationId],
  );
  expect((await api(path(), { key, code })).payload.error.code).toBe(
    'IDEMPOTENCY_EXPIRED',
  );
}, 40000);

test('RLS real separa resultados entre alumnos de la misma clase y oculta token de lease', async () => {
  const own = await asApplication(student, (client) =>
    client.query('SELECT id FROM app.executions WHERE student_id=$1', [
      student.id,
    ]),
  );
  expect(own.rowCount).toBeGreaterThan(0);
  for (const user of [secondStudent, teacher, admin, outsider]) {
    const foreign = await asApplication(user, (client) =>
      client.query('SELECT id FROM app.executions WHERE student_id=$1', [
        student.id,
      ]),
    );
    expect(foreign.rowCount).toBe(0);
  }
  await expect(
    asApplication(student, (client) =>
      client.query('SELECT lease_token FROM app.executions'),
    ),
  ).rejects.toMatchObject({ code: '42501' });
});
test('Fallo real de commit no confirma y permite reconciliar la misma clave sin ejecutar otra vez', async () => {
  const key = randomUUID(),
    code = 'module.exports.solve=()=>{while(true){}};';
  const running = api(path(), { key, code });
  let executionId;
  await eventually(async () => {
    executionId = (
      await pool.query(
        'SELECT resource_id FROM app.operation_keys WHERE organization_id=$1 AND key=$2',
        [ids.org, key],
      )
    ).rows[0]?.resource_id;
    return Boolean(executionId);
  });
  try {
    await pool.query(
      `CREATE FUNCTION app_private.practice_commit_fault() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN IF new.id='${executionId}'::uuid AND new.lifecycle_status='COMPLETED' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='PRACTICE_COMMIT_FAULT'; END IF; RETURN new; END $$`,
    );
    await pool.query(
      'CREATE TRIGGER practice_commit_fault BEFORE UPDATE ON app.executions FOR EACH ROW EXECUTE FUNCTION app_private.practice_commit_fault()',
    );
    const failed = await running;
    expect(failed.status).toBe(503);
    expect(failed.payload.error.code).toBe('PERSISTENCE_UNAVAILABLE');
    expect(
      (
        await pool.query(
          'SELECT lifecycle_status FROM app.executions WHERE id=$1',
          [executionId],
        )
      ).rows[0].lifecycle_status,
    ).toBe('RUNNING');
  } finally {
    await pool.query(
      'DROP TRIGGER IF EXISTS practice_commit_fault ON app.executions',
    );
    await pool.query(
      'DROP FUNCTION IF EXISTS app_private.practice_commit_fault()',
    );
  }
  await pool.query(
    "UPDATE app.executions SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
    [executionId],
  );
  await eventually(
    async () =>
      (
        await pool.query(
          'SELECT lifecycle_status FROM app.executions WHERE id=$1',
          [executionId],
        )
      ).rows[0].lifecycle_status === 'COMPLETED',
    25000,
  );
  const recovered = await api(path(), { key, code });
  expect(recovered.status).toBe(201);
  expect(recovered.payload.data.executionId).toBe(executionId);
  expect(recovered.payload.data.technicalResult.diagnosisCode).toBe('UNKNOWN');
}, 45000);

test('El reconciliador elimina una cápsula vencida que aparece después de completar su RUN', async () => {
  const key = randomUUID();
  const completed = await api(path(), { key });
  expect(completed.status).toBe(201);
  const executionId = completed.payload.data.executionId;
  const capsule = await import('../../infra/runner/capsule.mjs');
  const { localDockerEngine, capsuleConfiguration } =
    await import('../../infra/runner/docker-engine.mjs');
  const engine = await localDockerEngine(capsule.command);
  const name = `${capsule.RUNNER_PREFIX}${randomUUID()}`;
  try {
    const created = await engine.request(
      'POST',
      `/containers/create?name=${encodeURIComponent(name)}`,
      {
        body: capsuleConfiguration(await capsule.imageIdentity(), {
          'org.alunza.runner': 'alunza-edu-laboratorio',
          'org.alunza.execution': executionId,
          'org.alunza.expires': String(Date.now() - 1000),
        }),
      },
    );
    expect(created.status).toBe(201);
    await eventually(
      async () =>
        (await engine.request('GET', `/containers/${name}/json`)).status ===
        404,
      25000,
    );
    const stored = await pool.query(
      'SELECT lifecycle_status FROM app.executions WHERE id=$1',
      [executionId],
    );
    expect(stored.rows[0].lifecycle_status).toBe('COMPLETED');
    expect((await api(path(), { key })).payload.data).toEqual(
      completed.payload.data,
    );
  } finally {
    expect(
      (await capsule.cleanupDockerExecution(executionId)).cleanupVerified,
    ).toBe(true);
  }
}, 45000);

test('Revocar membresía durante RUN conserva evidencia pero deniega entregar respuesta', async () => {
  const key = randomUUID(),
    code = 'module.exports.solve=()=>{while(true){}};';
  const running = api(path(), { key, code });
  let executionId;
  await eventually(async () => {
    executionId = (
      await pool.query(
        'SELECT resource_id FROM app.operation_keys WHERE organization_id=$1 AND key=$2',
        [ids.org, key],
      )
    ).rows[0]?.resource_id;
    return Boolean(executionId);
  });
  try {
    await pool.query(
      "UPDATE app.organization_memberships SET state='DISABLED' WHERE organization_id=$1 AND user_id=$2",
      [ids.org, student.id],
    );
    expect([403, 404]).toContain((await running).status);
    expect(
      (
        await pool.query(
          'SELECT lifecycle_status FROM app.executions WHERE id=$1',
          [executionId],
        )
      ).rows[0].lifecycle_status,
    ).toBe('COMPLETED');
    expect([403, 404]).toContain((await api(path(), { key, code })).status);
  } finally {
    await pool.query(
      "UPDATE app.organization_memberships SET state='ACTIVE' WHERE organization_id=$1 AND user_id=$2",
      [ids.org, student.id],
    );
  }
  expect((await api(path(), { key, code })).payload.data.executionId).toBe(
    executionId,
  );
}, 45000);

test('Cierre serializado permite terminar RUN admitido y rechaza nuevas admisiones', async () => {
  const key = randomUUID(),
    code = 'module.exports.solve=()=>{while(true){}};';
  const running = api(path(), { key, code });
  await eventually(
    async () =>
      (
        await pool.query(
          'SELECT count(*)::int total FROM app.operation_keys WHERE organization_id=$1 AND key=$2',
          [ids.org, key],
        )
      ).rows[0].total === 1,
  );
  const activity = await api(`/activities/${ids.activity}`, {
    actor: teacher,
    method: 'GET',
  });
  expect(activity.status).toBe(200);
  const closed = await api(`/activities/${ids.activity}/close`, {
    actor: teacher,
    body: {},
    revision: activity.payload.data.revision,
  });
  expect(closed.status).toBe(200);
  const finished = await running;
  expect(finished.status).toBe(201);
  expect((await api(path(), { key, code })).payload.data.executionId).toBe(
    finished.payload.data.executionId,
  );
  expect((await api(path())).payload.error.code).toBe('ACTIVITY_CLOSED');
  const stored = (
    await pool.query(
      'SELECT admitted_at,finished_at FROM app.executions WHERE id=$1',
      [finished.payload.data.executionId],
    )
  ).rows[0];
  expect(stored.admitted_at.getTime()).toBeLessThanOrEqual(
    Date.parse(closed.payload.data.closedAt),
  );
  expect(stored.finished_at.getTime()).toBeGreaterThanOrEqual(
    Date.parse(closed.payload.data.closedAt),
  );
}, 45000);
