/* eslint @typescript-eslint/no-require-imports: "off" */
const { randomUUID } = require('node:crypto');
const c = require('@alunza/contracts');
const at = '2026-10-26T12:00:00.123456Z';
const diagnoses = [
  'SUCCESS',
  'SYNTAX_ERROR',
  'RUNTIME_ERROR',
  'FAILED_TEST',
  'TIMEOUT',
  'UNKNOWN',
];
const summary = {
  attempts: 3,
  technicalFailures: 2,
  unverifiableAttempts: 1,
  hintsDelivered: 1,
  activityEvents: 4,
  byDiagnosis: diagnoses.map((diagnosisCode) => ({
    diagnosisCode,
    count:
      diagnosisCode === 'FAILED_TEST' ? 2 : diagnosisCode === 'UNKNOWN' ? 1 : 0,
  })),
};

test('períodos conservan microsegundos y no admiten identidad o scope libre', () => {
  expect(
    c.dashboardQuerySchema.parse({
      from: '2026-10-26T09:00:00.123456-03:00',
      asOf: at,
    }),
  ).toEqual({ from: at, asOf: at });
  for (const patch of [
    { from: '2026-10-26T12:00:00.123457Z', asOf: at },
    { studentId: randomUUID() },
    { organizationId: randomUUID() },
    { role: 'ADMIN' },
    { asOf: '2026-10-26T12:00:00' },
    { limit: 101 },
    { limit: '' },
    { cursor: 'bad/cursor' },
  ])
    expect(c.dashboardQuerySchema.safeParse(patch).success).toBe(false);
  expect(c.dashboardQuerySchema.parse({ limit: '100' }).limit).toBe(100);
  expect(
    c.dashboardEvidenceQuerySchema.safeParse({
      kind: 'HINT',
      diagnosisCode: 'FAILED_TEST',
    }).success,
  ).toBe(false);
});

test('señales conservan estados persistidos y período inicial no filtra historia', () => {
  expect(c.dashboardSignalQuerySchema.parse({})).toEqual({ state: 'ACTIVE' });
  expect(c.dashboardSignalQuerySchema.parse({ state: 'ALL' }).state).toBe(
    'ALL',
  );
  for (const value of [
    { state: 'RESOLVED' },
    { state: 'NO_VERIFICABLE' },
    { from: at },
    { type: 'LOW_SCORE' },
    { includeCode: true },
  ])
    expect(c.dashboardSignalQuerySchema.safeParse(value).success).toBe(false);
  expect(
    c.dashboardSignalDetailQuerySchema.safeParse({
      asOf: at,
      studentId: randomUUID(),
    }).success,
  ).toBe(false);
});

test('observaciones no confunden desconocido, fallos verificables y ayuda concedida', () => {
  expect(c.observationSummarySchema.safeParse(summary).success).toBe(true);
  for (const patch of [
    { attempts: 4 },
    { technicalFailures: 3 },
    { hintsDelivered: 5 },
    {
      byDiagnosis: summary.byDiagnosis.map((v) => ({
        ...v,
        diagnosisCode: 'UNKNOWN',
      })),
    },
    { score: 1 },
  ])
    expect(
      c.observationSummarySchema.safeParse({ ...summary, ...patch }).success,
    ).toBe(false);
});

test('evidencia docente rechaza payload privado y preserva falta de cobertura visible', () => {
  const attempt = {
    id: randomUUID(),
    studentId: randomUUID(),
    studentName: 'Estudiante ficticio',
    activityId: randomUUID(),
    activityTitle: 'Actividad ficticia',
    activityExerciseId: randomUUID(),
    exerciseVersionId: randomUUID(),
    submittedAt: at,
    diagnosisCode: 'UNKNOWN',
    visiblePassed: null,
    visibleTotal: null,
    allRequiredPassed: false,
    verification: 'UNVERIFIABLE',
  };
  expect(c.observedAttemptSchema.safeParse(attempt).success).toBe(true);
  for (const patch of [
    { code: 'private' },
    { console: 'private' },
    { hiddenTests: [] },
    { visiblePassed: 0 },
    { visiblePassed: 2, visibleTotal: 1 },
  ])
    expect(
      c.observedAttemptSchema.safeParse({ ...attempt, ...patch }).success,
    ).toBe(false);
});

test('paginación y recuentos de señales no mezclan población vigente e histórica', () => {
  expect(
    c.observationPageSchema.safeParse({ hasMore: false, nextCursor: 'cursor' })
      .success,
  ).toBe(false);
  expect(
    c.dashboardSignalCountSchema.safeParse({
      type: 'INACTIVITY',
      state: 'ACTIVE',
      count: 3,
      currentStudents: 1,
      historicalStudents: 2,
    }).success,
  ).toBe(true);
  expect(
    c.dashboardSignalCountSchema.safeParse({
      type: 'INACTIVITY',
      state: 'ACTIVE',
      count: 3,
      currentStudents: 3,
      historicalStudents: 2,
    }).success,
  ).toBe(false);
});
