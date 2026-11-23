import { z } from 'zod';
import {
  observationPaginationFields,
  observationPeriodValid,
  studentObservationSchema,
} from './progress-observation';

const instant = z.iso
  .datetime({ offset: true })
  .refine(
    (value) => (value.match(/\.(\d+)/)?.[1].length ?? 0) <= 6,
    'La fecha admite como máximo seis decimales de segundo.',
  );
const utcInstant = instant.transform((value) => {
  // Preserve sub-millisecond precision when normalizing an offset. PostgreSQL
  // records confirmation times more precisely than JavaScript's Date.
  const fraction = value.match(/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/)?.[1];
  return new Date(value)
    .toISOString()
    .replace(/\.\d{3}Z$/, fraction ? `.${fraction}Z` : 'Z');
});

function microsecondInstant(value: string): bigint {
  const fraction = value.match(/\.(\d+)/)?.[1] ?? '';
  const wholeSecond = value.replace(/\.\d+/, '');
  return (
    BigInt(Date.parse(wholeSecond)) * 1000n + BigInt(fraction.padEnd(6, '0'))
  );
}

export const progressQuerySchema = z
  .strictObject({
    classId: z.uuid(),
    activityId: z.uuid().optional(),
    conceptId: z.uuid().optional(),
    asOf: utcInstant.optional(),
    from: utcInstant.optional(),
    ...observationPaginationFields,
  })
  .refine(observationPeriodValid, {
    path: ['from'],
    message: 'El inicio debe ser anterior o igual al corte.',
  });

const counterFields = {
  completed: z.number().int().nonnegative(),
  required: z.number().int().nonnegative(),
  ratio: z.number().finite().min(0).max(1).nullable(),
  evidenceState: z.enum([
    'NO_REQUIRED_EXERCISES',
    'NO_ATTEMPTS',
    'HAS_EVIDENCE',
  ]),
  basisAttemptIds: z.array(z.uuid()),
};
type Counters = z.infer<typeof progressCountersSchema>;
function coherentCounters(value: {
  completed: number;
  required: number;
  ratio: number | null;
  evidenceState: string;
  basisAttemptIds: string[];
}) {
  return (
    value.completed <= value.required &&
    (value.required === 0
      ? value.ratio === null && value.evidenceState === 'NO_REQUIRED_EXERCISES'
      : value.ratio === value.completed / value.required &&
        value.evidenceState !== 'NO_REQUIRED_EXERCISES') &&
    (value.evidenceState !== 'NO_ATTEMPTS' || value.completed === 0) &&
    value.basisAttemptIds.length === value.completed &&
    new Set(value.basisAttemptIds).size === value.basisAttemptIds.length
  );
}
export const progressCountersSchema = z
  .strictObject(counterFields)
  .refine(coherentCounters, 'Avance incoherente.');
export const progressActivitySchema = z
  .strictObject({
    activityId: z.uuid(),
    title: z.string().min(1).max(200),
    ...counterFields,
  })
  .refine(coherentCounters, 'Avance de actividad incoherente.');
export const progressConceptSchema = z
  .strictObject({
    conceptId: z.uuid(),
    name: z.string().min(1).max(160),
    conceptVersionIds: z.array(z.uuid()).min(1),
    ...counterFields,
  })
  .refine(coherentCounters, 'Avance de concepto incoherente.');
export const progressEvidenceSchema = z.strictObject({
  activityId: z.uuid(),
  activityExerciseId: z.uuid(),
  exerciseVersionId: z.uuid(),
  attemptId: z.uuid(),
  submittedAt: instant,
});
export const studentProgressSchema = z
  .strictObject({
    classId: z.uuid(),
    filters: z.strictObject({
      activityId: z.uuid().nullable(),
      conceptId: z.uuid().nullable(),
    }),
    asOf: instant,
    summary: progressCountersSchema,
    byActivity: z.array(progressActivitySchema),
    byConcept: z.array(progressConceptSchema),
    evidence: z.array(progressEvidenceSchema),
    observation: studentObservationSchema,
  })
  .superRefine((value, context) => {
    const basis = new Set(value.summary.basisAttemptIds);
    const evidence = new Set(value.evidence.map((item) => item.attemptId));
    const assignments = new Set(
      value.evidence.map((item) => item.activityExerciseId),
    );
    const rows: Counters[] = [...value.byActivity, ...value.byConcept];
    if (
      evidence.size !== value.evidence.length ||
      assignments.size !== value.evidence.length ||
      basis.size !== evidence.size ||
      [...basis].some((id) => !evidence.has(id)) ||
      rows.some((row) => row.basisAttemptIds.some((id) => !basis.has(id))) ||
      value.evidence.some(
        (item) =>
          microsecondInstant(item.submittedAt) > microsecondInstant(value.asOf),
      ) ||
      (value.observation.from !== null &&
        microsecondInstant(value.observation.from) >
          microsecondInstant(value.asOf)) ||
      value.observation.attempts.some(
        (item) =>
          microsecondInstant(item.submittedAt) >
            microsecondInstant(value.asOf) ||
          (value.observation.from !== null &&
            microsecondInstant(item.submittedAt) <
              microsecondInstant(value.observation.from)),
      ) ||
      (value.observation.lastActivityAt !== null &&
        microsecondInstant(value.observation.lastActivityAt) >
          microsecondInstant(value.asOf)) ||
      new Set(value.byActivity.map((item) => item.activityId)).size !==
        value.byActivity.length ||
      new Set(value.byConcept.map((item) => item.conceptId)).size !==
        value.byConcept.length
    )
      context.addIssue({
        code: 'custom',
        message: 'Evidencia de progreso incoherente.',
      });
  });
export const studentProgressResponseSchema = z.strictObject({
  data: studentProgressSchema,
  requestId: z.uuid(),
});
export const activityOpenInputSchema = z.strictObject({});
export const activityOpenSchema = z.strictObject({
  eventId: z.uuid(),
  activityId: z.uuid(),
  occurredAt: instant,
});
export const activityOpenResponseSchema = z.strictObject({
  data: activityOpenSchema,
  requestId: z.uuid(),
});

export type ProgressQuery = z.infer<typeof progressQuerySchema>;
export type StudentProgress = z.infer<typeof studentProgressSchema>;
export type ProgressCounters = Counters;
