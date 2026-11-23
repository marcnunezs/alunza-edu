const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const readJson = (path) =>
  JSON.parse(readFileSync(join(__dirname, '..', path), 'utf8'));
const signals = readJson('fixtures/progress/signals-proposed.json');
const events = readJson('fixtures/progress/events-and-order.json');
const progress = readJson('fixtures/progress/temporal-progress.json');
const time = (value) => Date.parse(value);
const ordered = (attempts) =>
  [...attempts].sort(
    (left, right) =>
      time(left.submittedAt) - time(right.submittedAt) ||
      left.eventSequence - right.eventSequence,
  );

// Reference arithmetic over fictitious facts, independent of production SQL,
// contracts, provider responses and the future signal evaluators.
function eventOracle(input) {
  const semanticTypes = new Set([
    'CLASS_JOINED',
    'ACTIVITY_OPENED',
    'EXECUTION_COMPLETED',
    'ATTEMPT_SUBMITTED',
    'HINT_DELIVERED',
    'FEEDBACK_VIEWED',
  ]);
  const canonical = new Map();
  for (const event of input.deliveries) {
    if (
      !semanticTypes.has(event.type) ||
      !event.confirmed ||
      event.actorKind !== 'STUDENT' ||
      ['organizationId', 'classId', 'actorId'].some(
        (key) => event[key] !== input.scope[key],
      ) ||
      time(event.serverAt) > time(input.asOf) ||
      (event.type === 'CLASS_JOINED'
        ? event.activityId !== null
        : event.activityId !== input.scope.activityId) ||
      (['ACTIVITY_OPENED', 'FEEDBACK_VIEWED'].includes(event.type) &&
        !event.explicit) ||
      (['HINT_DELIVERED', 'FEEDBACK_VIEWED'].includes(event.type) &&
        !event.acknowledged) ||
      (event.type === 'HINT_DELIVERED' && event.ragStatus !== 'SUPPORTED')
    )
      continue;
    const key = JSON.stringify([
      event.organizationId,
      event.classId,
      event.actorId,
      event.type,
      event.dedupKey,
    ]);
    if (!canonical.has(key)) canonical.set(key, event);
  }
  const eligible = [...canonical.values()].filter(
    (event) => event.activityId === input.scope.activityId,
  );
  const last = eligible.reduce(
    (latest, event) =>
      latest === null || time(event.serverAt) > time(latest)
        ? event.serverAt
        : latest,
    null,
  );
  return {
    canonicalEventIds: [...canonical.values()].map((event) => event.id),
    eligibleActivityEventIds: eligible.map((event) => event.id),
    latestActivityAt: last,
  };
}

function progressOracle(input) {
  const assignments = input.assignments.filter(
    (assignment) =>
      assignment.required &&
      assignment.organizationId === input.scope.organizationId &&
      assignment.classId === input.scope.classId &&
      time(assignment.publishedAt) <= time(input.asOf),
  );
  const eligible = input.attempts.filter((attempt) => {
    const assignment = assignments.find(
      (item) => item.id === attempt.assignmentId,
    );
    return (
      assignment &&
      assignment.exerciseVersionId === attempt.exerciseVersionId &&
      attempt.mode === 'SUBMIT' &&
      attempt.confirmed &&
      time(attempt.submittedAt) <= time(input.asOf)
    );
  });
  const count = (selected) => {
    const selectedIds = new Set(selected.map((assignment) => assignment.id));
    const attempts = eligible.filter((attempt) =>
      selectedIds.has(attempt.assignmentId),
    );
    const completeIds = new Set(
      attempts
        .filter(
          (attempt) =>
            attempt.diagnosisCode === 'SUCCESS' &&
            attempt.requiredTestsComplete &&
            attempt.requiredTestsPassed,
        )
        .map((attempt) => attempt.assignmentId),
    );
    return {
      completed: completeIds.size,
      required: selected.length,
      ratio: selected.length ? completeIds.size / selected.length : null,
      evidenceState: !selected.length
        ? 'NO_REQUIRED_EXERCISES'
        : attempts.length
          ? 'HAS_EVIDENCE'
          : 'NO_ATTEMPTS',
    };
  };
  const conceptIds = [
    ...new Set(assignments.flatMap((assignment) => assignment.conceptIds)),
  ].sort();
  return {
    ...count(assignments),
    eligibleAttemptIds: ordered(eligible).map((attempt) => attempt.id),
    observedAttemptIds: ordered(eligible)
      .filter(
        (attempt) =>
          !input.from || time(attempt.submittedAt) >= time(input.from),
      )
      .map((attempt) => attempt.id),
    concepts: conceptIds.map((id) => ({
      id,
      ...count(
        assignments.filter((assignment) => assignment.conceptIds.includes(id)),
      ),
    })),
  };
}

