import type { SignalBoundary, SignalSnapshot } from './signals.types';
import { signalBoundaryKey, signalHash } from './signal-identities';
import { normalizeSignalInstant, signalMicroseconds } from './signal-time';

const rank: Record<SignalBoundary['kind'], number> = {
  START: 0,
  RULE_ACTIVATED: 1,
  AVAILABILITY: 1,
  COVERAGE: 1,
  SUBMISSION: 2,
  EVENT: 3,
  REVIEW: 4,
  INACTIVITY_DUE: 5,
  REPETITION_EXPIRES: 5,
  RECONCILE: 6,
  CURRENT: 7,
};

export function compareSignalBoundaries(
  a: SignalBoundary,
  b: SignalBoundary,
): number {
  const at = signalMicroseconds(a.at);
  const bt = signalMicroseconds(b.at);
  if (at !== bt) return at < bt ? -1 : 1;
  if (a.kind === 'SUBMISSION' && b.kind === 'SUBMISSION') {
    const as = BigInt(a.sequence!);
    const bs = BigInt(b.sequence!);
    if (as !== bs) return as < bs ? -1 : 1;
  }
  if (rank[a.kind] !== rank[b.kind]) return rank[a.kind] - rank[b.kind];
  return a.reference < b.reference ? -1 : a.reference > b.reference ? 1 : 0;
}

/** Controls at an instant are reflected in every input at that instant. */
export function initialSignalBoundaries(
  snapshot: SignalSnapshot,
): SignalBoundary[] {
  const start = signalMicroseconds(snapshot.bootstrapAt);
  const through = signalMicroseconds(snapshot.snapshot.observedThrough);
  const values: SignalBoundary[] = [
    {
      kind: 'START',
      at: normalizeSignalInstant(snapshot.bootstrapAt),
      reference: snapshot.lane.laneId,
    },
    {
      kind: 'CURRENT',
      at: normalizeSignalInstant(snapshot.snapshot.observedThrough),
      reference: snapshot.lane.laneId,
    },
  ];
  const add = (boundary: SignalBoundary) => {
    const at = signalMicroseconds(boundary.at);
    if (at > start && at <= through)
      values.push({ ...boundary, at: normalizeSignalInstant(boundary.at) });
  };
  for (const rule of snapshot.rules)
    if (rule.validFrom && rule.type === snapshot.lane.type)
      add({ kind: 'RULE_ACTIVATED', at: rule.validFrom, reference: rule.id });
  for (const change of snapshot.availabilityChanges)
    add({ kind: 'AVAILABILITY', at: change.occurredAt, reference: change.id });
  for (const item of snapshot.coverageHistory)
    add({
      kind: 'COVERAGE',
      at: item.at,
      reference: signalHash('coverage', item),
    });
  for (const review of snapshot.reviews)
    add({ kind: 'REVIEW', at: review.reviewedAt, reference: review.id });
  for (const key of ['opensAt', 'closesAt', 'closedAt'] as const) {
    const at = snapshot.activity[key];
    if (at)
      add({
        kind: 'AVAILABILITY',
        at,
        reference: `${snapshot.lane.activityId}:${key}`,
      });
  }
  if (snapshot.lane.type === 'INACTIVITY') {
    // Equal timestamps from different ledgers have no invented global ordering.
    const eventsAt = new Map<string, { source: string; id: string }[]>();
    for (const event of snapshot.events) {
      if (!event.eligible || event.activityId !== snapshot.lane.activityId)
        continue;
      const at = normalizeSignalInstant(event.occurredAt);
      const references = eventsAt.get(at) ?? [];
      references.push({ source: event.source, id: event.id });
      eventsAt.set(at, references);
    }
    for (const [at, references] of eventsAt) {
      references.sort((a, b) =>
        `${a.source}:${a.id}`.localeCompare(`${b.source}:${b.id}`, 'en'),
      );
      add({
        kind: 'EVENT',
        at,
        reference: signalHash('event-group', references),
      });
    }
  } else {
    for (const submission of snapshot.submissions) {
      if (
        submission.mode !== 'SUBMIT' ||
        !submission.confirmed ||
        !submission.submittedAt ||
        !submission.eventSequence
      )
        continue;
      if (
        submission.organizationId !== snapshot.lane.organizationId ||
        submission.classId !== snapshot.lane.classId ||
        submission.studentId !== snapshot.lane.studentId ||
        submission.activityId !== snapshot.lane.activityId ||
        submission.assignmentId !== snapshot.lane.assignmentId
      )
        continue;
      add({
        kind: 'SUBMISSION',
        at: submission.submittedAt,
        reference: submission.id,
        sequence: submission.eventSequence,
      });
    }
  }
  // A new snapshot may alter an old cut even if the arriving event precedes it.
  for (const previous of snapshot.priorEvaluations) add(previous.boundary);
  const unique = new Map(
    values.map((value) => [signalBoundaryKey(value), value]),
  );
  return [...unique.values()].sort(compareSignalBoundaries);
}
