import { evaluateInactivity, type InactivityInput } from './inactivity';
import { evaluateRepeatedError } from './repeated-error';
import { evaluateStagnation } from './stagnation';
import {
  compareSignalBoundaries,
  initialSignalBoundaries,
} from './signal-boundaries';
import {
  signalBoundaryKey,
  signalEvaluationKey,
  signalHash,
  signalSemanticKey,
  signalWitnessKey,
} from './signal-identities';
import {
  normalizeSignalInstant,
  signalDeadlineMicroseconds,
  signalInstantFromMicroseconds,
  signalMicroseconds,
} from './signal-time';
import type {
  SignalBoundary,
  SignalEvaluationBatch,
  SignalEvaluationOutput,
  SignalSnapshot,
} from './signals.types';

function activityAt(snapshot: SignalSnapshot, at: string) {
  const activity = { ...snapshot.activity };
  const cut = signalMicroseconds(at);
  const changes = [...snapshot.availabilityChanges].sort((a, b) => {
    const delta =
      signalMicroseconds(b.occurredAt) - signalMicroseconds(a.occurredAt);
    if (delta !== 0n) return delta < 0n ? -1 : 1;
    const sequenceA = BigInt(a.sequence);
    const sequenceB = BigInt(b.sequence);
    return sequenceA > sequenceB ? -1 : sequenceA < sequenceB ? 1 : 0;
  });
  for (const change of changes)
    if (signalMicroseconds(change.occurredAt) > cut && change.before)
      Object.assign(activity, change.before);
  return activity;
}

function coverageAt(
  snapshot: SignalSnapshot,
  at: string,
): InactivityInput['coverage'] {
  const cut = signalMicroseconds(at);
  const history = snapshot.coverageHistory
    .filter((entry) => signalMicroseconds(entry.at) <= cut)
    .sort((a, b) => {
      const delta = signalMicroseconds(a.at) - signalMicroseconds(b.at);
      return delta < 0n ? -1 : delta > 0n ? 1 : 0;
    });
  if (snapshot.coverageHistory.length > 0 && history.length === 0)
    return { status: 'UNKNOWN', reason: 'NO_COVERAGE_HISTORY_AT_CUT' };
  return structuredClone(history.at(-1)?.coverage ?? snapshot.coverage);
}

function ruleAt(snapshot: SignalSnapshot, at: string) {
  const cut = signalMicroseconds(at);
  const applicable = snapshot.rules.filter(
    (rule) =>
      rule.type === snapshot.lane.type &&
      rule.organizationId === snapshot.lane.organizationId &&
      rule.state !== 'DRAFT' &&
      rule.validFrom !== null &&
      signalMicroseconds(rule.validFrom) <= cut &&
      (rule.validTo === null || signalMicroseconds(rule.validTo) > cut),
  );
  if (applicable.length > 1)
    throw new Error('Overlapping signal rule validity.');
  return applicable[0] ?? null;
}

export function evaluateSignalBoundary(
  snapshot: SignalSnapshot,
  boundary: SignalBoundary,
): SignalEvaluationOutput {
  const at = normalizeSignalInstant(boundary.at);
  const cut = signalMicroseconds(at);
  const activity = activityAt(snapshot, at);
  const common = {
    evaluationTime: at,
    rule: ruleAt(snapshot, at),
    snapshot: {
      revision: snapshot.snapshot.revision,
      digest: snapshot.snapshot.digest,
      observedThrough: snapshot.snapshot.observedThrough,
    },
  };
  if (snapshot.lane.type === 'INACTIVITY') {
    const { assignmentId: _assignmentId, ...scope } = activity;
    return evaluateInactivity({
      ...common,
      activity: scope,
      coverage: coverageAt(snapshot, at),
      events: snapshot.events,
    });
  }
  if (!snapshot.lane.assignmentId)
    throw new Error('Attempt signal lane requires an assignment.');
  const submissions = snapshot.submissions.filter((submission) => {
    if (!submission.submittedAt || !submission.eventSequence) return true;
    const submitted = signalMicroseconds(submission.submittedAt);
    if (submitted > cut) return false;
    // Controls govern T before visiting its confirmed submission prefixes. They
    // must not consume the complete tied group and then rewind to its first item.
    if (
      ['RULE_ACTIVATED', 'AVAILABILITY', 'COVERAGE'].includes(boundary.kind) &&
      cut > signalMicroseconds(snapshot.bootstrapAt) &&
      submitted === cut
    )
      return false;
    return (
      boundary.kind !== 'SUBMISSION' ||
      submitted !== cut ||
      BigInt(submission.eventSequence) <= BigInt(boundary.sequence!)
    );
  });
  const input = {
    ...common,
    activity: { ...activity, assignmentId: snapshot.lane.assignmentId },
    snapshot: { ...common.snapshot, selectionComplete: true },
    submissions,
  };
  return snapshot.lane.type === 'REPEATED_ERROR'
    ? evaluateRepeatedError(input)
    : evaluateStagnation(input);
}