// Independent arithmetic over synthetic normalized facts; never call the
// production evaluator to generate expected results. Activity/snapshot
// sufficiency is a declared precondition here and is tested in the API suite.
function copyRepetitionFixture(value) {
  return JSON.parse(JSON.stringify(value));
}

function repeatedErrorOracle(input) {
  const micros = (value) =>
    BigInt(Date.parse(value.replace(/\.\d+/, ''))) * 1000n +
    BigInt((value.match(/\.(\d+)/)?.[1] ?? '').padEnd(6, '0'));
  const cutoff = micros(input.evaluationTime);
  const attempts = input.attempts
    .filter(
      (value) =>
        value.mode === 'SUBMIT' &&
        value.confirmed &&
        Object.entries(input.scope).every(([key, id]) => value[key] === id) &&
        micros(value.submittedAt) <= cutoff,
    )
    .sort((left, right) => {
      const a = micros(left.submittedAt),
        b = micros(right.submittedAt);
      if (a !== b) return a < b ? -1 : 1;
      const x = BigInt(left.eventSequence),
        y = BigInt(right.eventSequence);
      return x < y ? -1 : x > y ? 1 : 0;
    })
    .slice(-3);
  if (attempts.length !== 3) return { verifiable: false, createSignal: false };
  const canonical = attempts.every((value) => {
    const result = value.technicalResult,
      profile = value.profile;
    const ids = result?.visibleTestResults?.map((test) => test.id) ?? [];
    return (
      profile?.resultSchemaVersion === 'submission.v1' &&
      profile.visibleTestIds.length > 0 &&
      new Set(profile.visibleTestIds).size === profile.visibleTestIds.length &&
      result?.runnerVersion === profile.runnerVersion &&
      result.visibleTotal === profile.visibleTestIds.length &&
      new Set(ids).size === ids.length &&
      ids.every((id) => profile.visibleTestIds.includes(id)) &&
      result.visiblePassed ===
        result.visibleTestResults.filter((test) => test.passed).length &&
      [
        'SUCCESS',
        'UNKNOWN',
        'SYNTAX_ERROR',
        'RUNTIME_ERROR',
        'FAILED_TEST',
        'TIMEOUT',
      ].includes(result.diagnosisCode) &&
      result.allRequiredPassed === (result.diagnosisCode === 'SUCCESS') &&
      ['OK', 'FAILED'].includes(result.infrastructureStatus) &&
      (result.infrastructureStatus !== 'FAILED' ||
        (result.diagnosisCode === 'UNKNOWN' &&
          result.hiddenChecksPassed === null)) &&
      (result.diagnosisCode !== 'SUCCESS' ||
        (ids.length === result.visibleTotal &&
          result.visiblePassed === result.visibleTotal &&
          result.infrastructureStatus === 'OK' &&
          result.terminationReason === 'COMPLETED' &&
          !result.outputTruncated &&
          result.hiddenChecksPassed !== false))
    );
  });
  if (!canonical) return { verifiable: false, createSignal: false };
  if (
    attempts.some((value) =>
      ['SUCCESS', 'UNKNOWN'].includes(value.technicalResult.diagnosisCode),
    )
  )
    return { verifiable: true, createSignal: false };
  const first = attempts[0];
  const comparable = attempts.every(
    (value) =>
      value.exerciseVersionId === first.exerciseVersionId &&
      value.profile.testsVersion === first.profile.testsVersion &&
      value.profile.runnerVersion === first.profile.runnerVersion &&
      JSON.stringify(value.profile.limits) ===
        JSON.stringify(first.profile.limits) &&
      JSON.stringify([...value.profile.visibleTestIds].sort()) ===
        JSON.stringify([...first.profile.visibleTestIds].sort()) &&
      value.technicalResult.infrastructureStatus === 'OK',
  );
  return {
    verifiable: comparable,
    createSignal:
      comparable &&
      attempts.every(
        (value) =>
          value.technicalResult.diagnosisCode ===
          first.technicalResult.diagnosisCode,
      ) &&
      cutoff - micros(first.submittedAt) <= 1_209_600_000_000n,
  };
}

