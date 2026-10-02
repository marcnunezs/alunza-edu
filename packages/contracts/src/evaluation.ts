import { z } from 'zod';

const id = z.uuid();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const amount = z.string().regex(/^(0|[1-9][0-9]{0,23})$/);
const count = z.number().int().min(0).max(1_000_000_000);
export const evaluationStageSchema = z.enum([
  'INGESTION',
  'CALIBRATION',
  'FUNCTIONAL',
  'EVALUATION',
]);
export const evaluationPhaseSchema = z.enum([
  'EMBEDDING',
  'GENERATION',
  'REVIEW',
]);
export const evaluationBudgetSchema = z.strictObject({
  maxCalls: count,
  maxInputTokens: count,
  maxOutputTokens: count,
  maxCostMicroUsd: amount,
});
export const evaluationProfileSchema = z.strictObject({
  id: z.string().min(1).max(160),
  model: z.string().min(1).max(160),
  fingerprint: hash,
  dimensions: z.number().int().min(1).max(16000).optional(),
  inputMicroUsdPerMillion: amount,
  outputMicroUsdPerMillion: amount,
});
const scope = {
  actorId: id,
  organizationId: id,
  classId: id,
  activityId: id.nullable(),
};
export const evaluationMaterialBindingSchema = z.strictObject({
  id,
  ...scope,
  sha256: hash,
  format: z.enum(['PDF', 'TXT', 'MARKDOWN']),
  operation: z.enum(['UPLOAD', 'REPLACE', 'REINDEX']),
  maxOperations: z.number().int().min(1).max(100),
});
export const evaluationCaseBindingSchema = z.strictObject({
  id,
  ...scope,
  activityId: id,
  attemptId: id,
  codeHash: hash,
  stage: z.enum(['CALIBRATION', 'FUNCTIONAL', 'EVALUATION']),
  maxOperations: z.number().int().min(1).max(100),
  calibration: z
    .strictObject({
      caseId: z.string().min(1).max(120),
      groupId: z.string().min(1).max(120),
      split: z.enum(['calibration', 'validation']),
      expected: z.enum(['SUPPORTED', 'NO_EVIDENCE', 'AMBIGUOUS']),
      relevantBindingIds: z.array(id).max(100),
    })
    .optional(),
  reviewCase: z
    .strictObject({
      caseId: z.string().min(1).max(120),
      candidate: z
        .record(z.string(), z.unknown())
        .refine(
          (x) =>
            new TextEncoder().encode(JSON.stringify(x)).byteLength <= 16384,
          'Candidate exceeds limit.',
        ),
      expected: z.enum(['ACCEPT', 'NO_EVIDENCE', 'REJECT']),
      boundaryExpected: z.boolean().default(false),
      refsMapping: z
        .array(
          z.strictObject({
            source_id: id,
            source_version_id: id,
            chunk_id: id,
            locator: z.string().min(1).max(1000),
            materialBindingId: id,
          }),
        )
        .max(5),
    })
    .optional(),
});
export const evaluationManifestSchema = z
  .strictObject({
    version: z.literal(1),
    runId: id,
    environment: z.enum(['LAB-EVAL', 'TEST']),
    provider: z.enum(['AZURE', 'TEST']),
    releaseSha: z.string().regex(/^[a-f0-9]{40,64}$/),
    environmentHash: hash,
    corpusHash: hash,
    approvedBy: z.string().min(1).max(120),
    priceVersion: z.string().min(1).max(160),
    approvalReference: z.string().min(1).max(200),
    expiresAt: z.iso.datetime({ offset: true }),
    globalBudget: evaluationBudgetSchema,
    stages: z.strictObject({
      INGESTION: evaluationBudgetSchema,
      CALIBRATION: evaluationBudgetSchema,
      FUNCTIONAL: evaluationBudgetSchema,
      EVALUATION: evaluationBudgetSchema,
    }),
    profiles: z.strictObject({
      EMBEDDING: evaluationProfileSchema,
      GENERATION: evaluationProfileSchema,
      REVIEW: evaluationProfileSchema,
    }),
    materials: z.array(evaluationMaterialBindingSchema).max(100),
    cases: z.array(evaluationCaseBindingSchema).max(1000),
  })
  .superRefine((value, ctx) => {
    if (value.environment === 'TEST' && value.provider !== 'TEST')
      ctx.addIssue({ code: 'custom', message: 'TEST never authorizes Azure.' });
    if (!value.profiles.EMBEDDING.dimensions)
      ctx.addIssue({
        code: 'custom',
        message: 'Embedding dimensions are required.',
      });
    const ids = [...value.materials, ...value.cases].map((x) => x.id);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: 'custom', message: 'Binding IDs must be unique.' });
    if (
      value.cases.some((x) => (x.stage === 'CALIBRATION') !== !!x.calibration)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Calibration metadata belongs to calibration cases only.',
      });
    if (value.cases.some((x) => x.reviewCase && x.stage !== 'EVALUATION'))
      ctx.addIssue({
        code: 'custom',
        message: 'Review fixtures belong to evaluation only.',
      });
  });
