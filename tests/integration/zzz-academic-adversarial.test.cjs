const { assertLaboratoryTestState } = require('../laboratory-test-state.cjs');
/* eslint @typescript-eslint/no-require-imports: "off" */
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const pg = require('pg');
const { createClient } = require('@supabase/supabase-js');
const contracts = require('@alunza/contracts');
const fixture = require('../../fixtures/foundation/identity.json');

// scripts/integration.mjs also checks this marker against the actual API log.
const PRIVATE_SENTINEL = 'IMP02_PRIVATE_EXPECTATION_DO_NOT_EXPOSE';
const admin = fixture.users[0];
const teacher = fixture.users[1];
const student = fixture.users[2];
const replacement = fixture.users[4];
const sessions = new Map();
let state, base, pool, organization, course, concept, exercise;

async function request(path, options = {}) {
  const {
    actor = admin,
    method = 'GET',
    body,
    revision,
    operationKey = method === 'POST' ? randomUUID() : undefined,
  } = options;
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
  for (const secret of [
    state.authAdminKey,
    state.applicationPassword,
    state.fixturePassword,
    sessions.get(actor.id).access_token,
  ])
    expect(JSON.stringify(payload)).not.toContain(secret);
  if (!response.ok)
    expect(contracts.errorResponseSchema.safeParse(payload).success).toBe(true);
  return { status: response.status, ...payload };
}
async function newOrganization() {
  const grant = randomUUID();
  await pool.query(
    "INSERT INTO app.provisioning_grants(id,user_id,granted_by,reason,expires_at) VALUES($1,$2,'academic-adversarial-test','Fixture de integración IMP02',now()+interval '1 hour')",
    [grant, admin.id],
  );
  const result = await request('/organizations', {
    method: 'POST',
    body: {
      grantId: grant,
      code: `ADV-${randomUUID().slice(0, 12)}`,
      name: 'Institución ficticia adversarial',
    },
  });
  expect(result.status).toBe(201);
  return result.data;
}
async function newClass() {
  const result = await request(`/organizations/${organization.id}/classes`, {
    actor: teacher,
    method: 'POST',
    body: {
      courseId: course.id,
      code: `CLS-${randomUUID().slice(0, 12)}`,
      name: 'Clase adversarial',
    },
  });
  expect(result.status).toBe(201);
  return result.data;
}
async function newActivity(classroom, version = exercise.currentVersionId) {
  const result = await request(`/classes/${classroom.id}/activities`, {
    actor: teacher,
    method: 'POST',
    body: {
      title: 'Publicación adversarial',
      instructions: 'Resuelve la actividad.',
      type: 'FORMATIVE',
      opensAt: null,
      closesAt: null,
      exercises: [{ exerciseVersionId: version, position: 0, required: true }],
    },
  });
  expect(result.status).toBe(201);
  return result.data;
}
async function publish(activity, operationKey = randomUUID()) {
  return request(`/activities/${activity.id}/publish`, {
    actor: teacher,
    method: 'POST',
    revision: activity.revision,
    operationKey,
  });
}
async function join(classroom) {
  const issued = await request(`/classes/${classroom.id}/join-codes`, {
    actor: teacher,
    method: 'POST',
    body: {},
    revision: classroom.revision,
  });
  expect(issued.status).toBe(201);
  const operationKey = randomUUID();
  const confirmed = await request('/class-enrollments', {
    actor: student,
    method: 'POST',
    body: { code: issued.data.code },
    operationKey,
  });
  expect(confirmed.status).toBe(200);
  return { code: issued.data.code, operationKey };
}
function definition() {
  return {
    title: 'Contenido con prueba privada',
    statement: 'Retorna el doble del número.',
    starterCode: 'function solve(n) { return n * 2; }',
    language: 'javascript',
    entrypoint: 'solve',
    difficulty: 'BEGINNER',
    conceptVersionIds: [concept.currentVersionId],
    tests: [
      { id: 'visible', visibility: 'visible', args: [2], expected: 4 },
      {
        id: 'hidden',
        visibility: 'hidden',
        args: [PRIVATE_SENTINEL],
        expected: { privateExpectation: PRIVATE_SENTINEL },
      },
    ],
    executionLimits: {
      memoryBytes: 134217728,
      runtimeMs: 3000,
      outputBytes: 65536,
    },
  };
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
  for (const user of [admin, teacher, student, replacement]) {
    const auth = createClient(state.authUrl, state.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const result = await auth.auth.signInWithPassword({
      email: user.email,
      password: state.fixturePassword,
    });
    if (result.error || !result.data.session)
      throw new Error(
        'No se obtuvo sesión ficticia para pruebas adversariales.',
      );
    sessions.set(user.id, result.data.session);
  }
  organization = await newOrganization();
  for (const user of [teacher, student, replacement])
    await pool.query(
      "INSERT INTO app.organization_memberships(organization_id,user_id,role,state,joined_at) VALUES($1,$2,$3,'ACTIVE',now())",
      [organization.id, user.id, user.role],
    );
  const createdCourse = await request(
    `/organizations/${organization.id}/courses`,
    {
      method: 'POST',
      body: {
        code: 'ADV-PROG',
        name: 'Programación adversarial',
        academicPeriod: '2026-2',
      },
    },
  );
  expect(createdCourse.status).toBe(201);
  const granted = await request(
    `/courses/${createdCourse.data.id}/teachers/${teacher.id}`,
    {
      method: 'PUT',
      revision: createdCourse.data.revision,
      body: { enabled: true },
    },
  );
  expect(granted.status).toBe(200);
  course = granted.data;
  await newClass();
  const createdConcept = await request(
    `/organizations/${organization.id}/concepts`,
    {
      method: 'POST',
      body: {
        name: 'Concepto adversarial',
        description: 'Definición ficticia',
      },
    },
  );
  expect(createdConcept.status).toBe(201);
  concept = createdConcept.data;
  const createdExercise = await request(
    `/organizations/${organization.id}/exercises`,
    { actor: teacher, method: 'POST', body: definition() },
  );
  expect(createdExercise.status).toBe(201);
  exercise = createdExercise.data;
}, 120000);
afterAll(async () => {
  await pool?.end();
});

