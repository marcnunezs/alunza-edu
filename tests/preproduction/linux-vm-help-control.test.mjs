import { describe, it, expect, jest } from '@jest/globals';
import {
  validateHelpAction,
  assertAttemptSnapshot,
  assertHelpEvidence,
  assertRetryEvidence,
} from '../../scripts/linux-vm-help-control.mjs';
import {
  helpExercisePlan,
  publicHelpScope,
  closeHelpScope,
} from '../integration/linux-vm-help-fixture.mjs';
import { canonicalHash } from '../integration/linux-vm-api.mjs';

const id = (n) => `90000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = {
  scope: 'H01',
  actorId: id(1),
  organizationId: id(2),
  classId: id(3),
  activityId: id(4),
  assignmentId: id(5),
  exerciseVersionId: id(6),
};
function snapshot(diagnosis = 'FAILED_TEST') {
  return {
    attempt: {
      id: id(7),
      execution_id: id(8),
      student_id: scope.actorId,
      organization_id: scope.organizationId,
      class_id: scope.classId,
      activity_id: scope.activityId,
      activity_exercise_id: scope.assignmentId,
      exercise_version_id: scope.exerciseVersionId,
      code: 'module.exports.solve=(a,b)=>a-b;',
      technical_result: { diagnosisCode: diagnosis },
    },
    results: [{ attempt_id: id(7), private_test_results: [] }],
    events: [
      { event_type: 'ATTEMPT_SUBMITTED' },
      { event_type: 'EXECUTION_COMPLETED' },
    ],
  };
}
function help(status = 'SUPPORTED', kind = 'FEEDBACK') {
  const baseline = assertAttemptSnapshot(
    snapshot(),
    scope,
    snapshot().attempt.code,
    'FAILED_TEST',
  );
  const source = { id: id(20), versionId: id(21) };
  const supported = status === 'SUPPORTED',
    viewed = supported || kind === 'FEEDBACK';
  const phases = supported
    ? ['EMBEDDING', 'GENERATION', 'REVIEW']
    : status === 'NO_EVIDENCE'
      ? ['EMBEDDING']
      : ['EMBEDDING', 'GENERATION'];
  return {
    scope,
    baseline,
    source,
    expectedStatus: status,
    kind,
    request: {
      id: id(9),
      attempt_id: id(7),
      student_id: scope.actorId,
      organization_id: scope.organizationId,
      class_id: scope.classId,
      lifecycle_status: 'SUCCEEDED',
      kind,
      level_reserved: false,
    },
    feedback: {
      id: id(10),
      requestId: id(9),
      attemptId: id(7),
      kind,
      hintLevel: kind === 'HINT' ? 1 : null,
      status,
      viewedAt: viewed ? '2026-11-18T00:00:00Z' : null,
      presentationToken: viewed ? id(12) : null,
      help: {
        status,
        diagnosis_code: 'FAILED_TEST',
        hint: supported && kind === 'HINT' ? 'Revisa el cálculo.' : '',
        source_refs: supported
          ? [
              {
                source_id: source.id,
                source_version_id: source.versionId,
                chunk_id: id(22),
                locator: 'p1',
              },
            ]
          : [],
      },
    },
    events: [
      { event_type: 'HELP_REQUESTED' },
      ...(viewed
        ? [
            {
              event_type:
                kind === 'HINT' ? 'HINT_DELIVERED' : 'FEEDBACK_VIEWED',
            },
          ]
        : []),
    ],
    calls: phases.map((phase) => ({
      phase,
      state:
        status === 'PROVIDER_UNAVAILABLE' && phase === 'GENERATION'
          ? 'DISPATCHED'
          : 'COMPLETED',
    })),
    observations: phases.map((phase) => ({
      phase,
      requestId: id(9),
      attemptId: id(7),
      executionId: baseline.executionId,
      codeSha256: baseline.codeSha256,
      scope: 'H01',
      pass: true,
      committed: true,
      submittedEvents: 1,
      completedEvents: 1,
      privateResultRows: 1,
    })),
  };
}

describe('bounded physical help control actions', () => {
  it('accepts the six-submit profile without SQL, paths, role escalation or extra commands', () => {
    expect(validateHelpAction('prepare', { scope: 'H01' })).toEqual({
      scope: 'H01',
    });
    expect(
      validateHelpAction('login', { scope: 'H02', role: 'student' }),
    ).toBeTruthy();
    expect(
      validateHelpAction('verify-attempt', {
        scope: 'H01',
        attemptId: id(1),
        code: 'x',
        diagnosis: 'FAILED_TEST',
        key: id(2),
        status: 201,
        payload: { data: {} },
      }),
    ).toBeTruthy();
    for (const [action, input] of [
      ['reset', {}],
      ['prepare', { scope: 'F01' }],
      ['prepare', { scope: 'H01', sql: 'delete' }],
      ['login', { scope: 'H01', role: 'admin' }],
      ['fault', { scope: 'H01', attemptId: id(1), enabled: true }],
      [
        'verify-help',
        {
          scope: 'H01',
          attemptId: id(1),
          requestId: id(2),
          kind: 'EXPLANATION',
          expectedStatus: 'SUPPORTED',
        },
      ],
    ])
      expect(() => validateHelpAction(action, input)).toThrow();
  });
  it('rejects a foreign path, oversized code or a failed submission presented as durable', () => {
    const input = {
      scope: 'H01',
      attemptId: id(1),
      code: 'x',
      diagnosis: 'FAILED_TEST',
      key: id(2),
      status: 201,
      payload: {},
    };
    for (const change of [
      { attemptId: '../../secret' },
      { code: 'x'.repeat(65537) },
      { status: 503 },
      { diagnosis: 'UNKNOWN' },
    ])
      expect(() =>
        validateHelpAction('verify-attempt', { ...input, ...change }),
      ).toThrow();
    expect(() => validateHelpAction('inspect', { scope: 'H01' })).toThrow();
  });
});

describe('independent committed attempt evidence', () => {
  it('requires the exact owner, class, code, result row and both durable events', () => {
    const value = snapshot();
    expect(
      assertAttemptSnapshot(value, scope, value.attempt.code, 'FAILED_TEST'),
    ).toMatchObject({
      attemptId: id(7),
      executionId: id(8),
      diagnosis: 'FAILED_TEST',
      snapshotSha256: canonicalHash(value),
    });
    for (const mutate of [
      (v) => {
        v.attempt.student_id = id(99);
      },
      (v) => {
        v.attempt.class_id = id(99);
      },
      (v) => {
        v.attempt.code += 'changed';
      },
      (v) => {
        v.results = [];
      },
      (v) => {
        v.results.push(v.results[0]);
      },
      (v) => {
        v.events.pop();
      },
      (v) => {
        v.events[1].event_type = 'ATTEMPT_SUBMITTED';
      },
    ]) {
      const bad = globalThis.structuredClone(value);
      mutate(bad);
      expect(() =>
        assertAttemptSnapshot(bad, scope, value.attempt.code, 'FAILED_TEST'),
      ).toThrow();
    }
  });
  it('requires genuinely new retry evidence and keeps the original immutable', () => {
    const value = snapshot(),
      first = assertAttemptSnapshot(
        value,
        scope,
        value.attempt.code,
        'FAILED_TEST',
      );
    const retryValue = globalThis.structuredClone(value);
    retryValue.attempt.id = id(30);
    retryValue.attempt.execution_id = id(31);
    retryValue.attempt.code = 'module.exports.solve=(a,b)=>a+b;';
    retryValue.attempt.technical_result.diagnosisCode = 'SUCCESS';
    retryValue.results[0].attempt_id = id(30);
    const retry = assertAttemptSnapshot(
      retryValue,
      scope,
      retryValue.attempt.code,
      'SUCCESS',
    );
    expect(assertRetryEvidence(first, retry, value)).toEqual({
      pass: true,
      firstAttemptId: id(7),
      retryAttemptId: id(30),
    });
    expect(() =>
      assertRetryEvidence(
        first,
        { ...retry, executionId: first.executionId },
        value,
      ),
    ).toThrow('HELP_RETRY_NEW_EVIDENCE');
    const mutated = globalThis.structuredClone(value);
    mutated.attempt.technical_result.diagnosisCode = 'SUCCESS';
    expect(() => assertRetryEvidence(first, retry, mutated)).toThrow(
      'HELP_ORIGINAL_MUTATED',
    );
  });
});

describe('RAG status, provider and presentation proofs', () => {
  it.each([
    ['SUPPORTED', 'FEEDBACK', 1, 3],
    ['NO_EVIDENCE', 'HINT', 0, 1],
    ['PROVIDER_UNAVAILABLE', 'HINT', 0, 2],
    ['SUPPORTED', 'HINT', 1, 3],
  ])(
    'proves %s %s without treating TEST as Azure',
    (status, kind, viewedCount, calls) => {
      const result = assertHelpEvidence(help(status, kind));
      expect(result).toMatchObject({ pass: true, status, kind, viewedCount });
      expect(result.providerCalls).toHaveLength(calls);
      expect(result.providerCalls.every((row) => row.provider === 'TEST')).toBe(
        true,
      );
      expect(result.sourceRefs).toHaveLength(status === 'SUPPORTED' ? 1 : 0);
    },
  );
  it('fails if help precedes either event or evidence comes from another scope', () => {
    for (const mutate of [
      (v) => {
        v.observations = [];
      },
      (v) => {
        v.observations[0].committed = false;
      },
      (v) => {
        v.observations[0].completedEvents = 0;
      },
      (v) => {
        v.observations[0].scope = 'H03';
      },
      (v) => {
        v.feedback.help.diagnosis_code = 'SUCCESS';
      },
      (v) => {
        v.feedback.help.source_refs[0].source_id = id(99);
      },
      (v) => {
        v.request.student_id = id(99);
      },
      (v) => {
        v.calls.push(v.calls[0]);
      },
    ]) {
      const value = help();
      mutate(value);
      expect(() => assertHelpEvidence(value)).toThrow();
    }
  });
  it('requires the UI ACK before verification and rejects duplicate or consumed fallback events', () => {
    const noAck = help();
    noAck.events.pop();
    noAck.feedback.viewedAt = null;
    expect(() => assertHelpEvidence(noAck)).toThrow('HELP_ACK_EVIDENCE');
    const duplicate = help();
    duplicate.events.push(duplicate.events[1]);
    expect(() => assertHelpEvidence(duplicate)).toThrow('HELP_ACK_EVIDENCE');
    const fallback = help('NO_EVIDENCE', 'HINT');
    fallback.events.push({ event_type: 'HINT_DELIVERED' });
    expect(() => assertHelpEvidence(fallback)).toThrow('HELP_ACK_EVIDENCE');
    const invented = help('PROVIDER_UNAVAILABLE', 'HINT');
    invented.feedback.help.hint = 'Una pista';
    expect(() => assertHelpEvidence(invented)).toThrow(
      'HELP_FALLBACK_CONSUMED_HINT',
    );
    const advanced = help('SUPPORTED', 'HINT');
    advanced.feedback.hintLevel = 2;
    expect(() => assertHelpEvidence(advanced)).toThrow('HELP_HINT_LEVEL');
  });
});

describe('owned additive fixtures and retirement', () => {
  it('uses precisely two public and six private cases and exposes no private tests or secrets', () => {
    const plan = helpExercisePlan(id(100), 'H01');
    expect(plan.tests).toHaveLength(8);
    expect(plan.tests.filter((t) => t.visibility === 'visible')).toHaveLength(
      2,
    );
    expect(plan.tests.filter((t) => t.visibility === 'hidden')).toHaveLength(6);
    const context = publicHelpScope({
      ...scope,
      prepared: true,
      closed: false,
      fixture: {
        incorrectCode: plan.incorrectCode,
        successCode: plan.successCode,
        hiddenTestIds: ['secret'],
      },
      token: 'secret',
      source: null,
    });
    expect(context.route).toBe(
      `/actividades/${scope.activityId}/ejercicios/${scope.assignmentId}`,
    );
    expect(JSON.stringify(context)).not.toContain('secret');
  });
  it('archives only owned resources through authorized API roles, preserving rows and Storage', async () => {
    const owned = { ...scope, source: { id: id(20) }, closed: false };
    const api = jest.fn(async (role, method, path) => ({
      data: path.startsWith('/sources/')
        ? { id: id(20), state: 'ACTIVE', revision: 1 }
        : path.startsWith('/activities/')
          ? { id: scope.activityId, state: 'PUBLISHED', revision: 2 }
          : { id: scope.classId, state: 'ACTIVE', revision: 3 },
    }));
    await closeHelpScope(owned, api);
    expect(owned.closed).toBe(true);
    expect(
      api.mock.calls
        .filter(([, method]) => method === 'POST')
        .map(([role, , path]) => [role, path]),
    ).toEqual([
      ['admin', `/sources/${id(20)}/archive`],
      ['teacher', `/activities/${scope.activityId}/close`],
      ['admin', `/classes/${scope.classId}/archive`],
    ]);
    expect(
      api.mock.calls.every(
        ([, method]) => method === 'GET' || method === 'POST',
      ),
    ).toBe(true);
    await closeHelpScope(owned, api);
    expect(api).toHaveBeenCalledTimes(6);
  });
  it('retains partial fixture ownership and reports a failed close', async () => {
    const partial = {
      ...scope,
      source: null,
      activityId: undefined,
      closed: false,
    };
    const api = jest.fn(async () => {
      throw new Error('REQUEST_FAILED');
    });
    await expect(closeHelpScope(partial, api)).rejects.toThrow(
      'REQUEST_FAILED',
    );
    expect(partial.closed).toBe(false);
    expect(api.mock.calls[0]).toEqual([
      'admin',
      'GET',
      `/classes/${scope.classId}`,
    ]);
  });
});
