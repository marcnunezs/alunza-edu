/* eslint @typescript-eslint/no-require-imports: "off" */
const { readFileSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const c = require('@alunza/contracts');
let harness, scope, csv;
const endpoint = (value = scope) =>
  `/organizations/${value.organizationId}/audit-exports`;

async function ready(input = scope, options = {}) {
  const response = await harness.create(input, options);
  expect(response.status).toBe(201);
  expect(response.noStore).toBe(true);
  c.auditExportResponseSchema.parse(response.body);
  expect(response.data.state).toBe('READY');
  expect(response.data.organizationId).toBe(input.organizationId);
  expect(response.data.formatVersion).toBe('audit-csv-v1');
  expect(
    new Date(response.data.expiresAt) - new Date(response.data.generatedAt),
  ).toBe(86400000);
  return response.data;
}
async function download(input, metadata, options = {}) {
  const result = await harness.content(input, metadata.exportId, options);
  expect(result.status).toBe(200);
  expect(result.noStore).toBe(true);
  expect(result.headers['content-type']).toMatch(
    /^text\/csv;\s*charset=utf-8/i,
  );
  expect(result.headers['x-content-type-options']).toBe('nosniff');
  expect(result.headers['content-disposition']).toContain(metadata.fileName);
  const parsed = csv(result.bytes);
  expect(parsed.sha256).toBe(metadata.sha256);
  expect(parsed.byteLength).toBe(metadata.byteLength);
  expect(parsed.rowCount).toBe(metadata.rowCount);
  expect(result.headers['content-length']).toBe(String(metadata.byteLength));
  expect(parsed.rows.every((row) => row[6] === input.organizationId)).toBe(
    true,
  );
  expect(result.bytes.toString('utf8')).not.toMatch(
    /audit-private-fixture-sentinel|safe_changes|correlation_id|access_token/,
  );
  return { ...result, parsed };
}
beforeAll(async () => {
  if (process.env.ALUNZA_TEST_API_URL !== 'http://127.0.0.1:4300')
    throw new Error('Audit export requires isolated LAB TEST.');
  const state = JSON.parse(readFileSync(process.env.ALUNZA_TEST_STATE, 'utf8'));
  const fixture = await import('../e2e/audit-fixture.mjs');
  harness = fixture.createAuditExportHarness(state);
  csv = fixture.readAuditCsv;
}, 90000);
beforeEach(async () => {
  scope = await harness.prepare();
});
afterAll(async () => {
  await harness?.close();
});

test('HU027-E1: full filtered set, stable order and recoverable binary/metadata', async () => {
  const metadata = await ready();
  expect(metadata.rowCount).toBe(25);
  const file = await download(scope, metadata);
  expect(file.parsed.rows.map((row) => row[0])).toEqual(
    harness.expected(scope).map((event) => event.eventId),
  );
  expect(
    file.parsed.rows.find((row) => row[0] === scope.nullActorEventId)[2],
  ).toBe('');
  expect(
    file.parsed.rows.find((row) => row[0] === scope.nullActorEventId)[5],
  ).toBe('');
  const recovered = await harness.metadata(scope, metadata.exportId);
  expect(recovered.status).toBe(200);
  expect(recovered.noStore).toBe(true);
  c.auditExportResponseSchema.parse(recovered.body);
  expect(recovered.data).toEqual(metadata);
  const second = await download(scope, metadata);
  expect(second.bytes.equals(file.bytes)).toBe(true);
});

test('exact filters, inclusive microseconds and empty exports retain headers/context', async () => {
  const selected = await ready(scope, { body: scope.filters });
  const filtered = await download(scope, selected);
  expect(filtered.parsed.rows.map((row) => row[0])).toEqual(
    scope.oracle.combinedIds,
  );
  const instant = '2026-09-01T12:00:00.000001Z';
  const boundary = await ready(scope, {
    body: { from: instant, asOf: instant },
  });
  expect(boundary.rowCount).toBe(3);
  expect(
    (await download(scope, boundary)).parsed.rows.every(
      (row) => row[1] === instant,
    ),
  ).toBe(true);
  const empty = await ready(scope, {
    body: { asOf: scope.asOf, action: 'fixture.absent' },
  });
  expect(empty.rowCount).toBe(0);
  expect((await download(scope, empty)).parsed.rows).toEqual([]);
  expect(empty.filters).toEqual({ asOf: scope.asOf, action: 'fixture.absent' });
});

test('UTF-8, quotes, commas, CRLF, controls and formula prefixes are safe CSV', async () => {
  const hostile = await harness.prepare({ profile: 'hostile' });
  const metadata = await ready(hostile);
  const file = await download(hostile, metadata);
  const original = new Map(
    harness.expected(hostile).map((row) => [row.eventId, row]),
  );
  for (const row of file.parsed.rows) {
    const action = original.get(row[0]).action;
    if (action === 'á, ñ, "texto"\r\nsegunda línea')
      expect(row[3]).toBe(action);
    else if (action === 'control\u0001seguro')
      expect(row[3]).toBe('control\\u0001seguro');
    else expect(row[3].startsWith('texto: ')).toBe(true);
    expect(row[4]).toBe(original.get(row[0]).entityType);
    expect(
      Array.from(row[3]).some((character) => {
        const code = character.codePointAt(0);
        return (
          (code < 32 && code !== 10 && code !== 13) ||
          (code >= 127 && code <= 159)
        );
      }),
    ).toBe(false);
  }
});

test('same key normalizes dates/UUIDs and returns the original bytes; changed payload conflicts', async () => {
  const key = randomUUID();
  const first = await ready(scope, { key, body: scope.filters });
  const file = await download(scope, first);
  const replay = await ready(scope, {
    key,
    body: {
      ...scope.filters,
      actorId: scope.adminId.toUpperCase(),
      from: '2026-08-31T21:00:00-03:00',
      asOf: '2026-09-01T21:00:00-03:00',
    },
  });
  expect(replay).toEqual(first);
  expect((await download(scope, replay)).bytes.equals(file.bytes)).toBe(true);
  const changed = await harness.create(scope, {
    key,
    body: { asOf: scope.asOf },
  });
  expect(changed.status).toBe(409);
  expect(changed.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
});

test('concurrent identical requests create only one durable artifact', async () => {
  const key = randomUUID();
  const results = await Promise.all([
    harness.create(scope, { key }),
    harness.create(scope, { key }),
  ]);
  expect(
    results.every((response) => [201, 409].includes(response.status)),
  ).toBe(true);
  for (const result of results.filter((response) => response.status === 409)) {
    expect(result.body.error.code).toBe('REQUEST_IN_PROGRESS');
    expect(result.headers['retry-after']).toBeDefined();
  }
  const result = await ready(scope, { key });
  expect(
    results
      .filter((response) => response.status === 201)
      .every((response) => response.data.exportId === result.exportId),
  ).toBe(true);
  const facts = await harness.facts({ ...scope, exportId: result.exportId });
  expect(facts.exports).toHaveLength(1);
  expect(facts.requested).toBe(1);
  expect(facts.generated).toBe(1);
});

test('non-requesting ADMIN, foreign scope and non-admin roles cannot inspect or download', async () => {
  const metadata = await ready();
  for (const actor of ['otherAdmin', 'foreignAdmin', 'teacher', 'student']) {
    const read = await harness.metadata(scope, metadata.exportId, { actor });
    const bytes = await harness.content(scope, metadata.exportId, { actor });
    expect([403, 404]).toContain(read.status);
    expect(bytes.status).toBe(read.status);
    expect(read.data).toBeUndefined();
    expect(bytes.headers['content-type']).toContain('application/json');
  }
  const absent = await harness.metadata(scope, randomUUID());
  const foreign = await harness.request(
    scope,
    `/organizations/${scope.otherOrganizationId}/audit-exports/${metadata.exportId}`,
  );
  expect(absent.status).toBe(404);
  expect(foreign.status).toBe(404);
  expect(absent.body.error.code).toBe(foreign.body.error.code);
  for (const actor of ['teacher', 'student', 'foreignAdmin']) {
    const result = await harness.create(scope, { actor });
    expect([403, 404]).toContain(result.status);
  }
});

test('cached JWT is rejected after revocation on replay/metadata/content; archive remains readable', async () => {
  const key = randomUUID();
  const metadata = await ready(scope, { key });
  await harness.revoke(scope);
  try {
    for (const result of [
      await harness.create(scope, { key }),
      await harness.metadata(scope, metadata.exportId),
      await harness.content(scope, metadata.exportId),
    ]) {
      expect([403, 404]).toContain(result.status);
      expect(result.data).toBeUndefined();
      expect(result.noStore).toBe(true);
    }
  } finally {
    await harness.revoke(scope, { restore: true });
  }
  await harness.archive(scope);
  await download(scope, metadata);
  expect((await ready(scope, { key })).exportId).toBe(metadata.exportId);
  expect((await ready()).rowCount).toBe(25);
});

test('invalid requests fail before reservation and expose no export data', async () => {
  const invalid = [
    {},
    { asOf: 'bad' },
    { asOf: scope.asOf, limit: 20 },
    { asOf: scope.asOf, cursor: 'opaque' },
    { asOf: scope.asOf, actorId: 'bad' },
    { asOf: scope.asOf, action: '' },
    { asOf: scope.asOf, from: '2026-09-03T00:00:00Z' },
    { asOf: '2099-01-01T00:00:00Z' },
    { asOf: '2026-09-02T00:00:00.0000001Z' },
  ];
  for (const body of invalid) {
    const response = await harness.create(scope, { body });
    expect(response.status).toBe(422);
    expect(response.data).toBeUndefined();
    expect(response.noStore).toBe(true);
  }
  const noKey = await harness.request(scope, endpoint(), {
    method: 'POST',
    body: { asOf: scope.asOf },
  });
  expect(noKey.status).toBe(400);
  const anonymous = await harness.create(scope, {
    headers: { Authorization: 'Bearer invalid-token' },
  });
  expect(anonymous.status).toBe(401);
  expect((await harness.facts(scope)).exports).toEqual([]);
});

test('10,000 rows are complete; row/byte excess is a stable failure without partial bytes', async () => {
  const capacity = await harness.prepare({ profile: 'capacity' });
  const complete = await ready(capacity);
  expect(complete.rowCount).toBe(10000);
  expect((await download(capacity, complete)).parsed.rowCount).toBe(10000);
  for (const profile of ['rowOverflow', 'byteOverflow']) {
    const oversized = await harness.prepare({ profile });
    const key = randomUUID();
    const response = await harness.create(oversized, { key });
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('AUDIT_EXPORT_LIMIT_EXCEEDED');
    const replay = await harness.create(oversized, { key });
    expect(replay.status).toBe(422);
    expect(replay.body.error).toEqual(response.body.error);
    const facts = await harness.facts(oversized);
    expect(facts.exports).toHaveLength(1);
    expect(facts.exports[0].state).toBe('FAILED');
    expect(facts.exports[0].storedBytes).toBe(0);
    expect(facts.generated).toBe(0);
    expect(facts.failed).toBe(1);
  }
}, 90000);

test('snapshot at generation includes committed old events but later commits never alter recovered bytes', async () => {
  const late = await harness.beginLate(scope);
  let committed = false;
  try {
    const first = await ready();
    const original = await download(scope, first);
    expect(
      original.parsed.rows.some((row) => row[0] === late.row.eventId),
    ).toBe(false);
    await late.finish(true);
    committed = true;
    expect((await download(scope, first)).bytes.equals(original.bytes)).toBe(
      true,
    );
    const next = await ready();
    expect(next.rowCount).toBe(26);
    expect(
      (await download(scope, next)).parsed.rows.some(
        (row) => row[0] === late.row.eventId,
      ),
    ).toBe(true);
    await harness.append(scope, { occurredAt: '2026-09-03T00:00:00.000000Z' });
    expect((await ready()).rowCount).toBe(26);
  } finally {
    if (!committed) await late.finish(false);
  }
});

test('HEAD authorizes metadata without delivery; GET records one completed transport', async () => {
  const metadata = await ready();
  const before = await harness.facts({ ...scope, exportId: metadata.exportId });
  const head = await harness.content(scope, metadata.exportId, {
    method: 'HEAD',
  });
  expect(head.status).toBe(200);
  expect(head.bytes.length).toBe(0);
  expect(head.noStore).toBe(true);
  expect(head.headers['content-length']).toBe(String(metadata.byteLength));
  expect(
    (await harness.facts({ ...scope, exportId: metadata.exportId })).deliveries,
  ).toEqual(before.deliveries);
  await download(scope, metadata);
  const completed = await harness.waitForFacts(
    { ...scope, exportId: metadata.exportId },
    (facts) =>
      facts.deliveries.some((delivery) => delivery.state === 'FINISHED'),
  );
  expect(completed.deliveries).toHaveLength(1);
  expect(completed.deliveries[0].state).toBe('FINISHED');
});

test('expired artifacts return 410 before purge and retain the original idempotency binding', async () => {
  const key = randomUUID();
  const metadata = await ready(scope, { key });
  await harness.expire({ ...scope, exportId: metadata.exportId });
  for (const response of [
    await harness.metadata(scope, metadata.exportId),
    await harness.content(scope, metadata.exportId),
    await harness.create(scope, { key }),
  ]) {
    expect(response.status).toBe(410);
    expect(response.body.error.code).toBe('AUDIT_EXPORT_EXPIRED');
  }
  await harness.maintain(scope);
  const facts = await harness.facts(scope);
  expect(facts.exports).toHaveLength(1);
  expect(facts.exports[0].storedBytes).toBe(0);
  expect(facts.requested).toBe(1);
  expect((await ready()).exportId).not.toBe(metadata.exportId);
});

test('a live reservation cannot be duplicated; an expired lease remains failed on replay', async () => {
  const key = randomUUID();
  const claim = await harness.reserve(scope, key);
  expect(claim.kind).toBe('CLAIMED');
  const repeated = await harness.create(scope, { key });
  expect(repeated.status).toBe(409);
  expect(repeated.body.error.code).toBe('REQUEST_IN_PROGRESS');
  expect(repeated.body.error.retryable).toBe(true);
  const conflicting = await harness.create(scope);
  expect(conflicting.status).toBe(429);
  expect(conflicting.body.error.code).toBe('RATE_LIMITED');
  const input = { ...scope, exportId: claim.exportId };
  await harness.expireLease(input);
  await harness.maintain(scope);
  for (const response of [
    await harness.create(scope, { key }),
    await harness.metadata(scope, claim.exportId),
  ]) {
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('AUDIT_EXPORT_INTERRUPTED');
    expect(response.body.error.retryable).toBe(false);
  }
  const facts = await harness.facts(input);
  expect(facts.exports[0].state).toBe('FAILED');
  expect(facts.exports[0].storedBytes).toBe(0);
  expect(facts.failed).toBe(1);
  expect(facts.generated).toBe(0);
  expect((await ready()).exportId).not.toBe(claim.exportId);
});

test('delivery evidence survives revocation, and reconciliation does not invent successful receipt', async () => {
  const metadata = await ready();
  const input = { ...scope, exportId: metadata.exportId };
  const first = await harness.beginDelivery(input);
  await harness.revoke(scope);
  try {
    await harness.finishDelivery(input, first, 'ABORTED');
  } finally {
    await harness.revoke(scope, { restore: true });
  }
  const pending = await harness.beginDelivery(input);
  await harness.expireDelivery(input);
  await harness.maintain(scope);
  await harness.finishDelivery(input, pending, 'FINISHED');
  const facts = await harness.facts(input);
  expect(facts.deliveries.map((delivery) => delivery.state)).toEqual([
    'ABORTED',
    'UNKNOWN',
  ]);
  expect(facts.downloaded).toBe(2);
  expect(facts.exports[0].state).toBe('READY');
  await download(scope, metadata);
});

test('revocation while replay waits for its database lock prevents returning READY metadata', async () => {
  const key = randomUUID();
  const metadata = await ready(scope, { key });
  const before = await harness.facts({ ...scope, exportId: metadata.exportId });
  const lock = await harness.holdReservation(scope);
  const request = harness.create(scope, { key }).then(
    (response) => ({ response }),
    (error) => ({ error }),
  );
  let revoked = false;
  try {
    // Observe the real PostgreSQL wait; an elapsed delay is not the oracle.
    await lock.waitForBlocked();
    await harness.revoke(scope);
    revoked = true;
    await lock.release();
    const result = await request;
    if (result.error) throw result.error;
    expect(result.response.status).toBe(404);
    expect(result.response.body.error.code).toBe('RESOURCE_NOT_FOUND');
    expect(result.response.data).toBeUndefined();
    expect(result.response.noStore).toBe(true);
    expect(
      await harness.facts({ ...scope, exportId: metadata.exportId }),
    ).toEqual(before);
  } finally {
    await lock.release();
    await request;
    if (revoked) await harness.revoke(scope, { restore: true });
  }
});
