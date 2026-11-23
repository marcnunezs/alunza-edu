/* eslint @typescript-eslint/no-require-imports: "off" */
const { randomUUID } = require('node:crypto');
const c = require('@alunza/contracts');
const observedAt = '2026-10-27T01:00:00.123456Z';
const counts = { total: 3, draft: 1, published: 1, closed: 1 };
const version = {
  id: randomUUID(),
  version: 25,
  title: 'Funciones',
  difficulty: 'BEGINNER',
  createdAt: observedAt,
  concepts: [
    {
      id: randomUUID(),
      versionId: randomUUID(),
      name: 'Variables',
      version: 1,
    },
  ],
};
const entry = {
  id: randomUUID(),
  organizationId: randomUUID(),
  revision: 25,
  state: 'ACTIVE',
  visibility: 'PRIVATE',
  owner: { id: randomUUID(), displayName: 'Docente ficticio' },
  currentVersion: version,
  versionCount: 25,
  useCounts: counts,
};
test('governance accepts only explicit organization-scoped policy changes', () => {
  for (const input of [
    { ownerId: entry.owner.id },
    { visibility: 'PRIVATE' },
    { ownerId: entry.owner.id, visibility: 'ORGANIZATION' },
  ])
    expect(c.exerciseBankGovernanceInputSchema.parse(input)).toEqual(input);
  for (const input of [
    {},
    { ownerId: null },
    { ownerId: 'unknown' },
    { visibility: 'PUBLIC' },
    { visibility: null },
    { visibility: 'PRIVATE', organizationId: entry.organizationId },
    { visibility: 'PRIVATE', currentVersionId: version.id },
    { visibility: 'PRIVATE', revision: 1 },
    { role: 'ADMIN' },
  ])
    expect(c.exerciseBankGovernanceInputSchema.safeParse(input).success).toBe(
      false,
    );
});
test('bank queries limit scope to explicit filters and bounded pagination', () => {
  expect(c.exerciseBankQuerySchema.parse({})).toEqual({ limit: 20 });
  expect(
    c.exerciseBankQuerySchema.parse({ search: '  funciones  ', limit: '100' }),
  ).toEqual({ search: 'funciones', limit: 100 });
  for (const input of [
    { limit: '' },
    { limit: 0 },
    { limit: 101 },
    { limit: 1.5 },
    { cursor: 'unsafe/cursor' },
    { cursor: 'a'.repeat(4097) },
    { search: 'a'.repeat(161) },
    { state: 'DISABLED' },
    { visibility: 'PUBLIC' },
    { ownerId: randomUUID() },
    { role: 'ADMIN' },
    { organizationId: randomUUID() },
    { conceptId: 'not-a-uuid' },
    { includeTests: true },
  ])
    expect(c.exerciseBankQuerySchema.safeParse(input).success).toBe(false);
  expect(
    c.exerciseBankUsesQuerySchema.parse({
      versionId: version.id,
      activityState: 'CLOSED',
    }),
  ).toMatchObject({ limit: 20, activityState: 'CLOSED' });
  expect(
    c.exerciseBankVersionsQuerySchema.safeParse({ state: 'ACTIVE' }).success,
  ).toBe(false);
  expect(
    c.exerciseBankUsesQuerySchema.safeParse({ activityState: 'ARCHIVED' })
      .success,
  ).toBe(false);
});
test('metadata preserves fixed concepts and rejects sensitive fields at every level', () => {
  expect(c.exerciseBankEntrySchema.parse(entry)).toEqual(entry);
  for (const patch of [
    { email: 'private@example.test' },
    { statement: 'private statement' },
    { tests: [] },
    { owner: { ...entry.owner, email: 'private@example.test' } },
    {
      currentVersion: {
        ...version,
        starterCode: 'module.exports.solve=()=>1;',
      },
    },
    {
      currentVersion: {
        ...version,
        concepts: [{ ...version.concepts[0], description: 'extra' }],
      },
    },
  ])
    expect(
      c.exerciseBankEntrySchema.safeParse({ ...entry, ...patch }).success,
    ).toBe(false);
  expect(
    c.exerciseBankVersionSchema.parse({ ...version, useCounts: counts })
      .version,
  ).toBe(25);
});
test('counts and page continuity cannot represent contradictory observations', () => {
  expect(
    c.exerciseBankUseCountsSchema.safeParse({ ...counts, total: 2 }).success,
  ).toBe(false);
  expect(
    c.exerciseBankUseCountsSchema.safeParse({
      total: 0,
      draft: -1,
      published: 1,
      closed: 0,
    }).success,
  ).toBe(false);
  expect(
    c.exerciseBankPageSchema.safeParse({
      hasMore: true,
      nextCursor: null,
      totalFiltered: 25,
    }).success,
  ).toBe(false);
  expect(
    c.exerciseBankPageSchema.safeParse({
      hasMore: false,
      nextCursor: 'abc',
      totalFiltered: 25,
    }).success,
  ).toBe(false);
});
test('all four envelopes are strict and preserve observation precision', () => {
  const page = { hasMore: false, nextCursor: null, totalFiltered: 1 };
  const common = { organizationId: entry.organizationId, observedAt, page };
  const requestId = randomUUID();
  const responses = [
    [c.exerciseBankListResponseSchema, { ...common, items: [entry] }],
    [c.exerciseBankDetailResponseSchema, { ...entry, observedAt }],
    [
      c.exerciseBankVersionsResponseSchema,
      {
        ...common,
        exerciseId: entry.id,
        items: [{ ...version, useCounts: counts }],
      },
    ],
    [
      c.exerciseBankUsesResponseSchema,
      {
        ...common,
        exerciseId: entry.id,
        items: [
          {
            assignmentId: randomUUID(),
            exerciseVersionId: version.id,
            version: version.version,
            activity: {
              id: randomUUID(),
              title: 'Actividad',
              state: 'PUBLISHED',
            },
            class: { id: randomUUID(), name: 'Clase', archived: true },
          },
        ],
      },
    ],
  ];
  for (const [schema, data] of responses) {
    expect(schema.parse({ data, requestId }).data.observedAt).toBe(observedAt);
    expect(
      schema.safeParse({ data: { ...data, students: [] }, requestId }).success,
    ).toBe(false);
    expect(schema.safeParse({ data, requestId, token: 'secret' }).success).toBe(
      false,
    );
  }
});