test('RF001/002/021/022 valida invitaciones, aísla membresías y revoca al profesor reasignado', async () => {
  const invitationsBefore = (
    await pool.query(
      'SELECT count(*)::int total FROM app.organization_invitations WHERE organization_id=$1',
      [organization.id],
    )
  ).rows[0].total;
  const malformed = await request(
    `/organizations/${organization.id}/invitations`,
    {
      method: 'POST',
      body: { email: 'correo-sin-arroba', role: 'STUDENT' },
    },
  );
  expect(malformed.status).toBe(422);
  expect(malformed.error.fields.some((field) => field.field === 'email')).toBe(
    true,
  );
  expect(
    (
      await pool.query(
        'SELECT count(*)::int total FROM app.organization_invitations WHERE organization_id=$1',
        [organization.id],
      )
    ).rows[0].total,
  ).toBe(invitationsBefore);
  const unrelatedOrganization = fixture.organizations[1].id;
  const unrelatedBefore = (
    await pool.query(
      'SELECT role,state,revision FROM app.organization_memberships WHERE organization_id=$1 AND user_id=$2',
      [unrelatedOrganization, replacement.id],
    )
  ).rows[0];
  const foreignMutation = await request(
    `/organizations/${unrelatedOrganization}/members/${replacement.id}`,
    {
      method: 'PATCH',
      revision: unrelatedBefore.revision,
      body: { state: 'DISABLED' },
    },
  );
  expect([403, 404]).toContain(foreignMutation.status);
  expect(
    (
      await pool.query(
        'SELECT role,state,revision FROM app.organization_memberships WHERE organization_id=$1 AND user_id=$2',
        [unrelatedOrganization, replacement.id],
      )
    ).rows[0],
  ).toEqual(unrelatedBefore);
  const classCountBefore = (
    await pool.query(
      'SELECT count(*)::int total FROM app.classes WHERE organization_id=$1',
      [organization.id],
    )
  ).rows[0].total;
  for (const [body, field] of [
    [{ code: 'MISSING-COURSE', name: 'Clase incompleta' }, 'courseId'],
    [{ courseId: course.id, code: 'MISSING-NAME', name: '' }, 'name'],
  ]) {
    const invalidClass = await request(
      `/organizations/${organization.id}/classes`,
      { actor: teacher, method: 'POST', body },
    );
    expect(invalidClass.status).toBe(422);
    expect(
      invalidClass.error.fields.some((error) => error.field === field),
    ).toBe(true);
  }
  expect(
    (
      await pool.query(
        'SELECT count(*)::int total FROM app.classes WHERE organization_id=$1',
        [organization.id],
      )
    ).rows[0].total,
  ).toBe(classCountBefore);
  const demo = await import('../../fixtures/demo/academic.mjs');
  const canonicalClass = await request(`/classes/${demo.classes[0].id}`);
  expect(canonicalClass.status).toBe(200);
  const foreignTeacher = await request(
    `/classes/${demo.classes[0].id}/teacher`,
    {
      method: 'PUT',
      revision: canonicalClass.data.revision,
      body: { teacherId: replacement.id },
    },
  );
  expect(foreignTeacher.status).toBe(422);
  expect((await request(`/classes/${demo.classes[0].id}`)).data).toEqual(
    canonicalClass.data,
  );
  const classroom = await newClass();
  const structureAudit = (
    await pool.query(
      `SELECT
    (SELECT count(*)::int FROM app.audit_events WHERE organization_id=$1 AND entity_id=$2 AND actor_id=$4 AND action='course.created') courses,
    (SELECT count(*)::int FROM app.audit_events WHERE organization_id=$1 AND entity_id=$3 AND actor_id=$5 AND action='class.created') classes`,
      [organization.id, course.id, classroom.id, admin.id, teacher.id],
    )
  ).rows[0];
  expect(structureAudit).toEqual({ courses: 1, classes: 1 });
  const draft = await newActivity(classroom);
  const published = await publish(draft);
  expect(published.status).toBe(200);
  const previousToken = sessions.get(teacher.id).access_token;
  await pool.query(
    "UPDATE app.organization_memberships SET state='DISABLED' WHERE organization_id=$1 AND user_id=$2",
    [organization.id, replacement.id],
  );
  try {
    const disabled = await request(`/classes/${classroom.id}/teacher`, {
      method: 'PUT',
      revision: classroom.revision,
      body: { teacherId: replacement.id },
    });
    expect(disabled.status).toBe(422);
    expect(
      disabled.error.fields.some((field) => field.field === 'teacherId'),
    ).toBe(true);
    const unchanged = await request(`/classes/${classroom.id}`, {
      actor: teacher,
    });
    expect(unchanged.status).toBe(200);
    expect(unchanged.data).toEqual(classroom);
  } finally {
    await pool.query(
      "UPDATE app.organization_memberships SET state='ACTIVE' WHERE organization_id=$1 AND user_id=$2",
      [organization.id, replacement.id],
    );
  }
  const reassigned = await request(`/classes/${classroom.id}/teacher`, {
    method: 'PUT',
    revision: classroom.revision,
    body: { teacherId: replacement.id },
  });
  expect(reassigned.status).toBe(200);
  expect(sessions.get(teacher.id).access_token).toBe(previousToken);
  for (const path of [
    `/classes/${classroom.id}`,
    `/activities/${draft.id}`,
    `/activities/${draft.id}/exercises/${published.data.exercises[0].id}`,
  ]) {
    expect([403, 404]).toContain(
      (await request(path, { actor: teacher })).status,
    );
    expect((await request(path, { actor: replacement })).status).toBe(200);
  }
  const forbiddenClose = await request(`/activities/${draft.id}/close`, {
    actor: teacher,
    method: 'POST',
    revision: published.data.revision,
  });
  expect([403, 404]).toContain(forbiddenClose.status);
  expect(
    (await request(`/activities/${draft.id}`, { actor: replacement })).data
      .state,
  ).toBe('PUBLISHED');
});

