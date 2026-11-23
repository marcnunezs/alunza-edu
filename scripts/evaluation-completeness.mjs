import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { cases, manifest } from '../fixtures/ai/help-adversarial-manifest.mjs';

const localTestName =
  'operational UNKNOWN explains deterministically without configuration or providers';
const fail = (code) => {
  throw Object.assign(new Error(code), { code });
};
const requireCondition = (condition, code = 'EVALUATION_ORACLE_MISMATCH') => {
  if (!condition) fail(code);
};
function uniqueIndex(values, key) {
  requireCondition(Array.isArray(values), 'EVALUATION_CORPUS_INCOMPLETE');
  const index = new Map();
  for (const value of values) {
    const id = value?.[key];
    requireCondition(
      typeof id === 'string' && id.length > 0 && !index.has(id),
      'EVALUATION_CORPUS_DUPLICATE_OR_INVALID_ID',
    );
    index.set(id, value);
  }
  return index;
}
function exactCases(index, expected) {
  requireCondition(
    index.size === expected.length &&
      expected.every((item) => index.has(item.id)),
    'EVALUATION_CORPUS_INCOMPLETE',
  );
}
function localReceipt(evidence) {
  if (!evidence) return null;
  requireCondition(
    typeof evidence.raw === 'string' &&
      typeof evidence.path === 'string' &&
      evidence.path.length > 0 &&
      /^[a-f0-9]{64}$/u.test(evidence.sha256 ?? '') &&
      createHash('sha256').update(evidence.raw).digest('hex') ===
        evidence.sha256,
    'EVALUATION_LOCAL_EVIDENCE_INVALID',
  );
  let result;
  try {
    result = JSON.parse(evidence.raw);
  } catch {
    fail('EVALUATION_LOCAL_EVIDENCE_INVALID');
  }
  const suites = Array.isArray(result.testResults)
    ? result.testResults.filter(
        (suite) =>
          typeof suite.name === 'string' &&
          suite.name.replaceAll('\\', '/').split('/').at(-1) ===
            'help.worker.spec.ts',
      )
    : [];
  const tests = suites[0]?.assertionResults?.filter(
    (test) => test.fullName === localTestName,
  );
  requireCondition(
    result.success === true &&
      result.numFailedTests === 0 &&
      result.numFailedTestSuites === 0 &&
      Number.isSafeInteger(result.numPassedTests) &&
      result.numPassedTests > 0 &&
      Number.isSafeInteger(result.numPassedTestSuites) &&
      result.numPassedTestSuites > 0 &&
      suites.length === 1 &&
      // Jest marks a successful suite selected by --testNamePattern as focused.
      // The exact assertion must still have run and passed; skipped is not proof.
      ['passed', 'focused'].includes(suites[0].status) &&
      tests?.length === 1 &&
      tests[0].status === 'passed',
    'EVALUATION_LOCAL_EVIDENCE_INVALID',
  );
  // These are the exact bytes supplied by the caller's persisted Jest report.
  // A declared omission, test name or hand-written passed flag is insufficient.
  return {
    kind: 'JEST_LOCAL_UNIT',
    path: evidence.path,
    sha256: evidence.sha256,
    suite: 'help.worker.spec.ts',
    testName: localTestName,
    status: 'PASSED',
  };
}

/** Checks scenario execution, not pedagogical quality. The operational UNKNOWN
 * case is credited separately, only from the exact persisted local Jest report.
 * No network, filesystem reads or provider calls occur in this pure check. */
