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
  // Confirmed partial/UNKNOWN/incompatible results occupy their position.
  // Validate the canonical result only after selecting the latest N.
  technicalResult: z.unknown().refine((value) => value !== undefined),
});

// Internal normalized facts. .05 supplies authorized exhaustive snapshots and
// producer metadata; this contract does not implement operational acquisition.
export const repeatedErrorInputSchema = z.strictObject({
  evaluationTime: instant,
  rule: signalRuleVersionSchema
    .nullable()
    .refine((value) => value === null || value.type === 'REPEATED_ERROR'),
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
export type RepeatedErrorInput = z.input<typeof repeatedErrorInputSchema>;
type Submission = z.output<typeof submission>;
type Technical = z.output<typeof submitTechnicalResultSchema>;
type Diagnosis = Technical['diagnosisCode'];
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
  | 'DIAGNOSIS_INTERRUPTED'
  | 'DIAGNOSIS_DIFFERS'
  | 'WINDOW_EXPIRED'
  | 'REPEATED_DIAGNOSIS';
type Signature = {
  version: 'DEC005_V1_DIAGNOSIS';
  diagnosisCode: Diagnosis;
};
type Evidence = {
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
    diagnosisCode: Diagnosis;
    infrastructureStatus: Technical['infrastructureStatus'];
  }[];
};
function sameEvidence(left: Submission, right: Submission): boolean {
  try {
    // Transport copies of JSON facts may have different object prototypes.
    return isDeepStrictEqual(structuredClone(left), structuredClone(right));
  } catch {
    return false;
  }
}

/** DEC-005 D1/D2: latest N SUBMIT, then compatibility, diagnosis and T-window. */
export function evaluateRepeatedError(input: unknown) {
  const parsed = repeatedErrorInputSchema.parse(input);
  const { activity, rule, snapshot } = parsed;
  const cutoff = micros(parsed.evaluationTime);
  const scope = {
    organizationId: activity.organizationId,
    classId: activity.classId,
    studentId: activity.studentId,
    activityId: activity.activityId,
    assignmentId: activity.assignmentId,
  };
  const window =
    rule?.type === 'REPEATED_ERROR'
      ? {
          days: rule.parameters.repeatedErrorWindowDays,
          fromMicroseconds: (
            cutoff -
            BigInt(rule.parameters.repeatedErrorWindowDays) * 86_400_000_000n
          ).toString(),
          toMicroseconds: cutoff.toString(),
          fromInclusive: true as const,
          toInclusive: true as const,
        }
      : null;
  const result = (
    outcome: Outcome,
    reason: Reason,
    selectedAttemptIds: string[] = [],
    evidence: Evidence | null = null,
    signature: Signature | null = null,
  ) => ({
    type: 'REPEATED_ERROR' as const,
    outcome,
    reason,
    evaluationTime: parsed.evaluationTime,
    scope,
    ruleVersionId: rule?.id ?? null,
    algorithmVersion: rule?.algorithmVersion ?? null,
    schemaVersion: rule?.schemaVersion ?? null,
    parameters: rule?.type === 'REPEATED_ERROR' ? { ...rule.parameters } : null,
    snapshot: { revision: snapshot.revision, digest: snapshot.digest },
    selectedAttemptIds,
    evidence,
    signature,
    window,
    cause:
      outcome === 'MATCH'
        ? `Los últimos ${selectedAttemptIds.length} envíos confirmados comparables dentro de la ventana inclusiva de ${window?.days} días al corte ${parsed.evaluationTime} comparten el diagnóstico técnico ${signature?.diagnosisCode}. La regla agrupa por diagnóstico; no identifica una misma prueba ni concepto.`
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
    rule.type !== 'REPEATED_ERROR' ||
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
  const count = rule.parameters.repeatedErrorAttempts;
  if (ordered.length < count)
    return result('NOT_VERIFIABLE', 'INSUFFICIENT_SUBMISSIONS');
  const selected = ordered.slice(-count);
  const ids = selected.map((value) => value.id);
  // A canonical SUCCESS/UNKNOWN is an explicit, verifiable interruption.
  const results: Technical[] = [];
  for (const value of selected) {
    const canonical = submitTechnicalResultSchema.safeParse(
      value.technicalResult,
    );
    if (!canonical.success)
      return result('NOT_VERIFIABLE', 'RESULT_NOT_VERIFIABLE', ids);
    // An interruption must itself be trustworthy under its own producer profile;
    // compatibility BETWEEN the selected submissions is checked afterwards.
    if (
      !value.profile ||
      !value.exerciseVersionId ||
      value.profile.resultSchemaVersion !== 'submission.v1' ||
      value.profile.visibleTestIds.length === 0 ||
      new Set(value.profile.visibleTestIds).size !==
        value.profile.visibleTestIds.length
    )
      return result('NOT_VERIFIABLE', 'NOT_COMPARABLE', ids);
    if (
      canonical.data.runnerVersion !== value.profile.runnerVersion ||
      canonical.data.visibleTotal !== value.profile.visibleTestIds.length ||
      canonical.data.visibleTestResults.some(
        (test) => !value.profile!.visibleTestIds.includes(test.id),
      )
    )
      return result('NOT_VERIFIABLE', 'RESULT_NOT_VERIFIABLE', ids);
    results.push(canonical.data);
  }
  if (
    results.some((value) =>
      ['SUCCESS', 'UNKNOWN'].includes(value.diagnosisCode),
    )
  )
    return result('NO_MATCH', 'DIAGNOSIS_INTERRUPTED', ids);

  const first = selected[0];
  if (!first?.profile || !first.exerciseVersionId)
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
  // Reliable technical diagnoses may be partial; require a canonical subset,
  // not the complete suite required exclusively by STAGNATION.
  if (
    results.some(
      (value) =>
        value.infrastructureStatus !== 'OK' ||
        value.runnerVersion !== basis.runnerVersion ||
        value.visibleTotal !== expectedIds.length ||
        value.visibleTestResults.some((test) => !expectedIds.includes(test.id)),
    )
  )
    return result('NOT_VERIFIABLE', 'RESULT_NOT_VERIFIABLE', ids);
  const evidence: Evidence = {
    compatibilityVersion: 'DEC005_V1_SUBMISSION_V1',
    exerciseVersionId: first.exerciseVersionId,
    testsVersion: basis.testsVersion,
    visibleTestIds: expectedIds,
    visibleTotal: expectedIds.length,
    runnerVersion: basis.runnerVersion,
    resultSchemaVersion: basis.resultSchemaVersion,
    limits: { ...basis.limits },
    submissions: selected.map((value, index) => ({
      id: value.id,
      submittedAt: value.submittedAt!,
      eventSequence: value.eventSequence!,
      diagnosisCode: results[index]!.diagnosisCode,
      infrastructureStatus: results[index]!.infrastructureStatus,
    })),
  };
  if (
    results.some((value) => value.diagnosisCode !== results[0]!.diagnosisCode)
  )
    return result('NO_MATCH', 'DIAGNOSIS_DIFFERS', ids, evidence);
  if (
    cutoff - micros(first.submittedAt!) >
    BigInt(rule.parameters.repeatedErrorWindowDays) * 86_400_000_000n
  )
    return result('NO_MATCH', 'WINDOW_EXPIRED', ids, evidence);
  return result('MATCH', 'REPEATED_DIAGNOSIS', ids, evidence, {
    version: 'DEC005_V1_DIAGNOSIS',
    diagnosisCode: results[0]!.diagnosisCode,
  });
}
