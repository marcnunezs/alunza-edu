const { assertLaboratoryTestState } = require('../laboratory-test-state.cjs');
/* eslint @typescript-eslint/no-require-imports: "off" */
const { randomUUID, createHash } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { readFileSync } = require('node:fs');
const pg = require('pg');
const { createClient } = require('@supabase/supabase-js');
const fixture = require('../../fixtures/foundation/identity.json');
const c = require('@alunza/contracts');
const admin = fixture.users[0],
  teacher = fixture.users[1],
  student = fixture.users[2],
  outsider = fixture.users[5];
let state,
  pool,
  base,
  org,
  course,
  classroom,
  concept,
  exercise,
  published,
  publicExercise,
  demo;
const sessions = new Map();
const key = () => randomUUID();
async function api(
  path,
  {
    actor = admin,
    method = 'GET',
    body,
    revision,
    operationKey,
    expectSchema,
  } = {},
) {
  const response = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${sessions.get(actor.id).access_token}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(revision ? { 'If-Match': `"${revision}"` } : {}),
      ...(operationKey ? { 'Idempotency-Key': operationKey } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  });
  const payload = await response.json();
  expect(response.headers.get('cache-control')).toContain('no-store');
  const serialized = JSON.stringify(payload);
  for (const secret of [
    state.authAdminKey,
    state.applicationPassword,
    state.fixturePassword,
    sessions.get(actor.id).access_token,
  ])
    expect(serialized.includes(secret)).toBe(false);
  if (expectSchema && response.ok)
    expect(expectSchema.safeParse(payload).success).toBe(true);
  return {
    status: response.status,
    ...payload,
    etag: response.headers.get('etag'),
  };
}
const post = (path, body, actor = admin, revision, operationKey = key()) =>
  api(path, { method: 'POST', body, actor, revision, operationKey });
