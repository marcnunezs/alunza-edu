import {
  submitTechnicalResultSchema,
  type SignalRuleVersion,
  type SubmitTechnicalResult,
} from '@alunza/contracts';
import { evaluateInactivity, type InactivityInput } from './inactivity';
import {
  evaluateRepeatedError,
  type RepeatedErrorInput,
} from './repeated-error';
import { evaluateStagnation, type StagnationInput } from './stagnation';

const id = (n: number) =>
  `40000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const scope = {
  organizationId: id(1),
  classId: id(2),
  studentId: id(3),
  activityId: id(4),
};
const assignmentId = id(5);
const ruleIds = { inactivity: id(7), repeatedError: id(8), stagnation: id(9) };
const ruleFields = {
  organizationId: scope.organizationId,
  version: 1,
  schemaVersion: 1 as const,
  algorithmVersion: 'DEC005_V1' as const,
  state: 'ACTIVE' as const,
  createdBy: id(10),
  createdAt: '2026-09-01T00:00:00.000000Z',
  activatedBy: id(10),
  validFrom: '2026-09-02T00:00:00.000000Z',
  validTo: null,
};

function repeatedErrorRule(): Extract<
  SignalRuleVersion,
  { type: 'REPEATED_ERROR' }
> {
  return {
    ...ruleFields,
    id: ruleIds.repeatedError,
    type: 'REPEATED_ERROR',
    parameters: { repeatedErrorAttempts: 3, repeatedErrorWindowDays: 14 },
  };
}
function stagnationRule(): Extract<SignalRuleVersion, { type: 'STAGNATION' }> {
  return {
    ...ruleFields,
    id: ruleIds.stagnation,
    type: 'STAGNATION',
    parameters: { stagnationAttempts: 3 },
  };
}
function inactivityRule(): Extract<SignalRuleVersion, { type: 'INACTIVITY' }> {
  return {
    ...ruleFields,
    id: ruleIds.inactivity,
    type: 'INACTIVITY',
    parameters: { inactivityDays: 7 },
  };
}

function activity(): InactivityInput['activity'] {
  return {
    ...scope,
    state: 'PUBLISHED',
    scopeEnabled: true,
    studentActive: true,
    enrollmentActive: true,
    enrolledAt: '2026-09-20T00:00:00.000000Z',
    publishedAt: '2026-09-20T00:00:00.000000Z',
    opensAt: null,
    closesAt: null,
    closedAt: null,
  };
}

function completeResult(
  passed: number,
  success = false,
): SubmitTechnicalResult {
  return {
    runnerVersion: 'runner.v1',
    diagnosisCode: success ? 'SUCCESS' : 'FAILED_TEST',
    terminationReason: success ? 'COMPLETED' : 'ASSERTION_FAILED',
    infrastructureStatus: 'OK',
    visibleTestResults: ['visible-1', 'visible-2', 'visible-3'].map(
      (testId, index) => ({
        id: testId,
        passed: index < passed,
        stdout: '',
        stderr: '',
      }),
    ),
    visiblePassed: passed,
    visibleTotal: 3,
    hiddenChecksPassed: success,
    allRequiredPassed: success,
    outputTruncated: false,
    outputBytes: 0,
    runtimeMs: 1,
    lifecycleMs: 2,
  };
}
type PartialDiagnosis = 'SYNTAX_ERROR' | 'RUNTIME_ERROR' | 'TIMEOUT';
function partialResult(diagnosis: PartialDiagnosis): SubmitTechnicalResult {
  const termination: Record<
    PartialDiagnosis,
    SubmitTechnicalResult['terminationReason']
  > = {
    SYNTAX_ERROR: 'STUDENT_SYNTAX',
    RUNTIME_ERROR: 'STUDENT_EXCEPTION',
    TIMEOUT: 'EXECUTION_DEADLINE',
  };
  return {
    ...completeResult(1),
    diagnosisCode: diagnosis,
    terminationReason: termination[diagnosis],
    visibleTestResults:
      diagnosis === 'SYNTAX_ERROR'
        ? []
        : [{ id: 'visible-1', passed: true, stdout: '', stderr: '' }],
    visiblePassed: diagnosis === 'SYNTAX_ERROR' ? 0 : 1,
    hiddenChecksPassed: null,
  };
}

type Submission = RepeatedErrorInput['submissions'][number];
function attempt(
  number: number,
  submittedAt: string,
  eventSequence: string,
  technicalResult: SubmitTechnicalResult,
): Submission {
  return {
    ...scope,
    assignmentId,
    id: id(number),
    mode: 'SUBMIT',
    confirmed: true,
    submittedAt,
    eventSequence,
    exerciseVersionId: id(6),
    profile: {
      testsVersion: 'a'.repeat(64),
      visibleTestIds: ['visible-1', 'visible-2', 'visible-3'],
      runnerVersion: 'runner.v1',
      resultSchemaVersion: 'submission.v1',
      limits: { memoryBytes: 134217728, runtimeMs: 3000, outputBytes: 65536 },
    },
    technicalResult,
  };
}

function facts(
  evaluationTime: string,
  submissions: Submission[],
  revision: string,
  digest = 'a'.repeat(64),
) {
  return {
    evaluationTime,
    activity: { ...activity(), assignmentId },
    snapshot: {
      revision,
      digest,
      observedThrough: evaluationTime,
      selectionComplete: true,
    },
    submissions,
  };
}
type Facts = ReturnType<typeof facts>;
function repeatedErrorInput(shared: Facts): RepeatedErrorInput {
  return { ...shared, rule: repeatedErrorRule() };
}
function stagnationInput(shared: Facts): StagnationInput {
  return { ...shared, rule: stagnationRule() };
}
function inactivityInput(shared: Facts): InactivityInput {
  // Its strict contract has no assignmentId or selectionComplete. These are
  // projections of the same synthetic scope/snapshot, not another data source.
  const { assignmentId: omittedAssignment, ...sharedActivity } =
    shared.activity;
  const { selectionComplete: omittedSelection, ...snapshot } = shared.snapshot;
  if (!omittedAssignment || !omittedSelection) throw new Error('fixture');
  return {
    evaluationTime: shared.evaluationTime,
    rule: inactivityRule(),
    activity: sharedActivity,
    snapshot,
    coverage: {
      status: 'CONTINUOUS',
      epoch: 'synthetic-joint-all-capturers',
      restartReason: null,
      sources: (['ACTIVITY_OPEN', 'RUN', 'ATTEMPT', 'HELP'] as const).map(
        (source) => ({
          source,
          since: '2026-09-20T00:00:00.000000Z',
          through: shared.evaluationTime,
          referenceId: `synthetic-joint-coverage-${source}`,
        }),
      ),
    },
    events: shared.submissions.map((submission) => {
      if (submission.submittedAt === null) throw new Error('fixture');
      return {
        ...scope,
        id: submission.id,
        source: 'ATTEMPT' as const,
        type: 'ATTEMPT_SUBMITTED' as const,
        schemaVersion: 1 as const,
        occurredAt: submission.submittedAt,
        eligible: true,
        infrastructureStatus: null,
      };
    }),
  };
}
function freezeFacts(value: unknown): void {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(freezeFacts);
    Object.freeze(value);
  }
}
function expectMetadata(
  result: unknown,
  ruleVersionId: string,
  parameters: Record<string, number>,
  shared: Facts,
) {
  expect(result).toMatchObject({
    evaluationTime: shared.evaluationTime,
    ruleVersionId,
    algorithmVersion: 'DEC005_V1',
    schemaVersion: 1,
    parameters,
    snapshot: {
      revision: shared.snapshot.revision,
      digest: shared.snapshot.digest,
    },
  });
}

// Joint integration of pure functions only: no dispatcher, provider, HTTP,
// database, episode worker or progress-service call. Oracles are explicit.
describe('IMP-05.04: evaluación conjunta pura de las señales DEC-005', () => {
  it('E22: el éxito antiguo permanece y la tripleta posterior cumple ambas causas', () => {
    const priorSuccess = attempt(
      100,
      '2026-09-28T12:00:00.000000Z',
      '1',
      completeResult(3, true),
    );
    expect(
      submitTechnicalResultSchema.safeParse(priorSuccess.technicalResult)
        .success,
    ).toBe(true);
    const shared = facts(
      '2026-10-02T12:00:00.000000Z',
      [
        priorSuccess,
        attempt(101, '2026-09-30T12:00:00.000000Z', '2', completeResult(1)),
        attempt(102, '2026-10-01T12:00:00.000000Z', '3', completeResult(1)),
        attempt(103, '2026-10-02T12:00:00.000000Z', '4', completeResult(1)),
      ],
      'synthetic-e22',
    );
    const repeatedInput = repeatedErrorInput(shared);
    const stagnantInput = stagnationInput(shared);
    const inactiveInput = inactivityInput(shared);
    const before = structuredClone({
      repeatedInput,
      stagnantInput,
      inactiveInput,
    });
    freezeFacts({ repeatedInput, stagnantInput, inactiveInput });

    const repeated = evaluateRepeatedError(repeatedInput);
    const stagnant = evaluateStagnation(stagnantInput);
    const inactive = evaluateInactivity(inactiveInput);

    expect(repeated).toMatchObject({
      type: 'REPEATED_ERROR',
      outcome: 'MATCH',
      reason: 'REPEATED_DIAGNOSIS',
      selectedAttemptIds: [id(101), id(102), id(103)],
      signature: {
        version: 'DEC005_V1_DIAGNOSIS',
        diagnosisCode: 'FAILED_TEST',
      },
      window: { days: 14, fromInclusive: true, toInclusive: true },
    });
    expect(
      repeated.evidence?.submissions.map((value) => value.diagnosisCode),
    ).toEqual(['FAILED_TEST', 'FAILED_TEST', 'FAILED_TEST']);
    expect(stagnant).toMatchObject({
      type: 'STAGNATION',
      outcome: 'MATCH',
      reason: 'NON_INCREASING_VISIBLE_RESULTS',
      selectedAttemptIds: [id(101), id(102), id(103)],
      evidence: { visibleTotal: 3 },
    });
    expect(
      stagnant.evidence?.submissions.map((value) => value.visiblePassed),
    ).toEqual([1, 1, 1]);
    expect(repeated.cause).toContain('FAILED_TEST');
    expect(stagnant.cause).toContain('pruebas visibles');
    expect(repeated.cause).not.toBe(stagnant.cause);
    expect(stagnant).not.toHaveProperty('signature');
    for (const cause of [repeated.cause, stagnant.cause]) {
      expect(cause).not.toMatch(/pendiente|pérdida de logro|incapacidad/i);
    }
    expect(inactive).toMatchObject({
      type: 'INACTIVITY',
      outcome: 'NO_MATCH',
      reason: 'THRESHOLD_NOT_REACHED',
      evidence: {
        lastAt: '2026-10-02T12:00:00.000000Z',
        elapsedMicroseconds: '0',
        referenceEvents: [{ source: 'ATTEMPT', id: id(103) }],
      },
    });
    expectMetadata(
      repeated,
      ruleIds.repeatedError,
      {
        repeatedErrorAttempts: 3,
        repeatedErrorWindowDays: 14,
      },
      shared,
    );
    expectMetadata(
      stagnant,
      ruleIds.stagnation,
      { stagnationAttempts: 3 },
      shared,
    );
    expectMetadata(inactive, ruleIds.inactivity, { inactivityDays: 7 }, shared);
    expect(repeated.scope).toEqual({ ...scope, assignmentId });
    expect(stagnant.scope).toEqual({ ...scope, assignmentId });
    expect(inactive.scope).toEqual(scope);
    expect({ repeatedInput, stagnantInput, inactiveInput }).toEqual(before);
    expect(priorSuccess.technicalResult).toMatchObject({
      diagnosisCode: 'SUCCESS',
      visiblePassed: 3,
      allRequiredPassed: true,
    });
    // This preserves the historical success fact; it does not execute or prove
    // SQL accumulated progress. That regression belongs to integrated progress.
    expect(evaluateRepeatedError(repeatedInput)).toEqual(repeated);
    expect(evaluateStagnation(stagnantInput)).toEqual(stagnant);
    expect(evaluateInactivity(inactiveInput)).toEqual(inactive);
  });

  it.each([
    [
      1,
      '2026-10-01T12:00:00.000000Z',
      [],
      null,
      'NOT_VERIFIABLE',
      'INSUFFICIENT_SUBMISSIONS',
    ],
    [
      2,
      '2026-10-02T12:00:00.000000Z',
      [],
      null,
      'NOT_VERIFIABLE',
      'INSUFFICIENT_SUBMISSIONS',
    ],
    [
      3,
      '2026-10-03T12:00:00.000000Z',
      [id(101), id(102), id(103)],
      [1, 1, 1],
      'MATCH',
      'NON_INCREASING_VISIBLE_RESULTS',
    ],
    [
      4,
      '2026-10-04T12:00:00.000000Z',
      [id(102), id(103), id(104)],
      [1, 1, 2],
      'NO_MATCH',
      'VISIBLE_PROGRESS_INCREASED',
    ],
    [
      5,
      '2026-10-05T12:00:00.000000Z',
      [id(103), id(104), id(105)],
      [1, 2, 2],
      'NO_MATCH',
      'VISIBLE_PROGRESS_INCREASED',
    ],
    [
      6,
      '2026-10-06T12:00:00.000000Z',
      [id(104), id(105), id(106)],
      [2, 2, 2],
      'MATCH',
      'NON_INCREASING_VISIBLE_RESULTS',
    ],
  ] as const)(
    'E17: prefijo A%s conserva la mejora intermedia y el diagnóstico repetido',
    (
      size,
      cutoff,
      selectedIds,
      counts,
      stagnationOutcome,
      stagnationReason,
    ) => {
      const submissions = [
        attempt(101, '2026-10-01T12:00:00.000000Z', '1', completeResult(1)),
        attempt(102, '2026-10-02T12:00:00.000000Z', '2', completeResult(1)),
        attempt(103, '2026-10-03T12:00:00.000000Z', '3', completeResult(1)),
        attempt(104, '2026-10-04T12:00:00.000000Z', '4', completeResult(2)),
        attempt(105, '2026-10-05T12:00:00.000000Z', '5', completeResult(2)),
        attempt(106, '2026-10-06T12:00:00.000000Z', '6', completeResult(2)),
      ];
      const shared = facts(
        cutoff,
        submissions.slice(0, size),
        `synthetic-prefix-${size}`,
        `${size}`.repeat(64),
      );
      const before = structuredClone(shared);
      freezeFacts(shared);
      const repeated = evaluateRepeatedError(repeatedErrorInput(shared));
      const stagnant = evaluateStagnation(stagnationInput(shared));
      expect(stagnant.outcome).toBe(stagnationOutcome);
      expect(stagnant.reason).toBe(stagnationReason);
      expect(stagnant.selectedAttemptIds).toEqual(selectedIds);
      expect(
        stagnant.evidence?.submissions.map((value) => value.visiblePassed) ??
          null,
      ).toEqual(counts);
      expect(repeated.selectedAttemptIds).toEqual(selectedIds);
      expect(repeated.outcome).toBe(size < 3 ? 'NOT_VERIFIABLE' : 'MATCH');
      expect(repeated.reason).toBe(
        size < 3 ? 'INSUFFICIENT_SUBMISSIONS' : 'REPEATED_DIAGNOSIS',
      );
      expect(repeated.signature).toEqual(
        size < 3
          ? null
          : {
              version: 'DEC005_V1_DIAGNOSIS',
              diagnosisCode: 'FAILED_TEST',
            },
      );
      expectMetadata(
        repeated,
        ruleIds.repeatedError,
        {
          repeatedErrorAttempts: 3,
          repeatedErrorWindowDays: 14,
        },
        shared,
      );
      expectMetadata(
        stagnant,
        ruleIds.stagnation,
        { stagnationAttempts: 3 },
        shared,
      );
      expect(shared).toEqual(before);
      // These prefix calculations establish no episode transitions or worker
      // replay guarantees; their persistence remains IMP-05.05 work.
    },
  );

  it.each(['SYNTAX_ERROR', 'RUNTIME_ERROR', 'TIMEOUT'] as const)(
    '%s parcial fiable repite diagnóstico sin acreditar conteos de estancamiento',
    (diagnosis) => {
      const technical = partialResult(diagnosis);
      expect(submitTechnicalResultSchema.safeParse(technical).success).toBe(
        true,
      );
      const shared = facts(
        '2026-10-03T12:00:00.000000Z',
        [
          attempt(101, '2026-10-01T12:00:00.000000Z', '1', technical),
          attempt(
            102,
            '2026-10-02T12:00:00.000000Z',
            '2',
            structuredClone(technical),
          ),
          attempt(
            103,
            '2026-10-03T12:00:00.000000Z',
            '3',
            structuredClone(technical),
          ),
        ],
        `synthetic-partial-${diagnosis}`,
      );
      const before = structuredClone(shared);
      freezeFacts(shared);
      const repeated = evaluateRepeatedError(repeatedErrorInput(shared));
      const stagnant = evaluateStagnation(stagnationInput(shared));
      expect(repeated).toMatchObject({
        outcome: 'MATCH',
        reason: 'REPEATED_DIAGNOSIS',
        selectedAttemptIds: [id(101), id(102), id(103)],
        signature: { version: 'DEC005_V1_DIAGNOSIS', diagnosisCode: diagnosis },
        evidence: { visibleTotal: 3 },
      });
      expect(
        repeated.evidence?.submissions.map((value) => value.diagnosisCode),
      ).toEqual([diagnosis, diagnosis, diagnosis]);
      expect(stagnant).toMatchObject({
        outcome: 'NOT_VERIFIABLE',
        reason: 'RESULT_NOT_VERIFIABLE',
        selectedAttemptIds: [id(101), id(102), id(103)],
        evidence: null,
        cause: null,
      });
      expectMetadata(
        repeated,
        ruleIds.repeatedError,
        {
          repeatedErrorAttempts: 3,
          repeatedErrorWindowDays: 14,
        },
        shared,
      );
      expectMetadata(
        stagnant,
        ruleIds.stagnation,
        { stagnationAttempts: 3 },
        shared,
      );
      expect(shared).toEqual(before);
    },
  );

  it('UNKNOWN confirmado interrumpe repetición y deja estancamiento no verificable', () => {
    const unknown: SubmitTechnicalResult = {
      ...completeResult(0),
      diagnosisCode: 'UNKNOWN',
      terminationReason: 'PROTOCOL_INVALID',
      visibleTestResults: [],
      hiddenChecksPassed: null,
    };
    expect(submitTechnicalResultSchema.safeParse(unknown).success).toBe(true);
    const shared = facts(
      '2026-10-03T12:00:00.000000Z',
      [
        attempt(101, '2026-10-01T12:00:00.000000Z', '1', completeResult(1)),
        attempt(102, '2026-10-02T12:00:00.000000Z', '2', unknown),
        attempt(103, '2026-10-03T12:00:00.000000Z', '3', completeResult(1)),
      ],
      'synthetic-joint-unknown',
    );
    const repeated = evaluateRepeatedError(repeatedErrorInput(shared));
    const stagnant = evaluateStagnation(stagnationInput(shared));
    expect(repeated).toMatchObject({
      outcome: 'NO_MATCH',
      reason: 'DIAGNOSIS_INTERRUPTED',
      selectedAttemptIds: [id(101), id(102), id(103)],
      signature: null,
      cause: null,
    });
    expect(stagnant).toMatchObject({
      outcome: 'NOT_VERIFIABLE',
      reason: 'RESULT_NOT_VERIFIABLE',
      selectedAttemptIds: [id(101), id(102), id(103)],
      evidence: null,
      cause: null,
    });
  });

  it('ATTEMPT_SUBMITTED en T reinicia el silencio sin cambiar los diagnósticos técnicos', () => {
    const shared = facts(
      '2026-10-12T12:00:00.000000Z',
      [
        attempt(101, '2026-10-01T12:00:00.000000Z', '1', completeResult(1)),
        attempt(102, '2026-10-02T12:00:00.000000Z', '2', completeResult(1)),
        attempt(103, '2026-10-05T12:00:00.000000Z', '3', completeResult(1)),
      ],
      'synthetic-before-new-submit',
    );
    const beforeInactivity = evaluateInactivity(inactivityInput(shared));
    expect(beforeInactivity).toMatchObject({
      outcome: 'MATCH',
      reason: 'INACTIVITY_THRESHOLD_REACHED',
      evidence: {
        lastAt: '2026-10-05T12:00:00.000000Z',
        elapsedMicroseconds: '604800000000',
        thresholdMicroseconds: '604800000000',
        referenceEvents: [{ source: 'ATTEMPT', id: id(103) }],
      },
    });
    const preserved = structuredClone(beforeInactivity);
    const after = facts(
      shared.evaluationTime,
      [
        ...shared.submissions,
        attempt(104, '2026-10-12T12:00:00.000000Z', '4', completeResult(1)),
      ],
      'synthetic-after-new-submit',
      'b'.repeat(64),
    );
    const inactive = evaluateInactivity(inactivityInput(after));
    const repeated = evaluateRepeatedError(repeatedErrorInput(after));
    const stagnant = evaluateStagnation(stagnationInput(after));
    expect(inactive).toMatchObject({
      outcome: 'NO_MATCH',
      reason: 'THRESHOLD_NOT_REACHED',
      evidence: {
        lastAt: '2026-10-12T12:00:00.000000Z',
        elapsedMicroseconds: '0',
        referenceEvents: [{ source: 'ATTEMPT', id: id(104) }],
      },
    });
    expect(repeated).toMatchObject({
      outcome: 'MATCH',
      selectedAttemptIds: [id(102), id(103), id(104)],
      signature: {
        version: 'DEC005_V1_DIAGNOSIS',
        diagnosisCode: 'FAILED_TEST',
      },
    });
    expect(stagnant).toMatchObject({
      outcome: 'MATCH',
      selectedAttemptIds: [id(102), id(103), id(104)],
    });
    expectMetadata(
      beforeInactivity,
      ruleIds.inactivity,
      { inactivityDays: 7 },
      shared,
    );
    expectMetadata(inactive, ruleIds.inactivity, { inactivityDays: 7 }, after);
    expect(beforeInactivity).toEqual(preserved);
  });

  it('las tres salidas preservan metadatos y evidencia ante mutaciones posteriores de las entradas', () => {
    const shared = facts(
      '2026-10-03T12:00:00.000000Z',
      [
        attempt(101, '2026-10-01T12:00:00.000000Z', '1', completeResult(1)),
        attempt(102, '2026-10-02T12:00:00.000000Z', '2', completeResult(1)),
        attempt(103, '2026-10-03T12:00:00.000000Z', '3', completeResult(1)),
      ],
      'synthetic-joint-immutable',
    );
    const repeatedInput = repeatedErrorInput(shared);
    const stagnantInput = stagnationInput(shared);
    const inactiveInput = inactivityInput(shared);
    const repeated = evaluateRepeatedError(repeatedInput);
    const stagnant = evaluateStagnation(stagnantInput);
    const inactive = evaluateInactivity(inactiveInput);
    const saved = structuredClone({ repeated, stagnant, inactive });
    if (
      repeatedInput.rule?.type !== 'REPEATED_ERROR' ||
      stagnantInput.rule?.type !== 'STAGNATION' ||
      inactiveInput.rule?.type !== 'INACTIVITY'
    )
      throw new Error('fixture');
    repeatedInput.rule.parameters.repeatedErrorAttempts = 9;
    stagnantInput.rule.parameters.stagnationAttempts = 9;
    inactiveInput.rule.parameters.inactivityDays = 99;
    shared.snapshot.revision = 'synthetic-later-revision';
    shared.snapshot.digest = 'c'.repeat(64);
    inactiveInput.snapshot.revision = 'synthetic-later-inactivity-revision';
    const first = shared.submissions[0];
    if (!first?.profile) throw new Error('fixture');
    first.profile.visibleTestIds[0] = 'changed-visible-id';
    first.profile.limits.runtimeMs = 1;
    first.submittedAt = '2026-09-30T12:00:00.000000Z';
    inactiveInput.events[0]!.occurredAt = '2026-09-30T12:00:00.000000Z';
    inactiveInput.events[2]!.id = id(999);
    if (inactiveInput.coverage.status !== 'CONTINUOUS')
      throw new Error('fixture');
    inactiveInput.coverage.sources[0]!.referenceId =
      'changed-coverage-reference';
    inactiveInput.coverage.epoch = 'changed-coverage-epoch';
    expect({ repeated, stagnant, inactive }).toEqual(saved);
    expect(repeated.parameters).toEqual({
      repeatedErrorAttempts: 3,
      repeatedErrorWindowDays: 14,
    });
    expect(stagnant.parameters).toEqual({ stagnationAttempts: 3 });
    expect(inactive).toHaveProperty('parameters', { inactivityDays: 7 });
  });
});