describe('Independent IMP-05 fixture oracles', () => {
  test('preserves SIG-01 through SIG-14 as proposed future acceptance cases', () => {
    expect(signals.map((fixture) => fixture.id)).toEqual(
      Array.from(
        { length: 14 },
        (_, index) => `SIG-${String(index + 1).padStart(2, '0')}`,
      ),
    );
    for (const fixture of signals) {
      expect(fixture.status).toBe('PROPOSED');
      expect(fixture.input).toBeDefined();
      expect(fixture.expected).toBeDefined();
    }
  });

  test.each(signals.slice(0, 4))(
    '$id inactivity duration and availability oracle',
    ({ input, expected }) => {
      const { activity } = input;
      // Independent DEC-005 arithmetic for these four synthetic cases only.
      // Capture coverage and exhaustive facts are declared fixture preconditions,
      // not a claim that the operational capturers have been verified.
      const microseconds = (value) => {
        const fraction = value.match(/\.(\d+)/)?.[1] ?? '';
        return (
          BigInt(Date.parse(value.replace(/\.\d+/, ''))) * 1000n +
          BigInt(fraction.padEnd(6, '0'))
        );
      };
      const maximum = (values) =>
        values.reduce((left, right) => (left > right ? left : right));
      const cutoff = microseconds(input.evaluationTime);
      const baseline = maximum([
        microseconds(activity.enrolledAt),
        microseconds(activity.publishedAt),
        ...(activity.opensAt ? [microseconds(activity.opensAt)] : []),
      ]);
      const sources = input.coverage.sources;
      const covered =
        input.coverage.status === 'CONTINUOUS' &&
        sources.length === 4 &&
        new Set(sources.map((item) => item.source)).size === 4 &&
        sources.every(
          (item) =>
            ['ACTIVITY_OPEN', 'RUN', 'ATTEMPT', 'HELP'].includes(item.source) &&
            microseconds(item.since) <= microseconds(item.through) &&
            microseconds(item.through) >= cutoff,
        );
      const observableSince = maximum([
        baseline,
        ...sources.map((item) => microseconds(item.since)),
      ]);
      const lastAt = maximum([
        observableSince,
        ...(input.lastEvent ? [microseconds(input.lastEvent.at)] : []),
      ]);
      const available =
        activity.state === 'PUBLISHED' &&
        activity.active &&
        baseline <= cutoff &&
        (!activity.closesAt || cutoff < microseconds(activity.closesAt));
      expect(available && covered && cutoff - lastAt >= 604_800_000_000n).toBe(
        expected.createSignal,
      );
      if (expected.baselineAt)
        expect(baseline).toBe(microseconds(expected.baselineAt));
      if (expected.referenceEventId)
        expect(expected.referenceEventId).toBe(input.lastEvent.id);
      if (expected.preservedSignalId)
        expect(expected.preservedSignalId).toBe(input.existingSignal.id);
    },
  );

  test.each(signals.slice(4, 8))(
    '$id consecutive diagnosis and inclusive T-window oracle',
    ({ input, expected }) => {
      expect(repeatedErrorOracle(input)).toEqual(expected);
    },
  );

  test.each([
    ['2026-09-18T11:59:59.999999Z', false],
    ['2026-09-18T12:00:00.000000Z', true],
    ['2026-09-18T12:00:00.000001Z', true],
  ])('repetition lower T-window bound at %s', (firstAt, createSignal) => {
    const input = copyRepetitionFixture(signals[4].input);
    input.attempts[0].submittedAt = firstAt;
    expect(repeatedErrorOracle(input)).toEqual({
      verifiable: true,
      createSignal,
    });
  });

  test('aged compact repetition and advancing T do not use t3 minus t1', () => {
    const aged = copyRepetitionFixture(signals[4].input);
    aged.attempts.forEach((value, index) => {
      value.submittedAt = '2026-09-0' + (index + 1) + 'T12:00:00Z';
    });
    expect(repeatedErrorOracle(aged)).toEqual({
      verifiable: true,
      createSignal: false,
    });
    const moved = copyRepetitionFixture(signals[4].input);
    moved.evaluationTime = '2026-10-02T12:00:00.000001Z';
    expect(repeatedErrorOracle(moved)).toEqual({
      verifiable: true,
      createSignal: false,
    });
  });

  test('future and excluded lanes do not occupy positions; exact T does', () => {
    for (const variant of [
      'future',
      'RUN',
      'unconfirmed',
      'assignment',
      'organization',
      'included',
    ]) {
      const input = copyRepetitionFixture(signals[4].input);
      const extra = copyRepetitionFixture(signals[7].input.attempts[1]);
      extra.id = 'attempt-4';
      extra.eventSequence = '4';
      extra.submittedAt = input.evaluationTime;
      if (variant === 'future')
        extra.submittedAt = '2026-10-02T12:00:00.000001Z';
      if (variant === 'RUN') extra.mode = 'RUN';
      if (variant === 'unconfirmed') extra.confirmed = false;
      if (variant === 'assignment') extra.assignmentId = 'assignment-b';
      if (variant === 'organization') extra.organizationId = 'org-b';
      input.attempts.push(extra);
      expect(repeatedErrorOracle(input)).toEqual({
        verifiable: true,
        createSignal: variant !== 'included',
      });
    }
  });

  test('partial canonical diagnosis can repeat; last incompatible cannot be skipped', () => {
    const partial = copyRepetitionFixture(signals[4].input);
    partial.attempts.forEach((value) => {
      Object.assign(value.technicalResult, {
        diagnosisCode: 'SYNTAX_ERROR',
        terminationReason: 'STUDENT_SYNTAX',
        visibleTestResults: [],
        visiblePassed: 0,
      });
    });
    expect(repeatedErrorOracle(partial)).toEqual({
      verifiable: true,
      createSignal: true,
    });
    const incompatible = copyRepetitionFixture(signals[4].input);
    const extra = copyRepetitionFixture(incompatible.attempts[2]);
    extra.id = 'attempt-4';
    extra.eventSequence = '4';
    extra.profile.testsVersion = 'b'.repeat(64);
    incompatible.attempts.push(extra);
    expect(repeatedErrorOracle(incompatible)).toEqual({
      verifiable: false,
      createSignal: false,
    });
  });

  test.each(signals.slice(8, 12))(
    '$id comparable visible-count oracle',
    ({ input, expected }) => {
      // Independent STAGNATION oracle: cut <=T, no additional date window.
      const micros = (value) =>
        BigInt(Date.parse(value.replace(/\.\d+/, ''))) * 1000n +
        BigInt((value.match(/\.(\d+)/)?.[1] ?? '').padEnd(6, '0'));
      const attempts = input.attempts
        .filter(
          (attempt) =>
            attempt.mode === 'SUBMIT' &&
            attempt.confirmed &&
            Object.entries(input.scope).every(
              ([key, value]) => attempt[key] === value,
            ) &&
            micros(attempt.submittedAt) <= micros(input.evaluationTime),
        )
        .sort((left, right) => {
          const a = micros(left.submittedAt);
          const b = micros(right.submittedAt);
          if (a !== b) return a < b ? -1 : 1;
          const x = BigInt(left.eventSequence);
          const y = BigInt(right.eventSequence);
          return x < y ? -1 : x > y ? 1 : 0;
        })
        .slice(-3);
      const first = attempts[0];
      const comparable =
        attempts.length === 3 &&
        attempts.every(
          (attempt) =>
            attempt.visibleCountsComplete &&
            attempt.exerciseVersionId === first.exerciseVersionId &&
            attempt.testsVersion === first.testsVersion &&
            attempt.profile.runnerVersion === first.profile.runnerVersion &&
            attempt.profile.resultSchemaVersion === 'submission.v1' &&
            JSON.stringify(attempt.profile.limits) ===
              JSON.stringify(first.profile.limits) &&
            JSON.stringify([...attempt.profile.visibleTestIds].sort()) ===
              JSON.stringify([...first.profile.visibleTestIds].sort()) &&
            attempt.technicalResult.infrastructureStatus === 'OK' &&
            attempt.technicalResult.diagnosisCode !== 'UNKNOWN' &&
            attempt.technicalResult.visibleTotal > 0 &&
            attempt.technicalResult.visibleTestResults.length ===
              attempt.technicalResult.visibleTotal &&
            new Set(
              attempt.technicalResult.visibleTestResults.map(
                (value) => value.id,
              ),
            ).size === attempt.technicalResult.visibleTotal &&
            JSON.stringify(
              attempt.technicalResult.visibleTestResults
                .map((value) => value.id)
                .sort(),
            ) === JSON.stringify([...attempt.profile.visibleTestIds].sort()) &&
            attempt.technicalResult.visiblePassed ===
              attempt.technicalResult.visibleTestResults.filter(
                (value) => value.passed,
              ).length,
        );
      expect(comparable).toBe(expected.verifiable);
      expect(
        comparable &&
          !attempts[2].technicalResult.allRequiredPassed &&
          attempts[1].technicalResult.visiblePassed <=
            attempts[0].technicalResult.visiblePassed &&
          attempts[2].technicalResult.visiblePassed <=
            attempts[1].technicalResult.visiblePassed,
      ).toBe(expected.createSignal);
    },
  );

  test('SIG-07 SUCCESS fixture is canonical, retaining interruption expected', () => {
    const success = signals.find((value) => value.id === 'SIG-07').input
      .attempts[1];
    expect(success.complete).toBe(true);
    expect(success.technicalResult).toMatchObject({
      diagnosisCode: 'SUCCESS',
      infrastructureStatus: 'OK',
      terminationReason: 'COMPLETED',
      visiblePassed: 3,
      visibleTotal: 3,
      allRequiredPassed: true,
    });
    expect(
      success.technicalResult.visibleTestResults.every((value) => value.passed),
    ).toBe(true);
    expect(signals.find((value) => value.id === 'SIG-07').expected).toEqual({
      verifiable: true,
      createSignal: false,
    });
  });

  test('SIG-13 specifies retained episode identity and reviewed state', () => {
    const { input, expected } = signals[12];
    expect(input.evaluations).toHaveLength(2);
    expect(expected).toEqual({
      recordCount: 1,
      signalId: input.existingSignal.id,
      state: input.existingSignal.state,
      reactivated: false,
    });
  });

  test('SIG-14 specifies one review and the first database winner', () => {
    const { input, expected } = signals[13];
    expect(
      new Set(input.requests.map((request) => request.teacherId)).size,
    ).toBe(2);
    expect(expected.reviewerId).toBe(
      input.requests.find(
        (request) => request.requestId === input.linearizationOrder[0],
      ).teacherId,
    );
    expect(expected.reviewedAt).toBe(input.firstServerAt);
    expect(expected.transitions).toBe(1);
    expect(expected.state).toBe('REVIEWED');
    expect(expected.bothResponsesState).toBe('REVIEWED');
  });

  test.each(events.filter((fixture) => fixture.id.startsWith('EVT-')))(
    '$id semantic event oracle',
    ({ status, input, expected }) => {
      expect(status).toBe('AGREED');
      expect(eventOracle(input)).toEqual(expected);
    },
  );

  test.each(events.filter((fixture) => fixture.id.startsWith('ORD-')))(
    '$id server submission order preserves historic attempt numbers',
    ({ input, expected }) => {
      const sorted = ordered(input.attempts);
      expect(sorted.map((attempt) => attempt.id)).toEqual(
        expected.orderedAttemptIds,
      );
      expect(sorted.map((attempt) => attempt.attemptNumber)).toEqual(
        expected.preservedAttemptNumbers,
      );
    },
  );

  test.each(progress)(
    '$id accumulated progress and concept oracle',
    ({ status, input, expected }) => {
      expect(status).toBe('AGREED');
      expect(progressOracle(input)).toEqual(expected);
    },
  );
});

