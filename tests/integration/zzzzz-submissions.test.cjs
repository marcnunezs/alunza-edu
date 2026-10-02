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
let ids = Object.fromEntries(
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
  `/activities/${ids.activity}/exercises/${ids.assignment}/attempts`;
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
  if (response.ok && method === 'POST' && route.endsWith('/attempts'))
    expect(contracts.attemptResponseSchema.safeParse(payload).success).toBe(
      true,
    );
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
  throw new Error(
    'La condición SUBMIT no se cumplió dentro del plazo de prueba.',
  );
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
    throw new Error('SUBMIT tests require isolated TEST.');
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
      throw new Error('No se obtuvo sesión ficticia de SUBMIT.');
    sessions.set(user.id, login.data.session.access_token);
  }
}, 120000);
beforeEach(async () => {
  ids = Object.fromEntries(
    Object.keys(ids).map((name) => [name, randomUUID()]),
  );
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO app.organizations(id,code,name) VALUES($1,$2,$3)',
      [
        ids.org,
        `SUBMIT-${ids.org.slice(0, 8).toUpperCase()}`,
        'Práctica aislada',
      ],
    );
    for (const user of [admin, teacher, student, secondStudent])
      await client.query(
        "INSERT INTO app.organization_memberships(organization_id,user_id,role,state,joined_at) VALUES($1,$2,$3,'ACTIVE',now())",
        [ids.org, user.id, user.role],
      );
    await client.query(
      "INSERT INTO app.courses(id,organization_id,code,name,academic_period) VALUES($1,$2,'SUBMIT','Programación','2026-2')",
      [ids.course, ids.org],
    );
    await client.query(
      "INSERT INTO app.classes(id,organization_id,course_id,teacher_id,code,name) VALUES($1,$2,$3,$4,'SUBMIT','Clase SUBMIT')",
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
      "INSERT INTO app.activities(id,organization_id,class_id,created_by,title,type) VALUES($1,$2,$3,$4,'Actividad SUBMIT','FORMATIVE')",
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

const progress = async () => {
  const response = await api(`/activities/${ids.activity}/progress`, {
    method: 'GET',
  });
  expect(response.status).toBe(200);
  return contracts.activityProgressResponseSchema.parse(response.payload).data;
};
const reservationFor = async (key) => {
  let id;
  await eventually(async () => {
    id = (
      await pool.query(
        'SELECT resource_id FROM app.operation_keys WHERE organization_id=$1 AND key=$2',
        [ids.org, key],
      )
    ).rows[0]?.resource_id;
    return Boolean(id);
  });
  return id;
};

test('SUBMIT rechaza identidad, versiones y autoridad aportada antes de reservar', async () => {
  for (const actor of [teacher, admin, outsider])
    expect([403, 404]).toContain((await api(path(), { actor })).status);
  expect(
    (
      await api(path(), {
        body: { code: source, exerciseVersionId: randomUUID() },
      })
    ).payload.error.code,
  ).toBe('VERSION_CONFLICT');
  for (const extra of [
    { tests: [] },
    { studentId: secondStudent.id },
    { executionId: randomUUID() },
    { allRequiredPassed: true },
  ])
    expect(
      (
        await api(path(), {
          body: { code: source, exerciseVersionId: ids.version, ...extra },
        })
      ).status,
    ).toBe(422);
  expect((await api(path(), { code: 'é'.repeat(32769) })).status).toBe(413);
  expect((await api(path(), { code: '\0' })).status).toBe(422);
  expect(
    (
      await pool.query(
        'SELECT count(*)::int n FROM app.attempts WHERE organization_id=$1',
        [ids.org],
      )
    ).rows[0].n,
  ).toBe(0);
});

test('RF007/010/011/014 guarda ocultas, historia y reintento; avance conserva éxito previo', async () => {
  expect(await progress()).toMatchObject({
    completed: 0,
    required: 1,
    ratio: 0,
    evidenceState: 'NO_ATTEMPTS',
  });
  const run = await api(path().replace('/attempts', '/executions'));
  expect(run.status).toBe(201);
  expect(await progress()).toMatchObject({
    completed: 0,
    evidenceState: 'NO_ATTEMPTS',
  });
  const failed = await api(path(), { code: 'module.exports.solve=()=>5;' });
  expect(failed.status).toBe(201);
  expect(failed.payload.data.technicalResult).toMatchObject({
    diagnosisCode: 'FAILED_TEST',
    visiblePassed: 1,
    visibleTotal: 1,
    hiddenChecksPassed: false,
    allRequiredPassed: false,
  });
  expect(await progress()).toMatchObject({
    completed: 0,
    evidenceState: 'HAS_EVIDENCE',
  });
  const first = failed.payload.data;
  const success = await api(path(), {
    body: {
      code: source,
      exerciseVersionId: ids.version,
      previousAttemptId: first.attemptId,
    },
  });
  expect(success.status).toBe(201);
  expect(success.payload.data.technicalResult.allRequiredPassed).toBe(true);
  expect(success.payload.data.previousAttemptId).toBe(first.attemptId);
  expect(success.payload.data.testsVersion).toMatch(/^[a-f0-9]{64}$/);
  const later = await api(path(), { code: 'module.exports.solve=()=>0;' });
  expect(later.status).toBe(201);
  expect(await progress()).toMatchObject({
    completed: 1,
    required: 1,
    ratio: 1,
    evidenceState: 'HAS_EVIDENCE',
  });
  const detail = await api(`/attempts/${first.attemptId}`, { method: 'GET' });
  expect(detail.status).toBe(200);
  expect(detail.payload.data).toEqual(first);
  const page = await api(`${path()}?limit=2`, { method: 'GET' });
  expect(page.status).toBe(200);
  expect(
    contracts.attemptListResponseSchema.safeParse(page.payload).success,
  ).toBe(true);
  expect(page.payload.data.map((x) => x.attemptId)).toEqual([
    later.payload.data.attemptId,
    success.payload.data.attemptId,
  ]);
  expect(page.payload.data.every((x) => !('code' in x))).toBe(true);
  expect(page.payload.page.hasMore).toBe(true);
  const older = await api(
    `${path()}?limit=2&cursor=${page.payload.page.nextCursor}`,
    { method: 'GET' },
  );
  expect(older.payload.data.map((x) => x.attemptId)).toEqual([first.attemptId]);
  expect(older.payload.page.hasMore).toBe(false);
  expect(
    (
      await pool.query('SELECT code_hash FROM app.attempts WHERE id=$1', [
        success.payload.data.attemptId,
      ])
    ).rows[0].code_hash,
  ).toBe(hash(source));
}, 60000);

test.each([
  ['SYNTAX_ERROR', 'module.exports.solve=;'],
  ['RUNTIME_ERROR', 'module.exports.solve=()=>{throw new Error("failure");};'],
  ['TIMEOUT', 'module.exports.solve=()=>{while(true){}};'],
  ['UNKNOWN', 'module.exports.solve=()=>"x".repeat(65536);'],
])(
  'RF011 persiste %s desde ejecutor real sin completar',
  async (diagnosis, code) => {
    const response = await api(path(), { code });
    expect(response.status).toBe(201);
    expect(response.payload.data.technicalResult).toMatchObject({
      diagnosisCode: diagnosis,
      allRequiredPassed: false,
    });
    expect(
      (
        await api(`/attempts/${response.payload.data.attemptId}`, {
          method: 'GET',
        })
      ).payload.data,
    ).toEqual(response.payload.data);
    expect((await progress()).completed).toBe(0);
  },
  45000,
);

test('Ocultas no filtran argumentos por consola, excepciones o proyección pública', async () => {
  const response = await api(path(), {
    code: 'module.exports.solve=(a,b)=>{console.log(JSON.stringify([a,b]));if(a===7)throw new Error("hidden-value-"+a+"-"+b);return a+b;};',
  });
  expect(response.status).toBe(201);
  const serialized = JSON.stringify(response.payload.data.technicalResult);
  expect(serialized).toContain('[2,3]');
  expect(serialized).not.toContain('[7,8]');
  expect(serialized).not.toContain('hidden-value-7-8');
  expect(serialized).not.toContain('privateTestResults');
  expect(serialized).not.toContain('expected');
});

test('Idempotencia y dos envíos intencionales concurrentes conservan identidades separadas', async () => {
  const key = randomUUID(),
    code = 'module.exports.solve=()=>{while(true){}};';
  const first = api(path(), { key, code });
  await reservationFor(key);
  const duplicate = await api(path(), { key, code });
  expect(duplicate.status).toBe(409);
  expect(duplicate.payload.error.code).toBe('REQUEST_IN_PROGRESS');
  const secondKey = randomUUID();
  const second = api(path(), { key: secondKey, code });
  await reservationFor(secondKey);
  const over = await api(path());
  expect(over.status).toBe(429);
  const [one, two] = await Promise.all([first, second]);
  expect(one.status).toBe(201);
  expect(two.status).toBe(201);
  expect(one.payload.data.attemptId).not.toBe(two.payload.data.attemptId);
  expect(one.payload.data.attemptNumber).toBeLessThan(
    two.payload.data.attemptNumber,
  );
  expect((await api(path(), { key, code })).payload.data).toEqual(
    one.payload.data,
  );
  expect((await api(path(), { key, code: source })).payload.error.code).toBe(
    'IDEMPOTENCY_CONFLICT',
  );
  const intentional = await api(path(), { code });
  expect(intentional.status).toBe(201);
  expect(intentional.payload.data.attemptId).not.toBe(
    one.payload.data.attemptId,
  );
  expect(
    (
      await pool.query(
        'SELECT count(*)::int n FROM app.attempts WHERE organization_id=$1',
        [ids.org],
      )
    ).rows[0].n,
  ).toBe(3);
}, 60000);

test('RLS y API impiden leer, copiar y alterar intento ajeno incluso en misma clase', async () => {
  const saved = await api(path());
  expect(saved.status).toBe(201);
  const id = saved.payload.data.attemptId;
  for (const actor of [secondStudent, teacher, admin, outsider]) {
    const denied = await api(`/attempts/${id}`, { actor, method: 'GET' });
    expect([403, 404]).toContain(denied.status);
    const rows = await asApplication(actor, (client) =>
      client.query('SELECT id FROM app.attempts WHERE id=$1', [id]),
    );
    expect(rows.rowCount).toBe(0);
  }
  const own = await asApplication(student, (client) =>
    client.query('SELECT id FROM app.attempts WHERE id=$1', [id]),
  );
  expect(own.rowCount).toBe(1);
  await expect(
    asApplication(student, (client) =>
      client.query('UPDATE app.attempts SET code=$2 WHERE id=$1', [
        id,
        'changed',
      ]),
    ),
  ).rejects.toMatchObject({ code: '42501' });
  expect([403, 404]).toContain(
    (
      await api(path(), {
        actor: secondStudent,
        body: {
          code: source,
          exerciseVersionId: ids.version,
          previousAttemptId: id,
        },
      })
    ).status,
  );
  expect(
    (await api(path(), { method: 'GET', actor: secondStudent })).payload.data,
  ).toEqual([]);
});

test('Commit fallido conserva resultado durable y recuperación confirma una vez sin reejecutar', async () => {
  const key = randomUUID(),
    code = 'module.exports.solve=()=>{while(true){}};';
  const running = api(path(), { key, code });
  const executionId = await reservationFor(key);
  try {
    await pool.query(
      `CREATE FUNCTION app_private.submit_commit_fault() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN IF new.execution_id='${executionId}'::uuid THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='SUBMIT_COMMIT_FAULT'; END IF; RETURN new; END $$`,
    );
    await pool.query(
      'CREATE TRIGGER submit_commit_fault BEFORE INSERT ON app.attempts FOR EACH ROW EXECUTE FUNCTION app_private.submit_commit_fault()',
    );
    const failed = await running;
    expect(failed.status).toBe(503);
    expect(failed.payload.error.code).toBe('PERSISTENCE_UNAVAILABLE');
    expect(
      (
        await pool.query(
          'SELECT count(*)::int n FROM app.attempts WHERE organization_id=$1',
          [ids.org],
        )
      ).rows[0].n,
    ).toBe(0);
    expect((await progress()).evidenceState).toBe('NO_ATTEMPTS');
  } finally {
    await pool.query(
      'DROP TRIGGER IF EXISTS submit_commit_fault ON app.attempts',
    );
    await pool.query(
      'DROP FUNCTION IF EXISTS app_private.submit_commit_fault()',
    );
  }
  await pool.query(
    "UPDATE app_private.submission_reservations SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
    [executionId],
  );
  await eventually(
    async () =>
      (
        await pool.query(
          'SELECT count(*)::int n FROM app.attempts WHERE organization_id=$1',
          [ids.org],
        )
      ).rows[0].n === 1,
    25000,
  );
  const recovered = await api(path(), { key, code });
  expect(recovered.status).toBe(201);
  expect(recovered.payload.data.executionId).toBe(executionId);
  expect(recovered.payload.data.technicalResult.diagnosisCode).toBe('TIMEOUT');
}, 45000);

test('Revocación durante SUBMIT conserva intento pero deniega respuesta y lectura', async () => {
  const key = randomUUID(),
    code = 'module.exports.solve=()=>{while(true){}};';
  const running = api(path(), { key, code });
  await reservationFor(key);
  try {
    await pool.query(
      "UPDATE app.organization_memberships SET state='DISABLED' WHERE organization_id=$1 AND user_id=$2",
      [ids.org, student.id],
    );
    expect([403, 404]).toContain((await running).status);
    expect(
      (
        await pool.query(
          'SELECT count(*)::int n FROM app.attempts WHERE organization_id=$1',
          [ids.org],
        )
      ).rows[0].n,
    ).toBe(1);
    expect([403, 404]).toContain((await api(path(), { key, code })).status);
  } finally {
    await pool.query(
      "UPDATE app.organization_memberships SET state='ACTIVE' WHERE organization_id=$1 AND user_id=$2",
      [ids.org, student.id],
    );
  }
  expect((await api(path(), { key, code })).status).toBe(201);
}, 45000);

test('DEC002 guarda admitido antes del cierre; historia y replay siguen autorizados', async () => {
  const key = randomUUID(),
    code = 'module.exports.solve=()=>{while(true){}};';
  const running = api(path(), { key, code });
  await reservationFor(key);
  const current = await api(`/activities/${ids.activity}`, {
    actor: teacher,
    method: 'GET',
  });
  const closed = await api(`/activities/${ids.activity}/close`, {
    actor: teacher,
    body: {},
    revision: current.payload.data.revision,
  });
  expect(closed.status).toBe(200);
  const saved = await running;
  expect(saved.status).toBe(201);
  expect(Date.parse(saved.payload.data.admittedAt)).toBeLessThanOrEqual(
    Date.parse(closed.payload.data.closedAt),
  );
  expect(Date.parse(saved.payload.data.submittedAt)).toBeGreaterThanOrEqual(
    Date.parse(closed.payload.data.closedAt),
  );
  expect((await api(path(), { key, code })).payload.data).toEqual(
    saved.payload.data,
  );
  expect((await api(path())).payload.error.code).toBe('ACTIVITY_CLOSED');
  expect((await api(path(), { method: 'GET' })).payload.data).toHaveLength(1);
  expect(
    (await api(`/attempts/${saved.payload.data.attemptId}`, { method: 'GET' }))
      .status,
  ).toBe(200);
}, 45000);

test('Clave vencida conserva intento histórico y nunca ejecuta un duplicado', async () => {
  const key = randomUUID(),
    saved = await api(path(), { key });
  expect(saved.status).toBe(201);
  await pool.query(
    "UPDATE app.operation_keys SET expires_at=clock_timestamp()-interval '1 second' WHERE organization_id=$1 AND key=$2",
    [ids.org, key],
  );
  expect((await api(path(), { key })).payload.error.code).toBe(
    'IDEMPOTENCY_EXPIRED',
  );
  expect(
    (await api(`/attempts/${saved.payload.data.attemptId}`, { method: 'GET' }))
      .payload.data,
  ).toEqual(saved.payload.data);
  expect(
    (
      await pool.query(
        'SELECT count(*)::int n FROM app.attempts WHERE organization_id=$1',
        [ids.org],
      )
    ).rows[0].n,
  ).toBe(1);
});
