import { readdir, readFile } from 'node:fs/promises';
import inventory from '../../scripts/e2e-inventory.cjs';
import context from '../../scripts/phase-context.cjs';
import phase from '../../scripts/governance-phase.cjs';

function fullRun() {
  return {
    specs: inventory.fullSpecs,
    tests: inventory.inventory.flatMap(({ spec, cases }) =>
      cases.map((id) => ({ id, spec, state: 'passed' })),
    ),
  };
}
test('the current inventory covers every authored spec and preserves the frozen context', async () => {
  const files = (await readdir('tests/e2e'))
    .filter((file) => file.endsWith('.cy.ts'))
    .map((file) => `tests/e2e/${file}`)
    .sort();
  expect([...inventory.fullSpecs].sort()).toEqual(files);
  expect(inventory.fullSpecs).toHaveLength(18);
  expect(inventory.fullCaseIds).toHaveLength(125);
  expect(new Set(inventory.fullCaseIds).size).toBe(125);
  expect(inventory.casesForSuite('phase-context')).toEqual(
    context.contextCaseIds,
  );
  expect(inventory.specsForSuite('phase-context')).toEqual(
    context.contextSpecs,
  );
  expect(context.contextCaseIds).toHaveLength(69);
  expect(context.contextSpecs).toHaveLength(10);
  expect(context.parseE2eArguments(['--governance-phase'])).toEqual({
    suite: 'governance-phase',
    diagnostics: false,
  });
  expect(() =>
    context.parseE2eArguments(['--governance-phase', '--diagnostics']),
  ).toThrow();
});
test('equal totals cannot conceal duplicated, omitted, moved or unknown cases/specs', () => {
  expect(inventory.inspectSuiteCoverage('full', fullRun()).complete).toBe(true);
  for (const change of [
    (run) => {
      run.tests[1] = { ...run.tests[0] };
    },
    (run) => {
      run.tests[0].spec = run.specs[1];
    },
    (run) => {
      run.tests[0].id = 'UNKNOWN';
    },
    (run) => {
      run.specs = [...run.specs.slice(1), run.specs[1]];
    },
    (run) => {
      run.tests.pop();
    },
  ]) {
    const run = fullRun();
    change(run);
    expect(inventory.inspectSuiteCoverage('full', run).complete).toBe(false);
  }
  const failure = fullRun();
  failure.tests[0].state = 'failed';
  expect(inventory.inspectSuiteCoverage('full', failure).complete).toBe(true);
});
test('six phase cases account for all sixteen source scenarios with HTTP and browser evidence', () => {
  expect(inventory.casesForSuite('governance-phase')).toEqual(
    phase.phaseCaseIds,
  );
  expect(inventory.specsForSuite('governance-phase')).toEqual([
    'tests/e2e/governance-phase.cy.ts',
  ]);
  expect(
    phase.acceptanceMatrix.map(({ scenarioId }) => scenarioId).sort(),
  ).toEqual(
    ['017', '019', '024', '027']
      .flatMap((r) => [1, 2, 3, 4].map((e) => `ALZ-HU-${r}-E${e}`))
      .sort(),
  );
  for (const row of phase.acceptanceMatrix) {
    expect(row.evidence.map(({ suite }) => suite)).toEqual(['http', 'e2e']);
    for (const { caseId } of row.evidence)
      expect(phase.phaseCaseIds).toContain(caseId);
  }
});
test('CI retains its seventeen stages and only explicitly named IMP-06 public reports', async () => {
  const ci = await readFile('scripts/ci-verify.mjs', 'utf8');
  const commands = ci.slice(
    ci.indexOf('for (const args of ['),
    ci.indexOf('  ]) {'),
  );
  expect(commands.match(/\['(?:run|test)'/g)).toHaveLength(17);
  expect(commands.match(/'--submit'/g)).toHaveLength(3);
  const workflow = await readFile('.github/workflows/foundation.yml', 'utf8');
  const paths = [
    ...workflow.matchAll(/^\s+(\.local\/reports\/imp-06\/[^\s]+)$/gm),
  ].map((match) => match[1]);
  expect(paths).toEqual(
    [
      'ci',
      'e2e',
      'e2e-governance-phase',
      'governance-phase-integration',
      'governance-phase-acceptance',
    ].map((name) => `.local/reports/imp-06/${name}.json`),
  );
});