describe('IMP-05 preparatory provider manifests', () => {
  test('Azure evaluation example is schema-valid and explicitly incomplete', async () => {
    const { planEvaluation } =
      await import('../scripts/evaluation-manifest.mjs');
    const plan = planEvaluation(
      readJson('infra/preproduction/imp-05-ai-preparation.example.json'),
    );
    expect(plan.remoteCalls).toBe(0);
    expect(plan.executionImplemented).toBe(true);
    expect(plan.azureEvaluation).toBe('not-executed');
    expect(plan.status).toBe('configuration-pending');
    expect(plan.pending).toEqual([
      'candidateFingerprint',
      'authorization',
      'priceVersion',
      'budgets',
      'profiles',
      'azure',
    ]);
  });

  test('Sandbox example is schema-valid and denies every remote operation', async () => {
    const { validateManifest, assertRemoteAuthorization, remoteOperations } =
      await import('../scripts/preprod-manifest.mjs');
    const manifest = validateManifest(
      readJson('infra/preproduction/imp-05-sandbox-preparation.example.json'),
    );
    expect(manifest.remote.enabled).toBe(false);
    expect(manifest.remote.approvalRef).toBeNull();
    expect(manifest.remote.allowedOperations).toEqual([]);
    expect(manifest.budget.maxCost).toBe(0);
    expect(manifest.budget.maxAiRequests).toBe(0);
    for (const operation of remoteOperations)
      expect(() => assertRemoteAuthorization(manifest, operation)).toThrow();
  });
});
