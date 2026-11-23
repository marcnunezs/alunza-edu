import { z } from 'zod';
import { studentProgressSchema } from './progress';
import { studentExerciseSchema } from './academic';
import { attemptSchema } from './submissions';
import { helpKindSchema, helpReferenceSchema } from './help';
import { ragHelpSchema, ragStatusSchema } from './rag';
import {
  dashboardQuerySchema,
  dashboardEvidenceSchema,
  dashboardSignalQuerySchema,
  dashboardSignalsSchema,
  dashboardSignalDetailSchema,
} from './dashboard';
import {
  observationQueryFields,
  observationPaginationFields,
  observationPeriodValid,
  observationDiagnosisSchema,
  observationPageSchema,
  progressInstantSchema as instant,
  progressUtcInstantSchema,
  progressMicros,
} from './progress-observation';

const id = z.uuid();
const context = {
  classId: id,
  studentId: id,
  asOf: instant,
  observedAt: instant,
};
const envelope = <T extends z.ZodType>(schema: T) =>
  z.strictObject({ data: schema, requestId: id });

export const studentDetailQuerySchema = dashboardQuerySchema;
export const studentDetailItemQuerySchema = z.strictObject({
  asOf: progressUtcInstantSchema.optional(),
});
export const studentDetailEvidenceQuerySchema = z
  .strictObject({
    ...observationQueryFields,
    ...observationPaginationFields,
    kind: z.enum(['ATTEMPT', 'COMPLETION', 'EVENT', 'HINT']).default('ATTEMPT'),
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
export const studentDetailFeedbackQuerySchema = z.strictObject({
  asOf: progressUtcInstantSchema.optional(),
  cursor: observationPaginationFields.cursor,
  limit: z.coerce.number().int().min(1).max(20).default(20),
});
export const studentDetailSignalsQuerySchema = dashboardSignalQuerySchema;

export const studentDetailProgressSchema = z
  .strictObject({
    ...context,
    organizationId: id,
    className: z.string().min(1),
    studentName: z.string().min(1),
    enrolledAt: instant,
    roster: z.literal('CURRENT_ACTIVE'),
    progress: studentProgressSchema,
  })
  .refine(
    (value) =>
      value.progress.classId === value.classId &&
      progressMicros(value.progress.asOf) === progressMicros(value.asOf) &&
      value.progress.observation.attempts.every(
        (item) => item.studentId === value.studentId,
      ),
    'El progreso no corresponde al estudiante y corte solicitados.',
  );
export const studentDetailEvidenceSchema = dashboardEvidenceSchema
  .extend({
    studentId: id,
  })
  .refine(
    (value) =>
      value.data.every(
        (item) =>
          ('attempt' in item
            ? item.attempt.studentId
            : item.event.studentId) === value.studentId,
      ),
    'La evidencia no corresponde al estudiante.',
  );
export const studentDetailExerciseSchema = studentExerciseSchema.pick({
  organizationId: true,
  classId: true,
  activityId: true,
  activityExerciseId: true,
  exerciseVersionId: true,
  activityState: true,
  title: true,
  statement: true,
  starterCode: true,
  difficulty: true,
  concepts: true,
  tests: true,
});
export const studentDetailAttemptSchema = z
  .strictObject({
    ...context,
    attempt: attemptSchema,
    exercise: studentDetailExerciseSchema,
  })
  .refine(
    (value) =>
      value.exercise.classId === value.classId &&
      value.exercise.activityId === value.attempt.activityId &&
      value.exercise.activityExerciseId === value.attempt.assignmentId &&
      value.exercise.exerciseVersionId === value.attempt.exerciseVersionId &&
      progressMicros(value.attempt.submittedAt) <= progressMicros(value.asOf),
    'El intento no corresponde a su contexto y corte.',
  );
export const studentDetailFeedbackSummarySchema = z
  .strictObject({
    id,
    attemptId: id,
    kind: helpKindSchema,
    hintLevel: z.number().int().min(1).max(3).nullable(),
    status: ragStatusSchema,
    createdAt: instant,
    deliveredAt: instant,
    available: z.boolean(),
  })
  .refine(
    (value) =>
      (value.kind === 'FEEDBACK'
        ? value.hintLevel === null
        : value.hintLevel !== null) &&
      progressMicros(value.createdAt) <= progressMicros(value.deliveredAt),
    'Entrega de ayuda incoherente.',
  );
export const studentDetailFeedbackValueSchema =
  studentDetailFeedbackSummarySchema
    .safeExtend({ help: ragHelpSchema.nullable() })
    .refine(
      (value) =>
        value.available === (value.help !== null) &&
        (value.help === null || value.status === value.help.status),
      'Disponibilidad de ayuda incoherente.',
    );
export const studentDetailFeedbackHistorySchema = z
  .strictObject({
    ...context,
    attemptId: id,
    items: z.array(studentDetailFeedbackSummarySchema).max(20),
    page: observationPageSchema,
  })
  .refine(
    (value) =>
      new Set(value.items.map((item) => item.id)).size === value.items.length &&
      value.items.every(
        (item) =>
          item.attemptId === value.attemptId &&
          progressMicros(item.deliveredAt) <= progressMicros(value.asOf),
      ),
    'Historial de ayuda fuera del intento o corte.',
  );
export const studentDetailFeedbackSchema = z
  .strictObject({
    ...context,
    feedback: studentDetailFeedbackValueSchema,
  })
  .refine(
    (value) =>
      progressMicros(value.feedback.deliveredAt) <= progressMicros(value.asOf),
    'La ayuda no estaba entregada al corte.',
  );
export const studentDetailReferenceSchema = z.strictObject({
  ...context,
  feedbackId: id,
  reference: helpReferenceSchema,
});
export const studentDetailSignalsSchema = dashboardSignalsSchema
  .extend({
    studentId: id,
  })
  .refine(
    (value) => value.data.every((item) => item.studentId === value.studentId),
    'Las señales no corresponden al estudiante.',
  );
export const studentDetailSignalSchema = dashboardSignalDetailSchema
  .extend({
    studentId: id,
  })
  .refine(
    (value) =>
      value.signal.studentId === value.studentId &&
      value.evidence.attempts.every(
        (item) => item.studentId === value.studentId,
      ) &&
      value.evidence.events.every((item) => item.studentId === value.studentId),
    'La señal y su evidencia deben pertenecer al estudiante.',
  );

export const studentDetailProgressResponseSchema = envelope(
  studentDetailProgressSchema,
);
export const studentDetailEvidenceResponseSchema = envelope(
  studentDetailEvidenceSchema,
);
export const studentDetailAttemptResponseSchema = envelope(
  studentDetailAttemptSchema,
);
export const studentDetailFeedbackHistoryResponseSchema = envelope(
  studentDetailFeedbackHistorySchema,
);
export const studentDetailFeedbackResponseSchema = envelope(
  studentDetailFeedbackSchema,
);
export const studentDetailReferenceResponseSchema = envelope(
  studentDetailReferenceSchema,
);
export const studentDetailSignalsResponseSchema = envelope(
  studentDetailSignalsSchema,
);
export const studentDetailSignalResponseSchema = envelope(
  studentDetailSignalSchema,
);

export type StudentDetailQuery = z.infer<typeof studentDetailQuerySchema>;
export type StudentDetailItemQuery = z.infer<
  typeof studentDetailItemQuerySchema
>;
export type StudentDetailEvidenceQuery = z.infer<
  typeof studentDetailEvidenceQuerySchema
>;
export type StudentDetailFeedbackQuery = z.infer<
  typeof studentDetailFeedbackQuerySchema
>;
export type StudentDetailSignalsQuery = z.infer<
  typeof studentDetailSignalsQuerySchema
>;
export type StudentDetailProgress = z.infer<typeof studentDetailProgressSchema>;
export type StudentDetailAttempt = z.infer<typeof studentDetailAttemptSchema>;
export type StudentDetailFeedback = z.infer<typeof studentDetailFeedbackSchema>;
export type StudentDetailFeedbackSummary = z.infer<
  typeof studentDetailFeedbackSummarySchema
>;
export type StudentDetailReference = z.infer<
  typeof studentDetailReferenceSchema
>;
export type StudentDetailSignals = z.infer<typeof studentDetailSignalsSchema>;
export type StudentDetailSignal = z.infer<typeof studentDetailSignalSchema>;
