import { z } from 'zod';

export const RUN_CODE_BYTES = 65536;
const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
const validText = (value: string) =>
  [...value].every((character) => {
    const point = character.codePointAt(0)!;
    return point !== 0 && !(point >= 0xd800 && point <= 0xdfff);
  });

export const runExecutionInputSchema = z.strictObject({
  code: z
    .string()
    .min(1)
    .max(RUN_CODE_BYTES)
    .refine(validText, 'Unicode inválido.')
    .refine(
      (value) => bytes(value) <= RUN_CODE_BYTES,
      'El código supera 65536 bytes UTF-8.',
    ),
  exerciseVersionId: z.uuid(),
});
export const runDiagnosisSchema = z.enum([
  'SUCCESS',
  'SYNTAX_ERROR',
  'RUNTIME_ERROR',
  'FAILED_TEST',
  'TIMEOUT',
  'UNKNOWN',
]);
export const runTerminationReasonSchema = z.enum([
  'COMPLETED',
  'STUDENT_SYNTAX',
  'STUDENT_EXCEPTION',
  'ASSERTION_FAILED',
  'EXECUTION_DEADLINE',
  'MEMORY_LIMIT',
  'OUTPUT_LIMIT',
  'RETURN_LIMIT',
  'PROTOCOL_INVALID',
  'RUNNER_FAILURE',
  'PROVIDER_FAILURE',
  'CAPABILITY_GAP',
  'CANCELLED',
]);
const consoleText = z
  .string()
  .max(65536)
  .refine((value) => bytes(value) <= 65536);
const visibleTest = z.strictObject({
  id: z.string().min(1).max(100),
  passed: z.boolean(),
  stdout: consoleText,
  stderr: consoleText,
});
export const runTechnicalResultSchema = z
  .strictObject({
    runnerVersion: z.string().min(1).max(100),
    diagnosisCode: runDiagnosisSchema,
    terminationReason: runTerminationReasonSchema,
    infrastructureStatus: z.enum(['OK', 'FAILED']),
    visibleTestResults: z.array(visibleTest).max(8),
    visiblePassed: z.number().int().min(0).max(8),
    visibleTotal: z.number().int().min(1).max(8),
    outputTruncated: z.boolean(),
    outputBytes: z.number().int().min(0).max(65536),
    runtimeMs: z.number().finite().nonnegative(),
    lifecycleMs: z.number().finite().nonnegative(),
  })
  .superRefine((value, context) => {
    const cases = value.visibleTestResults;
    const allPassed =
      cases.length === value.visibleTotal && cases.every((item) => item.passed);
    if (
      cases.length > value.visibleTotal ||
      new Set(cases.map((item) => item.id)).size !== cases.length ||
      value.visiblePassed !== cases.filter((item) => item.passed).length ||
      cases.reduce(
        (sum, item) => sum + bytes(item.stdout) + bytes(item.stderr),
        0,
      ) > value.outputBytes ||
      (value.infrastructureStatus === 'FAILED' &&
        value.diagnosisCode !== 'UNKNOWN') ||
      (value.diagnosisCode === 'SUCCESS' &&
        (!allPassed ||
          value.outputTruncated ||
          value.infrastructureStatus !== 'OK' ||
          value.terminationReason !== 'COMPLETED'))
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Resultado de práctica incoherente.',
      });
    }
  });
export const runExecutionSchema = z
  .strictObject({
    executionId: z.uuid(),
    exerciseVersionId: z.uuid(),
    mode: z.literal('RUN'),
    admittedAt: z.iso.datetime({ offset: true }),
    finishedAt: z.iso.datetime({ offset: true }),
    technicalResult: runTechnicalResultSchema,
  })
  .refine(
    (value) => Date.parse(value.finishedAt) >= Date.parse(value.admittedAt),
    'Fechas de ejecución incoherentes.',
  );
export const runExecutionResponseSchema = z.strictObject({
  data: runExecutionSchema,
  requestId: z.uuid(),
});
export type RunExecutionInput = z.infer<typeof runExecutionInputSchema>;
export type RunExecution = z.infer<typeof runExecutionSchema>;
export type RunTechnicalResult = z.infer<typeof runTechnicalResultSchema>;