export const evaluationObservationSchema = z.strictObject({
  phase: evaluationPhaseSchema,
  outcome: z.enum(['RESPONSE', 'ERROR']),
  settledAt: z.iso.datetime({ offset: true }),
  aborted: z.boolean(),
  model: z.string().max(160).optional(),
  requestId: z.string().max(200).optional(),
  httpStatus: z.number().int().min(100).max(599).optional(),
  retryable: z.boolean().optional(),
  retryAfterMs: z.number().int().min(0).max(300000).optional(),
  usage: z
    .strictObject({
      inputTokens: count.optional(),
      outputTokens: count.optional(),
    })
    .optional(),
});
export const evaluationReceiptSchema = z.strictObject({
  callId: id,
  runId: id.nullable(),
  stage: evaluationStageSchema.nullable(),
  phase: evaluationPhaseSchema,
  state: z.enum(['DISPATCHED', 'COMPLETED', 'UNKNOWN']),
  provider: z.enum(['AZURE', 'TEST', 'UNSPECIFIED']),
  configurationId: z.string(),
  model: z.string(),
  observedModel: z.string().nullable(),
  dimensions: z.number().int().nullable(),
  inputHash: hash,
  dispatchedAt: z.iso.datetime({ offset: true }),
  settledAt: z.iso.datetime({ offset: true }).nullable(),
  outcome: z.enum(['RESPONSE', 'ERROR']).nullable(),
  inputTokens: count.nullable(),
  outputTokens: count.nullable(),
  requestId: z.string().nullable(),
  httpStatus: z.number().int().nullable(),
  retryable: z.boolean().nullable(),
  aborted: z.boolean().nullable(),
  reservedInputTokens: count,
  maxOutputTokens: count,
  reservedCostMicroUsd: amount.nullable(),
  observedCostMicroUsd: amount.nullable(),
});
export type EvaluationManifest = z.infer<typeof evaluationManifestSchema>;
export type EvaluationStage = z.infer<typeof evaluationStageSchema>;
export type EvaluationPhase = z.infer<typeof evaluationPhaseSchema>;
export type EvaluationObservation = z.infer<typeof evaluationObservationSchema>;
export type EvaluationReceipt = z.infer<typeof evaluationReceiptSchema>;

/** Exact conservative ceiling. Monetary values stay strings across JSON. */
export function evaluationCostMicroUsd(
  inputTokens: number,
  outputTokens: number,
  inputPrice: string,
  outputPrice: string,
): string {
  const numerator =
    BigInt(count.parse(inputTokens)) * BigInt(amount.parse(inputPrice)) +
    BigInt(count.parse(outputTokens)) * BigInt(amount.parse(outputPrice));
  return ((numerator + 999_999n) / 1_000_000n).toString();
}
