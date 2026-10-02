/* eslint @typescript-eslint/no-require-imports: "off" */
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const c = require('@alunza/contracts');
const input = (code = 'module.exports.solve = (a,b) => a+b;') => ({
  code,
  exerciseVersionId: randomUUID(),
});
const result = () => ({
  executionId: randomUUID(),
  exerciseVersionId: randomUUID(),
  mode: 'RUN',
  admittedAt: '2026-09-26T12:00:00.000Z',
  finishedAt: '2026-09-26T12:00:01.000Z',
  technicalResult: {
    runnerVersion: 'imp-03',
    diagnosisCode: 'SUCCESS',
    terminationReason: 'COMPLETED',
    infrastructureStatus: 'OK',
    visibleTestResults: [
      { id: 'visible', passed: true, stdout: '', stderr: '' },
    ],
    visiblePassed: 1,
    visibleTotal: 1,
    outputTruncated: false,
    outputBytes: 0,
    runtimeMs: 100,
    lifecycleMs: 900,
  },
});
test('RUN valida bytes UTF-8 y Unicode sin normalizar ni recortar el programa', () => {
  for (const code of [
    'a'.repeat(65536),
    'é'.repeat(32768),
    '  // comentario\n',
  ])
    expect(c.runExecutionInputSchema.parse(input(code)).code).toBe(code);
  for (const code of [
    '',
    'é'.repeat(32769),
    'a'.repeat(65537),
    '\u0000',
    '\ud800',
  ])
    expect(c.runExecutionInputSchema.safeParse(input(code)).success).toBe(
      false,
    );
});
test.each([
  'tests',
  'limits',
  'studentId',
  'mode',
  'executionId',
  'diagnosisCode',
])('RUN rechaza campo cliente %s', (field) => {
  expect(
    c.runExecutionInputSchema.safeParse({ ...input(), [field]: 'untrusted' })
      .success,
  ).toBe(false);
});
test('RUN rechaza éxito parcial, contadores inventados y evidencia privada', () => {
  expect(c.runExecutionSchema.safeParse(result()).success).toBe(true);
  for (const patch of [
    { visibleTotal: 2 },
    { visiblePassed: 0 },
    { outputTruncated: true },
    {
      visibleTestResults: [
        { id: 'visible', passed: true, stdout: 'x', stderr: '' },
      ],
      outputBytes: 0,
    },
    { infrastructureStatus: 'FAILED' },
    { terminationReason: 'PROTOCOL_INVALID' },
    { privateTestResults: [] },
    { allRequiredPassed: true },
    {
      visibleTestResults: [
        { id: 'v', passed: true, stdout: 'x'.repeat(65536), stderr: 'x' },
      ],
    },
  ]) {
    const value = result();
    Object.assign(value.technicalResult, patch);
    expect(c.runExecutionSchema.safeParse(value).success).toBe(false);
  }
  expect(
    c.runExecutionSchema.safeParse({ ...result(), code: 'secret' }).success,
  ).toBe(false);
});
test('RUN representa fallo operativo sin inventar pruebas ejecutadas', () => {
  const value = result();
  Object.assign(value.technicalResult, {
    diagnosisCode: 'UNKNOWN',
    terminationReason: 'RUNNER_FAILURE',
    infrastructureStatus: 'FAILED',
    visibleTestResults: [],
    visiblePassed: 0,
  });
  expect(c.runExecutionSchema.safeParse(value).success).toBe(true);
  expect(
    c.runExecutionSchema.safeParse({ ...value, mode: 'SUBMIT' }).success,
  ).toBe(false);
});
test('OpenAPI publica RUN con idempotencia, resultado 201 y rechazo de campos extra', () => {
  const doc = JSON.parse(
    readFileSync(join(__dirname, '../packages/contracts/openapi.json'), 'utf8'),
  );
  const endpoint =
    doc.paths['/api/v1/activities/{id}/exercises/{aeId}/executions'].post;
  expect(
    endpoint.parameters.find((p) => p.name === 'Idempotency-Key').required,
  ).toBe(true);
  expect(endpoint.responses[201]).toBeDefined();
  expect(doc.components.schemas.RunExecutionInput.additionalProperties).toBe(
    false,
  );
  expect(
    Object.keys(doc.components.schemas.RunExecutionInput.properties).sort(),
  ).toEqual(['code', 'exerciseVersionId']);
});