function deadlineFor(
  result: SignalEvaluationOutput,
): { kind: 'INACTIVITY_DUE' | 'REPETITION_EXPIRES'; micros: string } | null {
  if (
    result.type === 'INACTIVITY' &&
    result.evidence &&
    result.parameters &&
    result.outcome === 'NO_MATCH'
  )
    return {
      kind: 'INACTIVITY_DUE',
      micros: signalDeadlineMicroseconds(
        result.evidence.lastAt,
        result.parameters.inactivityDays,
        'INACTIVITY_DUE',
      ),
    };
  if (
    result.type === 'REPEATED_ERROR' &&
    result.outcome === 'MATCH' &&
    result.evidence &&
    result.parameters
  ) {
    const first = result.evidence.submissions[0];
    if (!first) throw new Error('Missing repetition witness.');
    return {
      kind: 'REPETITION_EXPIRES',
      micros: signalDeadlineMicroseconds(
        first.submittedAt,
        result.parameters.repeatedErrorWindowDays,
        'REPETITION_EXPIRES',
      ),
    };
  }
  return null;
}

function publicationScopeEnabled(snapshot: SignalSnapshot): boolean {
  const at = signalMicroseconds(snapshot.snapshot.observedThrough);
  const a = snapshot.activity;
  return (
    a.state === 'PUBLISHED' &&
    a.scopeEnabled &&
    a.studentActive &&
    a.enrollmentActive &&
    a.publishedAt !== null &&
    [a.enrolledAt, a.publishedAt, a.opensAt].every(
      (value) => value === null || signalMicroseconds(value) <= at,
    ) &&
    [a.closesAt, a.closedAt].every(
      (value) => value === null || signalMicroseconds(value) > at,
    )
  );
}

function afterWitness(
  boundary: SignalBoundary,
  result: SignalEvaluationOutput | undefined,
): boolean {
  if (result?.outcome !== 'MATCH' || !result.evidence) return false;
  const at = signalMicroseconds(boundary.at);
  if (result.type === 'INACTIVITY')
    return at > signalMicroseconds(result.evidence.lastAt);
  const anchor = result.evidence.submissions.reduce<{
    at: bigint;
    sequence: bigint;
  } | null>((latest, submission) => {
    const candidate = {
      at: signalMicroseconds(submission.submittedAt),
      sequence: BigInt(submission.eventSequence),
    };
    return latest === null ||
      candidate.at > latest.at ||
      (candidate.at === latest.at && candidate.sequence > latest.sequence)
      ? candidate
      : latest;
  }, null);
  return (
    anchor !== null &&
    (at > anchor.at ||
      (at === anchor.at &&
        boundary.kind === 'SUBMISSION' &&
        BigInt(boundary.sequence!) > anchor.sequence))
  );
}

