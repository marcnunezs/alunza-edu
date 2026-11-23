/* eslint @typescript-eslint/no-require-imports: "off" */
const { readFileSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const { URLSearchParams } = require('node:url');
const c = require('@alunza/contracts');
let harness, scope;
const path = (value = scope) =>
  `/organizations/${value.organizationId}/audit-events`;
const qs = (value) => new URLSearchParams(value).toString();
async function read(url, options) {
  const response = await harness.request(scope, url, options);
  expect(response.status).toBe(200);
  expect(response.noStore).toBe(true);
  c.auditListResponseSchema.parse(response.body);
  for (const row of response.data.items)
    expect(Object.keys(row).sort()).toEqual(
      [
        'eventId',
        'occurredAt',
        'actorId',
        'action',
        'entityType',
        'entityId',
        'organizationId',
        'outcome',
      ].sort(),
    );
  for (const privateField of [
    'safeChanges',
    'safe_changes',
    'actor_kind',
    'actorKind',
    'request_id',
    'correlation_id',
    'email',
    'code',
    'prompt',
  ])
    expect(JSON.stringify(response.body)).not.toContain(`"${privateField}"`);
  return response.data;
}
beforeAll(async () => {
  if (process.env.ALUNZA_TEST_API_URL !== 'http://127.0.0.1:4300')
    throw new Error('Audit requires isolated LAB TEST.');
  const state = JSON.parse(readFileSync(process.env.ALUNZA_TEST_STATE, 'utf8'));
  const { createAuditHarness } = await import('../e2e/audit-fixture.mjs');
  harness = createAuditHarness(state);
  scope = await harness.prepare();
}, 90000);
afterAll(async () => {
  await harness?.close();
});

test('HU027-E1: stable pages, exact full count and timestamp/UUID ties', async () => {
  const rows = [];
  let cursor;
  do {
    const result = await read(
      `${path()}?${qs({ asOf: scope.asOf, limit: 7, ...(cursor ? { cursor } : {}) })}`,
    );
    expect(result.page.totalFiltered).toBe(25);
    expect(result.page.hasMore).toBe(result.page.nextCursor !== null);
    rows.push(...result.items);
    cursor = result.page.nextCursor;
  } while (cursor);
  expect(rows).toHaveLength(25);
  expect(rows.map((row) => row.eventId)).toEqual(
    harness.expected(scope).map((row) => row.eventId),
  );
  expect(new Set(rows.map((row) => row.eventId)).size).toBe(25);
  expect(rows.every((row) => row.organizationId === scope.organizationId)).toBe(
    true,
  );
});

test('HU027-E1: all filters apply before count and paging, with inclusive microsecond bounds', async () => {
  const combined = await read(
    `${path()}?${qs({ ...scope.filters, limit: 1 })}`,
  );
  expect(combined.page.totalFiltered).toBe(scope.oracle.combinedTotal);
  expect(combined.items[0].eventId).toBe(scope.oracle.combinedIds[0]);
  const next = await read(
    `${path()}?${qs({ ...scope.filters, limit: 1, cursor: combined.page.nextCursor })}`,
  );
  expect(next.items[0].eventId).toBe(scope.oracle.combinedIds[1]);
  const timestamp = '2026-09-01T12:00:00.000001Z';
  const boundary = await read(
    `${path()}?${qs({ from: timestamp, asOf: timestamp })}`,
  );
  const expected = harness
    .expected(scope)
    .filter((event) => event.occurredAt === timestamp);
  expect(boundary.page.totalFiltered).toBe(3);
  expect(boundary.items.map((event) => event.eventId)).toEqual(
    expected.map((event) => event.eventId),
  );
  expect(boundary.items.every((event) => event.occurredAt === timestamp)).toBe(
    true,
  );
  const precision = await read(
    `${path()}?${qs({ from: '2026-09-01T12:00:00.000000Z', asOf: '2026-09-01T12:00:00.000000Z' })}`,
  );
  expect(precision.page.totalFiltered).toBe(3);
});

test('empty and unknown exact filters return no synthetic rows; historical/null actors remain', async () => {
  for (const filter of [
    { action: 'fixture.unmatched' },
    { actorId: randomUUID() },
    { entityId: randomUUID() },
    { entityType: 'NO_SUCH_TYPE' },
  ]) {
    const result = await read(
      `${path()}?${qs({ ...filter, asOf: scope.asOf })}`,
    );
    expect(result.items).toEqual([]);
    expect(result.page).toEqual({
      nextCursor: null,
      hasMore: false,
      totalFiltered: 0,
    });
  }
  const all = await read(`${path()}?${qs({ asOf: scope.asOf, limit: 100 })}`);
  const system = all.items.find(
    (event) => event.eventId === scope.nullActorEventId,
  );
  expect(system.actorId).toBeNull();
  expect(system.entityId).toBeNull();
  await harness.revoke(scope, { actor: 'teacher' });
  try {
    const historical = await read(
      `${path()}?${qs({ actorId: scope.teacherId, asOf: scope.asOf })}`,
    );
    expect(historical.page.totalFiltered).toBe(12);
    expect(
      historical.items.every((event) => event.actorId === scope.teacherId),
    ).toBe(true);
  } finally {
    await harness.revoke(scope, { actor: 'teacher', restore: true });
  }
});

test('HU027-E2: invalid filters/cursors reject without projected content', async () => {
  for (const query of [
    'from=invalid',
    'asOf=invalid',
    'from=2026-09-03T00%3A00%3A00Z&asOf=2026-09-02T00%3A00%3A00Z',
    'asOf=2099-01-01T00%3A00%3A00Z',
    'from=2026-09-01T00%3A00%3A00.0000001Z',
    'actorId=invalid',
    'entityId=invalid',
    'action=',
    'entityType=',
    'limit=0',
    'limit=101',
    'limit=1.5',
    'cursor=unsafe%2Fvalue',
    'actorId=bad&actorId=bad',
    'includePrivate=true',
  ]) {
    const result = await harness.request(scope, `${path()}?${query}`);
    expect(result.status).toBe(422);
    expect(result.data).toBeUndefined();
    expect(result.noStore).toBe(true);
  }
  const first = await read(`${path()}?${qs({ asOf: scope.asOf, limit: 1 })}`);
  for (const changed of [
    {},
    { asOf: scope.asOf, action: 'fixture.changed' },
    { asOf: '2026-09-01T23:59:59.999999Z' },
  ]) {
    const response = await harness.request(
      scope,
      `${path()}?${qs({ ...changed, limit: 1, cursor: first.page.nextCursor })}`,
    );
    expect(response.status).toBe(422);
  }
  const secondScope = await harness.prepare();
  expect(
    (
      await harness.request(
        secondScope,
        `${path(secondScope)}?${qs({ asOf: scope.asOf, limit: 1, cursor: first.page.nextCursor })}`,
      )
    ).status,
  ).toBe(422);
});

test('HU027-E3: unauthenticated/foreign/role access is denied before enumeration', async () => {
  for (const authorization of ['', 'Bearer invalid-token']) {
    const result = await harness.request(scope, path(), {
      headers: { Authorization: authorization },
    });
    expect(result.status).toBe(401);
    expect(result.data).toBeUndefined();
  }
  for (const actor of ['teacher', 'student', 'foreignAdmin']) {
    const result = await harness.request(scope, path(), { actor });
    expect([403, 404]).toContain(result.status);
    expect(result.data).toBeUndefined();
  }
  const foreign = await harness.request(
    scope,
    `/organizations/${scope.otherOrganizationId}/audit-events`,
  );
  const absent = await harness.request(
    scope,
    `/organizations/${randomUUID()}/audit-events`,
  );
  expect(foreign.status).toBe(404);
  expect(absent.status).toBe(404);
  expect(foreign.body.error.code).toBe(absent.body.error.code);
  expect(foreign.data).toBeUndefined();
});

test('revocation blocks a cached real JWT and archive preserves ADMIN historical reads', async () => {
  await read(path());
  await harness.revoke(scope);
  try {
    const result = await harness.request(scope, path());
    expect([403, 404]).toContain(result.status);
    expect(result.data).toBeUndefined();
  } finally {
    await harness.revoke(scope, { restore: true });
  }
  await harness.archive(scope);
  expect(
    (await read(`${path()}?${qs({ asOf: scope.asOf })}`)).page.totalFiltered,
  ).toBe(25);
});

test('queries preserve audit/history and do not create recursive audit rows', async () => {
  const before = await harness.snapshot(scope);
  await read(path());
  await read(`${path()}?${qs(scope.filters)}`);
  await harness.request(scope, path(), { actor: 'foreignAdmin' });
  expect(await harness.snapshot(scope)).toEqual(before);
});

test('a stable cut excludes new future events, while committed earlier facts are visible on later requests', async () => {
  const isolated = await harness.prepare();
  const firstResponse = await harness.request(
    isolated,
    `${path(isolated)}?${qs({ asOf: isolated.asOf, limit: 20 })}`,
  );
  expect(firstResponse.status).toBe(200);
  const first = firstResponse.data;
  await harness.append(isolated, { occurredAt: '2026-09-03T00:00:00.000001Z' });
  const late = await harness.beginLate(isolated);
  let committed = false;
  try {
    const before = await harness.request(
      isolated,
      `${path(isolated)}?${qs({ asOf: isolated.asOf, limit: 20, cursor: first.page.nextCursor })}`,
    );
    expect(before.data.page.totalFiltered).toBe(25);
    expect(before.data.items).toHaveLength(5);
    await late.finish();
    committed = true;
    const after = await harness.request(
      isolated,
      `${path(isolated)}?${qs({ asOf: isolated.asOf, limit: 20, cursor: first.page.nextCursor })}`,
    );
    expect(after.data.page.totalFiltered).toBe(26);
    expect(after.data.items).toHaveLength(6);
    expect(after.data.items.at(-1).eventId).toBe(late.row.eventId);
    expect(
      new Set([...first.items, ...after.data.items].map((row) => row.eventId))
        .size,
    ).toBe(26);
  } finally {
    if (!committed) await late.finish(false);
  }
});

test('real government mutation produces existing audit that is readable without safe_changes', async () => {
  const isolated = await harness.prepare();
  const update = await harness.request(
    isolated,
    `/organizations/${isolated.organizationId}`,
    {
      method: 'PATCH',
      headers: { 'If-Match': '"1"' },
      body: { name: 'Auditoría cambio real' },
    },
  );
  expect(update.status).toBe(200);
  const result = await harness.request(
    isolated,
    `${path(isolated)}?action=organization.updated&entityType=organization`,
  );
  expect(result.status).toBe(200);
  c.auditListResponseSchema.parse(result.body);
  expect(result.data.page.totalFiltered).toBe(1);
  expect(result.data.items[0]).toMatchObject({
    actorId: isolated.adminId,
    entityId: isolated.organizationId,
    action: 'organization.updated',
    entityType: 'organization',
  });
  expect(Object.keys(result.data.items[0])).toHaveLength(8);
});