export function assertEvaluationCompleteness(report, localEvidence) {
  const local = cases.filter(
    (item) => item.context.infrastructureStatus !== 'OK',
  );
  const product = cases.filter(
    (item) => item.context.infrastructureStatus === 'OK' && !item.candidate,
  );
  const reviews = cases.filter(
    (item) => item.context.infrastructureStatus === 'OK' && item.candidate,
  );
  requireCondition(
    cases.length === 43 &&
      product.length === 30 &&
      reviews.length === 12 &&
      local.length === 1,
    'EVALUATION_CORPUS_CHANGED',
  );
  requireCondition(['TEST', 'AZURE'].includes(report?.provider));
  const oracles = uniqueIndex(report.oracles, 'caseId');
  const reviewResults = uniqueIndex(report.reviewCases, 'caseId');
  const omissions = uniqueIndex(report.omittedRemoteOracles, 'id');
  exactCases(oracles, product);
  exactCases(reviewResults, reviews);
  exactCases(omissions, local);
  requireCondition(
    Array.isArray(report.samples),
    'EVALUATION_CORPUS_INCOMPLETE',
  );
  const allSamples = uniqueIndex(report.samples, 'requestId');
  const productSamples = new Map(
    [...allSamples].filter(([, sample]) => sample.profile === 'adversarial'),
  );
  requireCondition(
    productSamples.size === product.length,
    'EVALUATION_CORPUS_INCOMPLETE',
  );
  const requests = new Set();
  const feedback = new Set();
  const covered = [];
  for (const item of product) {
    const oracle = oracles.get(item.id);
    const sample = productSamples.get(oracle.requestId);
    requireCondition(
      sample &&
        !requests.has(oracle.requestId) &&
        typeof sample.feedbackId === 'string' &&
        sample.feedbackId.length > 0 &&
        !feedback.has(sample.feedbackId) &&
        sample.kind === item.kind &&
        sample.hintLevel === item.hintLevel &&
        sample.diagnosis === item.context.diagnosisCode &&
        sample.status === item.expected.status &&
        sample.verificationComplete === true &&
        oracle.diagnosisPreserved === true &&
        oracle.actual === item.expected.status &&
        isDeepStrictEqual(oracle.expected, item.expected) &&
        oracle.semanticEvaluation ===
          (report.provider === 'TEST'
            ? 'NOT_ESTABLISHED'
            : 'PENDING_HUMAN_REVIEW'),
    );
    requests.add(oracle.requestId);
    feedback.add(sample.feedbackId);
    covered.push({
      caseId: item.id,
      execution: 'PRODUCT_HELP',
      requestId: oracle.requestId,
      feedbackId: sample.feedbackId,
      diagnosisCode: sample.diagnosis,
      kind: sample.kind,
      hintLevel: sample.hintLevel,
      status: sample.status,
    });
  }
  const calls = new Set();
  for (const item of reviews) {
    const observed = reviewResults.get(item.id);
    const expected = item.expected.review ?? 'REJECT';
    const boundary = item.expected.boundary === 'REJECT';
    requireCondition(
      observed.state === 'SUCCEEDED' &&
        observed.passed === true &&
        observed.expected === expected &&
        observed.actual === expected &&
        observed.boundaryRejected === boundary &&
        (boundary
          ? observed.reviewCallId === null
          : typeof observed.reviewCallId === 'string' &&
            observed.reviewCallId.length > 0 &&
            !calls.has(observed.reviewCallId)),
    );
    if (!boundary) calls.add(observed.reviewCallId);
    covered.push({
      caseId: item.id,
      execution: boundary ? 'CANDIDATE_BOUNDARY' : 'CANDIDATE_REVIEW',
      reviewCallId: observed.reviewCallId,
      verdict: observed.actual,
    });
  }
  const omitted = omissions.get(local[0].id);
  requireCondition(
    omitted.execution === 'deterministic-local-tests' &&
      omitted.reason === 'infrastructure-failure-does-not-authorize-ai',
  );
  const receipt = localReceipt(localEvidence);
  if (receipt)
    covered.push({
      caseId: local[0].id,
      execution: 'LOCAL_UNIT',
      evidence: receipt,
    });
  return {
    version: 1,
    corpusVersion: manifest.version,
    casesHash: manifest.casesHash,
    status: receipt ? 'COMPLETE' : 'LOCAL_EVIDENCE_PENDING',
    expectedCases: cases.length,
    coveredCases: covered.length,
    product: product.length,
    candidateReviews: reviews.length,
    candidateBoundary: reviews.length - calls.size,
    candidateProviderReview: calls.size,
    localDeterministic: receipt ? 1 : 0,
    productProvider: report.provider,
    pendingCaseIds: receipt ? [] : [local[0].id],
    localEvidence: receipt,
    pedagogicalQuality: 'NOT_ESTABLISHED_BY_COMPLETENESS',
    cases: covered,
  };
}
