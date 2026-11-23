import catalog from '../../scripts/phase-context.cjs';

const {
  parseE2eArguments,
  contextSpecs,
  contextCaseIds,
  inspectContextCoverage,
} = catalog;
const counts = [8, 8, 5, 8, 8, 7, 8, 3, 5, 9];
function context() {
  let next = 0;
  return {
    specs: [...contextSpecs],
    tests: counts.flatMap((count, index) =>
      contextCaseIds
        .slice(next, (next += count))
        .map((id) => ({ id, spec: contextSpecs[index], state: 'passed' })),
    ),
  };
}
test('explicit context parser preserves ordinary selectors and rejects diagnostic ambiguity', () => {
  expect(parseE2eArguments([])).toEqual({ suite: 'full', diagnostics: false });
  expect(parseE2eArguments(['--audit'])).toEqual({
    suite: 'audit',
    diagnostics: false,
  });
  expect(parseE2eArguments(['--signal-review'])).toEqual({
    suite: 'signal-review',
    diagnostics: false,
  });
  expect(parseE2eArguments(['--diagnostics', '--phase-context'])).toEqual({
    suite: 'phase-context',
    diagnostics: true,
  });
  for (const args of [
    ['--diagnostics'],
    ['--phase', '--diagnostics'],
    ['--audit', '--diagnostics'],
    ['--phase-context', '--phase'],
    ['--phase-context', '--phase-context'],
    ['--full'],
    ['phase-context'],
    ['--spec', 'secret'],
  ])
    expect(() => parseE2eArguments(args)).toThrow();
});
test('historical prefix is exactly 69 distinct cases in ten ordered specs', () => {
  expect(contextSpecs).toHaveLength(10);
  expect(contextSpecs[0]).toBe('tests/e2e/academic.cy.ts');
  expect(contextSpecs.at(-1)).toBe('tests/e2e/progress-phase.cy.ts');
  expect(contextCaseIds).toHaveLength(69);
  expect(new Set(contextCaseIds).size).toBe(69);
  expect(inspectContextCoverage(context())).toMatchObject({
    complete: true,
    expectedCases: 69,
    expectedSpecs: 10,
  });
});
test('all attempts remain observable even when the expected latency case fails', () => {
  const result = context();
  result.tests.find((test) => test.id === 'IMP05-PHASE-07').state = 'failed';
  expect(inspectContextCoverage(result).complete).toBe(true);
  result.tests.pop();
  expect(inspectContextCoverage(result).casesComplete).toBe(false);
});
test('same totals cannot hide changed spec order, duplicate cases or a case moved to another spec', () => {
  const reordered = context();
  [reordered.specs[0], reordered.specs[1]] = [
    reordered.specs[1],
    reordered.specs[0],
  ];
  expect(inspectContextCoverage(reordered).complete).toBe(false);
  const duplicate = context();
  duplicate.tests[1] = duplicate.tests[0];
  expect(inspectContextCoverage(duplicate).complete).toBe(false);
  const moved = context();
  moved.tests[0].spec = contextSpecs[1];
  expect(inspectContextCoverage(moved)).toMatchObject({
    complete: false,
    unexpected: 1,
  });
});
