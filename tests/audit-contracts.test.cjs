/* eslint @typescript-eslint/no-require-imports: "off" */
const { randomUUID } = require('node:crypto');
const c = require('@alunza/contracts');
const asOf = '2026-11-02T15:00:00.123456Z';
const event = {
  eventId: randomUUID(),
  organizationId: randomUUID(),
  occurredAt: asOf,
  actorId: null,
  action: 'SIGNAL_REVIEWED',
  entityType: 'signal',
  entityId: null,
  outcome: 'SUCCEEDED',
};

test('audit query preserves exact codes, bounded pagination and microseconds', () => {
  expect(c.auditQuerySchema.parse({})).toEqual({ limit: 20 });
  expect(
    c.auditQuerySchema.parse({
      asOf: '2026-11-02T12:00:00.123456-03:00',
      action: 'SIGNAL_REVIEWED',
      limit: '100',
    }),
  ).toEqual({ asOf, action: 'SIGNAL_REVIEWED', limit: 100 });
  expect(
    c.auditQuerySchema.parse({ from: asOf, asOf, cursor: 'abc' }).asOf,
  ).toBe(asOf);
});
test.each([
  { limit: [] },
  { limit: ['20'] },
  { limit: true },
  { limit: '' },
  { limit: null },
  { limit: 0 },
  { limit: 101 },
  { limit: 1.1 },
  { actorId: 'invalid' },
  { entityId: 'invalid' },
  { action: '' },
  { action: ['x'] },
  { entityType: 'x'.repeat(101) },
  { from: 'invalid' },
  { from: '2026-02-30T00:00:00Z' },
  { asOf: '2026-11-02T00:00:00.1234567Z' },
  { from: '2026-11-02T15:00:00.123457Z', asOf },
  { cursor: 'abc' },
  { cursor: 'bad/', asOf },
  { cursor: 'x'.repeat(4097), asOf },
  { organizationId: randomUUID() },
  { include: 'safe_changes' },
  { order: 'action' },
])('audit query rejects invalid or unapproved input %#', (input) => {
  expect(c.auditQuerySchema.safeParse(input).success).toBe(false);
});
test('audit response permits historical results and nullable identities, but no private columns', () => {
  const response = {
    data: {
      organizationId: event.organizationId,
      asOf,
      items: [event],
      page: { hasMore: false, nextCursor: null, totalFiltered: 1 },
    },
    requestId: randomUUID(),
  };
  expect(c.auditListResponseSchema.parse(response)).toEqual(response);
  expect(
    c.auditEventSchema.parse({ ...event, outcome: 'HISTORICAL_RESULT' })
      .outcome,
  ).toBe('HISTORICAL_RESULT');
  for (const key of [
    'safe_changes',
    'safeChanges',
    'actorKind',
    'correlationId',
    'code',
    'prompt',
    'email',
  ]) {
    expect(
      c.auditEventSchema.safeParse({ ...event, [key]: 'PRIVATE' }).success,
    ).toBe(false);
  }
  expect(
    c.auditListResponseSchema.safeParse({
      ...response,
      data: {
        ...response.data,
        page: { hasMore: true, nextCursor: null, totalFiltered: 1 },
      },
    }).success,
  ).toBe(false);
});
