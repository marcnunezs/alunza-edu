import {
  evaluateGovernancePhaseAcceptance as evaluate,
  parseGovernanceAcceptanceArguments,
} from '../../scripts/governance-phase-acceptance-core.mjs';

const sourceDigest = 'a'.repeat(64);
const caseIds = Array.from({ length: 6 }, (_, i) => `IMP06-PHASE-0${i + 1}`);
function input() {
  const report = (surface) => ({
    schemaVersion: 1,
    increment: 'IMP-06.07',
    suite: 'governance-phase',
    evidenceSurface: surface,
    environment: 'LAB TEST',
    status: 'passed',
    sourceDigestBefore: sourceDigest,
    sourceDigestAfter: sourceDigest,
    startedAt: '2026-11-03T23:00:00.000Z',
    finishedAt: '2026-11-03T23:10:00.000Z',
    cases: caseIds.map((id) => ({ id, status: 'passed' })),
    counts: { total: 6, passed: 6, failed: 0, pending: 0, skipped: 0 },
    sql: { status: 'passed', files: 22, assertions: 1513 },
    cleanup: 'completed',
    inventoryCoverage: {
      complete: true,
      casesComplete: true,
      specsComplete: true,
      expectedCases: 6,
      expectedSpecs: 1,
    },
    tests: caseIds.map((id) => ({
      id,
      state: 'passed',
      spec: 'tests/e2e/governance-phase.cy.ts',
    })),
  });
  return {
    candidate: { sourceDigest },
    caseIds,
    matrix: [17, 19, 24, 27].flatMap((n) =>
      Array.from({ length: 4 }, (_, i) => ({
        scenarioId: `ALZ-HU-${String(n).padStart(3, '0')}-E${i + 1}`,
        evidence: [
          { suite: 'http', caseId: caseIds[i] },
          { suite: 'e2e', caseId: caseIds[i] },
        ],
      })),
    ),
    reports: { http: report('http'), e2e: report('e2e') },
    notBefore: '2026-11-03T22:33:41.512Z',
    now: '2026-11-03T23:11:00.000Z',
  };
}
test('functional success remains blocked with fixed historical counters and exit 2', () => {
  expect(evaluate(input())).toMatchObject({
    status: 'blocked',
    functionalStatus: 'passed',
    acceptanceStatus: 'blocked',
    exitCode: 2,
    errors: [],
    ciExecuted: false,
    closure: {
      contextualConsumed: 9,
      contextualBudget: 17,
      finalCiPassed: 0,
      finalCiRequired: 1,
    },
  });
  const value = input();
  value.closure = { status: 'passed', finalCiPassed: 1 };
  expect(evaluate(value).status).toBe('blocked');
});
test.each(['http', 'e2e'])(
  'missing %s, failed, omitted and duplicate cases cannot pass',
  (surface) => {
    const missing = input();
    delete missing.reports[surface];
    expect(evaluate(missing)).toMatchObject({ status: 'failed', exitCode: 1 });
    for (const state of ['failed', 'pending', 'skipped']) {
      const value = input();
      value.reports[surface].cases[1].status = state;
      expect(evaluate(value).functionalStatus).toBe('failed');
    }
    const duplicate = input();
    duplicate.reports[surface].cases[1].id = caseIds[0];
    expect(evaluate(duplicate).errors).toContain(
      `REPORT_CASES_${surface.toUpperCase()}`,
    );
    const short = input();
    short.reports[surface].cases.pop();
    expect(evaluate(short).functionalStatus).toBe('failed');
  },
);
test.each(['http', 'e2e'])(
  'rejects old, changed-candidate and future %s reports',
  (surface) => {
    for (const field of ['sourceDigestBefore', 'sourceDigestAfter']) {
      const value = input();
      value.reports[surface][field] = 'b'.repeat(64);
      expect(evaluate(value).errors).toContain(
        `REPORT_CANDIDATE_${surface.toUpperCase()}`,
      );
    }
    for (const [field, timestamp] of [
      ['startedAt', '2026-11-02T23:00:00.000Z'],
      ['finishedAt', '2026-11-03T23:12:00.000Z'],
      ['finishedAt', '2026-11-03T22:59:00.000Z'],
      ['startedAt', null],
    ]) {
      const value = input();
      value.reports[surface][field] = timestamp;
      expect(evaluate(value).errors).toContain(
        `REPORT_STALE_${surface.toUpperCase()}`,
      );
    }
  },
);
test('must cover all 16 original scenarios with known executed evidence', () => {
  const missing = input();
  missing.matrix.pop();
  expect(evaluate(missing).errors).toContain('SCENARIO_MATRIX_INVALID');
  const duplicate = input();
  duplicate.matrix[1] = duplicate.matrix[0];
  expect(evaluate(duplicate).errors).toContain('SCENARIO_MATRIX_INVALID');
  for (const evidence of [
    [],
    [{ suite: 'e2e', caseId: caseIds[0] }],
    [
      { suite: 'e2e', caseId: caseIds[0] },
      { suite: 'e2e', caseId: caseIds[1] },
    ],
    [{ suite: 'ci', caseId: caseIds[0] }],
    [{ suite: 'e2e', caseId: 'IMP06-PHASE-99' }],
  ]) {
    const value = input();
    value.matrix[0].evidence = evidence;
    expect(evaluate(value).errors).toContain('SCENARIO_EVIDENCE_INCOMPLETE');
  }
});
test('environment, increment and counts are checked independently of passed labels', () => {
  for (const patch of [
    { increment: 'IMP-06.06' },
    { environment: 'PRODUCTION' },
    { evidenceSurface: 'http' },
    { schemaVersion: 0 },
    { suite: 'full' },
  ]) {
    const value = input();
    Object.assign(value.reports.e2e, patch);
    expect(evaluate(value).errors).toContain('REPORT_IDENTITY_E2E');
  }
  const value = input();
  value.reports.http.counts.failed = 1;
  expect(evaluate(value).errors).toContain('REPORT_COUNTS_HTTP');
});
test('E2E inventory and raw observations must agree with normalized cases', () => {
  const missing = input();
  delete missing.reports.e2e.inventoryCoverage;
  expect(evaluate(missing).errors).toContain('E2E_INVENTORY_INCOMPLETE');
  const inventory = input();
  inventory.reports.e2e.inventoryCoverage.expectedSpecs = 2;
  expect(evaluate(inventory).errors).toContain('E2E_INVENTORY_INCOMPLETE');
  for (const patch of [
    { state: 'failed' },
    { spec: 'tests/e2e/audit.cy.ts' },
    { id: caseIds[1] },
  ]) {
    const value = input();
    Object.assign(value.reports.e2e.tests[0], patch);
    expect(evaluate(value).errors).toContain('E2E_CASES_MISMATCH');
  }
  const unknown = input();
  unknown.matrix[0].scenarioId = 'PRIVATE_UNEXPECTED_INPUT';
  expect(JSON.stringify(evaluate(unknown))).not.toContain(
    'PRIVATE_UNEXPECTED_INPUT',
  );
});
test('SQL and cleanup must finish before HTTP is accepted', () => {
  for (const patch of [
    { cleanup: 'failed' },
    { sql: { status: 'passed', files: 0, assertions: 0 } },
    { sql: { status: 'failed', files: 22, assertions: 1513 } },
  ]) {
    const value = input();
    Object.assign(value.reports.http, patch);
    expect(evaluate(value).errors).toContain('HTTP_REGRESSIONS_INCOMPLETE');
  }
});
test('explicit UTC cycle window is required; arbitrary closure flags are rejected', () => {
  expect(
    parseGovernanceAcceptanceArguments(['--since', input().notBefore]),
  ).toEqual({ notBefore: input().notBefore });
  for (const args of [
    [],
    ['--since', 'yesterday'],
    ['--since', input().notBefore, '--close'],
    ['--since', '2026-11-03T23:00:00-03:00'],
  ])
    expect(() => parseGovernanceAcceptanceArguments(args)).toThrow(
      'ACCEPTANCE_REQUIRES_SINCE_UTC',
    );
  const value = input();
  value.notBefore = '2026-11-04T00:00:00.000Z';
  expect(evaluate(value).errors).toContain('ACCEPTANCE_WINDOW_INVALID');
});

