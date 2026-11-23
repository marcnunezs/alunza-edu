import type {
  SignalRuleVersion,
  SubmitTechnicalResult,
} from '@alunza/contracts';
import type { SignalSnapshot, SignalType } from './signals.types';
import { processSignalSnapshot } from './signal-processing';
import * as stagnationEvaluator from './stagnation';
import { canonicalSignalJson, signalWitnessKey } from './signal-identities';

const id = (n: number) =>
  `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = (day: number, suffix = '12:00:00.000000') =>
  `2026-10-${String(day).padStart(2, '0')}T${suffix}Z`;

function rule(type: SignalType, number = 1): SignalRuleVersion {
  const common = {
    id: id(20 + number),
    organizationId: id(1),
    version: number,
    schemaVersion: 1 as const,
    algorithmVersion: 'DEC005_V1' as const,
    state: 'ACTIVE' as const,
    createdBy: id(2),
    createdAt: at(1),
    activatedBy: id(2),
    validFrom: at(1),
    validTo: null,
  };
  if (type === 'INACTIVITY')
    return { ...common, type, parameters: { inactivityDays: 7 } };
  if (type === 'REPEATED_ERROR')
    return {
      ...common,
      type,
      parameters: { repeatedErrorAttempts: 3, repeatedErrorWindowDays: 14 },
    };
  return { ...common, type, parameters: { stagnationAttempts: 3 } };
}

function snapshot(type: SignalType = 'STAGNATION'): SignalSnapshot {
  const scope = {
    organizationId: id(1),
    classId: id(3),
    studentId: id(4),
    activityId: id(5),
  };
  return {
    schemaVersion: 1,
    lane: {
      ...scope,
      laneId: id(6),
      type,
      assignmentId: type === 'INACTIVITY' ? null : id(7),
    },
    snapshot: {
      id: id(8),
      revision: '1',
      digest: 'a'.repeat(64),
      observedThrough: at(10),
      capturedAt: at(10),
    },
    bootstrapAt: at(1),
    checkpoint: {
      throughTime: null,
      throughSubmissionSequence: null,
      pendingReconciliationBreak: false,
      boundaryKey: null,
      continuation: null,
    },
    activity: {
      ...scope,
      state: 'PUBLISHED',
      scopeEnabled: true,
      studentActive: true,
      enrollmentActive: true,
      enrolledAt: at(1),
      publishedAt: at(1),
      opensAt: null,
      closesAt: null,
      closedAt: null,
    },
    rules: [rule(type)],
    coverage: {
      status: 'CONTINUOUS',
      epoch: 'epoch-1',
      restartReason: null,
      sources: (['ACTIVITY_OPEN', 'RUN', 'ATTEMPT', 'HELP'] as const).map(
        (source) => ({
          source,
          since: at(1),
          through: at(10),
          referenceId: source,
        }),
      ),
    },
    coverageHistory: [],
    events: [],
    submissions: [],
    availabilityChanges: [],
    reviews: [],
    processedWitnessKeys: [],
    priorEvaluations: [],
    knownSemanticKeys: [],
  };
}

function attempt(
  value: SignalSnapshot,
  n: number,
  passed: number,
  submittedAt = at(n + 1),
) {
  const result: SubmitTechnicalResult = {
    runnerVersion: 'runner.v1',
    diagnosisCode: 'FAILED_TEST',
    terminationReason: 'ASSERTION_FAILED',
    infrastructureStatus: 'OK',
    visibleTestResults: ['v1', 'v2', 'v3'].map((key, i) => ({
      id: key,
      passed: i < passed,
      stdout: '',
      stderr: '',
    })),
    visiblePassed: passed,
    visibleTotal: 3,
    hiddenChecksPassed: false,
    allRequiredPassed: false,
    outputTruncated: false,
    outputBytes: 0,
    runtimeMs: 1,
    lifecycleMs: 2,
  };
  return {
    id: id(100 + n),
    organizationId: value.lane.organizationId,
    classId: value.lane.classId,
    studentId: value.lane.studentId,
    activityId: value.lane.activityId,
    assignmentId: id(7),
    mode: 'SUBMIT' as const,
    confirmed: true,
    submittedAt,
    eventSequence: String(n),
    exerciseVersionId: id(9),
    profile: {
      testsVersion: 'b'.repeat(64),
      visibleTestIds: ['v1', 'v2', 'v3'],
      runnerVersion: 'runner.v1',
      resultSchemaVersion: 'submission.v1',
      limits: { memoryBytes: 134217728, runtimeMs: 3000, outputBytes: 65536 },
    },
    technicalResult: result,
  };
}

function remember(
  input: SignalSnapshot,
  batch: ReturnType<typeof processSignalSnapshot>,
) {
  input.priorEvaluations.push(
    ...batch.evaluations.map((e) => ({
      identityKey: e.identityKey,
      publicationAllowed: e.publicationAllowed,
      boundary: e.boundary,
      result: e.result,
    })),
  );
  input.knownSemanticKeys.push(...batch.evaluations.map((e) => e.semanticKey));
  input.processedWitnessKeys.push(
    ...batch.evaluations.flatMap((e) =>
      e.witnessKey === null ? [] : [e.witnessKey],
    ),
  );
  input.checkpoint = {
    throughTime: batch.checkpoint.throughTime,
    throughSubmissionSequence: batch.checkpoint.throughSubmissionSequence,
    pendingReconciliationBreak: input.checkpoint.pendingReconciliationBreak,
    boundaryKey: batch.checkpoint.boundaryKey,
    continuation: batch.checkpoint.continuation,
  };
}

describe('IMP-05.05 deterministic processing', () => {
  it('E17 visits the improvement between the two qualifying witnesses after downtime', () => {
    const input = snapshot();
    input.submissions = [1, 1, 1, 2, 2, 2].map((passed, i) =>
      attempt(input, i + 1, passed),
    );
    const before = structuredClone(input);
    const output = processSignalSnapshot(input);
    const matches = output.evaluations.filter(
      (e) => e.result.outcome === 'MATCH',
    );
    expect(matches.map((e) => e.boundary.reference)).toEqual([
      id(103),
      id(106),
    ]);
    const improvement = output.evaluations.find(
      (e) => e.boundary.reference === id(104),
    );
    expect(improvement?.result.reason).toBe('VISIBLE_PROGRESS_INCREASED');
    expect(matches.every((e) => e.publicationAllowed)).toBe(true);
    expect(input).toEqual(before);
  });

  it('orders every prefix at equal microseconds by BigInt sequence rather than array/UUID', () => {
    const input = snapshot();
    input.submissions = [1, 1, 1, 2, 2, 2]
      .map((passed, i) => ({
        ...attempt(input, i + 1, passed, at(2)),
        eventSequence: String(9007199254740993n + BigInt(i)),
      }))
      .reverse();
    const output = processSignalSnapshot(input);
    expect(
      output.evaluations
        .filter((e) => e.result.outcome === 'MATCH')
        .map((e) => e.boundary.reference),
    ).toEqual([id(103), id(106)]);
    expect(
      output.evaluations.find((e) => e.boundary.reference === id(104))?.result
        .outcome,
    ).toBe('NO_MATCH');
  });

  it('E21 reconciles a committed late fact at the same T with a new snapshot', () => {
    const input = snapshot();
    input.snapshot.observedThrough = at(5);
    input.submissions = [attempt(input, 1, 1), attempt(input, 2, 1)];
    const first = processSignalSnapshot(input);
    remember(input, first);
    input.snapshot = {
      ...input.snapshot,
      id: id(50),
      revision: '2',
      digest: 'c'.repeat(64),
    };
    input.submissions.push(attempt(input, 3, 1, at(5, '11:59:59.999999')));
    const second = processSignalSnapshot(input);
    const current = second.evaluations.find(
      (e) => e.boundary.kind === 'CURRENT',
    );
    expect(current?.result.outcome).toBe('MATCH');
    expect(current?.publicationAllowed).toBe(true);
    expect(second.checkpoint.throughTime).toBe(at(5));
    expect(first.evaluations.every((e) => e.result.outcome !== 'MATCH')).toBe(
      true,
    );
  });

  it('does not republish an earlier tied prefix after a lower-sequence commit arrives late', () => {
    const input = snapshot();
    input.snapshot.observedThrough = at(2);
    input.submissions = [1, 2, 4, 5, 6].map((n) =>
      attempt(input, n, n < 3 ? 1 : 2, at(2)),
    );
    const first = processSignalSnapshot(input);
    expect(
      first.evaluations.find((e) => e.result.outcome === 'MATCH')?.boundary
        .sequence,
    ).toBe('6');
    remember(input, first);
    input.snapshot = {
      ...input.snapshot,
      revision: '2',
      digest: '7'.repeat(64),
    };
    input.submissions.push(attempt(input, 3, 1, at(2)));
    const second = processSignalSnapshot(input);
    expect(
      second.evaluations.filter((e) => e.boundary.kind === 'SUBMISSION').length,
    ).toBeGreaterThan(0);
    expect(
      second.evaluations
        .filter((e) => e.boundary.kind === 'SUBMISSION')
        .every((e) => !e.publicationAllowed),
    ).toBe(true);
    expect(
      second.evaluations.some(
        (e) => e.publicationAllowed && e.result.outcome !== 'MATCH',
      ),
    ).toBe(false);
    expect(second.evaluations.some((e) => e.boundary.kind === 'CURRENT')).toBe(
      false,
    );
  });

  it('still processes new higher-sequence tied prefixes and preserves their intervening improvement', () => {
    const input = snapshot();
    input.snapshot.observedThrough = at(2);
    input.submissions = [1, 1, 1, 2, 2, 2].map((p, i) =>
      attempt(input, i + 1, p, at(2)),
    );
    const first = processSignalSnapshot(input);
    expect(first.checkpoint.throughSubmissionSequence).toBe('6');
    remember(input, first);
    input.snapshot = {
      ...input.snapshot,
      revision: '3',
      digest: '6'.repeat(64),
    };
    input.submissions.push(
      ...[7, 8, 9].map((n) => attempt(input, n, 3, at(2))),
    );
    const observed = [];
    for (let i = 0; i < 20; i++) {
      const batch = processSignalSnapshot(input, 1);
      observed.push(...batch.evaluations);
      remember(input, batch);
      if (!batch.checkpoint.hasMore) break;
    }
    const operational = observed.filter(
      (e) => e.publicationAllowed && e.boundary.kind === 'SUBMISSION',
    );
    expect(operational.map((e) => e.boundary.sequence)).toEqual([
      '7',
      '8',
      '9',
    ]);
    expect(operational.map((e) => e.result.outcome)).toEqual([
      'NO_MATCH',
      'NO_MATCH',
      'MATCH',
    ]);
    expect(input.checkpoint.throughSubmissionSequence).toBe('9');
    expect(input.checkpoint.continuation).toBeNull();
  });

  it('revalidates CURRENT after a late interruption even if the current witness is unchanged', () => {
    const input = snapshot();
    input.submissions = [1, 2, 3].map((n) => attempt(input, n, 1));
    const first = processSignalSnapshot(input);
    const witness = first.evaluations.find(
      (e) => e.result.outcome === 'MATCH',
    )!.witnessKey;
    remember(input, first);
    input.snapshot = {
      ...input.snapshot,
      revision: '2',
      digest: '5'.repeat(64),
    };
    input.availabilityChanges = [
      {
        id: id(301),
        sequence: '1',
        occurredAt: at(5),
        component: 'PROFILE',
        before: { studentActive: true },
        after: { studentActive: false },
      },
      {
        id: id(302),
        sequence: '2',
        occurredAt: at(6),
        component: 'PROFILE',
        before: { studentActive: false },
        after: { studentActive: true },
      },
    ];
    const second = processSignalSnapshot(input);
    expect(
      second.evaluations.some(
        (e) =>
          e.boundary.at === at(5) &&
          e.result.outcome === 'NOT_EVALUABLE' &&
          !e.publicationAllowed,
      ),
    ).toBe(true);
    const current = second.evaluations.find(
      (e) => e.boundary.kind === 'CURRENT',
    );
    expect(current?.publicationAllowed).toBe(true);
    expect(current?.witnessKey).toBe(witness);
  });

  it('delivers late improvement cuts before the new current witness without publishing past episodes', () => {
    const input = snapshot();
    input.submissions = [1, 2, 3].map((n) => attempt(input, n, 1));
    const first = processSignalSnapshot(input);
    const previousWitness = first.evaluations.find(
      (e) => e.result.outcome === 'MATCH',
    )!.witnessKey;
    remember(input, first);
    input.snapshot = {
      ...input.snapshot,
      revision: '2',
      digest: '4'.repeat(64),
    };
    input.submissions.push(...[4, 5, 6].map((n) => attempt(input, n, 2)));
    const observed = [];
    for (let i = 0; i < 15; i++) {
      const batch = processSignalSnapshot(input, 1);
      observed.push(...batch.evaluations);
      remember(input, batch);
      if (!batch.checkpoint.hasMore) break;
    }
    expect(
      observed
        .filter(
          (e) =>
            e.boundary.kind === 'SUBMISSION' &&
            ['4', '5'].includes(e.boundary.sequence!),
        )
        .map((e) => [e.result.outcome, e.publicationAllowed]),
    ).toEqual([
      ['NO_MATCH', false],
      ['NO_MATCH', false],
    ]);
    const current = observed.find((e) => e.boundary.kind === 'CURRENT');
    expect(current?.result.outcome).toBe('MATCH');
    expect(current?.publicationAllowed).toBe(true);
    expect(current?.witnessKey).not.toBe(previousWitness);
  });

  it('resumes the durable pending interruption across one-frontier batches', () => {
    const input = snapshot();
    input.submissions = [1, 2, 3].map((n) => attempt(input, n, 1));
    remember(input, processSignalSnapshot(input));
    input.snapshot = {
      ...input.snapshot,
      revision: '2',
      digest: '3'.repeat(64),
    };
    // The SQL finalizer owns this flag after persisting an actual historical cut.
    input.checkpoint.pendingReconciliationBreak = true;
    const observed = [];
    for (let i = 0; i < 10; i++) {
      const batch = processSignalSnapshot(input, 1);
      observed.push(...batch.evaluations);
      remember(input, batch);
      if (!batch.checkpoint.hasMore) break;
    }
    expect(observed.filter((e) => e.boundary.kind === 'CURRENT')).toEqual([
      expect.objectContaining({
        publicationAllowed: true,
        result: expect.objectContaining({ outcome: 'MATCH' }),
      }),
    ]);
  });

  it('uses appended operational state after a tied submission supersedes an older CURRENT', () => {
    const input = snapshot();
    input.snapshot.observedThrough = at(3);
    input.submissions = [1, 2].map((n) => attempt(input, n, 1, at(2)));
    remember(input, processSignalSnapshot(input));
    input.snapshot = {
      ...input.snapshot,
      revision: '2',
      digest: '2'.repeat(64),
    };
    input.submissions.push(
      ...[3, 4, 5, 6].map((n) => attempt(input, n, n === 3 ? 1 : 2, at(2))),
    );
    const reconciled = processSignalSnapshot(input);
    expect(
      reconciled.evaluations.find((e) => e.publicationAllowed)?.boundary.kind,
    ).toBe('CURRENT');
    remember(input, reconciled);
    input.snapshot = {
      ...input.snapshot,
      revision: '3',
      digest: '1'.repeat(64),
    };
    input.submissions.push(
      ...[7, 8, 9].map((n) => attempt(input, n, 3, at(3))),
    );
    const observed = [];
    for (let i = 0; i < 15; i++) {
      const batch = processSignalSnapshot(input, 1);
      observed.push(...batch.evaluations);
      remember(input, batch);
      if (!batch.checkpoint.hasMore) break;
    }
    const operational = observed.filter((e) => e.publicationAllowed);
    expect(
      operational.map((e) => [
        e.boundary.kind,
        e.boundary.sequence,
        e.result.outcome,
      ]),
    ).toEqual([
      ['SUBMISSION', '7', 'NO_MATCH'],
      ['SUBMISSION', '8', 'NO_MATCH'],
      ['SUBMISSION', '9', 'MATCH'],
    ]);
  });

  it('E23 keeps the inactivity witness when a second source has the same anchor timestamp', () => {
    const input = snapshot('INACTIVITY');
    const event = {
      id: id(70),
      source: 'ACTIVITY_OPEN' as const,
      type: 'ACTIVITY_OPENED' as const,
      schemaVersion: 1 as const,
      organizationId: id(1),
      classId: id(3),
      studentId: id(4),
      activityId: id(5),
      occurredAt: at(2),
      eligible: true,
      infrastructureStatus: null,
    };
    input.events.push(event);
    const first = processSignalSnapshot(input);
    const firstMatch = first.evaluations.find(
      (e) => e.result.outcome === 'MATCH',
    )!;
    remember(input, first);
    input.reviews.push({
      id: id(71),
      reviewedAt: at(9),
      episodeId: id(72),
      baseWitnessKeys: [firstMatch.witnessKey!],
    });
    input.snapshot = {
      ...input.snapshot,
      id: id(51),
      revision: '2',
      digest: 'd'.repeat(64),
    };
    input.events.push({ ...event, id: id(73) });
    const second = processSignalSnapshot(input);
    const matches = second.evaluations.filter(
      (e) => e.result.outcome === 'MATCH',
    );
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.every((e) => e.witnessKey === firstMatch.witnessKey)).toBe(
      true,
    );
    expect(
      matches.some(
        (e) =>
          e.result.type === 'INACTIVITY' &&
          e.result.evidence?.referenceEvents.length === 2,
      ),
    ).toBe(true);
  });

  it('resumes late reconciliation without confusing a historical calculation with an operational signal', () => {
    const input = snapshot();
    input.submissions = [attempt(input, 1, 1), attempt(input, 2, 1)];
    remember(input, processSignalSnapshot(input));
    input.snapshot = {
      ...input.snapshot,
      id: id(53),
      revision: '2',
      digest: '9'.repeat(64),
    };
    input.submissions.push(attempt(input, 3, 1, at(9)));
    const observed = [];
    for (let i = 0; i < 10; i++) {
      const batch = processSignalSnapshot(input, 1);
      observed.push(...batch.evaluations);
      remember(input, batch);
      if (!batch.checkpoint.hasMore) break;
    }
    expect(
      observed.some(
        (e) => e.result.outcome === 'MATCH' && e.publicationAllowed,
      ),
    ).toBe(true);
  });

  it('E24 exposes a new witness after review even when its new fact predates reviewedAt', () => {
    const input = snapshot();
    input.snapshot.observedThrough = at(6);
    input.submissions = [1, 2, 3].map((n) => attempt(input, n, 1));
    const first = processSignalSnapshot(input);
    const oldWitness = first.evaluations.find(
      (e) => e.result.outcome === 'MATCH',
    )!.witnessKey!;
    remember(input, first);
    input.reviews.push({
      id: id(80),
      reviewedAt: at(5),
      episodeId: id(81),
      baseWitnessKeys: [oldWitness],
    });
    input.submissions.push(attempt(input, 4, 1, at(4, '13:00:00.000000')));
    input.snapshot = {
      ...input.snapshot,
      id: id(52),
      revision: '2',
      digest: 'e'.repeat(64),
    };
    const second = processSignalSnapshot(input);
    const current = second.evaluations.find(
      (e) => e.boundary.kind === 'CURRENT',
    );
    expect(current?.result.outcome).toBe('MATCH');
    expect(current?.witnessKey).not.toBe(oldWitness);
    expect(current?.publicationAllowed).toBe(true);
  });

  it('does not append another observation on an unchanged periodic tick', () => {
    const input = snapshot();
    input.submissions = [1, 2, 3].map((n) => attempt(input, n, 1));
    remember(input, processSignalSnapshot(input));
    input.snapshot.observedThrough = at(11);
    input.snapshot.capturedAt = at(11);
    expect(processSignalSnapshot(input).evaluations).toEqual([]);
  });

  it('expires repetition at one microsecond past the inclusive window', () => {
    const input = snapshot('REPEATED_ERROR');
    input.submissions = [1, 2, 3].map((n) => attempt(input, n, 1));
    input.snapshot.observedThrough = at(16, '12:00:00.000001');
    const output = processSignalSnapshot(input);
    const expiry = output.evaluations.find(
      (e) => e.boundary.kind === 'REPETITION_EXPIRES',
    );
    expect(expiry?.boundary.at).toBe(at(16, '12:00:00.000001'));
    expect(expiry?.result.reason).toBe('WINDOW_EXPIRED');
  });

  it('retains a future int4 maximum deadline as decimal microseconds', () => {
    const input = snapshot('INACTIVITY');
    input.rules = [
      {
        ...rule('INACTIVITY'),
        type: 'INACTIVITY',
        parameters: { inactivityDays: 2147483647 },
      },
    ];
    const output = processSignalSnapshot(input);
    expect(BigInt(output.checkpoint.nextDeadlineMicros!)).toBeGreaterThan(
      9223372036854775807n,
    );
    expect(output.evaluations.every((e) => e.result.outcome !== 'MATCH')).toBe(
      true,
    );
  });

  it('replays bounded batches without losing the intermediate improvement', () => {
    const input = snapshot();
    input.submissions = [1, 1, 1, 2, 2, 2].map((p, i) =>
      attempt(input, i + 1, p),
    );
    const batches = [];
    for (let i = 0; i < 10; i++) {
      const batch = processSignalSnapshot(input, 2);
      batches.push(batch);
      remember(input, batch);
      if (!batch.checkpoint.hasMore) break;
    }
    expect(batches.at(-1)?.checkpoint.hasMore).toBe(false);
    const observed = batches.flatMap((b) => b.evaluations);
    expect(
      observed
        .filter((e) => e.result.outcome === 'MATCH')
        .map((e) => e.boundary.reference),
    ).toEqual([id(103), id(106)]);
    expect(new Set(observed.map((e) => e.identityKey)).size).toBe(
      observed.length,
    );
  });

  it('caps evaluation work at 100 frontiers and advances through batches with no new observations', () => {
    const input = snapshot();
    input.availabilityChanges = Array.from({ length: 250 }, (_, i) => ({
      id: id(1000 + i),
      sequence: String(i + 1),
      occurredAt: at(2),
      component: 'PROFILE',
      before: { studentActive: i % 2 === 0 },
      after: { studentActive: i % 2 !== 0 },
    }));
    const evaluator = jest.spyOn(stagnationEvaluator, 'evaluateStagnation');
    const first = processSignalSnapshot(input);
    expect(evaluator).toHaveBeenCalledTimes(100);
    expect(first.checkpoint.hasMore).toBe(true);
    remember(input, first);
    evaluator.mockClear();
    const second = processSignalSnapshot(input);
    expect(evaluator).toHaveBeenCalledTimes(100);
    expect(second.evaluations).toEqual([]);
    expect(second.checkpoint.continuation?.afterBoundary).not.toEqual(
      first.checkpoint.continuation?.afterBoundary,
    );
    remember(input, second);
    evaluator.mockClear();
    const third = processSignalSnapshot(input);
    expect(evaluator).toHaveBeenCalledTimes(52);
    expect(third.checkpoint.hasMore).toBe(false);
    expect(third.checkpoint.continuation).toBeNull();
    expect(third.checkpoint.throughTime).toBe(input.snapshot.observedThrough);
  });

  it('resumes a pending inactivity deadline with one frontier per transaction', () => {
    const input = snapshot('INACTIVITY');
    const first = processSignalSnapshot(input, 1);
    expect(first.checkpoint.continuation?.pendingDeadlineMicros).not.toBeNull();
    remember(input, first);
    const second = processSignalSnapshot(input, 1);
    expect(second.evaluations[0]?.boundary.kind).toBe('INACTIVITY_DUE');
    expect(second.evaluations[0]?.boundary.at).toBe(at(8));
    expect(second.evaluations[0]?.result.outcome).toBe('MATCH');
    remember(input, second);
    expect(processSignalSnapshot(input, 1).checkpoint.hasMore).toBe(false);
  });

  it('discards a continuation after the evidence revision changes without rewinding the operational cut', () => {
    const input = snapshot();
    input.submissions = [1, 1, 1, 2, 2, 2].map((p, i) =>
      attempt(input, i + 1, p),
    );
    const first = processSignalSnapshot(input, 4);
    remember(input, first);
    const previousCut = input.checkpoint.throughTime;
    input.snapshot = {
      ...input.snapshot,
      revision: 'new-revision',
      digest: '8'.repeat(64),
    };
    input.submissions.push(attempt(input, 8, 1, at(2, '12:00:00.000001')));
    const second = processSignalSnapshot(input, 1);
    expect(second.checkpoint.continuation?.revision).toBe('new-revision');
    expect(second.checkpoint.continuation?.afterBoundary.kind).toBe('START');
    expect(second.checkpoint.throughTime).toBe(previousCut);
  });

  it('requires the frozen target throughout a continuation', () => {
    const input = snapshot();
    remember(input, processSignalSnapshot(input, 1));
    input.snapshot.observedThrough = at(11);
    expect(() => processSignalSnapshot(input)).toThrow(
      'SIGNAL_CONTINUATION_TARGET_MISMATCH',
    );
  });

  it('a closed current scope retains calculations without opening old signals', () => {
    const input = snapshot();
    input.submissions = [1, 2, 3].map((n) => attempt(input, n, 1));
    input.activity.state = 'CLOSED';
    input.activity.closedAt = at(8);
    input.availabilityChanges.push({
      id: id(90),
      sequence: '1',
      occurredAt: at(8),
      component: 'ACTIVITY',
      before: { state: 'PUBLISHED', closedAt: null },
      after: { state: 'CLOSED', closedAt: at(8) },
    });
    const result = processSignalSnapshot(input);
    expect(
      result.evaluations
        .filter((e) => e.result.outcome === 'MATCH')
        .every((e) => !e.publicationAllowed),
    ).toBe(true);
    expect(
      result.evaluations.some(
        (e) => e.result.outcome === 'NOT_EVALUABLE' && e.publicationAllowed,
      ),
    ).toBe(true);
  });

  it('rejects operational clock rollback rather than changing historical time', () => {
    const input = snapshot();
    input.checkpoint.throughTime = at(11);
    expect(() => processSignalSnapshot(input)).toThrow(
      'SIGNAL_CLOCK_REGRESSION',
    );
  });

  it('activates the new rule before tied prefixes without consuming the final group early', () => {
    const input = snapshot();
    const oldRule = rule('STAGNATION');
    oldRule.state = 'RETIRED';
    oldRule.validTo = at(2);
    const newRule = rule('STAGNATION', 2);
    newRule.validFrom = at(2);
    input.rules = [oldRule, newRule];
    input.submissions = [1, 1, 1, 2, 2, 2].map((p, i) =>
      attempt(input, i + 1, p, at(2)),
    );
    const result = processSignalSnapshot(input);
    const matches = result.evaluations.filter(
      (e) => e.result.outcome === 'MATCH',
    );
    expect(matches.map((e) => e.boundary.reference)).toEqual([
      id(103),
      id(106),
    ]);
    expect(matches.every((e) => e.result.ruleVersionId === newRule.id)).toBe(
      true,
    );
    expect(
      result.evaluations.find((e) => e.boundary.kind === 'RULE_ACTIVATED')
        ?.result.outcome,
    ).not.toBe('MATCH');
  });

  it('exclusive close at the exact inactivity threshold prevents a signal', () => {
    const input = snapshot('INACTIVITY');
    input.activity.closesAt = at(8);
    input.snapshot.observedThrough = at(8);
    const result = processSignalSnapshot(input);
    expect(result.evaluations.every((e) => e.result.outcome !== 'MATCH')).toBe(
      true,
    );
    expect(
      result.evaluations.some(
        (e) => e.result.reason === 'ACTIVITY_UNAVAILABLE',
      ),
    ).toBe(true);
  });

  it('reconstructs same-timestamp availability changes using the durable sequence', () => {
    const input = snapshot();
    input.submissions = [1, 2, 3].map((n) => attempt(input, n, 1));
    input.activity.studentActive = true;
    input.availabilityChanges = [
      {
        id: id(99),
        sequence: '9007199254740994',
        occurredAt: at(8),
        component: 'PROFILE',
        before: { studentActive: false },
        after: { studentActive: true },
      },
      {
        id: id(10),
        sequence: '9007199254740993',
        occurredAt: at(8),
        component: 'PROFILE',
        before: { studentActive: true },
        after: { studentActive: false },
      },
    ];
    expect(
      processSignalSnapshot(input).evaluations.find(
        (e) => e.boundary.reference === id(103),
      )?.result.outcome,
    ).toBe('MATCH');
  });

  it('does not project a later coverage epoch into an earlier cut', () => {
    const input = snapshot('INACTIVITY');
    input.coverageHistory = [{ at: at(5), coverage: input.coverage }];
    const first = processSignalSnapshot(input).evaluations.find(
      (e) => e.boundary.kind === 'START',
    );
    expect(first?.result.reason).toBe('COVERAGE_UNKNOWN');
  });

  it('rejects a capture whose activity belongs to a different lane scope', () => {
    const input = snapshot();
    input.activity.studentId = id(999);
    expect(() => processSignalSnapshot(input)).toThrow(
      'SIGNAL_SNAPSHOT_SCOPE_MISMATCH',
    );
  });

  it('identity depends on canonical JSON and never insertion order or worker time', () => {
    expect(canonicalSignalJson({ z: [2, 1], a: { b: 1, a: 2 } })).toBe(
      canonicalSignalJson({ a: { a: 2, b: 1 }, z: [2, 1] }),
    );
    expect(() => canonicalSignalJson({ a: undefined })).toThrow();
    const input = snapshot();
    input.submissions = [1, 2, 3].map((n) => attempt(input, n, 1));
    const result = processSignalSnapshot(input).evaluations.find(
      (e) => e.result.outcome === 'MATCH',
    )!.result;
    expect(signalWitnessKey(result)).toBe(
      signalWitnessKey({
        ...result,
        snapshot: { revision: 'later', digest: 'f'.repeat(64) },
      }),
    );
  });
});
