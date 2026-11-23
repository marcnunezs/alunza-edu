/* eslint @typescript-eslint/no-require-imports: "off" */
const { randomUUID } = require('node:crypto');
const c = require('@alunza/contracts');
const counts = (overrides = {}) => ({
  completed: 0,
  required: 3,
  ratio: 0,
  evidenceState: 'NO_ATTEMPTS',
  basisAttemptIds: [],
  ...overrides,
});
test('progreso rechaza identidad del alumno, campos extra y fechas sin zona', () => {
  const query = { classId: randomUUID() };
  expect(c.progressQuerySchema.parse(query)).toEqual(query);
  for (const patch of [
    { studentId: randomUUID() },
    { organizationId: randomUUID() },
    { score: 1 },
    { asOf: '2026-10-02T12:00:00' },
    { conceptId: 'all' },
  ])
    expect(
      c.progressQuerySchema.safeParse({ ...query, ...patch }).success,
    ).toBe(false);
  expect(
    c.activityOpenInputSchema.safeParse({ occurredAt: '2026-10-01T00:00:00Z' })
      .success,
  ).toBe(false);
});
test('corte normaliza offsets conservando la precisión de confirmación', () => {
  expect(
    c.progressQuerySchema.parse({
      classId: randomUUID(),
      asOf: '2026-10-02T09:00:00.123456-03:00',
    }).asOf,
  ).toBe('2026-10-02T12:00:00.123456Z');
});
test('contadores conservan fracción exacta y distinguen ausencia de requeridos', () => {
  const ids = [randomUUID(), randomUUID()];
  expect(
    c.progressCountersSchema.parse(
      counts({
        completed: 2,
        ratio: 2 / 3,
        evidenceState: 'HAS_EVIDENCE',
        basisAttemptIds: ids,
      }),
    ).ratio,
  ).toBe(2 / 3);
  expect(
    c.progressCountersSchema.safeParse(
      counts({
        required: 0,
        ratio: null,
        evidenceState: 'NO_REQUIRED_EXERCISES',
      }),
    ).success,
  ).toBe(true);
  for (const patch of [
    { ratio: 0.67 },
    { completed: 4 },
    { required: 0, ratio: 1 },
    {
      completed: 1,
      ratio: 1 / 3,
      evidenceState: 'NO_ATTEMPTS',
      basisAttemptIds: [ids[0]],
    },
    {
      completed: 2,
      ratio: 2 / 3,
      evidenceState: 'HAS_EVIDENCE',
      basisAttemptIds: [ids[0], ids[0]],
    },
  ])
    expect(c.progressCountersSchema.safeParse(counts(patch)).success).toBe(
      false,
    );
});
test('proyección exige evidencia única hasta el corte sin mezclar asignaciones', () => {
  const attempt = randomUUID();
  const evidence = {
    activityId: randomUUID(),
    activityExerciseId: randomUUID(),
    exerciseVersionId: randomUUID(),
    attemptId: attempt,
    submittedAt: '2026-10-02T12:00:00Z',
  };
  const summary = counts({
    completed: 1,
    ratio: 1 / 3,
    evidenceState: 'HAS_EVIDENCE',
    basisAttemptIds: [attempt],
  });
  const value = {
    classId: randomUUID(),
    filters: { activityId: null, conceptId: null },
    asOf: evidence.submittedAt,
    summary,
    byActivity: [],
    byConcept: [],
    evidence: [evidence],
    observation: {
      from: null,
      observedAt: evidence.submittedAt,
      lastActivityAt: null,
      summary: {
        attempts: 0,
        technicalFailures: 0,
        unverifiableAttempts: 0,
        hintsDelivered: 0,
        activityEvents: 0,
        byDiagnosis: [
          'SUCCESS',
          'SYNTAX_ERROR',
          'RUNTIME_ERROR',
          'FAILED_TEST',
          'TIMEOUT',
          'UNKNOWN',
        ].map((diagnosisCode) => ({ diagnosisCode, count: 0 })),
      },
      attempts: [],
      page: { hasMore: false, nextCursor: null },
    },
  };
  expect(c.studentProgressSchema.safeParse(value).success).toBe(true);
  for (const patch of [
    { evidence: [] },
    { evidence: [evidence, evidence] },
    { evidence: [{ ...evidence, submittedAt: '2026-10-02T12:00:01Z' }] },
    { evidence: [{ ...evidence, submittedAt: '2026-10-02T12:00:00.000001Z' }] },
    {
      byActivity: [
        {
          activityId: evidence.activityId,
          title: 'Otra',
          ...summary,
          basisAttemptIds: [randomUUID()],
        },
      ],
    },
  ])
    expect(
      c.studentProgressSchema.safeParse({ ...value, ...patch }).success,
    ).toBe(false);
});
