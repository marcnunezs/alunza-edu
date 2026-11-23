import { z } from 'zod';

export const progressInstantSchema = z.iso
  .datetime({ offset: true })
  .refine(
    (value) => (value.match(/\.(\d+)/)?.[1].length ?? 0) <= 6,
    'La fecha admite como máximo seis decimales de segundo.',
  );
export const progressUtcInstantSchema = progressInstantSchema.transform(
  (value) => {
    const fraction = value.match(/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/)?.[1];
    return new Date(value)
      .toISOString()
      .replace(/\.\d{3}Z$/, fraction ? `.${fraction}Z` : 'Z');
  },
);
export function progressMicros(value: string): bigint {
  const fraction = value.match(/\.(\d+)/)?.[1] ?? '';
  return (
    BigInt(Date.parse(value.replace(/\.\d+/, ''))) * 1000n +
    BigInt(fraction.padEnd(6, '0'))
  );
}
export const observationQueryFields = {
  activityId: z.uuid().optional(),
  conceptId: z.uuid().optional(),
  from: progressUtcInstantSchema.optional(),
  asOf: progressUtcInstantSchema.optional(),
};
export const observationPaginationFields = {
  cursor: z
    .string()
    .min(1)
    .max(4096)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
};
export function observationPeriodValid(value: {
  from?: string;
  asOf?: string;
}) {
  // Object refinements can run after a field failed a non-aborting format check.
  // Leave malformed instants as validation errors instead of parsing NaN as BigInt.
  if (
    (value.from && !progressInstantSchema.safeParse(value.from).success) ||
    (value.asOf && !progressInstantSchema.safeParse(value.asOf).success)
  )
    return false;
  return (
    !value.from ||
    !value.asOf ||
    progressMicros(value.from) <= progressMicros(value.asOf)
  );
}
export const observationPageSchema = z
  .strictObject({
    hasMore: z.boolean(),
    nextCursor: z.string().min(1).max(4096).nullable(),
  })
  .refine((value) => value.hasMore === (value.nextCursor !== null));
export const observationDiagnosisSchema = z.enum([
  'SUCCESS',
  'SYNTAX_ERROR',
  'RUNTIME_ERROR',
  'FAILED_TEST',
  'TIMEOUT',
  'UNKNOWN',
]);
export const observationEventTypeSchema = z.enum([
  'CLASS_JOINED',
  'ACTIVITY_OPENED',
  'EXECUTION_COMPLETED',
  'ATTEMPT_SUBMITTED',
  'HINT_DELIVERED',
  'FEEDBACK_VIEWED',
]);
const count = z.number().int().nonnegative();
export const observationSummarySchema = z
  .strictObject({
    attempts: count,
    technicalFailures: count,
    unverifiableAttempts: count,
    hintsDelivered: count,
    activityEvents: count,
    byDiagnosis: z
      .array(
        z.strictObject({ diagnosisCode: observationDiagnosisSchema, count }),
      )
      .length(6),
  })
  .refine(
    (value) =>
      new Set(value.byDiagnosis.map((item) => item.diagnosisCode)).size === 6 &&
      value.byDiagnosis.reduce((sum, item) => sum + item.count, 0) ===
        value.attempts &&
      value.technicalFailures + value.unverifiableAttempts <= value.attempts &&
      value.hintsDelivered <= value.activityEvents,
    'Observaciones incoherentes.',
  );
export const observedAttemptSchema = z
  .strictObject({
    id: z.uuid(),
    studentId: z.uuid(),
    studentName: z.string().min(1),
    activityId: z.uuid(),
    activityTitle: z.string().min(1),
    activityExerciseId: z.uuid(),
    exerciseVersionId: z.uuid(),
    submittedAt: progressInstantSchema,
    diagnosisCode: observationDiagnosisSchema,
    visiblePassed: count.nullable(),
    visibleTotal: count.nullable(),
    allRequiredPassed: z.boolean(),
    verification: z.enum(['VERIFIED', 'UNVERIFIABLE']),
  })
  .refine(
    (value) =>
      (value.visiblePassed === null) === (value.visibleTotal === null) &&
      (value.visiblePassed === null ||
        value.visiblePassed <= value.visibleTotal!),
  );
export const observedEventSchema = z.strictObject({
  id: z.uuid(),
  studentId: z.uuid(),
  studentName: z.string().min(1),
  activityId: z.uuid().nullable(),
  occurredAt: progressInstantSchema,
  eventType: observationEventTypeSchema,
  referenceId: z.uuid().nullable(),
});
export const studentObservationSchema = z.strictObject({
  from: progressInstantSchema.nullable(),
  observedAt: progressInstantSchema,
  lastActivityAt: progressInstantSchema.nullable(),
  summary: observationSummarySchema,
  attempts: z.array(observedAttemptSchema),
  page: observationPageSchema,
});
export type ObservationSummary = z.infer<typeof observationSummarySchema>;
export type ObservedAttempt = z.infer<typeof observedAttemptSchema>;
