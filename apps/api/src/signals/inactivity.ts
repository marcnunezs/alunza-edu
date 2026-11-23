import { z } from 'zod';
import { signalRuleVersionSchema } from '@alunza/contracts';

const dayMicroseconds = 86_400_000_000n;
const instant = z.iso
  .datetime({ offset: true })
  .refine(
    (value) => (value.match(/\.(\d+)/)?.[1]?.length ?? 0) <= 6,
    'La fecha admite como máximo seis decimales de segundo.',
  )
  .transform((value) => {
    const fraction = value.match(/\.(\d+)/)?.[1] ?? '';
    return new Date(value.replace(/\.\d+/, ''))
      .toISOString()
      .replace('.000Z', `.${fraction.padEnd(6, '0')}Z`);
  });

function micros(value: string): bigint {
  return (
    BigInt(Date.parse(value.replace(/\.\d+/, ''))) * 1000n +
    BigInt((value.match(/\.(\d+)/)?.[1] ?? '').padEnd(6, '0'))
  );
}

function latest(values: string[]): string {
  return values.reduce((left, right) =>
    micros(right) > micros(left) ? right : left,
  );
}

const source = z.enum(['ACTIVITY_OPEN', 'RUN', 'ATTEMPT', 'HELP']);
const reference = z.string().min(1).max(200);
const coverage = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('UNKNOWN'), reason: reference }),
  z.strictObject({
    status: z.literal('CONTINUOUS'),
    epoch: reference,
    restartReason: reference.nullable(),
    sources: z.array(
      z.strictObject({
        source,
        since: instant,
        through: instant,
        referenceId: reference,
      }),
    ),
  }),
]);

const event = z.strictObject({
  id: z.uuid(),
  source: source.or(z.literal('CLASS_MEMBERSHIP')),
  type: z.enum([
    'CLASS_JOINED',
    'ACTIVITY_OPENED',
    'EXECUTION_COMPLETED',
    'ATTEMPT_SUBMITTED',
    'HINT_DELIVERED',
    'FEEDBACK_VIEWED',
    'HELP_REQUESTED',
  ]),
  schemaVersion: z.literal(1),
  organizationId: z.uuid(),
  classId: z.uuid(),
  studentId: z.uuid(),
  activityId: z.uuid().nullable(),
  occurredAt: instant,
  eligible: z.boolean(),
  infrastructureStatus: z.enum(['OK', 'FAILED']).nullable(),
});

// Internal normalized evidence, never a browser DTO. CONTINUOUS attests to all
// eligible capturers, not just installation timestamps. Its acquisition and
// authorization, snapshot validation and durable reconciliation belong to .05.
export const inactivityInputSchema = z.strictObject({
  evaluationTime: instant,
  rule: signalRuleVersionSchema
    .nullable()
    .refine((value) => value === null || value.type === 'INACTIVITY'),
  activity: z.strictObject({
    organizationId: z.uuid(),
    classId: z.uuid(),
    studentId: z.uuid(),
    activityId: z.uuid(),
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
    // Exhaustive evidence for this scope at the identified snapshot, including
    // all committed events through this instant; independent of capture uptime.
    observedThrough: instant,
  }),
  coverage,
  events: z.array(event),
});

export type InactivityInput = z.input<typeof inactivityInputSchema>;
type Event = z.output<typeof event>;
type Evidence = {
  baselineAt: string;
  observableSince: string;
  lastAt: string;
  elapsedMicroseconds: string;
  thresholdMicroseconds: string;
  coverageEpoch: string;
  coverageReferences: { source: string; referenceId: string }[];
  restartReason: string | null;
  referenceEvents: { source: string; id: string }[];
};
type Outcome = 'MATCH' | 'NO_MATCH' | 'NOT_EVALUABLE' | 'NOT_VERIFIABLE';
type Reason =
  | 'ACTIVITY_UNAVAILABLE'
  | 'START_NOT_REACHED'
  | 'NO_APPLICABLE_RULE'
  | 'EVIDENCE_INCOHERENT'
  | 'SNAPSHOT_INCOMPLETE'
  | 'COVERAGE_UNKNOWN'
  | 'COVERAGE_INCOMPLETE'
  | 'THRESHOLD_NOT_REACHED'
  | 'INACTIVITY_THRESHOLD_REACHED';

function coherentEvent(value: Event): boolean {
  const validSource =
    (value.source === 'CLASS_MEMBERSHIP' && value.type === 'CLASS_JOINED') ||
    (value.source === 'ACTIVITY_OPEN' && value.type === 'ACTIVITY_OPENED') ||
    (value.source === 'RUN' && value.type === 'EXECUTION_COMPLETED') ||
    (value.source === 'ATTEMPT' &&
      ['ATTEMPT_SUBMITTED', 'EXECUTION_COMPLETED'].includes(value.type)) ||
    (value.source === 'HELP' &&
      ['HELP_REQUESTED', 'HINT_DELIVERED', 'FEEDBACK_VIEWED'].includes(
        value.type,
      ));
  return (
    validSource &&
    (!value.eligible ||
      (value.type !== 'HELP_REQUESTED' &&
        (value.type !== 'EXECUTION_COMPLETED' ||
          value.infrastructureStatus === 'OK')))
  );
}

