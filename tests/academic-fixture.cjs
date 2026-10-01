/* eslint @typescript-eslint/no-require-imports: "off" */
const { randomUUID } = require('node:crypto');
const { Client } = require('pg');
const { createClient } = require('@supabase/supabase-js');
const identity = require('../fixtures/foundation/identity.json');

const accounts = {
  admin: identity.users[0],
  teacher: identity.users[1],
  student: identity.users[2],
  foreignAdmin: identity.users[3],
  secondTeacher: identity.users[4],
  secondStudent: identity.users[5],
};
function assertTestState(state) {
  const database = new URL(state.migrationUrl);
  if (
    state.projectId !== 'alunza-edu-foundation-test' ||
    state.authUrl !== 'http://127.0.0.1:16421' ||
    database.hostname !== '127.0.0.1' ||
    database.port !== '16422'
  )
    throw new Error(
      'El fixture académico solo opera en la base local aislada de pruebas.',
    );
}
async function login(state, role) {
  assertTestState(state);
  const user = accounts[role];
  if (!user) throw new Error('Actor de prueba desconocido.');
  const auth = createClient(state.authUrl, state.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const result = await auth.auth.signInWithPassword({
    email: user.email,
    password: state.fixturePassword,
  });
  if (result.error || !result.data.session)
    throw new Error('No se obtuvo sesión académica real.');
  return result.data.session;
}
async function request(
  base,
  token,
  path,
  { method = 'GET', body, revision, key } = {},
) {
  const response = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(revision !== undefined ? { 'If-Match': `"${revision}"` } : {}),
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  });
  const payload = await response.json();
  return {
    status: response.status,
    ...payload,
    etag: response.headers.get('etag'),
    cacheControl: response.headers.get('cache-control'),
  };
}
async function institution(state) {
  assertTestState(state);
  const db = new Client({ connectionString: state.migrationUrl });
  await db.connect();
  const id = randomUUID();
  try {
    await db.query('BEGIN');
    await db.query(
      'INSERT INTO app.organizations(id,code,name) VALUES($1,$2,$3)',
      [
        id,
        `ACA-${id.slice(0, 8).toUpperCase()}`,
        'Institución académica de prueba',
      ],
    );
    for (const role of [
      'admin',
      'teacher',
      'student',
      'secondTeacher',
      'secondStudent',
    ]) {
      const user = accounts[role];
      await db.query(
        "INSERT INTO app.organization_memberships(organization_id,user_id,role,state,joined_at) VALUES($1,$2,$3,'ACTIVE',now())",
        [id, user.id, user.role],
      );
    }
    await db.query('COMMIT');
    return { id, foreignId: identity.organizations[1].id };
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    await db.end();
  }
}
const exerciseInput = (conceptVersionId, overrides = {}) => ({
  title: 'Sumar dos valores',
  statement: 'Implementa solve(a, b) y retorna la suma.',
  starterCode: 'function solve(a, b) {\n  return a + b;\n}',
  difficulty: 'BASIC',
  conceptVersionIds: [conceptVersionId],
  tests: [
    {
      visibility: 'VISIBLE',
      args: [1, 2],
      expected: 3,
      comparator: 'EXACT_DEEP',
    },
    {
      visibility: 'HIDDEN',
      args: [777113, 5],
      expected: 777118,
      comparator: 'EXACT_DEEP',
    },
  ],
  executionLimits: {
    memoryBytes: 134217728,
    timeoutMs: 3000,
    outputBytes: 65536,
  },
  ...overrides,
});
async function fixture(
  state,
  base,
  { content = true, enroll = true, published = true } = {},
) {
  const organization = await institution(state);
  const sessions = {};
  for (const role of Object.keys(accounts))
    sessions[role] = await login(state, role);
  const api = (role, path, options) =>
    request(base, sessions[role].access_token, path, options);
  async function create(role, path, body, status = 201) {
    const result = await api(role, path, {
      method: 'POST',
      body,
      key: randomUUID(),
    });
    if (result.status !== status)
      throw new Error(
        `Fixture académico: ${path} devolvió ${result.status} (${result.error?.code}).`,
      );
    return result.data;
  }
  const course = await create(
    'admin',
    `/organizations/${organization.id}/courses`,
    {
      code: 'PROG1',
      name: 'Programación I',
      academicPeriod: '2026-2',
      startDate: '2026-01-01',
      endDate: '2027-12-31',
    },
  );
  const classroom = await create(
    'teacher',
    `/organizations/${organization.id}/classes`,
    {
      courseId: course.id,
      code: 'CLASE-A',
      name: 'Clase de prueba',
      startDate: '2026-02-01',
      endDate: '2027-11-30',
    },
  );
  const joinCode = await create(
    'teacher',
    `/classes/${classroom.id}/join-codes`,
    { expiresAt: new Date(Date.now() + 86400000).toISOString() },
  );
  let enrollment;
  if (enroll)
    enrollment = await create(
      'student',
      '/class-enrollments',
      { organizationId: organization.id, code: joinCode.code },
      201,
    );
  let concept, exercise, activity;
  if (content) {
    concept = await create(
      'admin',
      `/organizations/${organization.id}/concepts`,
      { name: 'Variables', description: 'Valores y expresiones' },
    );
    exercise = await create(
      'teacher',
      `/organizations/${organization.id}/exercises`,
      exerciseInput(concept.currentVersionId),
    );
    activity = await create('teacher', `/classes/${classroom.id}/activities`, {
      title: 'Primera actividad',
      type: 'FORMATIVE',
      instructions: 'Resuelve el ejercicio.',
      exercises: [
        {
          exerciseVersionId: exercise.currentVersionId,
          position: 0,
          required: true,
        },
      ],
    });
    if (published) {
      const result = await api(
        'teacher',
        `/activities/${activity.id}/publish`,
        {
          method: 'POST',
          body: {},
          revision: activity.revision,
          key: randomUUID(),
        },
      );
      if (result.status !== 200)
        throw new Error(
          `No se publicó fixture: ${result.status} (${result.error?.code}).`,
        );
      activity = result.data;
    }
  }
  return {
    organization,
    course,
    classroom,
    joinCode,
    enrollment,
    concept,
    exercise,
    activity,
    sessions,
    api,
    create,
  };
}
function academicTasks(state) {
  return {
    'academic:login': (role) => login(state, role),
    'academic:prepare': async (options) => {
      const result = await fixture(
        state,
        'http://127.0.0.1:4100',
        options ?? {},
      );
      return Object.fromEntries(
        Object.entries(result).filter(
          ([key]) => !['sessions', 'api', 'create'].includes(key),
        ),
      );
    },
    'academic:request': async ({ role, path, options }) => {
      const session = await login(state, role);
      return request(
        'http://127.0.0.1:4100',
        session.access_token,
        path,
        options,
      );
    },
  };
}
module.exports = {
  accounts,
  login,
  request,
  institution,
  fixture,
  exerciseInput,
  academicTasks,
};
