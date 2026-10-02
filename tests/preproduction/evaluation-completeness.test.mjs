import { test, expect } from '@jest/globals';
import { createHash } from 'node:crypto';
import { cases } from '../../fixtures/ai/help-adversarial-manifest.mjs';
import { assertEvaluationCompleteness } from '../../scripts/evaluation-completeness.mjs';

function fixture() {
  const product = cases.filter(
    (item) => item.context.infrastructureStatus === 'OK' && !item.candidate,
  );
  return {
    provider: 'TEST',
    oracles: product.map((item) => ({
      caseId: item.id,
      requestId: `request-${item.id}`,
      expected: item.expected,
      actual: item.expected.status,
      diagnosisPreserved: true,
      semanticEvaluation: 'NOT_ESTABLISHED',
    })),
    samples: product.map((item) => ({
      requestId: `request-${item.id}`,
      feedbackId: `feedback-${item.id}`,
      profile: 'adversarial',
      kind: item.kind,
      hintLevel: item.hintLevel,
      diagnosis: item.context.diagnosisCode,
      status: item.expected.status,
      verificationComplete: true,
    })),
    reviewCases: cases
      .filter((item) => item.candidate)
      .map((item) => ({
        caseId: item.id,
        state: 'SUCCEEDED',
        expected: item.expected.review ?? 'REJECT',
        actual: item.expected.review ?? 'REJECT',
        passed: true,
        boundaryRejected: item.expected.boundary === 'REJECT',
        reviewCallId:
          item.expected.boundary === 'REJECT' ? null : `call-${item.id}`,
      })),
    omittedRemoteOracles: [
      {
        id: 'unknown-feedback',
        execution: 'deterministic-local-tests',
        reason: 'infrastructure-failure-does-not-authorize-ai',
      },
    ],
  };
}
function evidence(change = (value) => value) {
  const value = {
    success: true,
    numFailedTests: 0,
    numFailedTestSuites: 0,
    numPassedTests: 1,
    numPassedTestSuites: 1,
    testResults: [
      {
        name: 'C:\\fixture\\apps\\api\\src\\help\\help.worker.spec.ts',
        status: 'passed',
        assertionResults: [
          {
            fullName:
              'operational UNKNOWN explains deterministically without configuration or providers',
            status: 'passed',
          },
        ],
      },
    ],
  };
  change(value);
  const raw = JSON.stringify(value);
  return {
    raw,
    sha256: createHash('sha256').update(raw).digest('hex'),
    path: 'fixture/operational-local-tests.json',
  };
}