test('RF005 fallo de auditoría revierte publicación, revisión, asignaciones y reserva idempotente', async () => {
  const classroom = await newClass();
  const draft = await newActivity(classroom);
  const operationKey = randomUUID();
  const suffix = randomUUID().replaceAll('-', '');
  const functionName = `imp02_fail_publish_${suffix}`;
  const triggerName = `imp02_fail_publish_${suffix}`;
  // Privileged setup injects a failure for exactly this fixture entity. Runtime
  // publication still executes through the authenticated, limited-role API.
  await pool.query(
    `CREATE FUNCTION app_private.${functionName}() RETURNS trigger LANGUAGE plpgsql AS $fault$ BEGIN IF NEW.entity_id='${draft.id}'::uuid AND NEW.action='activity.published' THEN RAISE EXCEPTION '${PRIVATE_SENTINEL}'; END IF; RETURN NEW; END $fault$`,
  );
  await pool.query(
    `CREATE TRIGGER ${triggerName} BEFORE INSERT ON app.audit_events FOR EACH ROW EXECUTE FUNCTION app_private.${functionName}()`,
  );
  try {
    const failed = await publish(draft, operationKey);
    expect(failed.status).toBe(503);
    expect(failed.error.code).toBe('PERSISTENCE_UNAVAILABLE');
    expect(JSON.stringify(failed)).not.toContain(PRIVATE_SENTINEL);
    const after = await request(`/activities/${draft.id}`, { actor: teacher });
    expect(after.status).toBe(200);
    expect(after.data).toEqual(draft);
    const evidence = await pool.query(
      `SELECT
      (SELECT count(*)::int FROM app.audit_events WHERE entity_id=$1 AND action='activity.published') publications,
      (SELECT count(*)::int FROM app.operation_keys WHERE actor_id=$2 AND organization_id=$3 AND key=$4) operation_keys`,
      [draft.id, teacher.id, organization.id, operationKey],
    );
    expect(evidence.rows[0]).toEqual({ publications: 0, operation_keys: 0 });
  } finally {
    await pool.query(
      `DROP TRIGGER IF EXISTS ${triggerName} ON app.audit_events`,
    );
    await pool.query(`DROP FUNCTION IF EXISTS app_private.${functionName}()`);
  }
  const retried = await publish(draft, operationKey);
  expect(retried.status).toBe(200);
  expect(retried.data.state).toBe('PUBLISHED');
  expect(retried.data.exercises).toEqual(draft.exercises);
  expect(retried.data.revision).toBe(draft.revision + 1);
});