const deny = (result) => expect([403, 404]).toContain(result.status);
function definition(title = 'Ejercicio de prueba') {
  return {
    title,
    statement: 'Retorna el doble del número recibido.',
    starterCode: 'module.exports.solve = function solve(n) {\n  return n;\n};',
    language: 'javascript',
    entrypoint: 'solve',
    difficulty: 'BEGINNER',
    conceptVersionIds: [concept.currentVersionId],
    tests: [
      { id: 'visible', visibility: 'visible', args: [2], expected: 4 },
      {
        id: 'hidden',
        visibility: 'hidden',
        args: [123456789],
        expected: 246913578,
      },
    ],
    executionLimits: {
      memoryBytes: 134217728,
      runtimeMs: 3000,
      outputBytes: 65536,
    },
  };
}
async function grantTeacher(enabled = true) {
  const response = await api(`/courses/${course.id}/teachers/${teacher.id}`, {
    method: 'PUT',
    body: { enabled },
    revision: course.revision,
  });
  expect(response.status).toBe(200);
  course = response.data;
  return response;
}
async function makeActivity(
  exerciseVersionId = exercise.currentVersionId,
  extra = {},
) {
  return post(
    `/classes/${classroom.id}/activities`,
    {
      title: 'Actividad de integración',
      instructions: 'Resuelve',
      type: 'FORMATIVE',
      opensAt: null,
      closesAt: null,
      exercises: [{ exerciseVersionId, position: 0, required: true }],
      ...extra,
    },
    teacher,
  );
}
beforeAll(async () => {
  state = JSON.parse(readFileSync(process.env.ALUNZA_TEST_STATE, 'utf8'));
  assertLaboratoryTestState(state);
  base = process.env.ALUNZA_TEST_API_URL;
  if (
    state.projectId !== 'alunza-edu-laboratorio-test' ||
    base !== 'http://127.0.0.1:4300'
  )
    throw new Error('Solo entorno aislado académico.');
  pool = new pg.Pool({ connectionString: state.migrationUrl, max: 3 });
  const { seedAcademic } = await import('../../scripts/academic-fixture.mjs');
  demo = await import('../../fixtures/demo/academic.mjs');
  await seedAcademic(state);
  await seedAcademic(state);
  for (const user of fixture.users) {
    const auth = createClient(state.authUrl, state.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const login = await auth.auth.signInWithPassword({
      email: user.email,
      password: state.fixturePassword,
    });
    if (login.error || !login.data.session)
      throw new Error('No se obtuvo sesión académica ficticia.');
    sessions.set(user.id, login.data.session);
  }
  const grant = key();
  await pool.query(
    "INSERT INTO app.provisioning_grants(id,user_id,granted_by,reason,expires_at) VALUES($1,$2,'test','IMP02',now()+interval '1 day')",
    [grant, admin.id],
  );
  const created = await post('/organizations', {
    grantId: grant,
    code: `IMP02-${key().slice(0, 8)}`,
    name: 'Institución adversarial IMP02',
  });
  expect(created.status).toBe(201);
  org = created.data;
  for (const user of [teacher, student])
    await pool.query(
      "INSERT INTO app.organization_memberships(organization_id,user_id,role,state,joined_at) VALUES($1,$2,$3,'ACTIVE',now())",
      [org.id, user.id, user.role],
    );
}, 120000);
afterAll(async () => {
  await pool?.end();
});

test('DAT09 demo incremental conserva 12 identidades, 3 clases y 10 ejercicios sin duplicar', async () => {
  const ids = [...fixture.users, ...demo.additionalStudents].map((u) => u.id);
  const result = await pool.query(
    'SELECT (SELECT count(*)::int FROM app.profiles WHERE id=ANY($1::uuid[])) profiles,(SELECT count(*)::int FROM app.classes WHERE id=ANY($2::uuid[])) classes,(SELECT count(*)::int FROM app.exercises WHERE id=ANY($3::uuid[])) exercises',
    [ids, demo.classes.map((x) => x.id), demo.exercises.map((x) => x.id)],
  );
  expect(result.rows[0]).toEqual({ profiles: 12, classes: 3, exercises: 10 });
});
test('RF022 E1/E2 crea curso, recupera fechas civiles y rechaza duplicados e incoherencia', async () => {
  const input = {
    code: 'PROG',
    name: 'Programación',
    academicPeriod: '2026-2',
    startDate: '2026-07-01',
    endDate: '2026-12-31',
  };
  const result = await post(`/organizations/${org.id}/courses`, input);
  expect(result.status).toBe(201);
  course = result.data;
  expect(c.courseSchema.safeParse(course).success).toBe(true);
  expect(course.startDate).toBe('2026-07-01');
  expect((await post(`/organizations/${org.id}/courses`, input)).status).toBe(
    409,
  );
  expect(
    (
      await post(`/organizations/${org.id}/courses`, {
        ...input,
        code: 'OTHER',
        endDate: '2026-01-01',
      })
    ).status,
  ).toBe(422);
  deny(
    await post(
      `/organizations/${org.id}/courses`,
      { ...input, code: 'STUDENT' },
      student,
    ),
  );
});
test('RF002 E1/E3 y RF022 E3/E4 habilitación explícita permite crear clase propia', async () => {
  const input = {
    courseId: course.id,
    code: 'CLASS',
    name: 'Clase',
    startDate: '2026-08-01',
    endDate: '2026-12-01',
  };
  deny(await post(`/organizations/${org.id}/classes`, input, teacher));
  await grantTeacher();
  const response = await post(
    `/organizations/${org.id}/classes`,
    input,
    teacher,
  );
  expect(response.status).toBe(201);
  classroom = response.data;
  expect(classroom.teacherId).toBe(teacher.id);
  expect(c.classSchema.safeParse(classroom).success).toBe(true);
  const cross = await api(`/classes/${classroom.id}/teacher`, {
    method: 'PUT',
    revision: classroom.revision,
    body: { teacherId: fixture.users[4].id },
  });
  expect([403, 404, 422]).toContain(cross.status);
  deny(await api(`/classes/${classroom.id}`, { actor: outsider }));
});
test('RF002 E2 configuración inválida y revisión antigua no pisan datos; revocar grant preserva clase', async () => {
  const path = `/classes/${classroom.id}`;
  expect(
    (
      await api(path, {
        actor: teacher,
        method: 'PATCH',
        revision: classroom.revision,
        body: { name: '' },
      })
    ).status,
  ).toBe(422);
  const updated = await api(path, {
    actor: teacher,
    method: 'PATCH',
    revision: classroom.revision,
    body: { name: 'Clase actualizada' },
  });
  expect(updated.status).toBe(200);
  classroom = updated.data;
  expect(
    (
      await api(path, {
        actor: teacher,
        method: 'PATCH',
        revision: 1,
        body: { name: 'Sobrescritura' },
      })
    ).status,
  ).toBe(412);
  await grantTeacher(false);
  expect((await api(path, { actor: teacher })).status).toBe(200);
  deny(
    await post(
      `/organizations/${org.id}/classes`,
      { courseId: course.id, code: 'DENIED', name: 'No autorizada' },
      teacher,
    ),
  );
  await grantTeacher();
});
test('RF003 E1/E4 inscripción colectiva concurrente es única y código no se persiste claro', async () => {
  const codeKey = key();
  const issued = await post(
    `/classes/${classroom.id}/join-codes`,
    {},
    teacher,
    classroom.revision,
    codeKey,
  );
  expect(issued.status).toBe(201);
  expect(issued.data.code).toEqual(expect.any(String));
  const replay = await post(
    `/classes/${classroom.id}/join-codes`,
    {},
    teacher,
    classroom.revision,
    codeKey,
  );
  expect(replay.data.id).toBe(issued.data.id);
  expect(replay.data.code).toBeUndefined();
  const digest = createHash('sha256').update(issued.data.code).digest('hex');
  const stored = await pool.query(
    'SELECT token_digest FROM app.class_join_codes WHERE id=$1',
    [issued.data.id],
  );
  expect(stored.rows[0].token_digest).toBe(digest);
  const safe = await pool.query(
    'SELECT response_body::text body FROM app.operation_keys WHERE actor_id=$1 AND key=$2',
    [teacher.id, codeKey],
  );
  expect(safe.rows.every((row) => !row.body?.includes(issued.data.code))).toBe(
    true,
  );
  const preview = await post(
    '/class-enrollments/preview',
    { code: issued.data.code },
    student,
  );
  expect(preview.status).toBe(200);
  expect(preview.data.alreadyEnrolled).toBe(false);
  const results = await Promise.all([
    post('/class-enrollments', { code: issued.data.code }, student),
    post('/class-enrollments', { code: issued.data.code }, student),
  ]);
  expect(results.every((r) => r.status === 200 || r.status === 201)).toBe(true);
  const count = await pool.query(
    'SELECT count(*)::int n FROM app.class_memberships WHERE class_id=$1 AND user_id=$2',
    [classroom.id, student.id],
  );
  expect(count.rows[0].n).toBe(1);
  expect(
    (await post('/class-enrollments', { code: issued.data.code }, student)).data
      .alreadyEnrolled,
  ).toBe(true);
  const alien = await post(
    '/class-enrollments',
    { code: issued.data.code },
    outsider,
  );
  expect(alien.status).toBe(400);
  expect(alien.error.code).toBe('JOIN_CODE_INVALID');
});
test('RF003 E2/E3/E4 código inválido, revocado y vencido no inscribe', async () => {
  expect((await post('/class-enrollments', { code: '' }, student)).status).toBe(
    422,
  );
  const invalid = await post(
    '/class-enrollments',
    { code: 'not-a-real-code' },
    student,
  );
  expect(invalid.status).toBe(400);
  expect(invalid.error.code).toBe('JOIN_CODE_INVALID');
  const issued = await post(
    `/classes/${classroom.id}/join-codes`,
    {},
    teacher,
    classroom.revision,
  );
  const enrollmentKey = key();
  const confirmed = await post(
    '/class-enrollments',
    { code: issued.data.code },
    student,
    undefined,
    enrollmentKey,
  );
  expect(confirmed.status).toBe(200);
  const newer = await post(
    `/classes/${classroom.id}/join-codes`,
    {},
    teacher,
    classroom.revision,
  );
  const recovered = await post(
    '/class-enrollments',
    { code: issued.data.code },
    student,
    undefined,
    enrollmentKey,
  );
  expect(recovered.status).toBe(200);
  expect(recovered.data.classId).toBe(classroom.id);
  expect(issued.data.code).toBeTruthy();
  expect(newer.data.code).not.toBe(issued.data.code);
  expect(
    (
      await post(
        '/class-enrollments/preview',
        { code: issued.data.code },
        student,
      )
    ).status,
  ).not.toBe(200);
  const revoked = await post(
    `/classes/${classroom.id}/join-codes/${newer.data.id}/revoke`,
    undefined,
    teacher,
    newer.data.revision,
  );
  expect(revoked.status).toBe(200);
  const expiredCode = `expired-${key()}`;
  await pool.query(
    "INSERT INTO app.class_join_codes(organization_id,class_id,token_digest,created_by,created_at,expires_at) VALUES($1,$2,$3,$4,now()-interval '2 days',now()-interval '1 day')",
    [
      org.id,
      classroom.id,
      createHash('sha256').update(expiredCode).digest('hex'),
      teacher.id,
    ],
  );
  expect(
    (await post('/class-enrollments/preview', { code: expiredCode }, student))
      .status,
  ).not.toBe(200);
});
test('RF023 E1/E2/E3 conceptos versionados, normalización y ciclos', async () => {
  const made = await post(`/organizations/${org.id}/concepts`, {
    name: 'Funciones',
    description: 'Entradas y retornos',
  });
  expect(made.status).toBe(201);
  concept = made.data;
  expect(
    (
      await post(`/organizations/${org.id}/concepts`, {
        name: '  FUNCIONES  ',
        description: 'Dup',
      })
    ).status,
  ).toBe(409);
  const child = await post(`/organizations/${org.id}/concepts`, {
    name: 'Parámetros',
    description: 'Argumentos',
    parentId: concept.id,
  });
  expect(child.status).toBe(201);
  const cycle = await api(`/concepts/${concept.id}`, {
    method: 'PATCH',
    revision: concept.revision,
    body: { parentId: child.data.id },
  });
  expect([409, 422]).toContain(cycle.status);
  deny(await api(`/concepts/${concept.id}`, { actor: outsider }));
  deny(
    await api(`/concepts/${concept.id}`, {
      actor: teacher,
      method: 'PATCH',
      revision: concept.revision,
      body: { name: 'Sin permiso' },
    }),
  );
});
test('RF004 E1/E2 valida definición y conserva pruebas privadas por versión', async () => {
  const wrong = definition();
  wrong.tests[1].args = [2];
  wrong.tests[1].expected = 8;
  expect(
    (await post(`/organizations/${org.id}/exercises`, wrong, teacher)).status,
  ).toBe(422);
  const made = await post(
    `/organizations/${org.id}/exercises`,
    definition(),
    teacher,
  );
  expect(made.status).toBe(201);
  exercise = made.data;
  const versions = await api(`/exercises/${exercise.id}/versions`, {
    actor: teacher,
  });
  expect(versions.status).toBe(200);
  expect(versions.data[0].tests).toEqual(definition().tests);
  deny(await api(`/exercises/${exercise.id}/versions`, { actor: student }));
  deny(
    await post(
      `/exercises/${exercise.id}/versions`,
      definition('Ajeno'),
      outsider,
      exercise.revision,
    ),
  );
});
test('RF005 habilitador publica atómicamente; RF008 E1 y RF004 E4 ocultan pruebas privadas', async () => {
  const empty = await makeActivity(exercise.currentVersionId, {
    exercises: [],
  });
  expect(empty.status).toBe(201);
  expect(
    (
      await post(
        `/activities/${empty.data.id}/publish`,
        undefined,
        teacher,
        empty.data.revision,
      )
    ).status,
  ).toBe(422);
  const made = await makeActivity();
  expect(made.status).toBe(201);
  deny(
    await post(
      `/activities/${made.data.id}/publish`,
      undefined,
      admin,
      made.data.revision,
    ),
  );
  const result = await post(
    `/activities/${made.data.id}/publish`,
    undefined,
    teacher,
    made.data.revision,
  );
  expect(result.status).toBe(200);
  published = result.data;
  expect(published.state).toBe('PUBLISHED');
  const publicResult = await api(
    `/activities/${published.id}/exercises/${published.exercises[0].id}`,
    { actor: student, expectSchema: c.studentExerciseResponseSchema },
  );
  expect(publicResult.status).toBe(200);
  publicExercise = publicResult.data;
  expect(publicExercise.canEdit).toBe(true);
  expect(publicExercise.tests).toEqual([definition().tests[0]]);
  const output = JSON.stringify(publicResult);
  expect(output.includes('123456789')).toBe(false);
  expect(output.includes('246913578')).toBe(false);
  deny(
    await api(
      `/activities/${published.id}/exercises/${published.exercises[0].id}`,
      { actor: outsider },
    ),
  );
});
test('RF004 E3 y DAT04 nueva versión no cambia publicación ni admite edición publicada', async () => {
  const added = await post(
    `/exercises/${exercise.id}/versions`,
    definition('Nueva versión'),
    teacher,
    exercise.revision,
  );
  expect(added.status).toBe(201);
  expect(added.data.id).not.toBe(exercise.currentVersionId);
  const current = await api(`/activities/${published.id}`, { actor: student });
  expect(current.data.exercises[0].exerciseVersionId).toBe(
    exercise.currentVersionId,
  );
  expect(
    (
      await api(`/activities/${published.id}`, {
        method: 'PATCH',
        actor: teacher,
        revision: published.revision,
        body: { title: 'Cambio publicado' },
      })
    ).status,
  ).toBe(409);
});
test('RF008 E4 ventanas futuras y vencidas son consulta; archivo bloquea publicaciones abiertas', async () => {
  const future = await makeActivity(exercise.currentVersionId, {
    opensAt: new Date(Date.now() + 86400000).toISOString(),
  });
  expect(future.status).toBe(201);
  const futurePublished = await post(
    `/activities/${future.data.id}/publish`,
    undefined,
    teacher,
    future.data.revision,
  );
  expect(futurePublished.status).toBe(200);
  const view = await api(
    `/activities/${future.data.id}/exercises/${futurePublished.data.exercises[0].id}`,
    { actor: student },
  );
  expect(view.status).toBe(200);
  expect(view.data.canEdit).toBe(false);
  const expired = await makeActivity(exercise.currentVersionId, {
    closesAt: new Date(Date.now() - 86400000).toISOString(),
  });
  expect(expired.status).toBe(201);
  const expiredPublished = await post(
    `/activities/${expired.data.id}/publish`,
    undefined,
    teacher,
    expired.data.revision,
  );
  expect(expiredPublished.status).toBe(200);
  const pastView = await api(
    `/activities/${expired.data.id}/exercises/${expiredPublished.data.exercises[0].id}`,
    { actor: student },
  );
  expect(pastView.status).toBe(200);
  expect(pastView.data.canEdit).toBe(false);
  expect(
    (
      await post(
        `/classes/${classroom.id}/archive`,
        { reason: 'Todavía publicada' },
        admin,
        classroom.revision,
      )
    ).status,
  ).toBe(409);
  for (const item of [futurePublished.data, expiredPublished.data])
    expect(
      (
        await post(
          `/activities/${item.id}/close`,
          undefined,
          teacher,
          item.revision,
        )
      ).status,
    ).toBe(200);
});

test('RF023 E4 archivar concepto conserva versión publicada y bloquea nuevos usos', async () => {
  const archived = await post(
    `/concepts/${concept.id}/archive`,
    { reason: 'Catálogo nuevo' },
    admin,
    concept.revision,
  );
  expect(archived.status).toBe(200);
  expect(
    (
      await post(
        `/organizations/${org.id}/exercises`,
        definition('No asignable'),
        teacher,
      )
    ).status,
  ).toBe(422);
  const historical = await api(
    `/activities/${published.id}/exercises/${published.exercises[0].id}`,
    { actor: student },
  );
  expect(historical.status).toBe(200);
  expect(historical.data.concepts[0].versionId).toBe(concept.currentVersionId);
});
test('RF008 E4 ventana UTC controla edición y CLOSED conserva contenido sin reapertura', async () => {
  // Existing published version can be read even after a concept is archived.
  const closed = await post(
    `/activities/${published.id}/close`,
    undefined,
    teacher,
    published.revision,
  );
  expect(closed.status).toBe(200);
  published = closed.data;
  const read = await api(
    `/activities/${published.id}/exercises/${published.exercises[0].id}`,
    { actor: student },
  );
  expect(read.status).toBe(200);
  expect(read.data.canEdit).toBe(false);
  expect(read.data.activityState).toBe('CLOSED');
  expect(read.data.starterCode).toBe(publicExercise.starterCode);
  expect(
    (
      await post(
        `/activities/${published.id}/publish`,
        undefined,
        teacher,
        published.revision,
      )
    ).status,
  ).toBe(409);
});
test('RF002 E4 archivo clase revoca códigos y conserva lectura autorizada', async () => {
  const issued = await post(
    `/classes/${classroom.id}/join-codes`,
    {},
    teacher,
    classroom.revision,
  );
  expect(issued.status).toBe(201);
  const archived = await post(
    `/classes/${classroom.id}/archive`,
    { reason: 'Finalizada' },
    admin,
    classroom.revision,
  );
  expect(archived.status).toBe(200);
  classroom = archived.data;
  expect(classroom.state).toBe('ARCHIVED');
  expect(
    (await api(`/classes/${classroom.id}`, { actor: student })).status,
  ).toBe(200);
  expect(
    (
      await api(`/classes/${classroom.id}`, {
        actor: teacher,
        method: 'PATCH',
        revision: classroom.revision,
        body: { name: 'Alteración' },
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await post(
        '/class-enrollments/preview',
        { code: issued.data.code },
        student,
      )
    ).status,
  ).not.toBe(200);
});
test('RF001/021 autorización vigente revoca lectura incluso con JWT anterior', async () => {
  await pool.query(
    "UPDATE app.organization_memberships SET state='DISABLED' WHERE organization_id=$1 AND user_id=$2",
    [org.id, student.id],
  );
  try {
    deny(await api(`/activities/${published.id}`, { actor: student }));
  } finally {
    await pool.query(
      "UPDATE app.organization_memberships SET state='ACTIVE' WHERE organization_id=$1 AND user_id=$2",
      [org.id, student.id],
    );
  }
});
test('RF020 dependencias académicas bloquean archivo institucional en API y DB', async () => {
  await pool.query(
    "UPDATE app.organization_memberships SET state='DISABLED' WHERE organization_id=$1 AND user_id<>$2",
    [org.id, admin.id],
  );
  try {
    const result = await post(
      `/organizations/${org.id}/archive`,
      { reason: 'No debe archivar' },
      admin,
      org.revision,
    );
    expect(result.status).toBe(409);
    expect(result.error.code).toBe('DEPENDENCIES_ACTIVE');
    const applicationUrl = new URL(state.migrationUrl);
    applicationUrl.username = 'alunza_app';
    applicationUrl.password = state.applicationPassword;
    const client = new pg.Client({ connectionString: applicationUrl.href });
    await client.connect();
    try {
      await client.query('BEGIN');
      const claims = JSON.parse(
        Buffer.from(
          sessions.get(admin.id).access_token.split('.')[1],
          'base64url',
        ).toString(),
      );
      await client.query(
        "SELECT set_config('app.actor_id',$1,true),set_config('app.organization_id',$2,true),set_config('app.session_id',$3,true)",
        [admin.id, org.id, claims.session_id],
      );
      await expect(
        client.query(
          'UPDATE app.organizations SET archived_at=now(), archived_by=$2, archive_reason=$3 WHERE id=$1',
          [org.id, admin.id, 'Dependencias académicas'],
        ),
      ).rejects.toMatchObject({
        code: 'P0001',
        message: 'DEPENDENCIES_ACTIVE',
      });
    } finally {
      await client.query('ROLLBACK');
      await client.end();
    }
  } finally {
    await pool.query(
      "UPDATE app.organization_memberships SET state='ACTIVE' WHERE organization_id=$1 AND user_id<>$2",
      [org.id, admin.id],
    );
  }
});

test('RF008 E3 aislamiento de clase dentro de la misma organización', async () => {
  const other = demo.activities.find(
    (item) => item.classId === demo.classes[1].id && item.state === 'PUBLISHED',
  );
  deny(await api(`/activities/${other.id}`, { actor: student }));
  deny(
    await api(`/activities/${other.id}/exercises/${other.exercises[0].id}`, {
      actor: student,
    }),
  );
});

test('RNF-REN-01 muestra API local documentada sin ocultar fallos', async () => {
  const { report } = await import('../../scripts/test-environment.mjs');
  const activity = demo.activities.find(
    (item) => item.classId === demo.classes[0].id && item.state === 'PUBLISHED',
  );
  const paths = [
    `/organizations/${demo.organizationA}/classes`,
    `/activities/${activity.id}/exercises/${activity.exercises[0].id}`,
  ];
  const results = [];
  for (const path of paths) {
    const samples = [];
    for (let batch = 0; batch < 10; batch++) {
      await Promise.all(
        Array.from({ length: 5 }, async () => {
          const started = performance.now();
          const result = await api(path, { actor: student });
          samples.push({
            durationMs: performance.now() - started,
            status: result.status,
          });
        }),
      );
    }
    const ordered = samples.map((s) => s.durationMs).sort((a, b) => a - b);
    results.push({
      operation: path.includes('/exercises/') ? 'student-exercise' : 'classes',
      samples,
      p95Ms: ordered[Math.ceil(ordered.length * 0.95) - 1],
      failures: samples.filter((s) => s.status !== 200).length,
    });
  }
  await report(
    'api-performance',
    {
      status: results.every((r) => r.failures === 0 && r.p95Ms < 3000)
        ? 'passed'
        : 'failed',
      environment: 'local-loopback-Supabase-NestJS',
      concurrency: 5,
      samplesPerOperation: 50,
      coldWarm: 'mixed; first request included',
      percentile: 'nearest-rank',
      results,
    },
    'imp-02',
  );
  expect(results.every((r) => r.failures === 0 && r.p95Ms < 3000)).toBe(true);
}, 120000);
