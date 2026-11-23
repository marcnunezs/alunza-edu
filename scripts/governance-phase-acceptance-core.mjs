const digest = /^[a-f0-9]{64}$/;
const scenarioIds = [17, 19, 24, 27].flatMap((number) =>
  Array.from(
    { length: 4 },
    (_, index) => `ALZ-HU-${String(number).padStart(3, '0')}-E${index + 1}`,
  ),
);
const instant = (value) =>
  typeof value === 'string' && /^\d{4}-\d\d-\d\dT.*Z$/.test(value)
    ? Date.parse(value)
    : NaN;

/** Pure, fail-closed report review. This cycle cannot close IMP-06.04 or CI. */
export function evaluateGovernancePhaseAcceptance({
  matrix,
  caseIds,
  reports,
  candidate,
  notBefore,
  now = new Date().toISOString(),
}) {
  const errors = new Set();
  const fail = (code) => errors.add(code);
  const since = instant(notBefore),
    end = instant(now);
  const windowValid =
    Number.isFinite(since) && Number.isFinite(end) && since <= end;
  const candidateValid = digest.test(candidate?.sourceDigest ?? '');
  if (!windowValid) fail('ACCEPTANCE_WINDOW_INVALID');
  if (!candidateValid) fail('CANDIDATE_INVALID');
  const expected = Array.from({ length: 6 }, (_, i) => `IMP06-PHASE-0${i + 1}`);
  const caseInventoryValid =
    JSON.stringify(caseIds) === JSON.stringify(expected);
  if (!caseInventoryValid) fail('CASE_INVENTORY_INVALID');
  const evidenceContextValid =
    windowValid && candidateValid && caseInventoryValid;
  const rows = Array.isArray(matrix) ? matrix : [];
  if (
    rows.length !== scenarioIds.length ||
    new Set(rows.map((row) => row?.scenarioId)).size !== scenarioIds.length ||
    rows.some((row) => !scenarioIds.includes(row?.scenarioId))
  )
    fail('SCENARIO_MATRIX_INVALID');
  const coverage = {};
  for (const surface of ['http', 'e2e']) {
    let reportValid = evidenceContextValid;
    const rejectReport = (code) => {
      reportValid = false;
      fail(code);
    };
    const value = reports?.[surface];
    if (!value || typeof value !== 'object') {
      rejectReport(`REPORT_MISSING_${surface.toUpperCase()}`);
      continue;
    }
    if (
      value.schemaVersion !== 1 ||
      value.increment !== 'IMP-06.07' ||
      value.suite !== 'governance-phase' ||
      value.evidenceSurface !== surface ||
      value.environment !== 'LAB TEST'
    )
      rejectReport(`REPORT_IDENTITY_${surface.toUpperCase()}`);
    if (value.status !== 'passed')
      rejectReport(`REPORT_FAILED_${surface.toUpperCase()}`);
    if (
      value.sourceDigestBefore !== candidate?.sourceDigest ||
      value.sourceDigestAfter !== candidate?.sourceDigest
    )
      rejectReport(`REPORT_CANDIDATE_${surface.toUpperCase()}`);
    const started = instant(value.startedAt),
      finished = instant(value.finishedAt);
    if (
      !Number.isFinite(started) ||
      !Number.isFinite(finished) ||
      started < since ||
      finished < started ||
      finished > end
    )
      rejectReport(`REPORT_STALE_${surface.toUpperCase()}`);
    const cases = Array.isArray(value.cases) ? value.cases : [];
    if (
      cases.length !== expected.length ||
      new Set(cases.map((item) => item?.id)).size !== expected.length ||
      cases.some(
        (item) => !expected.includes(item?.id) || item.status !== 'passed',
      )
    )
      rejectReport(`REPORT_CASES_${surface.toUpperCase()}`);
    if (
      value.counts?.total !== expected.length ||
      value.counts?.passed !== expected.length ||
      value.counts?.failed !== 0 ||
      value.counts?.pending !== 0 ||
      value.counts?.skipped !== 0
    )
      rejectReport(`REPORT_COUNTS_${surface.toUpperCase()}`);
    if (
      surface === 'http' &&
      (value.sql?.status !== 'passed' ||
        !Number.isSafeInteger(value.sql?.files) ||
        value.sql.files < 1 ||
        !Number.isSafeInteger(value.sql?.assertions) ||
        value.sql.assertions < 1 ||
        value.cleanup !== 'completed')
    )
      rejectReport('HTTP_REGRESSIONS_INCOMPLETE');
    if (surface === 'e2e') {
      const inventory = value.inventoryCoverage;
      if (
        inventory?.complete !== true ||
        inventory.casesComplete !== true ||
        inventory.specsComplete !== true ||
        inventory.expectedCases !== 6 ||
        inventory.expectedSpecs !== 1
      )
        rejectReport('E2E_INVENTORY_INCOMPLETE');
      const tests = Array.isArray(value.tests) ? value.tests : [];
      if (
        tests.length !== 6 ||
        new Set(tests.map((item) => item?.id)).size !== 6 ||
        tests.some(
          (item) =>
            item?.spec !== 'tests/e2e/governance-phase.cy.ts' ||
            item.state !== 'passed' ||
            !cases.some(
              (entry) => entry.id === item.id && entry.status === item.state,
            ),
        )
      )
        rejectReport('E2E_CASES_MISMATCH');
    }
    if (reportValid)
      coverage[surface] = new Map(cases.map((item) => [item.id, item.status]));
  }
  const scenarios = rows.map((row) => {
    const evidence = Array.isArray(row?.evidence) ? row.evidence : [];
    const valid =
      evidence.length === 2 &&
      new Set(evidence.map((item) => item?.suite)).size === 2 &&
      evidence.every(
        (item) =>
          ['http', 'e2e'].includes(item?.suite) &&
          expected.includes(item?.caseId) &&
          coverage[item.suite]?.get(item.caseId) === 'passed',
      );
    if (!valid) fail('SCENARIO_EVIDENCE_INCOMPLETE');
    return {
      scenarioId: scenarioIds.includes(row?.scenarioId)
        ? row.scenarioId
        : 'UNKNOWN',
      status: valid ? 'passed' : 'failed',
    };
  });
  const passed = errors.size === 0;
  return {
    schemaVersion: 1,
    increment: 'IMP-06.07',
    status: passed ? 'blocked' : 'failed',
    functionalStatus: passed ? 'passed' : 'failed',
    acceptanceStatus: 'blocked',
    exitCode: passed ? 2 : 1,
    sourceDigest: digest.test(candidate?.sourceDigest ?? '')
      ? candidate.sourceDigest
      : null,
    environment: 'LAB TEST',
    notBefore: Number.isFinite(since) ? notBefore : null,
    checkedAt: Number.isFinite(end) ? now : null,
    errors: [...errors].sort(),
    scenarios,
    requiredCasesPerSurface: 6,
    requiredScenarios: 16,
    blockers: ['IMP06_04_PENDING', 'INTEGRAL_CI_NOT_EXECUTED'],
    closure: {
      contextualConsumed: 9,
      contextualBudget: 17,
      finalCiPassed: 0,
      finalCiRequired: 1,
    },
    remoteAcceptance: 'not-tested',
    humanAcceptance: 'not-recorded',
    ciExecuted: false,
  };
}

export function parseGovernanceAcceptanceArguments(args) {
  if (
    args.length !== 2 ||
    args[0] !== '--since' ||
    !Number.isFinite(instant(args[1]))
  )
    throw new Error('ACCEPTANCE_REQUIRES_SINCE_UTC');
  return { notBefore: args[1] };
}
