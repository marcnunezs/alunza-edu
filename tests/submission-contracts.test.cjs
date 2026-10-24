/* eslint @typescript-eslint/no-require-imports: "off" */
const { randomUUID } = require('node:crypto');
const c = require('@alunza/contracts');
const result = () => ({
  runnerVersion: 'imp-03',
  diagnosisCode: 'SUCCESS',
  terminationReason: 'COMPLETED',
  infrastructureStatus: 'OK',
  visibleTestResults: [{ id: 'v', passed: true, stdout: '', stderr: '' }],
  visiblePassed: 1,
  visibleTotal: 1,
  outputTruncated: false,
  outputBytes: 0,
  runtimeMs: 10,
  lifecycleMs: 1000,
  hiddenChecksPassed: true,
  allRequiredPassed: true,
});
const attempt = () => ({
  attemptId: randomUUID(),
  executionId: randomUUID(),
  activityId: randomUUID(),
  assignmentId: randomUUID(),
  exerciseVersionId: randomUUID(),
  testsVersion: 'a'.repeat(64),
  attemptNumber: 1,
  previousAttemptId: null,
  admittedAt: '2026-09-26T12:00:00Z',
  submittedAt: '2026-09-26T12:00:01Z',
  code: 'module.exports.solve=()=>5;',
  technicalResult: result(),
});
test('SUBMIT captura fuente exacta y rechaza autoridad aportada por cliente', () => {
  const value = {
    code: ' // código\n',
    exerciseVersionId: randomUUID(),
    previousAttemptId: randomUUID(),
  };
  expect(c.submitAttemptInputSchema.parse(value)).toEqual(value);
  for (const field of [
    'actorId',
    'studentId',
    'tests',
    'executionId',
    'limits',
    'allRequiredPassed',
  ])
    expect(
      c.submitAttemptInputSchema.safeParse({ ...value, [field]: true }).success,
    ).toBe(false);
});
test('SUBMIT no convierte pruebas visibles correctas en éxito canónico', () => {
  const value = result();
  value.diagnosisCode = 'FAILED_TEST';
  value.terminationReason = 'ASSERTION_FAILED';
  value.hiddenChecksPassed = false;
  value.allRequiredPassed = false;
  expect(c.submitTechnicalResultSchema.safeParse(value).success).toBe(true);
  for (const patch of [
    { allRequiredPassed: true },
    { diagnosisCode: 'SUCCESS' },
    { privateTestResults: [] },
    { score: 100 },
  ])
    expect(
      c.submitTechnicalResultSchema.safeParse({ ...value, ...patch }).success,
    ).toBe(false);
  expect(
    c.submitTechnicalResultSchema.safeParse({
      ...result(),
      hiddenChecksPassed: null,
    }).success,
  ).toBe(true);
});
test('SUBMIT exige intento recuperable coherente y lista sin fuente', () => {
  const value = attempt();
  expect(c.attemptSchema.safeParse(value).success).toBe(true);
  expect(
    c.attemptSchema.safeParse({ ...value, submittedAt: '2026-09-26T11:00:00Z' })
      .success,
  ).toBe(false);
  expect(c.attemptSchema.safeParse({ ...value, code: '\0' }).success).toBe(
    false,
  );
  const { code, ...summary } = value;
  expect(code).toBeTruthy();
  expect(c.attemptSummarySchema.safeParse(summary).success).toBe(true);
  expect(c.attemptSummarySchema.safeParse(value).success).toBe(false);
  for (const cursor of ['-1', '0', '1 OR true', '9007199254740992'])
    expect(c.attemptListQuerySchema.safeParse({ cursor }).success).toBe(false);
});
test('avance distingue denominador vacío, falta de intentos y evidencia', () => {
  const base = { activityId: randomUUID(), asOf: '2026-09-26T12:00:00Z' };
  for (const fields of [
    {
      completed: 0,
      required: 0,
      ratio: null,
      evidenceState: 'NO_REQUIRED_EXERCISES',
    },
    { completed: 0, required: 3, ratio: 0, evidenceState: 'NO_ATTEMPTS' },
    { completed: 1, required: 3, ratio: 1 / 3, evidenceState: 'HAS_EVIDENCE' },
  ])
    expect(
      c.activityProgressSchema.safeParse({ ...base, ...fields }).success,
    ).toBe(true);
  for (const fields of [
    {
      completed: 0,
      required: 0,
      ratio: 0,
      evidenceState: 'NO_REQUIRED_EXERCISES',
    },
    { completed: 1, required: 3, ratio: 0.33, evidenceState: 'HAS_EVIDENCE' },
    { completed: 1, required: 3, ratio: 1 / 3, evidenceState: 'NO_ATTEMPTS' },
    { completed: 2, required: 1, ratio: 1, evidenceState: 'HAS_EVIDENCE' },
  ])
    expect(
      c.activityProgressSchema.safeParse({ ...base, ...fields }).success,
    ).toBe(false);
});
