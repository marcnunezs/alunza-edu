/* eslint @typescript-eslint/no-require-imports: "off" */
const { randomUUID, createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { Client } = require('pg');
const { fixture, exerciseInput, accounts } = require('../academic-fixture.cjs');
const contracts = require('@alunza/contracts');
let state, base, db;
beforeAll(async () => {
  state = JSON.parse(readFileSync(process.env.ALUNZA_TEST_STATE, 'utf8'));
  base = process.env.ALUNZA_TEST_API_URL;
  if (base !== 'http://127.0.0.1:4100')
    throw new Error('Destino académico de pruebas inválido.');
  db = new Client({ connectionString: state.migrationUrl });
  await db.connect();
});
afterAll(async () => {
  await db?.end();
});
const prepare = (options) => fixture(state, base, options);
const mutation = (body = {}, revision) => ({
  method: 'POST',
  body,
  revision,
  key: randomUUID(),
});
const reject = (result, statuses = [403, 404]) => {
  expect(statuses).toContain(result.status);
  expect(result.data).toBeUndefined();
  expect(result.error.message).toBeTruthy();
};

describe('IMP-02 · estructura y pertenencia reales', () => {
  test('HU-022 E4: docente activo de otra organización no puede ser asignado', async () => {
    const f = await prepare({ content: false });
    await db.query(
      'DELETE FROM app.organization_memberships WHERE organization_id=$1 AND user_id=$2',
      [f.organization.id, accounts.secondTeacher.id],
    );
    const foreign = await db.query(
      'SELECT role,state FROM app.organization_memberships WHERE organization_id=$1 AND user_id=$2',
      [f.organization.foreignId, accounts.secondTeacher.id],
    );
    expect(foreign.rows[0]).toMatchObject({ role: 'TEACHER', state: 'ACTIVE' });
    reject(
      await f.api('admin', `/classes/${f.classroom.id}/teacher`, {
        method: 'PUT',
        body: { teacherId: accounts.secondTeacher.id },
        revision: f.classroom.revision,
      }),
      [400, 403, 404, 422],
    );
    expect(
      (await f.api('teacher', `/classes/${f.classroom.id}`)).data.teacherId,
    ).toBe(accounts.teacher.id);
  });
  test('HU-022 E1 / HU-002 E1: crear, configurar y recuperar curso y clase con autor docente', async () => {
    const f = await prepare({ content: false });
    const course = await f.api('admin', `/courses/${f.course.id}`);
    expect(course.status).toBe(200);
    expect(course.data.academicPeriod).toBe('2026-2');
    const updated = await f.api('teacher', `/classes/${f.classroom.id}`, {
      method: 'PATCH',
      body: { name: 'Clase actualizada' },
      revision: f.classroom.revision,
    });
    expect(updated.status).toBe(200);
    const recovered = await f.api('teacher', `/classes/${f.classroom.id}`);
    expect(recovered.data).toMatchObject({
      name: 'Clase actualizada',
      courseId: f.course.id,
      teacherId: accounts.teacher.id,
    });
    expect(recovered.etag).toBe(`"${recovered.data.revision}"`);
    const duplicate = await f.api('teacher', `/classes/${f.classroom.id}`, {
      method: 'PATCH',
      body: { name: 'Cambio antiguo' },
      revision: f.classroom.revision,
    });
    reject(duplicate, [412]);
    expect(
      (await f.api('teacher', `/classes/${f.classroom.id}`)).data.name,
    ).toBe('Clase actualizada');
  });
  test('HU-022 E2 / HU-002 E2: obligatorios, duplicados, fechas y docente inactivo se rechazan', async () => {
    const f = await prepare({ content: false });
    const courses = `/organizations/${f.organization.id}/courses`;
    const classes = `/organizations/${f.organization.id}/classes`;
    for (const body of [
      { code: 'PROG1', name: 'Duplicado', academicPeriod: '2026' },
      {
        code: 'BAD-DATE',
        name: 'Fechas',
        academicPeriod: '2026',
        startDate: '2026-12-31',
        endDate: '2026-01-01',
      },
    ])
      reject(await f.api('admin', courses, mutation(body)), [400, 409, 422]);
    for (const body of [
      { courseId: f.course.id, code: 'BAD' },
      { name: 'Sin curso', code: 'BAD' },
      { courseId: f.course.id, code: 'BAD', name: '' },
    ])
      reject(await f.api('teacher', classes, mutation(body)), [400, 422]);
    await db.query(
      "UPDATE app.organization_memberships SET state='DISABLED' WHERE organization_id=$1 AND user_id=$2",
      [f.organization.id, accounts.secondTeacher.id],
    );
    reject(
      await f.api('admin', `/classes/${f.classroom.id}/teacher`, {
        method: 'PUT',
        body: { teacherId: accounts.secondTeacher.id },
        revision: f.classroom.revision,
      }),
      [400, 403, 404, 409, 422],
    );
    expect(
      (await f.api('teacher', `/classes/${f.classroom.id}`)).data.teacherId,
    ).toBe(accounts.teacher.id);
  });
  test('HU-022 E3/E4 / HU-002 E3: rol insuficiente, curso ajeno y asignación ajena no alteran relaciones', async () => {
    const f = await prepare({ content: false });
    reject(
      await f.api(
        'student',
        `/organizations/${f.organization.id}/classes`,
        mutation({
          courseId: f.course.id,
          name: 'Intrusión',
          code: 'INTRUSION',
        }),
      ),
    );
    reject(
      await f.api('secondTeacher', `/classes/${f.classroom.id}`, {
        method: 'PATCH',
        body: { name: 'Intrusión' },
        revision: f.classroom.revision,
      }),
    );
    reject(
      await f.api('teacher', `/classes/${f.classroom.id}/teacher`, {
        method: 'PUT',
        body: { teacherId: accounts.secondTeacher.id },
        revision: f.classroom.revision,
      }),
    );
    reject(
      await f.api('admin', `/classes/${f.classroom.id}/teacher`, {
        method: 'PUT',
        body: { teacherId: accounts.foreignAdmin.id },
        revision: f.classroom.revision,
      }),
      [400, 403, 404, 422],
    );
    reject(
      await f.api(
        'foreignAdmin',
        `/organizations/${f.organization.id}/courses`,
      ),
    );
    expect(
      (await f.api('teacher', `/classes/${f.classroom.id}`)).data.name,
    ).toBe('Clase de prueba');
    // Reassignment revokes the old teacher immediately even with its existing JWT.
    const assigned = await f.api(
      'admin',
      `/classes/${f.classroom.id}/teacher`,
      {
        method: 'PUT',
        body: { teacherId: accounts.secondTeacher.id },
        revision: f.classroom.revision,
      },
    );
    expect(assigned.status).toBe(200);
    reject(await f.api('teacher', `/classes/${f.classroom.id}`));
    expect(
      (await f.api('secondTeacher', `/classes/${f.classroom.id}`)).status,
    ).toBe(200);
  });
  test('HU-002 E4: archivar conserva relaciones, revoca códigos y bloquea operaciones', async () => {
    const f = await prepare({ published: false });
    const before = await db.query(
      'SELECT count(*)::int count FROM app.class_memberships WHERE class_id=$1',
      [f.classroom.id],
    );
    const archived = await f.api(
      'admin',
      `/classes/${f.classroom.id}/archive`,
      mutation({}, f.classroom.revision),
    );
    expect(archived.status).toBe(200);
    reject(
      await f.api('teacher', `/classes/${f.classroom.id}`, {
        method: 'PATCH',
        body: { name: 'Prohibido' },
        revision: archived.data.revision,
      }),
      [403, 404, 409],
    );
    reject(
      await f.api(
        'teacher',
        `/classes/${f.classroom.id}/join-codes`,
        mutation({}),
      ),
      [403, 404, 409],
    );
    reject(
      await f.api(
        'secondStudent',
        '/class-enrollments',
        mutation({ organizationId: f.organization.id, code: f.joinCode.code }),
      ),
      [400, 403, 404, 409, 422],
    );
    const after = await db.query(
      'SELECT count(*)::int count FROM app.class_memberships WHERE class_id=$1',
      [f.classroom.id],
    );
    expect(after.rows).toEqual(before.rows);
    const codes = await db.query(
      'SELECT revoked_at FROM app.class_join_codes WHERE class_id=$1',
      [f.classroom.id],
    );
    expect(codes.rows.every((c) => c.revoked_at !== null)).toBe(true);
    expect(
      (await f.api('teacher', `/activities/${f.activity.id}`)).data?.state,
    ).toBe('DRAFT');
  });
  test('HU-003 E1: confirmar incorpora y habilita únicamente la clase y publicación propia', async () => {
    const f = await prepare({ enroll: false });
    const input = { organizationId: f.organization.id, code: f.joinCode.code };
    const preview = await f.api(
      'student',
      '/class-enrollments/preview',
      mutation(input),
    );
    expect(preview.status).toBe(200);
    expect(preview.data.classId).toBe(f.classroom.id);
    expect(
      (
        await db.query(
          'SELECT count(*)::int count FROM app.class_memberships WHERE class_id=$1 AND user_id=$2',
          [f.classroom.id, accounts.student.id],
        )
      ).rows[0].count,
    ).toBe(0);
    const enrollment = await f.api(
      'student',
      '/class-enrollments',
      mutation(input),
    );
    expect([200, 201]).toContain(enrollment.status);
    expect(enrollment.data.classId).toBe(f.classroom.id);
    const classes = await f.api(
      'student',
      `/organizations/${f.organization.id}/classes`,
    );
    expect(classes.data.map((c) => c.id)).toEqual([f.classroom.id]);
    expect(
      (
        await f.api('student', `/classes/${f.classroom.id}/activities`)
      ).data.map((a) => a.id),
    ).toEqual([f.activity.id]);
  });
  test('HU-003 E2/E3: código inválido o ajeno no filtra metadatos ni crea membresía', async () => {
    const f = await prepare({ content: false, enroll: false });
    for (const body of [
      { organizationId: f.organization.id, code: '' },
      { organizationId: f.organization.id, code: 'CODIGOINVALIDO' },
      { organizationId: f.organization.foreignId, code: f.joinCode.code },
    ]) {
      const result = await f.api(
        'student',
        '/class-enrollments',
        mutation(body),
      );
      reject(result, [400, 403, 404, 409, 422]);
      expect(JSON.stringify(result)).not.toContain('Clase de prueba');
    }
    expect(
      (
        await db.query(
          'SELECT count(*)::int count FROM app.class_memberships WHERE class_id=$1 AND user_id=$2',
          [f.classroom.id, accounts.student.id],
        )
      ).rows[0].count,
    ).toBe(0);
  });
  test('HU-003 E4: duplicado y carrera mantienen una membresía; vencido y revocado bloquean usos nuevos', async () => {
    const f = await prepare({ content: false, enroll: false });
    const body = { organizationId: f.organization.id, code: f.joinCode.code };
    const results = await Promise.all([
      f.api('student', '/class-enrollments', mutation(body)),
      f.api('student', '/class-enrollments', mutation(body)),
    ]);
    expect(results.every((r) => [200, 201].includes(r.status))).toBe(true);
    expect(results[0].data.id).toBe(results[1].data.id);
    expect(
      (
        await db.query(
          'SELECT count(*)::int count FROM app.class_memberships WHERE class_id=$1 AND user_id=$2',
          [f.classroom.id, accounts.student.id],
        )
      ).rows[0].count,
    ).toBe(1);
    const expiredCode = 'EXPIRED1234567890';
    await db.query(
      "INSERT INTO app.class_join_codes(organization_id,class_id,token_digest,created_by,created_at,expires_at) VALUES($1,$2,$3,$4,now()-interval '2 days',now()-interval '1 day')",
      [
        f.organization.id,
        f.classroom.id,
        createHash('sha256').update(expiredCode).digest('hex'),
        accounts.teacher.id,
      ],
    );
    reject(
      await f.api(
        'secondStudent',
        '/class-enrollments',
        mutation({ ...body, code: expiredCode }),
      ),
      [400, 404, 409, 422],
    );
    const code = await f.create(
      'teacher',
      `/classes/${f.classroom.id}/join-codes`,
      {},
    );
    const revoked = await f.api(
      'teacher',
      `/classes/${f.classroom.id}/join-codes/${code.id}/revoke`,
      mutation({}, code.revision),
    );
    expect(revoked.status).toBe(200);
    reject(
      await f.api(
        'secondStudent',
        '/class-enrollments',
        mutation({ ...body, code: code.code }),
      ),
      [400, 404, 409, 422],
    );
  });
});

describe('IMP-02 · taxonomía y banco versionado', () => {
  test('HU-023 E1/E4: editar y archivar conserva versión y referencias de publicaciones', async () => {
    const f = await prepare();
    const next = await f.create(
      'teacher',
      `/classes/${f.classroom.id}/activities`,
      {
        title: 'Nueva publicación',
        type: 'FORMATIVE',
        exercises: [
          {
            exerciseVersionId: f.exercise.currentVersionId,
            position: 0,
            required: true,
          },
        ],
      },
    );
    const edited = await f.api('admin', `/concepts/${f.concept.id}`, {
      method: 'PATCH',
      body: { name: 'Variables actualizadas' },
      revision: f.concept.revision,
    });
    expect(edited.status).toBe(200);
    expect(edited.data.version).toBe(2);
    expect(edited.data.currentVersionId).not.toBe(f.concept.currentVersionId);
    const versions = await f.api('admin', `/concepts/${f.concept.id}/versions`);
    expect(versions.data.map((v) => v.name)).toEqual(
      expect.arrayContaining(['Variables', 'Variables actualizadas']),
    );
    const archived = await f.api(
      'admin',
      `/concepts/${f.concept.id}/archive`,
      mutation({}, edited.data.revision),
    );
    expect(archived.status).toBe(200);
    const opened = await f.api(
      'student',
      `/activities/${f.activity.id}/exercises/${f.activity.exercises[0].id}`,
    );
    expect(opened.status).toBe(200);
    expect(opened.data.concepts[0].name).toBe('Variables');
    reject(
      await f.api(
        'teacher',
        `/activities/${next.id}/publish`,
        mutation({}, next.revision),
      ),
      [400, 409, 422],
    );
  });
  test('HU-023 E2: nombre normalizado duplicado, autorreferencia y ciclo indirecto son atómicos', async () => {
    const f = await prepare();
    reject(
      await f.api(
        'admin',
        `/organizations/${f.organization.id}/concepts`,
        mutation({ name: '  VARIABLES  ', description: '' }),
      ),
      [409, 422],
    );
    reject(
      await f.api('admin', `/concepts/${f.concept.id}`, {
        method: 'PATCH',
        body: { parentId: f.concept.id },
        revision: f.concept.revision,
      }),
      [400, 409, 422],
    );
    const child = await f.create(
      'admin',
      `/organizations/${f.organization.id}/concepts`,
      { name: 'Asignación', parentId: f.concept.id },
    );
    reject(
      await f.api('admin', `/concepts/${f.concept.id}`, {
        method: 'PATCH',
        body: { parentId: child.id },
        revision: f.concept.revision,
      }),
      [400, 409, 422],
    );
    expect(
      (
        await f.api('admin', `/organizations/${f.organization.id}/concepts`)
      ).data.find((c) => c.id === f.concept.id).version,
    ).toBe(1);
  });
  test('HU-023 E3: taxonomía ajena y mutación docente denegadas', async () => {
    const f = await prepare();
    reject(
      await f.api(
        'foreignAdmin',
        `/organizations/${f.organization.id}/concepts`,
      ),
    );
    reject(
      await f.api('teacher', `/concepts/${f.concept.id}`, {
        method: 'PATCH',
        body: { name: 'Intrusión' },
        revision: f.concept.revision,
      }),
    );
    reject(
      await f.api(
        'student',
        `/organizations/${f.organization.id}/concepts`,
        mutation({ name: 'Intrusión' }),
      ),
    );
  });
  test('HU-004 E1: ejercicio íntegro recuperable y edición crea versión sin reescribir publicación', async () => {
    const f = await prepare();
    const recovered = await f.api('teacher', `/exercises/${f.exercise.id}`);
    expect(recovered.status).toBe(200);
    expect(
      contracts.exerciseResponseSchema.safeParse({
        data: recovered.data,
        requestId: recovered.requestId,
      }).success,
    ).toBe(true);
    expect(recovered.data.currentVersion.tests).toHaveLength(2);
    expect(recovered.data.currentVersion).toMatchObject(
      exerciseInput(f.concept.currentVersionId),
    );
    const edited = await f.api(
      'teacher',
      `/exercises/${f.exercise.id}/versions`,
      mutation(
        exerciseInput(f.concept.currentVersionId, {
          title: 'Suma revisada',
          statement: 'Una nueva consigna.',
        }),
        f.exercise.revision,
      ),
    );
    expect([200, 201]).toContain(edited.status);
    const versions = await f.api(
      'teacher',
      `/exercises/${f.exercise.id}/versions`,
    );
    expect(versions.data).toHaveLength(2);
    const opened = await f.api(
      'student',
      `/activities/${f.activity.id}/exercises/${f.activity.exercises[0].id}`,
    );
    expect(opened.data.exerciseVersionId).toBe(f.exercise.currentVersionId);
    expect(opened.data.statement).toBe(
      'Implementa solve(a, b) y retorna la suma.',
    );
  });
  test('HU-004 E2: enunciado, tests, conceptos y límites inválidos no se guardan', async () => {
    const f = await prepare();
    const route = `/organizations/${f.organization.id}/exercises`;
    const invalid = [
      { statement: '' },
      { tests: [] },
      {
        tests: [{ visibility: 'VISIBLE', args: [], comparator: 'EXECUTE_JS' }],
      },
      {
        executionLimits: {
          memoryBytes: 134217729,
          timeoutMs: 3000,
          outputBytes: 65536,
        },
      },
      {
        executionLimits: {
          memoryBytes: 134217728,
          timeoutMs: 3001,
          outputBytes: 65536,
        },
      },
      { conceptVersionIds: [] },
      { starterCode: 'é'.repeat(40000) },
    ];
    for (const override of invalid)
      reject(
        await f.api(
          'teacher',
          route,
          mutation(exerciseInput(f.concept.currentVersionId, override)),
        ),
        [400, 413, 422],
      );
    expect((await f.api('teacher', route)).data).toHaveLength(1);
  });
  test('HU-004 E3: otro docente no edita propiedad ni una versión ajena', async () => {
    const f = await prepare();
    reject(
      await f.api(
        'secondTeacher',
        `/exercises/${f.exercise.id}/versions`,
        mutation(
          exerciseInput(f.concept.currentVersionId),
          f.exercise.revision,
        ),
      ),
    );
    reject(await f.api('foreignAdmin', `/exercises/${f.exercise.id}`));
    expect(
      (await f.api('teacher', `/exercises/${f.exercise.id}/versions`)).data,
    ).toHaveLength(1);
  });
  test('HU-004 E4 / HU-008 E1/E3: proyección estudiantil estricta, sin pruebas ocultas ni acceso ajeno', async () => {
    const f = await prepare();
    const path = `/activities/${f.activity.id}/exercises/${f.activity.exercises[0].id}`;
    const result = await f.api('student', path);
    expect(result.status).toBe(200);
    expect(
      contracts.studentExerciseResponseSchema.safeParse({
        data: result.data,
        requestId: result.requestId,
      }).success,
    ).toBe(true);
    expect(result.data.tests).toHaveLength(1);
    expect(result.data.tests[0].visibility).toBe('VISIBLE');
    expect(JSON.stringify(result)).not.toContain('77711');
    expect(result.cacheControl).toContain('no-store');
    reject(await f.api('student', `/exercises/${f.exercise.id}`));
    reject(await f.api('student', `/exercises/${f.exercise.id}/versions`));
    reject(await f.api('secondStudent', path));
    reject(await f.api('secondTeacher', path));
  });
});

describe('IMP-02 · publicación, disponibilidad y regresiones', () => {
  test('fallo de auditoría revierte publicación y conserva revisión y ejercicios', async () => {
    const f = await prepare({ published: false });
    await db.query(
      'INSERT INTO identity_test_faults.flags(org_id) VALUES($1)',
      [f.organization.id],
    );
    try {
      const result = await f.api(
        'teacher',
        `/activities/${f.activity.id}/publish`,
        mutation({}, f.activity.revision),
      );
      reject(result, [503]);
      const recovered = await f.api('teacher', `/activities/${f.activity.id}`);
      expect(recovered.data.state).toBe('DRAFT');
      expect(recovered.data.revision).toBe(f.activity.revision);
      expect(recovered.data.exercises).toEqual(f.activity.exercises);
    } finally {
      await db.query('DELETE FROM identity_test_faults.flags WHERE org_id=$1', [
        f.organization.id,
      ]);
    }
  });
  test('HU-005 E1/E2/E3: orden estable, publicación inválida atómica y ADMIN no publica', async () => {
    const f = await prepare({ published: false });
    const second = await f.create(
      'teacher',
      `/organizations/${f.organization.id}/exercises`,
      exerciseInput(f.concept.currentVersionId, { title: 'Segundo ejercicio' }),
    );
    const edited = await f.api('teacher', `/activities/${f.activity.id}`, {
      method: 'PATCH',
      body: {
        exercises: [
          {
            exerciseVersionId: second.currentVersionId,
            position: 0,
            required: true,
          },
          {
            exerciseVersionId: f.exercise.currentVersionId,
            position: 1,
            required: true,
          },
        ],
      },
      revision: f.activity.revision,
    });
    expect(edited.status).toBe(200);
    reject(
      await f.api(
        'admin',
        `/activities/${f.activity.id}/publish`,
        mutation({}, edited.data.revision),
      ),
    );
    const result = await f.api(
      'teacher',
      `/activities/${f.activity.id}/publish`,
      mutation({}, edited.data.revision),
    );
    expect(result.status).toBe(200);
    expect(result.data.exercises.map((e) => e.title)).toEqual([
      'Segundo ejercicio',
      'Sumar dos valores',
    ]);
    const empty = await f.create(
      'teacher',
      `/classes/${f.classroom.id}/activities`,
      { title: 'Vacía', type: 'FORMATIVE', exercises: [] },
    );
    reject(
      await f.api(
        'teacher',
        `/activities/${empty.id}/publish`,
        mutation({}, empty.revision),
      ),
      [400, 409, 422],
    );
    expect((await f.api('teacher', `/activities/${empty.id}`)).data.state).toBe(
      'DRAFT',
    );
    reject(
      await f.api(
        'admin',
        `/classes/${f.classroom.id}/archive`,
        mutation({}, f.classroom.revision),
      ),
      [409],
    );
    reject(
      await f.api(
        'admin',
        `/courses/${f.course.id}/archive`,
        mutation({}, f.course.revision),
      ),
      [409],
    );
  });
  test('HU-008 E2/E4: ID inválido, ventana de fechas y cierre bloquean resolución', async () => {
    const f = await prepare();
    const path = `/activities/${f.activity.id}/exercises/${f.activity.exercises[0].id}`;
    reject(
      await f.api(
        'student',
        `/activities/not-a-uuid/exercises/${f.activity.exercises[0].id}`,
      ),
      [400, 404, 422],
    );
    const future = await f.create(
      'teacher',
      `/classes/${f.classroom.id}/activities`,
      {
        title: 'Futura',
        type: 'FORMATIVE',
        opensAt: new Date(Date.now() + 86400000).toISOString(),
        closesAt: new Date(Date.now() + 172800000).toISOString(),
        exercises: [
          {
            exerciseVersionId: f.exercise.currentVersionId,
            position: 0,
            required: true,
          },
        ],
      },
    );
    const futurePublished = await f.api(
      'teacher',
      `/activities/${future.id}/publish`,
      mutation({}, future.revision),
    );
    expect(futurePublished.status).toBe(200);
    reject(
      await f.api(
        'student',
        `/activities/${future.id}/exercises/${futurePublished.data.exercises[0].id}`,
      ),
      [403, 404, 409],
    );
    const past = await f.create(
      'teacher',
      `/classes/${f.classroom.id}/activities`,
      {
        title: 'Vencida',
        type: 'FORMATIVE',
        opensAt: '2020-01-01T00:00:00Z',
        closesAt: '2020-01-02T00:00:00Z',
        exercises: [
          {
            exerciseVersionId: f.exercise.currentVersionId,
            position: 0,
            required: true,
          },
        ],
      },
    );
    const pastPublished = await f.api(
      'teacher',
      `/activities/${past.id}/publish`,
      mutation({}, past.revision),
    );
    expect(pastPublished.status).toBe(200);
    reject(
      await f.api(
        'student',
        `/activities/${past.id}/exercises/${pastPublished.data.exercises[0].id}`,
      ),
      [403, 404, 409],
    );
    const closed = await f.api(
      'teacher',
      `/activities/${f.activity.id}/close`,
      mutation({}, f.activity.revision),
    );
    expect(closed.status).toBe(200);
    expect(closed.data.state).toBe('CLOSED');
    reject(await f.api('student', path), [403, 404, 409]);
    reject(
      await f.api(
        'teacher',
        `/activities/${f.activity.id}/publish`,
        mutation({}, closed.data.revision),
      ),
      [409],
    );
  });
  test('HU-008 E4: archivo de banco mantiene lo publicado y bloquea nuevos borradores al publicar', async () => {
    const f = await prepare();
    const draft = await f.create(
      'teacher',
      `/classes/${f.classroom.id}/activities`,
      {
        title: 'Borrador anterior',
        type: 'FORMATIVE',
        exercises: [
          {
            exerciseVersionId: f.exercise.currentVersionId,
            position: 0,
            required: true,
          },
        ],
      },
    );
    const archived = await f.api(
      'admin',
      `/exercises/${f.exercise.id}/archive`,
      mutation({}, f.exercise.revision),
    );
    expect(archived.status).toBe(200);
    expect(
      (
        await f.api(
          'student',
          `/activities/${f.activity.id}/exercises/${f.activity.exercises[0].id}`,
        )
      ).status,
    ).toBe(200);
    reject(
      await f.api(
        'teacher',
        `/activities/${draft.id}/publish`,
        mutation({}, draft.revision),
      ),
      [400, 409, 422],
    );
    expect((await f.api('teacher', `/activities/${draft.id}`)).data.state).toBe(
      'DRAFT',
    );
  });
  test('RF-001 regresión: deshabilitar membresía retira permisos académicos del JWT anterior', async () => {
    const f = await prepare();
    await db.query(
      "UPDATE app.organization_memberships SET state='DISABLED' WHERE organization_id=$1 AND user_id=$2",
      [f.organization.id, accounts.student.id],
    );
    reject(await f.api('student', `/classes/${f.classroom.id}/activities`));
    reject(
      await f.api(
        'student',
        `/activities/${f.activity.id}/exercises/${f.activity.exercises[0].id}`,
      ),
    );
  });
  test('RF-020 regresión: curso activo impide archivar organización aunque solo quede ADMIN activo', async () => {
    const f = await prepare({ content: false, enroll: false });
    await db.query(
      "UPDATE app.organization_memberships SET state='DISABLED' WHERE organization_id=$1 AND user_id<>$2",
      [f.organization.id, accounts.admin.id],
    );
    const org = await f.api('admin', `/organizations/${f.organization.id}`);
    const result = await f.api(
      'admin',
      `/organizations/${f.organization.id}/archive`,
      mutation(
        { reason: 'Verificar dependencia académica' },
        org.data.revision,
      ),
    );
    reject(result, [409]);
    expect(result.error.code).toBe('DEPENDENCIES_ACTIVE');
    expect(
      (await f.api('admin', `/organizations/${f.organization.id}`)).data.state,
    ).toBe('ACTIVE');
  });
});
