import { z } from 'zod';
import {
  progressInstantSchema as instant,
  progressUtcInstantSchema,
  observationQueryFields,
  observationPaginationFields,
  observationPeriodValid,
  observationPageSchema,
  observationSummarySchema,
  observationDiagnosisSchema,
  observedAttemptSchema,
  observedEventSchema,
} from './progress-observation';
import { signalRuleCreateSchema, signalRuleTypeSchema } from './signal-rules';

const count = z.number().int().nonnegative();
const counters = {
  completed: count,
  required: count,
  ratio: z.number().finite().min(0).max(1).nullable(),
  evidenceState: z.enum([
    'NO_REQUIRED_EXERCISES',
    'NO_ATTEMPTS',
    'HAS_EVIDENCE',
  ]),
};
const coherent = (value: {
  completed: number;
  required: number;
  ratio: number | null;
  evidenceState: string;
}) =>
  value.completed <= value.required &&
  (value.required === 0
    ? value.ratio === null && value.evidenceState === 'NO_REQUIRED_EXERCISES'
    : value.ratio === value.completed / value.required &&
      value.evidenceState !== 'NO_REQUIRED_EXERCISES') &&
  (value.evidenceState !== 'NO_ATTEMPTS' || value.completed === 0);
export const dashboardQuerySchema = z
  .strictObject({
    ...observationQueryFields,
    ...observationPaginationFields,
  })
  .refine(observationPeriodValid, {
    path: ['from'],
    message: 'El inicio debe ser anterior o igual al corte.',
  });
export const dashboardEvidenceQuerySchema = z
  .strictObject({
    ...observationQueryFields,
    ...observationPaginationFields,
    kind: z.enum(['ATTEMPT', 'COMPLETION', 'EVENT', 'HINT']).default('ATTEMPT'),
    studentId: z.uuid().optional(),
    diagnosisCode: observationDiagnosisSchema.optional(),
  })
  .refine(observationPeriodValid, {
    path: ['from'],
    message: 'El inicio debe ser anterior o igual al corte.',
  })
  .refine((value) => !value.diagnosisCode || value.kind === 'ATTEMPT', {
    path: ['diagnosisCode'],
    message: 'El diagnóstico solo filtra intentos.',
  });
export const dashboardSignalQuerySchema = z.strictObject({
  activityId: z.uuid().optional(),
  conceptId: z.uuid().optional(),
  asOf: progressUtcInstantSchema.optional(),
  ...observationPaginationFields,
  type: signalRuleTypeSchema.optional(),
  state: z.enum(['ACTIVE', 'REVIEWED', 'ALL']).default('ACTIVE'),
});
export const dashboardSignalDetailQuerySchema = z.strictObject({
  asOf: progressUtcInstantSchema.optional(),
});
export const signalProcessingSchema = z.strictObject({
  status: z.enum(['UP_TO_DATE', 'PENDING', 'FAILED', 'NOT_EVALUATED']),
  evaluatedAt: instant.nullable(),
  processedThrough: instant.nullable(),
  pendingLanes: count,
  failedLanes: count,
  unconfiguredTypes: z.array(signalRuleTypeSchema),
});
export const dashboardSignalCountSchema = z
  .strictObject({
    type: signalRuleTypeSchema,
    state: z.enum(['ACTIVE', 'REVIEWED']),
    count,
    currentStudents: count,
    historicalStudents: count,
  })
  .refine(
    (value) => value.count === value.currentStudents + value.historicalStudents,
  );
export const dashboardStudentSchema = z
  .strictObject({
    studentId: z.uuid(),
    studentName: z.string().min(1),
    ...counters,
    lastActivityAt: instant.nullable(),
    period: observationSummarySchema,
    signals: z.array(dashboardSignalCountSchema),
  })
  .refine(coherent);
