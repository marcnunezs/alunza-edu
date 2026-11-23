import { z } from 'zod';
import { signalRuleVersionSchema } from '@alunza/contracts';
import { inactivityInputSchema } from './inactivity';
import { repeatedErrorInputSchema } from './repeated-error';

const instant = z.iso
  .datetime({ offset: true })
  .refine((value) => (value.match(/\.(\d+)/)?.[1]?.length ?? 0) <= 6);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const signalLaneSchema = z.strictObject({
  laneId: z.uuid(),
  type: z.enum(['INACTIVITY', 'REPEATED_ERROR', 'STAGNATION']),
  organizationId: z.uuid(),
  classId: z.uuid(),
  studentId: z.uuid(),
  activityId: z.uuid(),
  assignmentId: z.uuid().nullable(),
});
export const signalLeaseSchema = signalLaneSchema.extend({
  leaseToken: z.uuid(),
  leaseUntil: instant,
});
export const signalBoundarySchema = z.strictObject({
  kind: z.enum([
    'START',
    'SUBMISSION',
    'EVENT',
    'RULE_ACTIVATED',
    'AVAILABILITY',
    'COVERAGE',
    'REVIEW',
    'INACTIVITY_DUE',
    'REPETITION_EXPIRES',
    'RECONCILE',
    'CURRENT',
  ]),
  at: instant,
  reference: z.string().min(1),
  sequence: z
    .string()
    .regex(/^[1-9][0-9]*$/)
    .optional(),
});
export const signalContinuationSchema = z.strictObject({
  revision: z.string().min(1).max(200),
  targetThrough: instant,
  afterBoundary: signalBoundarySchema,
  lastMeaning: hash.nullable(),
  pendingDeadlineMicros: z
    .string()
    .regex(/^-?[0-9]{1,30}$/)
    .nullable(),
});
const snapshot = z.strictObject({
  id: z.uuid(),
  revision: z.string().min(1).max(200),
  digest: hash,
  observedThrough: instant,
  capturedAt: instant,
});
export const signalSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(1),
  lane: signalLaneSchema,
  snapshot,
  bootstrapAt: instant,
  checkpoint: z.strictObject({
    throughTime: instant.nullable(),
    pendingReconciliationBreak: z.boolean(),
    throughSubmissionSequence: z
      .string()
      .regex(/^[1-9][0-9]*$/)
      .nullable(),
    boundaryKey: z.string().nullable(),
    continuation: signalContinuationSchema.nullable(),
  }),
  activity: inactivityInputSchema.shape.activity.extend({
    assignmentId: z.uuid().optional(),
  }),
  rules: z.array(signalRuleVersionSchema),
  coverage: inactivityInputSchema.shape.coverage,
  coverageHistory: z.array(
    z.strictObject({
      at: instant,
      coverage: inactivityInputSchema.shape.coverage,
    }),
  ),
  events: inactivityInputSchema.shape.events,
  submissions: repeatedErrorInputSchema.shape.submissions,
  availabilityChanges: z.array(
    z.strictObject({
      id: z.uuid(),
      sequence: z.string().regex(/^[1-9][0-9]*$/),
      occurredAt: instant,
      component: z.string(),
      before: z.record(z.string(), z.unknown()).nullable(),
      after: z.record(z.string(), z.unknown()).nullable(),
    }),
  ),
  reviews: z.array(
    z.strictObject({
      id: z.uuid(),
      reviewedAt: instant,
      episodeId: z.uuid(),
      baseWitnessKeys: z.array(hash),
    }),
  ),
  processedWitnessKeys: z.array(hash),
  priorEvaluations: z.array(
    z.strictObject({
      identityKey: hash,
      publicationAllowed: z.boolean(),
      boundary: signalBoundarySchema,
      // Historical output is revalidated/recomputed by the pure processing layer.
      result: z.unknown(),
    }),
  ),
  knownSemanticKeys: z.array(hash),
});
export const signalFinalizationSchema = z.strictObject({
  status: z.enum(['COMMITTED', 'STALE', 'LEASE_LOST', 'REPLAY']),
  evaluations: z.number().int().nonnegative(),
  signals: z.number().int().nonnegative(),
});

/** Read scope is validated independently from the worker's operational token. */
export const signalMaintenanceScopeSchema = z.strictObject({
  organizationId: z.uuid(),
  classId: z.uuid(),
  studentId: z.uuid(),
  activityId: z.uuid(),
  asOf: instant,
});

export const signalEpisodeEvidenceSchema = z.strictObject({
  id: z.uuid(),
  laneId: z.uuid(),
  ruleVersionId: z.uuid(),
  state: z.enum(['ACTIVE', 'REVIEWED']),
  cause: z.string(),
  evidence: z.record(z.string(), z.unknown()),
  qualifiedAt: instant,
  calculatedAt: instant,
  previousEpisodeId: z.uuid().nullable(),
  reviewedBy: z.uuid().nullable(),
  reviewedAt: instant.nullable(),
  scope: signalLaneSchema,
  evaluations: z.array(
    z.strictObject({
      id: z.uuid(),
      evaluationTime: instant,
      calculatedAt: instant,
      boundary: signalBoundarySchema,
      result: z.unknown(),
    }),
  ),
});
