/* eslint @typescript-eslint/no-require-imports: "off" */
const { phaseCaseIds } = require('./governance-phase.cjs');
const { contextSpecs, contextCaseIds } = require('./phase-context.cjs');
const numbered = (prefix, count, first = 1) =>
  Object.freeze(
    Array.from(
      { length: count },
      (_, i) => `${prefix}-${String(i + first).padStart(2, '0')}`,
    ),
  );
// This is the current inventory. The historical context remains in its own module.
const inventory = Object.freeze(
  [
    ['foundation', numbered('FND', 8)],
    ['identity', numbered('IMP01', 8)],
    ['academic', numbered('IMP02', 8)],
    ['practice', numbered('IMP03', 5)],
    ['submissions', numbered('IMP03', 6, 6)],
    ['materials', numbered('IMP04', 3)],
    ['help', numbered('IMP04', 7, 4)],
    ['progress', numbered('IMP05', 4)],
    ['signal-rules', numbered('IMP05-RULES', 9)],
    ['dashboard', numbered('IMP05-DASH', 8)],
    ['progress-phase', numbered('IMP05-PHASE', 9)],
    ['exercise-bank', numbered('IMP06-BANK', 8)],
    ['exercise-bank-governance', numbered('IMP06-GOV', 5)],
    ['student-detail', numbered('IMP06-DETAIL', 7)],
    ['signal-review', numbered('IMP06-REVIEW', 8)],
    ['audit', numbered('IMP06-AUDIT', 8)],
    ['audit-export', numbered('IMP06-AUDIT-EXPORT', 8)],
    ['governance-phase', phaseCaseIds],
  ].map(([name, cases]) =>
    Object.freeze({ name, spec: `tests/e2e/${name}.cy.ts`, cases }),
  ),
);
const fullCaseIds = Object.freeze(inventory.flatMap(({ cases }) => cases));
const fullSpecs = Object.freeze(inventory.map(({ spec }) => spec));
const aliases = Object.freeze({
  rules: 'signal-rules',
  phase: 'progress-phase',
  bank: 'exercise-bank',
  'bank-governance': 'exercise-bank-governance',
});

function casesForSuite(suite) {
  if (suite === 'full') return fullCaseIds;
  if (suite === 'phase-context') return contextCaseIds;
  const entry = inventory.find(
    ({ name }) => name === (aliases[suite] ?? suite),
  );
  if (!entry) throw new Error('Unknown E2E inventory.');
  return entry.cases;
}
function specsForSuite(suite) {
  if (suite === 'full') return fullSpecs;
  if (suite === 'phase-context') return contextSpecs;
  const entry = inventory.find(
    ({ name }) => name === (aliases[suite] ?? suite),
  );
  if (!entry) throw new Error('Unknown E2E inventory.');
  return [entry.spec];
}
function inspectSuiteCoverage(suite, { specs = [], tests = [] } = {}) {
  const expectedSpecs = specsForSuite(suite);
  const expectedCases = casesForSuite(suite);
  const bySpec = new Map(inventory.map(({ spec, cases }) => [spec, cases]));
  const actualSpecs = specs.map((spec) =>
    typeof spec === 'string' ? spec.replaceAll('\\', '/') : 'UNKNOWN',
  );
  const seen = new Set();
  const casesComplete =
    tests.length === expectedCases.length &&
    tests.every((test) => {
      const valid =
        expectedCases.includes(test.id) &&
        !seen.has(test.id) &&
        ['passed', 'failed', 'pending', 'skipped'].includes(test.state) &&
        bySpec.get(test.spec)?.includes(test.id);
      seen.add(test.id);
      return valid;
    });
  const specsComplete =
    actualSpecs.length === expectedSpecs.length &&
    new Set(actualSpecs).size === expectedSpecs.length &&
    actualSpecs.every((spec) => expectedSpecs.includes(spec));
  return {
    expectedCases: expectedCases.length,
    expectedSpecs: expectedSpecs.length,
    casesComplete,
    specsComplete,
    complete: casesComplete && specsComplete,
  };
}

module.exports = {
  inventory,
  fullCaseIds,
  fullSpecs,
  casesForSuite,
  specsForSuite,
  inspectSuiteCoverage,
};
