/* eslint @typescript-eslint/no-require-imports: "off" */
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { URLSearchParams } = require('node:url');
const pg = require('pg');
const { createClient } = require('@supabase/supabase-js');
const contracts = require('@alunza/contracts');
const { assertLaboratoryTestState } = require('../laboratory-test-state.cjs');
const fixture = require('../../fixtures/foundation/identity.json');
const [admin, teacher, student] = fixture.users;
const outsider = fixture.users[5];
const sessions = new Map();
const source = 'module.exports.solve=(a,b)=>a+b;';
let pool, base, ids;

async function api(
  path,
  { actor = student, method = 'GET', body, key = randomUUID() } = {},
) {
  const response = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${sessions.get(actor.id)}`,
      ...(method === 'POST'
        ? { 'Content-Type': 'application/json', 'Idempotency-Key': key }
        : {}),
    },
    ...(method === 'POST' ? { body: JSON.stringify(body ?? {}) } : {}),
    signal: AbortSignal.timeout(45000),
  });
  const payload = await response.json();
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(JSON.stringify(payload)).not.toContain('IMP05_PRIVATE_TEST');
  return { status: response.status, payload };
}
async function progress(filters = {}, actor = student) {
  return api(
    `/me/progress?${new URLSearchParams({ classId: ids.class, ...filters })}`,
    { actor },
  );
}
async function submit(index, code = source, key = randomUUID()) {
  const response = await api(
    `/activities/${ids.activities[index]}/exercises/${ids.assignments[index]}/attempts`,
    { method: 'POST', body: { code, exerciseVersionId: ids.version }, key },
  );
  expect(response.status).toBe(201);
  return contracts.attemptResponseSchema.parse(response.payload).data;
}

beforeAll(async () => {
  const state = JSON.parse(readFileSync(process.env.ALUNZA_TEST_STATE, 'utf8'));
  assertLaboratoryTestState(state);
  base = process.env.ALUNZA_TEST_API_URL;
  if (base !== 'http://127.0.0.1:4300')
    throw new Error('Progress requires isolated TEST.');
  pool = new pg.Pool({ connectionString: state.migrationUrl, max: 3 });
  for (const user of [admin, teacher, student, outsider]) {
    const auth = createClient(state.authUrl, state.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const login = await auth.auth.signInWithPassword({
      email: user.email,
      password: state.fixturePassword,
    });
    if (login.error || !login.data.session)
      throw new Error('No se obtuvo sesión ficticia de progreso.');
    sessions.set(user.id, login.data.session.access_token);
  }
}, 120000);
beforeEach(async () => {
  ids = Object.fromEntries(
    [
      'org',
      'course',
      'class',
      'otherClass',
      'concept',
      'conceptVersion',
      'otherConcept',
      'otherConceptVersion',
      'exercise',
      'version',
    ].map((key) => [key, randomUUID()]),
  );
  ids.activities = [randomUUID(), randomUUID(), randomUUID()];
  ids.assignments = [randomUUID(), randomUUID(), randomUUID()];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO app.organizations(id,code,name) VALUES($1,$2,$3)',
      [
        ids.org,
        `PROGRESS-${ids.org.slice(0, 8).toUpperCase()}`,
        'Progreso aislado',
      ],
    );
    for (const user of [admin, teacher, student])
      await client.query(
        "INSERT INTO app.organization_memberships(organization_id,user_id,role,state,joined_at) VALUES($1,$2,$3,'ACTIVE',now())",
        [ids.org, user.id, user.role],
      );
    await client.query(
      "INSERT INTO app.courses(id,organization_id,code,name,academic_period) VALUES($1,$2,'PROGRESS','Programación','2026-2')",
      [ids.course, ids.org],
    );
    for (const [index, classroom] of [ids.class, ids.otherClass].entries())
      await client.query(
        'INSERT INTO app.classes(id,organization_id,course_id,teacher_id,code,name) VALUES($1,$2,$3,$4,$5,$6)',
        [
          classroom,
          ids.org,
          ids.course,
          teacher.id,
          `PROGRESS-${index}`,
          `Clase ${index}`,
        ],
      );
    await client.query(
      'INSERT INTO app.class_memberships(organization_id,class_id,user_id) VALUES($1,$2,$3)',
      [ids.org, ids.class, student.id],
    );
    for (const [concept, version, name] of [
      [ids.concept, ids.conceptVersion, 'Sumar'],
      [ids.otherConcept, ids.otherConceptVersion, 'Funciones'],
    ]) {
      await client.query(
        'INSERT INTO app.concept_tags(id,organization_id,normalized_name) VALUES($1,$2,$3)',
        [concept, ids.org, name.toLowerCase()],
      );
      await client.query(
        'INSERT INTO app.concept_versions(id,organization_id,concept_id,version,name,description,created_by) VALUES($1,$2,$3,1,$4,$4,$5)',
        [version, ids.org, concept, name, admin.id],
      );
      await client.query(
        'UPDATE app.concept_tags SET current_version_id=$2 WHERE id=$1',
        [concept, version],
      );
    }
    await client.query(
      'INSERT INTO app.exercises(id,organization_id,owner_id) VALUES($1,$2,$3)',
      [ids.exercise, ids.org, teacher.id],
    );
    await client.query(
      "INSERT INTO app.exercise_versions(id,organization_id,exercise_id,version,title,statement,starter_code,difficulty,created_by) VALUES($1,$2,$3,1,'Sumar','Suma dos valores',$4,'BEGINNER',$5)",
      [ids.version, ids.org, ids.exercise, source, teacher.id],
    );
    for (const version of [ids.conceptVersion, ids.otherConceptVersion])
      await client.query(
        'INSERT INTO app.exercise_version_concepts VALUES($1,$2,$3)',
        [ids.org, ids.version, version],
      );
    await client.query(
      "INSERT INTO app_private.exercise_tests(organization_id,exercise_version_id,test_id,position,visibility,args,expected) VALUES($1,$2,'visible',0,'visible','[2,3]','5'),($1,$2,'IMP05_PRIVATE_TEST',1,'hidden','[7,8]','15')",
      [ids.org, ids.version],
    );
    await client.query(
      'UPDATE app.exercises SET current_version_id=$2 WHERE id=$1',
      [ids.exercise, ids.version],
    );
    for (const [index, activity] of ids.activities.entries()) {
      await client.query(
        "INSERT INTO app.activities(id,organization_id,class_id,created_by,title,type) VALUES($1,$2,$3,$4,$5,'FORMATIVE')",
        [activity, ids.org, ids.class, teacher.id, `Actividad ${index}`],
      );
      await client.query(
        'INSERT INTO app.activity_exercises(id,organization_id,activity_id,exercise_version_id,position) VALUES($1,$2,$3,$4,0)',
        [ids.assignments[index], ids.org, activity, ids.version],
      );
      await client.query(
        "UPDATE app.activities SET state='PUBLISHED' WHERE id=$1",
        [activity],
      );
    }
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

test('RF015-E1: 2/3 por asignaciones y conceptos, replay no duplica y fallo conserva logro', async () => {
  const key = randomUUID();
  const first = await submit(0, source, key);
  expect((await submit(0, source, key)).attemptId).toBe(first.attemptId);
  const second = await submit(1);
  await submit(0, 'module.exports.solve=()=>0;');
  const response = await progress();
  expect(response.status).toBe(200);
  const value = contracts.studentProgressResponseSchema.parse(
    response.payload,
  ).data;
  expect(value.summary).toEqual({
    completed: 2,
    required: 3,
    ratio: 2 / 3,
    evidenceState: 'HAS_EVIDENCE',
    basisAttemptIds: expect.arrayContaining([
      first.attemptId,
      second.attemptId,
    ]),
  });
  expect(value.evidence).toHaveLength(2);
  expect(value.byConcept).toHaveLength(2);
  for (const row of value.byConcept)
    expect([row.completed, row.required]).toEqual([2, 3]);
  const filtered = contracts.studentProgressResponseSchema.parse(
    (await progress({ activityId: ids.activities[0], conceptId: ids.concept }))
      .payload,
  ).data;
  expect([filtered.summary.completed, filtered.summary.required]).toEqual([
    1, 1,
  ]);
  const legacy = await api(`/activities/${ids.activities[0]}/progress`);
  expect(legacy.payload.data.completed).toBe(filtered.summary.completed);
}, 120000);
test('corte exacto y offset equivalente conservan solo confirmaciones anteriores', async () => {
  const first = await submit(0);
  await submit(1);
  const value = contracts.studentProgressResponseSchema.parse(
    (await progress({ asOf: first.submittedAt })).payload,
  ).data;
  expect([value.summary.completed, value.summary.required]).toEqual([1, 3]);
  expect(value.summary.basisAttemptIds).toEqual([first.attemptId]);
  const date = new Date(first.submittedAt);
  const fraction = first.submittedAt.match(/\.(\d+)/)?.[1];
  const offset = new Date(date.getTime() - 3 * 3600000)
    .toISOString()
    .replace(/\.\d{3}Z$/, `${fraction ? `.${fraction}` : ''}-03:00`);
  const equivalent = contracts.studentProgressResponseSchema.parse(
    (await progress({ asOf: offset })).payload,
  ).data;
  expect(equivalent.summary).toEqual(value.summary);
}, 120000);
test('RF015-E2: filtro inválido, fecha futura e identidad cliente se rechazan', async () => {
  expect((await progress({ asOf: '2099-01-01T00:00:00Z' })).status).toBe(400);
  for (const filters of [
    { asOf: '2026-10-02T12:00:00' },
    { conceptId: 'all' },
    { studentId: teacher.id },
  ])
    expect((await progress(filters)).status).toBe(422);
  expect(
    (
      await api(`/activities/${ids.activities[0]}/open-events`, {
        method: 'POST',
        body: { occurredAt: '2026-01-01T00:00:00Z' },
      })
    ).status,
  ).toBe(422);
});
test('RF015-E3: roles, otras clases y organizaciones no obtienen agregados propios del alumno', async () => {
  for (const actor of [admin, teacher, outsider])
    expect([403, 404]).toContain((await progress({}, actor)).status);
  expect((await api(`/me/progress?classId=${ids.otherClass}`)).status).toBe(
    404,
  );
  expect((await progress({ activityId: randomUUID() })).status).toBe(404);
  expect((await progress({ conceptId: randomUUID() })).status).toBe(404);
  expect((await progress()).status).toBe(200);
});
test('RF015-E4: corte anterior a publicación devuelve 0/0; actual distingue ausencia de intentos', async () => {
  const empty = contracts.studentProgressResponseSchema.parse(
    (await progress({ asOf: '2020-01-01T00:00:00Z' })).payload,
  ).data;
  expect(empty.summary).toMatchObject({
    completed: 0,
    required: 0,
    ratio: null,
    evidenceState: 'NO_REQUIRED_EXERCISES',
  });
  const current = contracts.studentProgressResponseSchema.parse(
    (await progress()).payload,
  ).data;
  expect(current.summary).toMatchObject({
    completed: 0,
    required: 3,
    ratio: 0,
    evidenceState: 'NO_ATTEMPTS',
  });
});
test('apertura explícita concurrente es idempotente y nueva apertura conserva otro hecho', async () => {
  const path = `/activities/${ids.activities[0]}/open-events`;
  const key = randomUUID();
  const responses = await Promise.all([
    api(path, { method: 'POST', key }),
    api(path, { method: 'POST', key }),
  ]);
  expect(responses.map((item) => item.status)).toEqual([201, 201]);
  const first = contracts.activityOpenResponseSchema.parse(
    responses[0].payload,
  ).data;
  expect(
    contracts.activityOpenResponseSchema.parse(responses[1].payload).data,
  ).toEqual(first);
  expect((await api(path, { method: 'POST' })).payload.data.eventId).not.toBe(
    first.eventId,
  );
  expect((await progress()).payload.data.summary.evidenceState).toBe(
    'NO_ATTEMPTS',
  );
  await pool.query(
    "UPDATE app.organization_memberships SET state='DISABLED' WHERE organization_id=$1 AND user_id=$2",
    [ids.org, student.id],
  );
  expect([403, 404]).toContain(
    (await api(path, { method: 'POST', key })).status,
  );
  expect([403, 404]).toContain((await progress()).status);
});
