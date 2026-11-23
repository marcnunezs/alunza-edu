/* eslint @typescript-eslint/no-require-imports: "off" */
const { readFileSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const { URLSearchParams } = require('node:url');
const c = require('@alunza/contracts');
let harness, scope;
const base = () => `/organizations/${scope.organizationId}/exercise-bank`;
const detail = () => `/exercises/${scope.exerciseId}/governance`;
const qs = (params) => new URLSearchParams(params).toString();
async function read(path, schema, options) {
  const response = await harness.request(scope, path, options);
  expect(response.status).toBe(200);
  expect(response.noStore).toBe(true);
  schema.parse(response.body);
  const json = JSON.stringify(response.data);
  for (const forbidden of [
    'email',
    'starterCode',
    'statement',
    'tests',
    'expected',
    'args',
    'studentId',
    'technicalResult',
    'module.exports',
  ])
    expect(json).not.toContain(`"${forbidden}"`);
  return response.data;
}
beforeAll(async () => {
  if (process.env.ALUNZA_TEST_API_URL !== 'http://127.0.0.1:4300')
    throw new Error('Bank integration requires isolated LAB TEST.');
  const state = JSON.parse(readFileSync(process.env.ALUNZA_TEST_STATE, 'utf8'));
  const { createExerciseBankHarness } =
    await import('../e2e/exercise-bank-fixture.mjs');
  harness = await createExerciseBankHarness(state);
  scope = await harness.prepare();
}, 90000);
afterAll(async () => {
  await harness?.close();
});

test('RF024 lectura: banco y conteos completos, sin multiplicación por conceptos', async () => {
  const result = await read(
    `${base()}?limit=20`,
    c.exerciseBankListResponseSchema,
  );
  expect(result.items).toHaveLength(20);
  expect(result.page.totalFiltered).toBe(scope.oracle.exercises);
  expect(result.page.hasMore).toBe(true);
  const next = await read(
    `${base()}?${qs({ limit: 20, cursor: result.page.nextCursor })}`,
    c.exerciseBankListResponseSchema,
  );
  expect(next.page.totalFiltered).toBe(scope.oracle.exercises);
  expect(new Set([...result.items, ...next.items].map((x) => x.id)).size).toBe(
    scope.oracle.exercises,
  );
  const item = await read(detail(), c.exerciseBankDetailResponseSchema);
  expect(item.owner.id).toBe(scope.teacherId);
  expect(item.currentVersion.id).toBe(scope.currentVersionId);
  expect(item.versionCount).toBe(scope.oracle.versions);
  expect(item.useCounts).toEqual(scope.oracle.useCounts);
});

test('RF024 historia: versión actual independiente de páginas e historia fijada', async () => {
  const first = await read(
    `${detail()}/versions?limit=20`,
    c.exerciseBankVersionsResponseSchema,
  );
  expect(first.page.totalFiltered).toBe(25);
  expect(first.items[0].id).toBe(scope.currentVersionId);
  const next = await read(
    `${detail()}/versions?${qs({ limit: 20, cursor: first.page.nextCursor })}`,
    c.exerciseBankVersionsResponseSchema,
  );
  expect(next.items).toHaveLength(5);
  expect(next.items.map((v) => v.version)).toEqual([5, 4, 3, 2, 1]);
  expect(
    (await read(detail(), c.exerciseBankDetailResponseSchema)).currentVersion
      .id,
  ).toBe(scope.currentVersionId);
  expect(next.items.at(-1).concepts.length).toBeGreaterThan(0);
  expect(next.items.at(-1).concepts[0].name).toBe('Variables banco');
  expect(next.items.at(-1).concepts[0].version).toBe(1);
});

test('RF024 usos: asignaciones por versión y filtro antes de contar/paginar', async () => {
  const all = await read(
    `${detail()}/uses?limit=100`,
    c.exerciseBankUsesResponseSchema,
  );
  expect(all.page.totalFiltered).toBe(25);
  expect(all.items).toHaveLength(25);
  expect(new Set(all.items.map((u) => u.activity.id)).size).toBe(24);
  const counts = scope.oracle.useCounts;
  for (const state of ['DRAFT', 'PUBLISHED', 'CLOSED']) {
    const filtered = await read(
      `${detail()}/uses?${qs({ activityState: state, limit: 1 })}`,
      c.exerciseBankUsesResponseSchema,
    );
    expect(filtered.items).toHaveLength(1);
    expect(filtered.items[0].activity.state).toBe(state);
    expect(filtered.page.totalFiltered).toBe(counts[state.toLowerCase()]);
  }
  const version = all.items[0].exerciseVersionId;
  const filtered = await read(
    `${detail()}/uses?${qs({ versionId: version })}`,
    c.exerciseBankUsesResponseSchema,
  );
  expect(filtered.page.totalFiltered).toBe(
    all.items.filter((u) => u.exerciseVersionId === version).length,
  );
});

test('RF024 filtros y vacío no fabrican registros ni aceptan ámbito arbitrario', async () => {
  const item = await read(detail(), c.exerciseBankDetailResponseSchema);
  const valid = {
    search: item.currentVersion.title,
    difficulty: item.currentVersion.difficulty,
    visibility: item.visibility,
    state: item.state,
    conceptId: item.currentVersion.concepts[0].id,
  };
  const filtered = await read(
    `${base()}?${qs(valid)}`,
    c.exerciseBankListResponseSchema,
  );
  expect(filtered.items.map((x) => x.id)).toContain(scope.exerciseId);
  const empty = await read(
    `${base()}?search=NONEXISTENT_BANK_QUERY_7428`,
    c.exerciseBankListResponseSchema,
  );
  expect(empty.items).toEqual([]);
  expect(empty.page).toEqual({
    hasMore: false,
    nextCursor: null,
    totalFiltered: 0,
  });
  for (const query of [
    'limit=101',
    'state=DISABLED',
    'visibility=PUBLIC',
    'conceptId=invalid',
    'cursor=unsafe%2Fcursor',
    'includeTests=true',
  ]) {
    const result = await harness.request(scope, `${base()}?${query}`);
    expect(result.status).toBe(422);
  }
  const first = await read(
    `${base()}?limit=1`,
    c.exerciseBankListResponseSchema,
  );
  expect(
    (
      await harness.request(
        scope,
        `${base()}?${qs({ limit: 1, cursor: first.page.nextCursor, search: 'changed' })}`,
      )
    ).status,
  ).toBe(422);
  expect(
    (
      await harness.request(
        scope,
        `${detail()}/uses?${qs({ cursor: first.page.nextCursor })}`,
      )
    ).status,
  ).toBe(422);
});

test('RF024-E3: roles y ámbitos ajenos son rechazados sin contenido', async () => {
  for (const authorization of ['', 'Bearer invalid-token']) {
    const result = await harness.request(scope, base(), {
      headers: { Authorization: authorization },
    });
    expect(result.status).toBe(401);
    expect(result.data).toBeUndefined();
  }
  for (const actor of ['teacher', 'student', 'foreignAdmin']) {
    for (const path of [
      base(),
      detail(),
      `${detail()}/versions`,
      `${detail()}/uses`,
    ]) {
      const result = await harness.request(scope, path, { actor });
      expect([403, 404]).toContain(result.status);
      expect(result.data).toBeUndefined();
    }
  }
  const other = await harness.request(
    scope,
    `/exercises/${scope.foreignExerciseId}/governance`,
  );
  const absent = await harness.request(
    scope,
    `/exercises/${randomUUID()}/governance`,
  );
  expect(other.status).toBe(404);
  expect(absent.status).toBe(404);
  expect(other.body.error.code).toBe(absent.body.error.code);
});

test('consultas preservan filas y un propietario deshabilitado sigue identificable', async () => {
  const before = await harness.snapshot(scope);
  await read(base(), c.exerciseBankListResponseSchema);
  await read(detail(), c.exerciseBankDetailResponseSchema);
  await read(`${detail()}/versions`, c.exerciseBankVersionsResponseSchema);
  await read(`${detail()}/uses`, c.exerciseBankUsesResponseSchema);
  expect(await harness.snapshot(scope)).toEqual(before);
  await harness.revoke(scope, { actor: 'teacher' });
  try {
    expect(
      (await read(detail(), c.exerciseBankDetailResponseSchema)).owner.id,
    ).toBe(scope.teacherId);
  } finally {
    await harness.revoke(scope, { actor: 'teacher', restore: true });
  }
});

test('revocación invalida JWT previo y archivo conserva lectura administrativa', async () => {
  await harness.revoke(scope, { actor: 'admin' });
  try {
    for (const path of [base(), detail(), `${detail()}/uses`])
      expect([403, 404]).toContain((await harness.request(scope, path)).status);
  } finally {
    await harness.revoke(scope, { actor: 'admin', restore: true });
  }
  await harness.archive(scope);
  const archived = await read(detail(), c.exerciseBankDetailResponseSchema);
  expect(archived.state).toBe('ARCHIVED');
  expect(archived.useCounts).toEqual(scope.oracle.useCounts);
  expect(
    (await read(base(), c.exerciseBankListResponseSchema)).page.totalFiltered,
  ).toBe(25);
});
