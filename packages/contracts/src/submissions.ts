import { z } from 'zod';
import { runExecutionInputSchema, runTechnicalResultSchema } from './practice';

export const submitAttemptInputSchema = runExecutionInputSchema.extend({
  previousAttemptId: z.uuid().optional(),
});

// This is a public projection, never the runner's private result protocol.
export const submitTechnicalResultSchema = runTechnicalResultSchema
  .safeExtend({
    hiddenChecksPassed: z.boolean().nullable(),
    allRequiredPassed: z.boolean(),
  })
  .superRefine((value, context) => {
    if (
      value.allRequiredPassed !== (value.diagnosisCode === 'SUCCESS') ||
      (value.allRequiredPassed && value.hiddenChecksPassed === false) ||
      (value.infrastructureStatus === 'FAILED' &&
        value.hiddenChecksPassed !== null)
    )
      context.addIssue({
        code: 'custom',
        message: 'Resultado de envío incoherente.',
      });
  });

const attemptFields = {
  attemptId: z.uuid(),
  executionId: z.uuid(),
  activityId: z.uuid(),
  assignmentId: z.uuid(),
  exerciseVersionId: z.uuid(),
  testsVersion: z.string().regex(/^[a-f0-9]{64}$/),
  attemptNumber: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  previousAttemptId: z.uuid().nullable(),
  admittedAt: z.iso.datetime({ offset: true }),
  submittedAt: z.iso.datetime({ offset: true }),
  technicalResult: submitTechnicalResultSchema,
};
const datesOrdered = (value: { admittedAt: string; submittedAt: string }) =>
  Date.parse(value.submittedAt) >= Date.parse(value.admittedAt);

export const attemptSummarySchema = z
  .strictObject(attemptFields)
  .refine(datesOrdered, 'Fechas de intento incoherentes.');
export const attemptSchema = z
  .strictObject({
    ...attemptFields,
    code: runExecutionInputSchema.shape.code,
  })
  .refine(datesOrdered, 'Fechas de intento incoherentes.');
export const attemptResponseSchema = z.strictObject({
  data: attemptSchema,
  requestId: z.uuid(),
});
export const attemptListQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(20).default(10),
  cursor: z
    .string()
    .regex(/^[1-9][0-9]{0,15}$/)
    .refine((value) => Number.isSafeInteger(Number(value)))
    .optional(),
});
export const attemptListResponseSchema = z.strictObject({
  data: z.array(attemptSummarySchema).max(20),
  page: z.strictObject({
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  }),
  requestId: z.uuid(),
});
export const activityProgressSchema = z
  .strictObject({
    activityId: z.uuid(),
    completed: z.number().int().nonnegative(),
    required: z.number().int().nonnegative(),
    ratio: z.number().finite().min(0).max(1).nullable(),
    evidenceState: z.enum([
      'NO_REQUIRED_EXERCISES',
      'NO_ATTEMPTS',
      'HAS_EVIDENCE',
    ]),
    asOf: z.iso.datetime({ offset: true }),
  })
  .superRefine((value, context) => {
    if (
      value.completed > value.required ||
      (value.required === 0
        ? value.ratio !== null ||
          value.evidenceState !== 'NO_REQUIRED_EXERCISES'
        : value.ratio !== value.completed / value.required ||
          value.evidenceState === 'NO_REQUIRED_EXERCISES') ||
      (value.evidenceState === 'NO_ATTEMPTS' && value.completed !== 0)
    )
      context.addIssue({ code: 'custom', message: 'Avance incoherente.' });
  });
export const activityProgressResponseSchema = z.strictObject({
  data: activityProgressSchema,
  requestId: z.uuid(),
});

export type SubmitAttemptInput = z.infer<typeof submitAttemptInputSchema>;
export type SubmitTechnicalResult = z.infer<typeof submitTechnicalResultSchema>;
export type Attempt = z.infer<typeof attemptSchema>;
export type AttemptSummary = z.infer<typeof attemptSummarySchema>;
export type AttemptListQuery = z.infer<typeof attemptListQuerySchema>;
export type ActivityProgress = z.infer<typeof activityProgressSchema>;