test('RF020/022 archivo institucional concurrente con alta de curso confirma solo un efecto incompatible', async () => {
  for (let round = 0; round < 3; round++) {
    const independent = await newOrganization();
    const [archived, created] = await Promise.all([
      request(`/organizations/${independent.id}/archive`, {
        method: 'POST',
        revision: independent.revision,
        body: { reason: 'Carrera académica controlada' },
      }),
      request(`/organizations/${independent.id}/courses`, {
        method: 'POST',
        body: {
          code: 'CONCURRENT',
          name: 'Alta concurrente',
          academicPeriod: '2026-2',
        },
      }),
    ]);
    expect(
      Number(archived.status === 200) + Number(created.status === 201),
    ).toBe(1);
    const actual = (
      await pool.query(
        `SELECT o.archived_at IS NOT NULL archived,
      (SELECT count(*)::int FROM app.courses c WHERE c.organization_id=o.id AND c.archived_at IS NULL) active_courses
      FROM app.organizations o WHERE o.id=$1`,
        [independent.id],
      )
    ).rows[0];
    if (archived.status === 200) {
      expect(created.status).toBe(409);
      expect(created.error.code).toBe('ORGANIZATION_ARCHIVED');
      expect(actual).toEqual({ archived: true, active_courses: 0 });
    } else {
      expect(archived.status).toBe(409);
      expect(archived.error.code).toBe('DEPENDENCIES_ACTIVE');
      expect(actual).toEqual({ archived: false, active_courses: 1 });
    }
  }
}, 60000);

