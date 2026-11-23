/* eslint @typescript-eslint/no-require-imports: "off" */
const { readFileSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const c = require('@alunza/contracts');
let harness, scope;
const path = () => `/exercises/${scope.exerciseId}/governance`;
const mutation = (body, revision = 1, options = {}) =>
  harness.request(scope, path(), {
    method: 'PATCH',
    body,
    revision,
    ...options,
  });
async function current() {
  const response = await harness.request(scope, path());
  expect(response.status).toBe(200);
  return c.exerciseBankDetailResponseSchema.parse(response.body).data;
}
function versionInput() {
  return {
    title: 'Versión administrativa nueva',
    statement: 'Devuelve el valor dos.',
    starterCode: 'module.exports.solve=()=>2;',
    language: 'javascript',
    entrypoint: 'solve',
    difficulty: 'INTERMEDIATE',
    conceptVersionIds: [scope.conceptVersionIds[1]],
    tests: [
      { id: 'visible-new', visibility: 'visible', args: [], expected: 2 },
    ],
    executionLimits: {
      memoryBytes: 134217728,
      runtimeMs: 3000,
      outputBytes: 65536,
    },
  };
}
beforeAll(async () => {
  if (process.env.ALUNZA_TEST_API_URL !== 'http://127.0.0.1:4300')
    throw new Error('Gobierno exige LAB TEST.');
  const state = JSON.parse(readFileSync(process.env.ALUNZA_TEST_STATE, 'utf8'));
  const { createBankGovernanceHarness } =
    await import('../e2e/exercise-bank-governance-fixture.mjs');
  harness = createBankGovernanceHarness(state);
}, 90000);
beforeEach(async () => {
  scope = await harness.prepare();
}, 90000);
afterAll(async () => {
  await harness?.close();
});

test('HU024-E1: transfiere propiedad y visibilidad de forma recuperable y auditada', async () => {
  const before = await harness.snapshot(scope);
  const revision = (await current()).revision;
  const key = randomUUID(),
    body = { ownerId: scope.adminId, visibility: 'PRIVATE' };
  const result = await mutation(body, revision, { key });
  expect(result.status).toBe(200);
  expect(result.noStore).toBe(true);
  c.exerciseBankDetailResponseSchema.parse(result.body);
  expect(result.data).toMatchObject({
    owner: { id: scope.adminId },
    visibility: 'PRIVATE',
    revision: revision + 1,
  });
  expect(result.etag).toBe(`"${revision + 1}"`);
  expect(await current()).toMatchObject({
    owner: { id: scope.adminId },
    visibility: 'PRIVATE',
  });
  const replay = await mutation(body, revision, { key });
  expect(replay.status).toBe(200);
  expect(replay.data).toEqual(result.data);
  expect(replay.etag).toBe(result.etag);
  // A distinct, valid request whose fields already match is not a new change.
  const noop = await mutation(body, revision + 1);
  expect(noop.status).toBe(200);
  expect(noop.data.revision).toBe(revision + 1);
  expect(noop.etag).toBe(result.etag);
  await harness.revoke(scope);
  try {
    const deniedReplay = await mutation(body, revision, { key });
    expect([403, 404]).toContain(deniedReplay.status);
    expect(deniedReplay.data).toBeUndefined();
  } finally {
    await harness.revoke({ ...scope, restore: true });
  }
  expect(await harness.snapshot(scope)).toEqual(before);
  const events = await harness.audit(scope);
  expect(events.reduce((total, item) => total + item.count, 0)).toBe(1);
  expect(
    (await mutation({ visibility: 'ORGANIZATION' }, revision, { key })).status,
  ).toBe(409);
});

test('HU024-E2/E3: destino inválido y payload fuera de política no alteran datos ni auditoría', async () => {
  expect(
    (await mutation({ ownerId: scope.adminId }, (await current()).revision))
      .status,
  ).toBe(200);
  const before = await current(),
    history = await harness.snapshot(scope);
  const auditBefore = await harness.audit(scope);
  for (const body of [
    {},
    { visibility: 'PUBLIC' },
    { visibility: 'ORGANIZATION', organizationId: scope.foreignOrganizationId },
    { ownerId: 'invalid' },
  ]) {
    expect((await mutation(body, before.revision)).status).toBe(422);
  }
  for (const ownerId of [scope.studentId, scope.foreignAdminId, randomUUID()]) {
    expect((await mutation({ ownerId }, before.revision)).status).toBe(422);
  }
  await harness.revoke({ ...scope, actor: 'teacher' });
  try {
    expect(
      (await mutation({ ownerId: scope.teacherId }, before.revision)).status,
    ).toBe(422);
  } finally {
    await harness.revoke({ ...scope, actor: 'teacher', restore: true });
  }
  expect(await current()).toMatchObject({
    revision: before.revision,
    owner: before.owner,
    visibility: before.visibility,
    currentVersion: before.currentVersion,
  });
  expect(await harness.snapshot(scope)).toEqual(history);
  expect(await harness.audit(scope)).toEqual(auditBefore);
});

test('HU024-E3: permisos vigentes, ámbito y organización archivada se revalidan', async () => {
  for (const actor of ['teacher', 'student', 'foreignAdmin']) {
    const result = await mutation({ visibility: 'PRIVATE' }, 1, { actor });
    expect([403, 404]).toContain(result.status);
    expect(result.data).toBeUndefined();
    expect([403, 404]).toContain(
      (await harness.request(scope, `${path()}/content`, { actor })).status,
    );
  }
  for (const id of [scope.foreignExerciseId, randomUUID()]) {
    const result = await harness.request(scope, `/exercises/${id}/governance`, {
      method: 'PATCH',
      body: { visibility: 'PRIVATE' },
      revision: 1,
    });
    expect(result.status).toBe(404);
    expect(result.data).toBeUndefined();
  }
  await harness.revoke(scope);
  try {
    expect([403, 404]).toContain(
      (await mutation({ visibility: 'PRIVATE' })).status,
    );
  } finally {
    await harness.revoke({ ...scope, restore: true });
  }
  await harness.archiveOrganization(scope);
  const result = await mutation({ visibility: 'PRIVATE' });
  expect(result.status).toBe(409);
  expect(result.data).toBeUndefined();
});

test('ETag y concurrencia: un cambio gana, el obsoleto no sobrescribe y replay conserva una auditoría', async () => {
  const revision = (await current()).revision;
  const results = await Promise.all([
    mutation({ visibility: 'PRIVATE' }, revision),
    mutation({ ownerId: scope.adminId }, revision),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual([200, 412]);
  expect((await current()).revision).toBe(revision + 1);
  const key = randomUUID(),
    next = (await current()).revision;
  const same = await Promise.all([
    mutation({ ownerId: scope.teacherId, visibility: 'ORGANIZATION' }, next, {
      key,
    }),
    mutation({ ownerId: scope.teacherId, visibility: 'ORGANIZATION' }, next, {
      key,
    }),
  ]);
  expect(same.map((r) => r.status)).toEqual([200, 200]);
  expect(same[0].data).toEqual(same[1].data);
  expect(
    (await harness.audit(scope)).reduce((total, item) => total + item.count, 0),
  ).toBe(2);
});

test('HU024-E2: versión incoherente o contenido ajeno no modifica referencias', async () => {
  const before = await harness.snapshot(scope);
  const content = await harness.request(scope, `${path()}/content`);
  expect(content.status).toBe(200);
  c.exerciseVersionResponseSchema.parse(content.body);
  expect(content.data.id).toBe(scope.currentVersionId);
  const input = versionInput();
  input.tests.push({
    id: 'contradiction',
    visibility: 'hidden',
    args: [],
    expected: 99,
  });
  expect(
    (
      await harness.request(scope, `/exercises/${scope.exerciseId}/versions`, {
        method: 'POST',
        body: input,
        revision: (await current()).revision,
      })
    ).status,
  ).toBe(422);
  expect(await harness.snapshot(scope)).toEqual(before);
  expect((await current()).versionCount).toBe(25);
  expect(await harness.audit(scope)).toEqual([]);
});

test('fallo al persistir auditoría revierte gobierno y permite reconciliar la misma solicitud', async () => {
  const before = await current();
  const history = await harness.snapshot(scope);
  const key = randomUUID(),
    body = { ownerId: scope.adminId, visibility: 'PRIVATE' };
  await harness.auditFailure(scope, true);
  try {
    const failed = await mutation(body, before.revision, { key });
    expect(failed.status).toBe(503);
    expect(failed.data).toBeUndefined();
    expect(JSON.stringify(failed.body)).not.toContain(
      'IMP06_SCOPED_AUDIT_FAILURE',
    );
    expect(await current()).toMatchObject({
      revision: before.revision,
      owner: before.owner,
      visibility: before.visibility,
    });
    expect(await harness.audit(scope)).toEqual([]);
    expect(await harness.snapshot(scope)).toEqual(history);
  } finally {
    await harness.auditFailure(scope, false);
  }
  const recovered = await mutation(body, before.revision, { key });
  expect(recovered.status).toBe(200);
  expect(recovered.data).toMatchObject({
    owner: { id: scope.adminId },
    visibility: 'PRIVATE',
    revision: before.revision + 1,
  });
  expect(
    (await harness.audit(scope)).reduce(
      (total, event) => total + event.count,
      0,
    ),
  ).toBe(1);
});

test('HU024-E4: nueva versión, gobierno y archivo preservan intento real, actividad, pruebas y conceptos anteriores', async () => {
  const submission = await harness.submit(scope);
  expect(submission.status).toBe(201);
  c.attemptResponseSchema.parse(submission.body);
  const attemptId = submission.data.attemptId;
  const originalAttempt = await harness.request(
    scope,
    `/attempts/${attemptId}`,
    { actor: 'student' },
  );
  expect(originalAttempt.status).toBe(200);
  const originalProgress = await harness.request(
    scope,
    `/activities/${scope.publishedActivityId}/progress`,
    { actor: 'student' },
  );
  expect(originalProgress.status).toBe(200);
  const before = await harness.snapshot(scope);
  const revision = (await current()).revision;
  const key = randomUUID(),
    input = versionInput();
  const created = await harness.request(
    scope,
    `/exercises/${scope.exerciseId}/versions`,
    { method: 'POST', body: input, revision, key },
  );
  expect(created.status).toBe(201);
  expect(created.data.version).toBe(26);
  expect(created.data.id).not.toBe(scope.currentVersionId);
  const replay = await harness.request(
    scope,
    `/exercises/${scope.exerciseId}/versions`,
    { method: 'POST', body: input, revision, key },
  );
  expect(replay.status).toBe(201);
  expect(replay.data).toEqual(created.data);
  expect(await current()).toMatchObject({
    versionCount: 26,
    currentVersion: { id: created.data.id },
  });
  const changed = await mutation(
    { ownerId: scope.adminId, visibility: 'PRIVATE' },
    revision + 1,
  );
  expect(changed.status).toBe(200);
  const archived = await harness.request(
    scope,
    `/exercises/${scope.exerciseId}/archive`,
    {
      method: 'POST',
      body: { reason: 'Conservar publicaciones existentes' },
      revision: revision + 2,
    },
  );
  expect(archived.status).toBe(200);
  expect(archived.data.state).toBe('ARCHIVED');
  const archivedReplay = await harness.request(
    scope,
    `/exercises/${scope.exerciseId}/versions`,
    { method: 'POST', body: input, revision, key },
  );
  expect(archivedReplay.status).toBe(201);
  expect(archivedReplay.data).toEqual(created.data);
  expect(await harness.snapshot(scope)).toEqual(before);
  const attempt = await harness.request(scope, `/attempts/${attemptId}`, {
    actor: 'student',
  });
  expect(attempt.status).toBe(200);
  expect(attempt.data).toEqual(originalAttempt.data);
  const progress = await harness.request(
    scope,
    `/activities/${scope.publishedActivityId}/progress`,
    { actor: 'student' },
  );
  expect(progress.status).toBe(200);
  expect(progress.data).toMatchObject({
    completed: originalProgress.data.completed,
    required: originalProgress.data.required,
    ratio: originalProgress.data.ratio,
    evidenceState: originalProgress.data.evidenceState,
  });
  expect((await current()).useCounts).toEqual(scope.oracle.useCounts);
  const published = await harness.request(
    scope,
    `/activities/${scope.publishedActivityId}/exercises/${scope.publishedAssignmentId}`,
    { actor: 'student' },
  );
  expect(published.status).toBe(200);
  expect(published.data.exerciseVersionId).toBe(scope.currentVersionId);
  expect(published.data.canEdit).toBe(true);
  expect(JSON.stringify(published.data)).not.toContain(
    'hidden-sentinel-exercise-bank-e2e',
  );
  expect(
    (await mutation({ visibility: 'ORGANIZATION' }, revision + 3)).status,
  ).toBe(409);
}, 90000);