function orderedReferences(values: Event[]) {
  return values
    .map(({ source, id }) => ({ source, id }))
    .sort((left, right) => {
      const a = `${left.source}:${left.id}`;
      const b = `${right.source}:${right.id}`;
      return a < b ? -1 : a > b ? 1 : 0;
    });
}

/** Pure DEC005_V1 calculation at an explicit UTC cut; no clock, DB or effects. */
export function evaluateInactivity(input: unknown) {
  const parsed = inactivityInputSchema.parse(input);
  const { activity, rule, snapshot } = parsed;
  const cutoff = micros(parsed.evaluationTime);
  const result = (
    outcome: Outcome,
    reason: Reason,
    evidence: Evidence | null = null,
  ) => ({
    type: 'INACTIVITY' as const,
    outcome,
    reason,
    evaluationTime: parsed.evaluationTime,
    scope: {
      organizationId: activity.organizationId,
      classId: activity.classId,
      studentId: activity.studentId,
      activityId: activity.activityId,
    },
    ruleVersionId: rule?.id ?? null,
    algorithmVersion: rule?.algorithmVersion ?? null,
    schemaVersion: rule?.schemaVersion ?? null,
    parameters: rule?.type === 'INACTIVITY' ? { ...rule.parameters } : null,
    snapshot: { revision: snapshot.revision, digest: snapshot.digest },
    evidence,
    cause:
      outcome === 'MATCH'
        ? `Sin eventos elegibles durante al menos ${rule?.type === 'INACTIVITY' ? rule.parameters.inactivityDays : 0} días de 24 horas desde ${evidence?.lastAt}.`
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
  const baselineAt = latest([
    activity.enrolledAt,
    activity.publishedAt,
    ...(activity.opensAt === null ? [] : [activity.opensAt]),
  ]);
  if (micros(baselineAt) > cutoff)
    return result('NOT_EVALUABLE', 'START_NOT_REACHED');
  if (
    rule === null ||
    rule.type !== 'INACTIVITY' ||
    rule.state === 'DRAFT' ||
    rule.organizationId !== activity.organizationId ||
    rule.validFrom === null ||
    micros(rule.validFrom) > cutoff ||
    (rule.validTo !== null && cutoff >= micros(rule.validTo))
  )
    return result('NOT_VERIFIABLE', 'NO_APPLICABLE_RULE');
  if (micros(snapshot.observedThrough) < cutoff)
    return result('NOT_VERIFIABLE', 'SNAPSHOT_INCOMPLETE');
  if (parsed.coverage.status === 'UNKNOWN')
    return result('NOT_VERIFIABLE', 'COVERAGE_UNKNOWN');
  const { sources } = parsed.coverage;
  if (
    sources.length !== 4 ||
    new Set(sources.map((value) => value.source)).size !== 4 ||
    sources.some(
      (value) =>
        micros(value.since) > micros(value.through) ||
        micros(value.through) < cutoff,
    )
  )
    return result('NOT_VERIFIABLE', 'COVERAGE_INCOMPLETE');
  const observableSince = latest([
    baselineAt,
    ...sources.map((value) => value.since),
  ]);
  if (micros(observableSince) > cutoff)
    return result('NOT_VERIFIABLE', 'COVERAGE_INCOMPLETE');

  const unique = new Map<string, Event>();
  for (const value of parsed.events) {
    if (
      value.organizationId !== activity.organizationId ||
      value.classId !== activity.classId ||
      value.studentId !== activity.studentId ||
      (value.activityId !== activity.activityId &&
        !(value.type === 'CLASS_JOINED' && value.activityId === null)) ||
      micros(value.occurredAt) > cutoff
    )
      continue;
    if (
      !coherentEvent(value) ||
      (value.type === 'CLASS_JOINED' && value.activityId !== null)
    )
      return result('NOT_VERIFIABLE', 'EVIDENCE_INCOHERENT');
    const key = `${value.source}:${value.id}`;
    const previous = unique.get(key);
    if (previous && JSON.stringify(previous) !== JSON.stringify(value))
      return result('NOT_VERIFIABLE', 'EVIDENCE_INCOHERENT');
    unique.set(key, value);
  }
  const eligible = [...unique.values()].filter(
    (value) => value.eligible && value.activityId === activity.activityId,
  );
  const lastAt = latest([
    observableSince,
    ...eligible.map((value) => value.occurredAt),
  ]);
  const elapsed = cutoff - micros(lastAt);
  const threshold = BigInt(rule.parameters.inactivityDays) * dayMicroseconds;
  const evidence: Evidence = {
    baselineAt,
    observableSince,
    lastAt,
    elapsedMicroseconds: elapsed.toString(),
    thresholdMicroseconds: threshold.toString(),
    coverageEpoch: parsed.coverage.epoch,
    coverageReferences: [...sources]
      .sort((left, right) =>
        left.source < right.source ? -1 : left.source > right.source ? 1 : 0,
      )
      .map(({ source, referenceId }) => ({ source, referenceId })),
    restartReason: parsed.coverage.restartReason,
    referenceEvents: orderedReferences(
      eligible.filter((value) => value.occurredAt === lastAt),
    ),
  };
  return elapsed >= threshold
    ? result('MATCH', 'INACTIVITY_THRESHOLD_REACHED', evidence)
    : result('NO_MATCH', 'THRESHOLD_NOT_REACHED', evidence);
}
