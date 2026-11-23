import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import {
  signalRuleVersionSchema,
  submitTechnicalResultSchema,
} from '@alunza/contracts';

const instant = z.iso
  .datetime({ offset: true })
  .refine(
    (value) => (value.match(/\.(\d+)/)?.[1]?.length ?? 0) <= 6,
    'La fecha admite como máximo seis decimales de segundo.',
  )
  .transform((value) =>
    new Date(value.replace(/\.\d+/, ''))
      .toISOString()
      .replace(
        '.000Z',
        `.${(value.match(/\.(\d+)/)?.[1] ?? '').padEnd(6, '0')}Z`,
      ),
  );
function micros(value: string): bigint {
  return (
    BigInt(Date.parse(value.replace(/\.\d+/, ''))) * 1000n +
    BigInt((value.match(/\.(\d+)/)?.[1] ?? '').padEnd(6, '0'))
  );
}
const reference = z.string().min(1).max(200);
const sequence = z
  .string()
  .regex(/^[1-9][0-9]{0,18}$/)
  .refine((value) => BigInt(value) <= 9_223_372_036_854_775_807n);
const profile = z.strictObject({
  testsVersion: z.string().regex(/^[a-f0-9]{64}$/),
  visibleTestIds: z.array(z.string().min(1).max(100)).max(8),
  runnerVersion: z.string().min(1).max(100),
  resultSchemaVersion: reference,
  limits: z.strictObject({
    memoryBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    runtimeMs: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    outputBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  }),
});
const submission = z.strictObject({
  id: z.uuid(),
  organizationId: z.uuid(),
  classId: z.uuid(),
  studentId: z.uuid(),
  activityId: z.uuid(),
  assignmentId: z.uuid(),
  mode: z.enum(['RUN', 'SUBMIT']),
  confirmed: z.boolean(),
  submittedAt: instant.nullable(),
  eventSequence: sequence.nullable(),
  exerciseVersionId: z.uuid().nullable(),
  profile: profile.nullable(),
  // Validate canonicity only AFTER selecting the latest N. A confirmed partial,
  // UNKNOWN or malformed result must occupy its position, never be skipped.
  technicalResult: z.unknown().refine((value) => value !== undefined),
});

// Internal, authorized normalized facts, not a new public API. .05 must supply
// exhaustive snapshot/revision and real producer metadata. There is no 14-day
// window for STAGNATION (DEC-005 D3); observedThrough is a cut, not a start.
export const stagnationInputSchema = z.strictObject({
  evaluationTime: instant,
  rule: signalRuleVersionSchema
    .nullable()
    .refine((value) => value === null || value.type === 'STAGNATION'),
  activity: z.strictObject({
    organizationId: z.uuid(),
    classId: z.uuid(),
    studentId: z.uuid(),
    activityId: z.uuid(),
    assignmentId: z.uuid(),
    state: z.enum(['DRAFT', 'PUBLISHED', 'CLOSED']),
    scopeEnabled: z.boolean(),
    studentActive: z.boolean(),
    enrollmentActive: z.boolean(),
    enrolledAt: instant,
    publishedAt: instant.nullable(),
    opensAt: instant.nullable(),
    closesAt: instant.nullable(),
    closedAt: instant.nullable(),
  }),
  snapshot: z.strictObject({
    revision: reference,
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    observedThrough: instant,
    selectionComplete: z.boolean(),
  }),
  submissions: z.array(submission),
});
export type StagnationInput = z.input<typeof stagnationInputSchema>;
type Submission = z.output<typeof submission>;
type Outcome = 'MATCH' | 'NO_MATCH' | 'NOT_EVALUABLE' | 'NOT_VERIFIABLE';
type Reason =
  | 'ACTIVITY_UNAVAILABLE'
  | 'START_NOT_REACHED'
  | 'NO_APPLICABLE_RULE'
  | 'SNAPSHOT_INCOMPLETE'
  | 'EVIDENCE_INCOHERENT'
  | 'INSUFFICIENT_SUBMISSIONS'
  | 'NOT_COMPARABLE'
  | 'RESULT_NOT_VERIFIABLE'
  | 'LAST_REQUIRED_PASSED'
  | 'VISIBLE_PROGRESS_INCREASED'
  | 'NON_INCREASING_VISIBLE_RESULTS';
