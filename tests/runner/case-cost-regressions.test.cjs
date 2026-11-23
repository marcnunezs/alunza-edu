const {
  selectFixtures,
  assessFixture,
  observedNodeWorker,
} = require('./case-cost-regressions.cjs');
let fixtures;
beforeAll(async () => {
  fixtures = (await import('./fixtures.mjs')).runnerFixtures;
});

function success(fixture) {
  const hidden = fixture.tests.filter(
    (item) => item.visibility === 'hidden',
  ).length;
  const visible = fixture.tests.length - hidden;
  const row = { passed: true, stdout: '', stderr: '' };
  return {
    diagnosisCode: 'SUCCESS',
    terminationReason: 'COMPLETED',
    infrastructureStatus: 'OK',
    allRequiredPassed: true,
    runtimeMs: 500,
    outputBytes: 0,
    visibleTestResults: Array.from({ length: visible }, () => ({ ...row })),
    privateTestResults: Array.from({ length: hidden }, () => ({ ...row })),
    evidence: {
      cleanupVerified: true,
      cgroups: fixture.tests.map(() => ({
        'memory.max': '134217728',
        'memory.swap.max': '0',
        'pids.max': '32',
        'cpu.max': '100000 100000',
      })),
    },
  };
}
const publicView = (result) => ({
  visibleTestResults: result.visibleTestResults,
  hiddenChecksPassed: result.privateTestResults.length > 0,
});

function workerObservation() {
  return {
    status:
      'State:\tS (sleeping)\nPPid:\t123\nUid:\t10001\t10001\t10001\t10001\nNoNewPrivs:\t1\n' +
      ['Inh', 'Prm', 'Eff', 'Bnd', 'Amb']
        .map((name) => `Cap${name}:\t0000000000000000`)
        .join('\n'),
    executable: '/usr/local/bin/node',
    argv: [
      '/usr/local/bin/node',
      '--single-threaded',
      '/opt/alunza/worker.cjs',
    ],
    parentPid: 123,
    nodeIdentity: { dev: 7n, ino: 90n },
    pinnedNode: { path: '/usr/local/bin/node', dev: 7n, ino: 90n },
  };
}

test('cancellation recognizes only the pinned Node worker process, without claiming guest instruction execution', () => {
  expect(observedNodeWorker(workerObservation())).toBe(true);
});

test.each([
  'setpriv',
  'zombie',
  'no-new-privs-disabled',
  'different-parent',
  'different-node-inode',
  'wrong-script',
  'eval-option',
])(
  'cancellation refuses %s even with UID10001 and zero capabilities',
  (change) => {
    const value = workerObservation();
    if (change === 'setpriv') value.executable = '/usr/bin/setpriv';
    if (change === 'zombie')
      value.status = value.status.replace('S (sleeping)', 'Z (zombie)');
    if (change === 'no-new-privs-disabled')
      value.status = value.status.replace('NoNewPrivs:\t1', 'NoNewPrivs:\t0');
    if (change === 'different-parent') value.parentPid = 456;
    if (change === 'different-node-inode') value.nodeIdentity.ino = 91n;
    if (change === 'wrong-script') value.argv[2] = '/opt/alunza/os-probe.cjs';
    if (change === 'eval-option')
      value.argv.splice(1, 0, '--eval=process.exit()');
    expect(observedNodeWorker(value)).toBe(false);
  },
);

test('selection requires the actual shared fixtures and keeps cancellation and fixed finite CPU separate', () => {
  const picked = selectFixtures(fixtures);
  expect(picked).toHaveLength(20);
  expect(new Set(picked.map((item) => item.id)).size).toBe(20);
  expect(picked.find((item) => item.id === 'case-state-isolation')).toBe(
    fixtures.find((item) => item.id === 'case-state-isolation'),
  );
  expect(picked.at(-1)).toMatchObject({
    cancel: true,
    expected: 'UNKNOWN',
    reason: 'CANCELLED',
  });
  expect(picked.at(-2).tests[0].expected).toBe(840003);
  expect(() =>
    selectFixtures(fixtures.filter((item) => item.id !== 'hidden-projection')),
  ).toThrow();
  expect(() =>
    selectFixtures([
      ...fixtures,
      fixtures.find((item) => item.id === 'json-arguments'),
    ]),
  ).toThrow();
});

test('a hidden success is rejected if private content or private evidence reaches the projection', () => {
  const fixture = fixtures.find((item) => item.id === 'hidden-projection');
  const result = success(fixture),
    view = publicView(result);
  expect(assessFixture(fixture, result, view).pass).toBe(true);
  expect(
    assessFixture(fixture, result, {
      ...view,
      message: fixture.privateSentinel,
    }).pass,
  ).toBe(false);
  expect(assessFixture(fixture, result, { ...view, evidence: {} }).pass).toBe(
    false,
  );
});

test.each([
  'missing-second-case',
  'wrong-memory',
  'time-exhausted',
  'output-exceeded',
  'cleanup-unproven',
  'wrong-reason',
])('a successful label cannot hide %s', (change) => {
  const fixture = fixtures.find((item) => item.id === 'case-state-isolation');
  const result = success(fixture);
  if (change === 'missing-second-case') result.evidence.cgroups.pop();
  if (change === 'wrong-memory')
    result.evidence.cgroups[0]['memory.max'] = 'max';
  if (change === 'time-exhausted') result.runtimeMs = 3000;
  if (change === 'output-exceeded') result.outputBytes = 65537;
  if (change === 'cleanup-unproven') result.evidence.cleanupVerified = false;
  if (change === 'wrong-reason') result.terminationReason = 'RUNNER_FAILURE';
  expect(assessFixture(fixture, result, publicView(result)).pass).toBe(false);
});