test.each(['http', 'e2e'])(
  'a rejected %s report cannot accredit scenarios with individually passed cases',
  (surface) => {
    for (const patch of [
      { suite: 'full' },
      { startedAt: '2026-11-02T23:00:00.000Z' },
      { sourceDigestAfter: 'b'.repeat(64) },
      { counts: { total: 6, passed: 6, failed: 1, pending: 0, skipped: 0 } },
      surface === 'http'
        ? { sql: { status: 'not-completed' } }
        : { inventoryCoverage: { complete: false } },
    ]) {
      const value = input();
      Object.assign(value.reports[surface], patch);
      const result = evaluate(value);
      expect(result.functionalStatus).toBe('failed');
      expect(result.scenarios).toHaveLength(16);
      expect(result.scenarios.every((row) => row.status === 'failed')).toBe(
        true,
      );
    }
  },
);

test('invalid global candidate or time window accredits no scenarios', () => {
  for (const patch of [
    { candidate: { sourceDigest: 'invalid' } },
    { notBefore: 'invalid' },
    { now: 'invalid' },
    { notBefore: '2026-11-04T00:00:00.000Z' },
  ]) {
    const value = { ...input(), ...patch };
    // Matching an invalid digest in both reports must not establish a candidate.
    if (patch.candidate)
      for (const report of Object.values(value.reports)) {
        report.sourceDigestBefore = patch.candidate.sourceDigest;
        report.sourceDigestAfter = patch.candidate.sourceDigest;
      }
    const result = evaluate(value);
    expect(result.functionalStatus).toBe('failed');
    expect(result.scenarios.every((row) => row.status === 'failed')).toBe(true);
  }
});
