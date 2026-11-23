/* eslint @typescript-eslint/no-require-imports: "off" */
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const c = require('@alunza/contracts');
const review = {
  signalId: randomUUID(),
  classId: randomUUID(),
  studentId: randomUUID(),
  state: 'REVIEWED',
  reviewedBy: randomUUID(),
  reviewedByName: 'Docente ficticio',
  reviewedAt: '2026-11-01T12:00:00.123456Z',
};

test('RF-019: entrada estricta sin autoridad, notas ni fecha cliente', () => {
  expect(c.signalReviewInputSchema.parse({})).toEqual({});
  for (const body of [
    null,
    undefined,
    [],
    { reviewedBy: review.reviewedBy },
    { reviewedAt: review.reviewedAt },
    { state: 'REVIEWED' },
    { note: 'texto' },
    { score: 1 },
  ])
    expect(c.signalReviewInputSchema.safeParse(body).success).toBe(false);
  for (const query of [
    { asOf: review.reviewedAt },
    { classId: review.classId },
    { studentId: review.studentId },
  ])
    expect(c.signalReviewQuerySchema.safeParse(query).success).toBe(false);
});

test('RF-019: resultado vigente mínimo con precisión y primer responsable', () => {
  expect(c.signalReviewSchema.parse(review)).toEqual(review);
  expect(
    c.signalReviewSchema.parse({ ...review, reviewedByName: null })
      .reviewedByName,
  ).toBeNull();
  for (const patch of [
    { state: 'ACTIVE' },
    { state: 'RESOLVED' },
    { reviewedBy: null },
    { reviewedAt: null },
    { reviewedAt: 'bad-date' },
    { reviewedByName: '' },
    { snapshot: {} },
    { code: 'private' },
    { email: 'private@example.test' },
  ])
    expect(
      c.signalReviewSchema.safeParse({ ...review, ...patch }).success,
    ).toBe(false);
});

test('RF-019 OpenAPI describe PUT protegido con entrada vacía e idempotencia por episodio', () => {
  const api = JSON.parse(
    readFileSync(require.resolve('../packages/contracts/openapi.json'), 'utf8'),
  );
  const route = api.paths['/api/v1/signals/{id}/review'];
  expect(Object.keys(route)).toEqual(['put']);
  expect(route.put.security).toEqual([{ bearerAuth: [] }]);
  expect(route.put.parameters.map((p) => p.name)).toEqual(['id']);
  expect(route.put.requestBody.required).toBe(true);
  expect(api.components.schemas.SignalReviewInput.additionalProperties).toBe(
    false,
  );
  expect(api.components.schemas.SignalReviewInput.properties).toEqual({});
  expect(route.put.responses['200']).toBeDefined();
});