type Evidence = {
  // Mapping of existing submission.v1 results under DEC005_V1; this label is
  // internal and does not pretend there is a persisted normalizerVersion field.
  compatibilityVersion: 'DEC005_V1_SUBMISSION_V1';
  exerciseVersionId: string;
  testsVersion: string;
  visibleTestIds: string[];
  visibleTotal: number;
  runnerVersion: string;
  resultSchemaVersion: string;
  limits: { memoryBytes: number; runtimeMs: number; outputBytes: number };
  submissions: {
    id: string;
    submittedAt: string;
    eventSequence: string;
    visiblePassed: number;
    allRequiredPassed: boolean;
  }[];
};

function sameEvidence(left: Submission, right: Submission): boolean {
  try {
    // Transport copies of JSON facts may come from distinct object realms.
    // Compare their data, not the prototypes preserved by z.unknown().
    return isDeepStrictEqual(structuredClone(left), structuredClone(right));
  } catch {
    return false;
  }
}

/** DEC-005 D2/D3: latest N, then comparability, then complete visible counts. */
export function evaluateStagnation(input: unknown) {
  const parsed = stagnationInputSchema.parse(input);
  const { activity, rule, snapshot } = parsed;
  const cutoff = micros(parsed.evaluationTime);
  const scope = {
    organizationId: activity.organizationId,
    classId: activity.classId,
    studentId: activity.studentId,
    activityId: activity.activityId,
    assignmentId: activity.assignmentId,
  };
  const result = (
    outcome: Outcome,
    reason: Reason,
    selectedAttemptIds: string[] = [],
    evidence: Evidence | null = null,
  ) => ({
    type: 'STAGNATION' as const,
    outcome,
    reason,
    evaluationTime: parsed.evaluationTime,
    scope,
    ruleVersionId: rule?.id ?? null,
    algorithmVersion: rule?.algorithmVersion ?? null,
    schemaVersion: rule?.schemaVersion ?? null,
    parameters: rule?.type === 'STAGNATION' ? { ...rule.parameters } : null,
    snapshot: { revision: snapshot.revision, digest: snapshot.digest },
    selectedAttemptIds,
    evidence,
    cause:
      outcome === 'MATCH'
        ? `Los últimos ${selectedAttemptIds.length} envíos confirmados comparables no aumentaron las pruebas visibles superadas entre resultados consecutivos.`
        : null,
  });
  if (
    activity.state !== 'PUBLISHED' ||
    !activity.scopeEnabled ||
    !activity.studentActive ||
    !activity.enrollmentActive ||
    [activity.closesAt, activity.closedAt].some(
      (at) => at !== null && cutoff >= micros(at),
    )
  )
    return result('NOT_EVALUABLE', 'ACTIVITY_UNAVAILABLE');
  if (activity.publishedAt === null)
    return result('NOT_VERIFIABLE', 'EVIDENCE_INCOHERENT');
  if (
    [activity.enrolledAt, activity.publishedAt, activity.opensAt].some(
      (at) => at !== null && micros(at) > cutoff,
    )
  )
    return result('NOT_EVALUABLE', 'START_NOT_REACHED');
  if (
    rule === null ||
    rule.type !== 'STAGNATION' ||
    rule.state === 'DRAFT' ||
    rule.organizationId !== activity.organizationId ||
    rule.validFrom === null ||
    micros(rule.validFrom) > cutoff ||
    (rule.validTo !== null && cutoff >= micros(rule.validTo))
  )
    return result('NOT_VERIFIABLE', 'NO_APPLICABLE_RULE');
  if (!snapshot.selectionComplete || micros(snapshot.observedThrough) < cutoff)
    return result('NOT_VERIFIABLE', 'SNAPSHOT_INCOMPLETE');

  const unique = new Map<string, Submission>();
  const sequences = new Map<string, string>();
  for (const value of parsed.submissions) {
    if (
      value.mode !== 'SUBMIT' ||
      !value.confirmed ||
      Object.entries(scope).some(
        ([key, id]) => value[key as keyof typeof scope] !== id,
      )
    )
      continue;
    if (value.submittedAt === null || value.eventSequence === null)
      return result('NOT_VERIFIABLE', 'EVIDENCE_INCOHERENT');
    if (micros(value.submittedAt) > cutoff) continue;
    const previous = unique.get(value.id);
    const sequenceId = sequences.get(value.eventSequence);
    if (
      (previous && !sameEvidence(previous, value)) ||
      (sequenceId && sequenceId !== value.id)
    )
      return result('NOT_VERIFIABLE', 'EVIDENCE_INCOHERENT');
    unique.set(value.id, value);
    sequences.set(value.eventSequence, value.id);
  }
  const ordered = [...unique.values()].sort((left, right) => {
    const timeA = micros(left.submittedAt!);
    const timeB = micros(right.submittedAt!);
    if (timeA !== timeB) return timeA < timeB ? -1 : 1;
    const sequenceA = BigInt(left.eventSequence!);
    const sequenceB = BigInt(right.eventSequence!);
    return sequenceA < sequenceB ? -1 : sequenceA > sequenceB ? 1 : 0;
  });
  const count = rule.parameters.stagnationAttempts;
  if (ordered.length < count)
    return result('NOT_VERIFIABLE', 'INSUFFICIENT_SUBMISSIONS');
  // No version, diagnosis, suite or completeness filter may precede this slice.
  const selected = ordered.slice(-count);
  const ids = selected.map((value) => value.id);
  const first = selected[0];
  const last = selected.at(-1);
  if (!first || !last || !first.profile || !first.exerciseVersionId)
    return result('NOT_VERIFIABLE', 'NOT_COMPARABLE', ids);
  const basis = first.profile;
  const expectedIds = [...basis.visibleTestIds].sort();
  if (
    expectedIds.length === 0 ||
    new Set(expectedIds).size !== expectedIds.length ||
    basis.resultSchemaVersion !== 'submission.v1'
  )
    return result('NOT_VERIFIABLE', 'NOT_COMPARABLE', ids);
  if (
    selected.some(
      (value) =>
        !value.profile ||
        value.exerciseVersionId !== first.exerciseVersionId ||
        value.profile.testsVersion !== basis.testsVersion ||
        value.profile.runnerVersion !== basis.runnerVersion ||
        value.profile.resultSchemaVersion !== basis.resultSchemaVersion ||
        !isDeepStrictEqual(value.profile.limits, basis.limits) ||
        !isDeepStrictEqual(
          [...value.profile.visibleTestIds].sort(),
          expectedIds,
        ),
    )
  )
    return result('NOT_VERIFIABLE', 'NOT_COMPARABLE', ids);

  const counts: Evidence['submissions'] = [];
  for (const value of selected) {
    const canonical = submitTechnicalResultSchema.safeParse(
      value.technicalResult,
    );
    if (!canonical.success)
      return result('NOT_VERIFIABLE', 'RESULT_NOT_VERIFIABLE', ids);
    const technical = canonical.data;
    if (
      technical.infrastructureStatus !== 'OK' ||
      technical.diagnosisCode === 'UNKNOWN' ||
      technical.runnerVersion !== basis.runnerVersion ||
      technical.visibleTotal !== expectedIds.length ||
      !isDeepStrictEqual(
        technical.visibleTestResults.map((test) => test.id).sort(),
        expectedIds,
      )
    )
      return result('NOT_VERIFIABLE', 'RESULT_NOT_VERIFIABLE', ids);
    counts.push({
      id: value.id,
      submittedAt: value.submittedAt!,
      eventSequence: value.eventSequence!,
      visiblePassed: technical.visiblePassed,
      allRequiredPassed: technical.allRequiredPassed,
    });
  }
  const evidence: Evidence = {
    compatibilityVersion: 'DEC005_V1_SUBMISSION_V1',
    exerciseVersionId: first.exerciseVersionId,
    testsVersion: basis.testsVersion,
    visibleTestIds: expectedIds,
    visibleTotal: expectedIds.length,
    runnerVersion: basis.runnerVersion,
    resultSchemaVersion: basis.resultSchemaVersion,
    limits: { ...basis.limits },
    submissions: counts,
  };
  if (counts.at(-1)?.allRequiredPassed)
    return result('NO_MATCH', 'LAST_REQUIRED_PASSED', ids, evidence);
  if (
    counts.some(
      (value, index) =>
        index > 0 && value.visiblePassed > counts[index - 1]!.visiblePassed,
    )
  )
    return result('NO_MATCH', 'VISIBLE_PROGRESS_INCREASED', ids, evidence);
  return result('MATCH', 'NON_INCREASING_VISIBLE_RESULTS', ids, evidence);
}
