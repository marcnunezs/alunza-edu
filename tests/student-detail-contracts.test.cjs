/* eslint @typescript-eslint/no-require-imports: "off" */
const { randomUUID } = require('node:crypto');
const c = require('@alunza/contracts');
const at = '2026-10-27T10:00:00.123456Z';
const context = {
  classId: randomUUID(),
  studentId: randomUUID(),
  asOf: at,
  observedAt: at,
};
const delivered = {
  id: randomUUID(),
  attemptId: randomUUID(),
  kind: 'FEEDBACK',
  hintLevel: null,
  status: 'NO_EVIDENCE',
  createdAt: at,
  deliveredAt: at,
  available: true,
  help: {
    diagnosis_code: 'FAILED_TEST',
    explanation: 'No hay fuentes autorizadas.',
    hint: '',
    source_refs: [],
    status: 'NO_EVIDENCE',
  },
};

test('teacher queries cannot substitute actor/student, request commands or widen filters', () => {
  for (const schema of [
    c.studentDetailQuerySchema,
    c.studentDetailEvidenceQuerySchema,
    c.studentDetailFeedbackQuerySchema,
    c.studentDetailItemQuerySchema,
    c.studentDetailSignalsQuerySchema,
  ]) {
    expect(schema.safeParse({}).success).toBe(true);
    for (const value of [
      { studentId: randomUUID() },
      { role: 'ADMIN' },
      { includeHidden: true },
      { includeUndelivered: true },
      { asOf: '2026-10-27T10:00:00' },
      { asOf: 'malformed' },
    ])
      expect(schema.safeParse(value).success).toBe(false);
  }
  expect(c.studentDetailFeedbackQuerySchema.parse({}).limit).toBe(20);
  for (const schema of [
    c.studentDetailQuerySchema,
    c.studentDetailEvidenceQuerySchema,
  ]) {
    for (const from of ['malformed', '2026-99-99T10:00:00Z'])
      expect(schema.safeParse({ from, asOf: at }).success).toBe(false);
  }
  expect(
    c.studentDetailFeedbackQuerySchema.safeParse({ limit: 21 }).success,
  ).toBe(false);
  expect(
    c.studentDetailEvidenceQuerySchema.safeParse({
      kind: 'HINT',
      diagnosisCode: 'FAILED_TEST',
    }).success,
  ).toBe(false);
  expect(
    c.studentDetailSignalsQuerySchema.safeParse({ from: at }).success,
  ).toBe(false);
  expect(
    c.studentDetailQuerySchema.safeParse({
      from: '2026-10-27T10:00:00.123457Z',
      asOf: at,
    }).success,
  ).toBe(false);
});

test('teacher help omits presentation capabilities and rejects availability/text mismatch', () => {
  const schema = c.studentDetailFeedbackSchema;
  expect(
    schema.parse({ ...context, feedback: delivered }).feedback.help,
  ).toEqual(delivered.help);
  expect(
    schema.parse({
      ...context,
      feedback: { ...delivered, available: false, help: null },
    }).feedback.help,
  ).toBeNull();
  for (const feedback of [
    { ...delivered, presentationToken: randomUUID() },
    { ...delivered, capabilities: { canHint: true } },
    { ...delivered, available: false },
    { ...delivered, help: null },
    { ...delivered, deliveredAt: '2026-10-27T10:00:00.123457Z' },
    { ...delivered, hintLevel: 1 },
    { ...delivered, help: { ...delivered.help, score: 1 } },
  ])
    expect(schema.safeParse({ ...context, feedback }).success).toBe(false);
});

test('teacher history cannot splice another attempt, duplicate deliveries or cross cutoff', () => {
  const { help: _help, ...summary } = delivered;
  const history = {
    ...context,
    attemptId: delivered.attemptId,
    items: [summary],
    page: { hasMore: false, nextCursor: null },
  };
  expect(c.studentDetailFeedbackHistorySchema.safeParse(history).success).toBe(
    true,
  );
  for (const items of [
    [summary, summary],
    [{ ...summary, attemptId: randomUUID() }],
    [{ ...summary, deliveredAt: '2026-10-27T10:00:01Z' }],
  ])
    expect(
      c.studentDetailFeedbackHistorySchema.safeParse({ ...history, items })
        .success,
    ).toBe(false);
});

test('teacher exercise tests allow only visible definitions', () => {
  const tests = c.studentDetailExerciseSchema.shape.tests;
  const visible = {
    id: 'visible-1',
    visibility: 'visible',
    args: [1],
    expected: 2,
  };
  expect(tests.parse([visible])).toEqual([visible]);
  expect(tests.safeParse([{ ...visible, visibility: 'hidden' }]).success).toBe(
    false,
  );
  expect(tests.safeParse([{ ...visible, privateResult: {} }]).success).toBe(
    false,
  );
  expect(c.studentDetailExerciseSchema.shape).not.toHaveProperty('canEdit');
});