test('RF003 una incorporación terminada no se reactiva por código ni por repetición de transporte', async () => {
  const classroom = await newClass();
  const enrollment = await join(classroom);
  await pool.query(
    'UPDATE app.class_memberships SET ended_at=now() WHERE organization_id=$1 AND class_id=$2 AND user_id=$3',
    [organization.id, classroom.id, student.id],
  );
  for (const options of [
    { path: '/class-enrollments/preview' },
    { path: '/class-enrollments' },
    { path: '/class-enrollments', operationKey: enrollment.operationKey },
  ]) {
    const denied = await request(options.path, {
      actor: student,
      method: 'POST',
      body: { code: enrollment.code },
      ...(options.operationKey ? { operationKey: options.operationKey } : {}),
    });
    expect(denied.status).toBe(400);
    expect(denied.error.code).toBe('JOIN_CODE_INVALID');
  }
  const membership = (
    await pool.query(
      'SELECT count(*)::int total,count(*) FILTER(WHERE ended_at IS NULL)::int active FROM app.class_memberships WHERE organization_id=$1 AND class_id=$2 AND user_id=$3',
      [organization.id, classroom.id, student.id],
    )
  ).rows[0];
  expect(membership).toEqual({ total: 1, active: 0 });
});

test('RF004/008 protege expectativas ocultas y archivar el banco conserva la publicación disponible', async () => {
  const taxonomyForeign = await request(
    `/organizations/${fixture.organizations[1].id}/concepts`,
  );
  expect([403, 404]).toContain(taxonomyForeign.status);
  const exerciseCountBefore = (
    await pool.query(
      'SELECT count(*)::int total FROM app.exercises WHERE organization_id=$1',
      [organization.id],
    )
  ).rows[0].total;
  const missingStatement = await request(
    `/organizations/${organization.id}/exercises`,
    {
      actor: teacher,
      method: 'POST',
      body: { ...definition(), statement: '' },
    },
  );
  expect(missingStatement.status).toBe(422);
  expect(
    missingStatement.error.fields.some((field) => field.field === 'statement'),
  ).toBe(true);
  expect(
    (
      await pool.query(
        'SELECT count(*)::int total FROM app.exercises WHERE organization_id=$1',
        [organization.id],
      )
    ).rows[0].total,
  ).toBe(exerciseCountBefore);
  const classroom = await newClass();
  await join(classroom);
  const draft = await newActivity(classroom);
  const published = await publish(draft);
  expect(published.status).toBe(200);
  const studentView = await request(
    `/activities/${draft.id}/exercises/${published.data.exercises[0].id}`,
    { actor: student },
  );
  expect(studentView.status).toBe(200);
  expect(
    contracts.studentExerciseSchema.safeParse(studentView.data).success,
  ).toBe(true);
  expect(studentView.data.tests).toEqual([definition().tests[0]]);
  expect(JSON.stringify(studentView)).not.toContain(PRIVATE_SENTINEL);
  const privateRead = await request(`/exercises/${exercise.id}/versions`, {
    actor: student,
  });
  expect([403, 404]).toContain(privateRead.status);
  expect(JSON.stringify(privateRead)).not.toContain(PRIVATE_SENTINEL);
  const invalid = definition();
  invalid.tests[1].id = '';
  const fieldError = await request(`/exercises/${exercise.id}/versions`, {
    actor: teacher,
    method: 'POST',
    revision: exercise.revision,
    body: invalid,
  });
  expect(fieldError.status).toBe(422);
  expect(
    fieldError.error.fields.some((field) => field.field === 'tests.1.id'),
  ).toBe(true);
  expect(JSON.stringify(fieldError)).not.toContain(PRIVATE_SENTINEL);
  const archived = await request(`/exercises/${exercise.id}/archive`, {
    method: 'POST',
    revision: exercise.revision,
    body: { reason: 'Retirar nuevas asignaciones sin alterar publicaciones' },
  });
  expect(archived.status).toBe(200);
  expect(archived.data.state).toBe('ARCHIVED');
  const retained = await request(
    `/activities/${draft.id}/exercises/${published.data.exercises[0].id}`,
    { actor: student },
  );
  expect(retained.status).toBe(200);
  expect(retained.data.canEdit).toBe(true);
  expect(retained.data.activityState).toBe('PUBLISHED');
  expect(retained.data.exerciseVersionId).toBe(exercise.currentVersionId);
  expect(retained.data.starterCode).toBe(studentView.data.starterCode);
  expect(retained.data.tests).toEqual(studentView.data.tests);
  const unavailable = await request(`/classes/${classroom.id}/activities`, {
    actor: teacher,
    method: 'POST',
    body: {
      title: 'Asignación no permitida',
      instructions: 'No publicar',
      type: 'FORMATIVE',
      opensAt: null,
      closesAt: null,
      exercises: [
        {
          exerciseVersionId: exercise.currentVersionId,
          position: 0,
          required: true,
        },
      ],
    },
  });
  expect(unavailable.status).toBe(422);
  expect(
    unavailable.error.fields.some((field) => field.field === 'exercises'),
  ).toBe(true);
});