/** Deterministic .05 orchestration: acquisition/fencing/publication remain SQL responsibilities. */
export function processSignalSnapshot(
  snapshot: SignalSnapshot,
  maxBoundaries = 100,
): SignalEvaluationBatch {
  if (
    snapshot.schemaVersion !== 1 ||
    !Number.isInteger(maxBoundaries) ||
    maxBoundaries < 1 ||
    maxBoundaries > 100
  )
    throw new Error('Invalid signal processing configuration.');
  for (const key of [
    'organizationId',
    'classId',
    'studentId',
    'activityId',
  ] as const)
    if (snapshot.lane[key] !== snapshot.activity[key])
      throw new Error('SIGNAL_SNAPSHOT_SCOPE_MISMATCH');
  const start = signalMicroseconds(snapshot.bootstrapAt);
  const through = signalMicroseconds(snapshot.snapshot.observedThrough);
  const previousThrough =
    snapshot.checkpoint.throughTime === null
      ? start
      : signalMicroseconds(snapshot.checkpoint.throughTime);
  const previousSequence = BigInt(
    snapshot.checkpoint.throughSubmissionSequence ?? '0',
  );
  const forwardBoundary = (boundary: SignalBoundary): boolean => {
    const at = signalMicroseconds(boundary.at);
    if (snapshot.checkpoint.throughTime === null || at > previousThrough)
      return true;
    if (at < previousThrough) return false;
    if (boundary.kind === 'CURRENT') return true;
    return (
      snapshot.lane.type !== 'INACTIVITY' &&
      boundary.kind === 'SUBMISSION' &&
      BigInt(boundary.sequence!) > previousSequence
    );
  };
  const submissionSequenceAt = (at: bigint): bigint => {
    if (snapshot.lane.type === 'INACTIVITY') return 0n;
    return snapshot.submissions.reduce((latest, value) => {
      if (
        value.mode !== 'SUBMIT' ||
        !value.confirmed ||
        !value.submittedAt ||
        !value.eventSequence ||
        value.organizationId !== snapshot.lane.organizationId ||
        value.classId !== snapshot.lane.classId ||
        value.studentId !== snapshot.lane.studentId ||
        value.activityId !== snapshot.lane.activityId ||
        value.assignmentId !== snapshot.lane.assignmentId ||
        signalMicroseconds(value.submittedAt) !== at
      )
        return latest;
      const sequence = BigInt(value.eventSequence);
      return sequence > latest ? sequence : latest;
    }, 0n);
  };
  if (through < start || through < previousThrough)
    throw new Error('SIGNAL_CLOCK_REGRESSION');
  const saved = snapshot.checkpoint.continuation;
  const continuation =
    saved?.revision === snapshot.snapshot.revision ? saved : null;
  if (
    continuation &&
    signalMicroseconds(continuation.targetThrough) !== through
  )
    throw new Error('SIGNAL_CONTINUATION_TARGET_MISMATCH');
  if (
    continuation &&
    (signalMicroseconds(continuation.afterBoundary.at) < start ||
      signalMicroseconds(continuation.afterBoundary.at) > through)
  )
    throw new Error('SIGNAL_CONTINUATION_BOUNDARY_INVALID');
  const queue = initialSignalBoundaries(snapshot).filter(
    (boundary) =>
      continuation === null ||
      compareSignalBoundaries(boundary, continuation.afterBoundary) > 0,
  );
  const priorByBoundary = new Map(
    snapshot.priorEvaluations.map((item) => [
      signalBoundaryKey(item.boundary),
      item,
    ]),
  );
  const previousIdentity = new Set(
    snapshot.priorEvaluations.map((item) => item.identityKey),
  );
  const latestPrior = snapshot.priorEvaluations
    .filter(
      (item) =>
        item.publicationAllowed &&
        signalMicroseconds(item.boundary.at) <= previousThrough,
    )
    // Capture orders immutable evaluations by their durable append sequence.
    // A later appended tied SUBMISSION can supersede an earlier CURRENT.
    .at(-1);
  const knownCurrentMeaning = latestPrior
    ? signalSemanticKey(latestPrior.result)
    : null;
  const evaluations: SignalEvaluationBatch['evaluations'] = [];
  const future = new Set<bigint>();
  for (const value of [
    snapshot.activity.opensAt,
    snapshot.activity.closesAt,
    snapshot.activity.closedAt,
  ])
    if (value !== null && signalMicroseconds(value) > through)
      future.add(signalMicroseconds(value));
  let lastMeaning: string | null = continuation?.lastMeaning ?? null;
  let lastMeaningWasOperational =
    continuation !== null && forwardBoundary(continuation.afterBoundary);
  let lastBoundary = snapshot.checkpoint.boundaryKey;
  let advancedThrough = previousThrough;
  let advancedSequence = previousSequence;
  let afterBoundary: SignalBoundary | null =
    continuation?.afterBoundary ?? null;
  let pendingDeadlineMicros = continuation?.pendingDeadlineMicros ?? null;
  let pendingRuleId = continuation
    ? (ruleAt(snapshot, continuation.afterBoundary.at)?.id ?? null)
    : null;
  if (
    pendingDeadlineMicros !== null &&
    (!pendingRuleId ||
      BigInt(pendingDeadlineMicros) <=
        signalMicroseconds(continuation!.afterBoundary.at))
  )
    throw new Error('SIGNAL_CONTINUATION_DEADLINE_INVALID');
  const pendingBoundary = (): SignalBoundary | null => {
    if (
      pendingDeadlineMicros === null ||
      BigInt(pendingDeadlineMicros) > through
    )
      return null;
    if (snapshot.lane.type === 'STAGNATION')
      throw new Error('Stagnation does not have a time deadline.');
    const at = signalInstantFromMicroseconds(BigInt(pendingDeadlineMicros));
    if (at === null)
      throw new Error('Due signal deadline cannot be represented.');
    return {
      kind:
        snapshot.lane.type === 'INACTIVITY'
          ? 'INACTIVITY_DUE'
          : 'REPETITION_EXPIRES',
      at,
      reference: signalHash('deadline', {
        type: snapshot.lane.type,
        ruleVersionId: pendingRuleId,
        micros: pendingDeadlineMicros,
      }),
    };
  };
  const scopeEnabled = publicationScopeEnabled(snapshot);
  let requiresCurrentRevalidation =
    snapshot.checkpoint.pendingReconciliationBreak;
  let processed = 0;
  while (processed < maxBoundaries) {
    const due = pendingBoundary();
    const source = queue[0];
    if (!source && !due) break;
    let boundary: SignalBoundary;
    if (due && (!source || compareSignalBoundaries(due, source) < 0)) {
      boundary = due;
    } else {
      boundary = queue.shift()!;
      if (due && signalBoundaryKey(due) === signalBoundaryKey(boundary))
        pendingDeadlineMicros = null;
    }
    const boundaryKey = signalBoundaryKey(boundary);
    const result = evaluateSignalBoundary(snapshot, boundary);
    processed++;
    const rawMeaning = signalSemanticKey(result);
    const semanticKey =
      boundary.kind === 'REVIEW'
        ? signalHash('review-boundary', {
            meaning: rawMeaning,
            reviewId: boundary.reference,
          })
        : rawMeaning;
    const identityKey = signalEvaluationKey(result, boundary);
    const previous = priorByBoundary.get(boundaryKey);
    const previousMeaning = previous
      ? signalSemanticKey(previous.result)
      : null;
    const identicalMeaning = previousMeaning === rawMeaning;
    const forward = forwardBoundary(boundary);
    const redundantTick =
      boundary.kind !== 'REVIEW' &&
      rawMeaning === lastMeaning &&
      (!forward ||
        lastMeaningWasOperational ||
        rawMeaning === knownCurrentMeaning);
    const currentRevalidation =
      boundary.kind === 'CURRENT' && requiresCurrentRevalidation;
    const shouldPersist =
      !previousIdentity.has(identityKey) &&
      (currentRevalidation || (!identicalMeaning && !redundantTick));
    if (shouldPersist) {
      evaluations.push({
        identityKey,
        witnessKey: signalWitnessKey(result),
        semanticKey,
        boundary,
        result,
        // Reconciliation can explain old cuts; only forward/current evidence may publish.
        publicationAllowed:
          (result.outcome !== 'MATCH' || scopeEnabled) && forward,
      });
      // SQL decides whether an actual accumulating episode was interrupted.
      // Preserve the CURRENT calculation needed to consume that durable finding,
      // including when its predicate has returned to the same witness.
      if (
        !forward &&
        result.outcome !== 'MATCH' &&
        result.ruleVersionId === latestPrior?.result.ruleVersionId &&
        afterWitness(boundary, latestPrior?.result)
      )
        requiresCurrentRevalidation = true;
    }
    lastMeaning = rawMeaning;
    lastMeaningWasOperational = forward;
    afterBoundary = boundary;
    const boundaryTime = signalMicroseconds(boundary.at);
    if (boundaryTime >= advancedThrough) {
      if (boundaryTime > advancedThrough) advancedSequence = 0n;
      advancedThrough = boundaryTime;
      lastBoundary = boundaryKey;
      const observedSequence =
        boundary.kind === 'SUBMISSION'
          ? BigInt(boundary.sequence!)
          : ['RULE_ACTIVATED', 'AVAILABILITY', 'COVERAGE'].includes(
                boundary.kind,
              )
            ? 0n
            : submissionSequenceAt(boundaryTime);
      if (observedSequence > advancedSequence)
        advancedSequence = observedSequence;
    }
    const deadline = deadlineFor(result);
    pendingDeadlineMicros =
      deadline && BigInt(deadline.micros) > boundaryTime
        ? deadline.micros
        : null;
    pendingRuleId = result.ruleVersionId;
  }
  const hasMore = queue.length > 0 || pendingBoundary() !== null;
  if (pendingDeadlineMicros !== null && BigInt(pendingDeadlineMicros) > through)
    future.add(BigInt(pendingDeadlineMicros));
  const next = [...future].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))[0];
  return {
    evaluations,
    checkpoint: {
      throughTime: signalInstantFromMicroseconds(
        hasMore ? advancedThrough : through,
      )!,
      throughSubmissionSequence:
        advancedSequence === 0n ? null : advancedSequence.toString(),
      boundaryKey: lastBoundary,
      nextDeadlineMicros: hasMore
        ? through.toString()
        : (next?.toString() ?? null),
      hasMore,
      continuation:
        hasMore && afterBoundary !== null
          ? {
              revision: snapshot.snapshot.revision,
              targetThrough: normalizeSignalInstant(
                snapshot.snapshot.observedThrough,
              ),
              afterBoundary,
              lastMeaning,
              pendingDeadlineMicros,
            }
          : null,
    },
  };
}