test('exact corpus execution remains 42/43 until the local UNKNOWN has recorded evidence', () => {
  const result = assertEvaluationCompleteness(fixture());
  expect(result).toMatchObject({
    status: 'LOCAL_EVIDENCE_PENDING',
    expectedCases: 43,
    coveredCases: 42,
    product: 30,
    candidateReviews: 12,
    candidateBoundary: 7,
    candidateProviderReview: 5,
    localDeterministic: 0,
    pendingCaseIds: ['unknown-feedback'],
    localEvidence: null,
  });
  expect(result.cases).toHaveLength(42);
});
test('the exact passed local Jest assertion completes coverage without calling it HTTP or quality evidence', () => {
  const local = evidence();
  const result = assertEvaluationCompleteness(fixture(), local);
  expect(result).toMatchObject({
    status: 'COMPLETE',
    coveredCases: 43,
    product: 30,
    candidateReviews: 12,
    localDeterministic: 1,
    pendingCaseIds: [],
    pedagogicalQuality: 'NOT_ESTABLISHED_BY_COMPLETENESS',
    localEvidence: { sha256: local.sha256, kind: 'JEST_LOCAL_UNIT' },
  });
  expect(new Set(result.cases.map((item) => item.caseId))).toEqual(
    new Set(cases.map((item) => item.id)),
  );
  expect(JSON.stringify(result)).not.toContain('assertionResults');
});
test.each(['oracles', 'samples', 'reviewCases', 'omittedRemoteOracles'])(
  'empty or incomplete %s cannot pass',
  (key) => {
    for (const replacement of [[], fixture()[key].slice(1)]) {
      const report = fixture();
      report[key] = replacement;
      expect(() => assertEvaluationCompleteness(report, evidence())).toThrow();
    }
  },
);
test.each(['oracles', 'samples', 'reviewCases', 'omittedRemoteOracles'])(
  'duplicate IDs in %s cannot compensate for missing coverage',
  (key) => {
    const report = fixture();
    report[key].push(report[key][0]);
    expect(() => assertEvaluationCompleteness(report, evidence())).toThrow(
      'EVALUATION_CORPUS_DUPLICATE_OR_INVALID_ID',
    );
  },
);
test.each([
  [
    'foreign case',
    (r) => {
      r.oracles[0].caseId = 'unapproved-case';
    },
  ],
  [
    'same request for two oracles',
    (r) => {
      r.oracles[1].requestId = r.oracles[0].requestId;
    },
  ],
  [
    'same feedback for two requests',
    (r) => {
      r.samples[1].feedbackId = r.samples[0].feedbackId;
    },
  ],
  [
    'diagnosis',
    (r) => {
      r.samples[0].diagnosis = 'UNKNOWN';
    },
  ],
  [
    'hint kind',
    (r) => {
      r.samples.find((s) => s.kind === 'HINT').kind = 'FEEDBACK';
    },
  ],
  [
    'hint level',
    (r) => {
      r.samples.find((s) => s.hintLevel === 2).hintLevel = 1;
    },
  ],
  [
    'expected oracle',
    (r) => {
      r.oracles[0].expected = { status: 'SUPPORTED' };
    },
  ],
  [
    'actual status',
    (r) => {
      r.oracles[0].actual = 'NO_EVIDENCE';
    },
  ],
  [
    'sample fallback',
    (r) => {
      r.samples[0].status = 'PROVIDER_UNAVAILABLE';
    },
  ],
  [
    'unchecked references',
    (r) => {
      r.samples[0].verificationComplete = false;
    },
  ],
  [
    'TEST quality claim',
    (r) => {
      r.oracles[0].semanticEvaluation = 'PENDING_HUMAN_REVIEW';
    },
  ],
  [
    'failed review',
    (r) => {
      r.reviewCases[0].state = 'FAILED';
    },
  ],
  [
    'wrong verdict',
    (r) => {
      r.reviewCases[0].actual = 'ACCEPT';
    },
  ],
  [
    'semantic rejected at boundary',
    (r) => {
      r.reviewCases[0].boundaryRejected = true;
      r.reviewCases[0].reviewCallId = null;
    },
  ],
  [
    'boundary called provider',
    (r) => {
      r.reviewCases.find((x) => x.boundaryRejected).reviewCallId =
        'call-unexpected';
    },
  ],
  [
    'reused review call',
    (r) => {
      r.reviewCases[1].reviewCallId = r.reviewCases[0].reviewCallId;
    },
  ],
])('rejects changed execution evidence: %s', (_label, mutate) => {
  const report = fixture();
  mutate(report);
  expect(() => assertEvaluationCompleteness(report, evidence())).toThrow();
});
test.each([
  [
    'failed report',
    (r) => {
      r.success = false;
    },
  ],
  [
    'failed test',
    (r) => {
      r.testResults[0].assertionResults[0].status = 'failed';
    },
  ],
  [
    'skipped test',
    (r) => {
      r.testResults[0].assertionResults[0].status = 'pending';
    },
  ],
  [
    'wrong test',
    (r) => {
      r.testResults[0].assertionResults[0].fullName = 'another passing test';
    },
  ],
  [
    'wrong suite',
    (r) => {
      r.testResults[0].name = 'different.spec.ts';
    },
  ],
  [
    'duplicate test',
    (r) => {
      r.testResults[0].assertionResults.push(
        r.testResults[0].assertionResults[0],
      );
    },
  ],
])('does not credit local UNKNOWN from %s', (_label, mutate) => {
  expect(() =>
    assertEvaluationCompleteness(fixture(), evidence(mutate)),
  ).toThrow('EVALUATION_LOCAL_EVIDENCE_INVALID');
});
test('Jest focused suite credits only the exact passed assertion even with unrelated skipped tests', () => {
  const local = evidence((value) => {
    value.testResults[0].status = 'focused';
    value.testResults[0].assertionResults.push({
      fullName: 'an unrelated test filtered out by testNamePattern',
      status: 'pending',
    });
  });
  expect(assertEvaluationCompleteness(fixture(), local)).toMatchObject({
    status: 'COMPLETE',
    coveredCases: 43,
    localDeterministic: 1,
  });
});
test.each(['pending', 'failed', 'skipped', 'todo', 'unknown', null])(
  'a suite status of %s is not accepted as local evidence',
  (status) => {
    const local = evidence((value) => {
      value.testResults[0].status = status;
    });
    expect(() => assertEvaluationCompleteness(fixture(), local)).toThrow(
      'EVALUATION_LOCAL_EVIDENCE_INVALID',
    );
  },
);
test.each(['pending', 'failed', 'skipped', 'todo'])(
  'focused cannot credit a %s target assertion',
  (status) => {
    const local = evidence((value) => {
      value.testResults[0].status = 'focused';
      value.testResults[0].assertionResults[0].status = status;
    });
    expect(() => assertEvaluationCompleteness(fixture(), local)).toThrow(
      'EVALUATION_LOCAL_EVIDENCE_INVALID',
    );
  },
);
test.each(['numPassedTests', 'numPassedTestSuites'])(
  'focused still requires a positive %s',
  (counter) => {
    const local = evidence((value) => {
      value.testResults[0].status = 'focused';
      value[counter] = 0;
    });
    expect(() => assertEvaluationCompleteness(fixture(), local)).toThrow(
      'EVALUATION_LOCAL_EVIDENCE_INVALID',
    );
  },
);
test('tampered report bytes or handwritten passed metadata do not establish local evidence', () => {
  const local = evidence();
  expect(() =>
    assertEvaluationCompleteness(fixture(), { ...local, raw: local.raw + ' ' }),
  ).toThrow('EVALUATION_LOCAL_EVIDENCE_INVALID');
  expect(() =>
    assertEvaluationCompleteness(fixture(), {
      caseId: 'unknown-feedback',
      status: 'PASSED',
    }),
  ).toThrow('EVALUATION_LOCAL_EVIDENCE_INVALID');
});