test('RF004/023 recupera la definición completa, conserva versiones de conceptos y respeta JSON de 65535 bytes', async () => {
  const input = definition();
  input.title = 'Frontera JSON de autoría';
  input.tests[1].args = [1e-7, 'x'.repeat(65526)];
  input.tests[1].expected = [1e-7, 'y'.repeat(65526)];
  expect(Buffer.byteLength(JSON.stringify(input.tests[1].args))).toBe(65535);
  expect(Buffer.byteLength(JSON.stringify(input.tests[1].expected))).toBe(
    65535,
  );
  expect(Buffer.byteLength(JSON.stringify(input))).toBeGreaterThan(32768);
  const created = await request(`/organizations/${organization.id}/exercises`, {
    actor: teacher,
    method: 'POST',
    body: input,
  });
  expect(created.status).toBe(201);
  const recovered = await request(`/exercises/${created.data.id}/versions`, {
    actor: teacher,
  });
  expect(recovered.status).toBe(200);
  expect(
    contracts.exerciseVersionSchema.safeParse(recovered.data[0]).success,
  ).toBe(true);
  const { id, exerciseId, version, createdAt, ...completeDefinition } =
    recovered.data[0];
  expect(id).toBe(created.data.currentVersionId);
  expect(exerciseId).toBe(created.data.id);
  expect(version).toBe(1);
  expect(Number.isFinite(Date.parse(createdAt))).toBe(true);
  expect(completeDefinition).toEqual(input);
  const stored = (
    await pool.query(
      "SELECT octet_length(args::text)::int args_bytes,octet_length(expected::text)::int expected_bytes FROM app_private.exercise_tests WHERE exercise_version_id=$1 AND test_id='hidden'",
      [created.data.currentVersionId],
    )
  ).rows[0];
  expect(stored).toEqual({ args_bytes: 65535, expected_bytes: 65535 });
  const excessive = JSON.parse(JSON.stringify(input));
  excessive.tests[1].args[1] += 'xx';
  const rejected = await request(
    `/organizations/${organization.id}/exercises`,
    {
      actor: teacher,
      method: 'POST',
      body: excessive,
    },
  );
  expect(rejected.status).toBe(422);
  expect(
    rejected.error.fields.some((field) => field.field === 'tests.1.args'),
  ).toBe(true);
  const edited = await request(`/concepts/${concept.id}`, {
    method: 'PATCH',
    revision: concept.revision,
    body: {
      name: 'Concepto adversarial revisado',
      description: 'Descripción versionada nueva',
    },
  });
  expect(edited.status).toBe(200);
  expect(edited.data.currentVersionId).not.toBe(concept.currentVersionId);
  expect(edited.data.revision).toBe(concept.revision + 1);
  const versions = (
    await pool.query(
      'SELECT id,version,name,description FROM app.concept_versions WHERE concept_id=$1 ORDER BY version',
      [concept.id],
    )
  ).rows;
  expect(versions).toEqual([
    {
      id: concept.currentVersionId,
      version: 1,
      name: concept.name,
      description: concept.description,
    },
    {
      id: edited.data.currentVersionId,
      version: 2,
      name: 'Concepto adversarial revisado',
      description: 'Descripción versionada nueva',
    },
  ]);
  const audit = (
    await pool.query(
      "SELECT safe_changes FROM app.audit_events WHERE organization_id=$1 AND entity_id=$2 AND action='concept.version.created'",
      [organization.id, concept.id],
    )
  ).rows;
  expect(audit).toEqual([
    { safe_changes: { versionId: edited.data.currentVersionId } },
  ]);
  const savedExercise = await request(
    `/exercises/${created.data.id}/versions`,
    { actor: teacher },
  );
  expect(savedExercise.status).toBe(200);
  expect(savedExercise.data[0].conceptVersionIds).toEqual([
    concept.currentVersionId,
  ]);
});
