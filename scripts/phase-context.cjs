// Shared, explicit inventory: one Cypress run replays the historical E2E prefix.
const numbered = (prefix, count, first = 1) =>
  Array.from(
    { length: count },
    (_, index) => `${prefix}-${String(index + first).padStart(2, '0')}`,
  );
const contextInventory = [
  ['academic', numbered('IMP02', 8)],
  ['dashboard', numbered('IMP05-DASH', 8)],
  ['exercise-bank-governance', numbered('IMP06-GOV', 5)],
  ['exercise-bank', numbered('IMP06-BANK', 8)],
  ['foundation', numbered('FND', 8)],
  ['help', numbered('IMP04', 7, 4)],
  ['identity', numbered('IMP01', 8)],
  ['materials', numbered('IMP04', 3)],
  ['practice', numbered('IMP03', 5)],
  ['progress-phase', numbered('IMP05-PHASE', 9)],
];
const contextSpecs = Object.freeze(
  contextInventory.map(([name]) => `tests/e2e/${name}.cy.ts`),
);
const contextCaseIds = Object.freeze(
  contextInventory.flatMap(([, ids]) => ids),
);
const suites = Object.freeze([
  'full',
  'materials',
  'help',
  'progress',
  'rules',
  'dashboard',
  'phase',
  'phase-context',
  'bank',
  'bank-governance',
  'student-detail',
  'signal-review',
  'audit',
  'audit-export',
  'governance-phase',
]);

function parseE2eArguments(args) {
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string'))
    throw new Error('Argumentos E2E inválidos.');
  if (new Set(args).size !== args.length)
    throw new Error('No se permiten argumentos E2E duplicados.');
  const diagnostics = args.includes('--diagnostics');
  const selectors = args.filter((arg) => arg !== '--diagnostics');
  if (selectors.length > 1) throw new Error('Selecciona una sola suite E2E.');
  const suite = selectors.length ? selectors[0].replace(/^--/, '') : 'full';
  if (
    (selectors.length && selectors[0] !== `--${suite}`) ||
    !suites.includes(suite) ||
    (selectors.length && suite === 'full')
  )
    throw new Error('Selector E2E no admitido.');
  if (diagnostics && suite !== 'phase-context')
    throw new Error('--diagnostics requiere --phase-context.');
  return { suite, diagnostics };
}

function inspectContextCoverage({ specs = [], tests = [] } = {}) {
  const actualSpecs = specs.map((spec) =>
    typeof spec === 'string' &&
    contextSpecs.includes(spec.replaceAll('\\', '/'))
      ? spec.replaceAll('\\', '/')
      : 'UNKNOWN',
  );
  const expectedBySpec = new Map(
    contextInventory.map(([name, ids]) => [`tests/e2e/${name}.cy.ts`, ids]),
  );
  const counts = new Map();
  let unexpected = 0;
  for (const test of tests) {
    const expected = expectedBySpec.get(test.spec);
    if (
      !expected?.includes(test.id) ||
      !['passed', 'failed', 'pending', 'skipped'].includes(test.state)
    ) {
      unexpected++;
      continue;
    }
    counts.set(test.id, (counts.get(test.id) ?? 0) + 1);
  }
  const specOrderValid =
    JSON.stringify(actualSpecs) === JSON.stringify(contextSpecs);
  const casesComplete =
    tests.length === contextCaseIds.length &&
    unexpected === 0 &&
    contextCaseIds.every((id) => counts.get(id) === 1);
  return {
    expectedCases: contextCaseIds.length,
    expectedSpecs: contextSpecs.length,
    actualSpecs,
    specOrderValid,
    casesComplete,
    unexpected,
    complete: specOrderValid && casesComplete,
  };
}

module.exports = {
  parseE2eArguments,
  contextSpecs,
  contextCaseIds,
  suites,
  inspectContextCoverage,
};