const filters = z.strictObject({
  activityId: z.uuid().nullable(),
  conceptId: z.uuid().nullable(),
  from: instant.nullable(),
});
export const dashboardSchema = z.strictObject({
  classId: z.uuid(),
  organizationId: z.uuid(),
  className: z.string().min(1),
  filters,
  asOf: instant,
  observedAt: instant,
  roster: z.literal('CURRENT_ACTIVE'),
  summary: z
    .strictObject({
      students: count,
      ...counters,
      lastActivityAt: instant.nullable(),
      period: observationSummarySchema,
    })
    .refine(coherent),
  byActivity: z.array(
    z
      .strictObject({
        activityId: z.uuid(),
        title: z.string().min(1),
        ...counters,
        period: observationSummarySchema,
      })
      .refine(coherent),
  ),
  byConcept: z.array(
    z
      .strictObject({
        conceptId: z.uuid(),
        name: z.string().min(1),
        conceptVersionIds: z.array(z.uuid()),
        ...counters,
        period: observationSummarySchema,
      })
      .refine(coherent),
  ),
  students: z.strictObject({
    data: z.array(dashboardStudentSchema),
    page: observationPageSchema,
  }),
  signals: z.strictObject({
    counts: z.array(dashboardSignalCountSchema),
    processing: signalProcessingSchema,
  }),
});
export const dashboardResponseSchema = z.strictObject({
  data: dashboardSchema,
  requestId: z.uuid(),
});
export const dashboardEvidenceItemSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('ATTEMPT'),
    attempt: observedAttemptSchema,
  }),
  z.strictObject({
    kind: z.literal('COMPLETION'),
    attempt: observedAttemptSchema,
  }),
  z.strictObject({ kind: z.literal('EVENT'), event: observedEventSchema }),
  z.strictObject({ kind: z.literal('HINT'), event: observedEventSchema }),
]);
export const dashboardEvidenceSchema = z.strictObject({
  classId: z.uuid(),
  filters,
  asOf: instant,
  observedAt: instant,
  kind: z.enum(['ATTEMPT', 'COMPLETION', 'EVENT', 'HINT']),
  studentId: z.uuid().nullable(),
  diagnosisCode: observationDiagnosisSchema.nullable(),
  data: z.array(dashboardEvidenceItemSchema),
  page: observationPageSchema,
});
export const dashboardEvidenceResponseSchema = z.strictObject({
  data: dashboardEvidenceSchema,
  requestId: z.uuid(),
});
export const signalEvaluationSummarySchema = z.strictObject({
  id: z.uuid(),
  evaluationTime: instant,
  calculatedAt: instant,
  outcome: z.enum(['MATCH', 'NO_MATCH', 'NOT_EVALUABLE', 'NOT_VERIFIABLE']),
  reason: z.string(),
});
export const dashboardSignalSchema = z
  .strictObject({
    id: z.uuid(),
    type: signalRuleTypeSchema,
    state: z.enum(['ACTIVE', 'REVIEWED']),
    studentId: z.uuid(),
    studentName: z.string().min(1),
    currentMember: z.boolean(),
    activityId: z.uuid(),
    activityTitle: z.string().min(1),
    activityExerciseId: z.uuid().nullable(),
    rule: z.strictObject({
      id: z.uuid(),
      version: z.number().int().positive(),
      configuration: signalRuleCreateSchema,
    }),
    cause: z.string(),
    qualifiedAt: instant,
    calculatedAt: instant,
    reviewedAt: instant.nullable(),
    reviewedBy: z.uuid().nullable(),
    reviewedByName: z.string().min(1).max(120).nullable(),
    stoppedAt: instant.nullable(),
    stopReason: z.string().nullable(),
    previousEpisodeId: z.uuid().nullable(),
    lastEvaluation: signalEvaluationSummarySchema.nullable(),
    verification: z.enum(['VERIFIABLE', 'UNVERIFIABLE']),
  })
  .refine(
    (value) =>
      value.type === value.rule.configuration.type &&
      (value.state === 'REVIEWED'
        ? value.reviewedAt !== null && value.reviewedBy !== null
        : value.reviewedAt === null &&
          value.reviewedBy === null &&
          value.reviewedByName === null),
  );
export const dashboardSignalsSchema = z.strictObject({
  classId: z.uuid(),
  asOf: instant,
  observedAt: instant,
  filters: z.strictObject({
    activityId: z.uuid().nullable(),
    conceptId: z.uuid().nullable(),
    type: signalRuleTypeSchema.nullable(),
    state: z.enum(['ACTIVE', 'REVIEWED', 'ALL']),
  }),
  processing: signalProcessingSchema,
  data: z.array(dashboardSignalSchema),
  page: observationPageSchema,
});
export const dashboardSignalsResponseSchema = z.strictObject({
  data: dashboardSignalsSchema,
  requestId: z.uuid(),
});
export const signalPublicEvidenceSchema = z.strictObject({
  attempts: z.array(observedAttemptSchema),
  events: z.array(observedEventSchema),
  baselineAt: instant.nullable(),
  observableSince: instant.nullable(),
  lastAt: instant.nullable(),
  explanation: z.string(),
});
export const dashboardSignalDetailSchema = z.strictObject({
  classId: z.uuid(),
  asOf: instant,
  observedAt: instant,
  signal: dashboardSignalSchema,
  evidence: signalPublicEvidenceSchema,
});
export const dashboardSignalDetailResponseSchema = z.strictObject({
  data: dashboardSignalDetailSchema,
  requestId: z.uuid(),
});
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;
export type DashboardEvidenceQuery = z.infer<
  typeof dashboardEvidenceQuerySchema
>;
export type DashboardSignalQuery = z.infer<typeof dashboardSignalQuerySchema>;
export type DashboardSignalDetailQuery = z.infer<
  typeof dashboardSignalDetailQuerySchema
>;
export type Dashboard = z.infer<typeof dashboardSchema>;
export type DashboardEvidence = z.infer<typeof dashboardEvidenceSchema>;
export type DashboardSignals = z.infer<typeof dashboardSignalsSchema>;
export type DashboardSignal = z.infer<typeof dashboardSignalSchema>;
export type DashboardSignalDetail = z.infer<typeof dashboardSignalDetailSchema>;
