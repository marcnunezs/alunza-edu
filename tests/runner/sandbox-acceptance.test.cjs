let acceptance;
let fixtures;
beforeAll(async () => {
  acceptance = await import('./sandbox-acceptance.mjs');
  ({ runnerFixtures: fixtures } = await import('./fixtures.mjs'));
});

test('Remote smoke selects the positive JSON fixture even after adversarial fixtures are reordered', () => {
  expect(fixtures[0].id).not.toBe('sync-json-success');
  for (const order of [fixtures, [...fixtures].reverse()]) {
    const fixture = acceptance.selectSandboxSmokeFixture(order);
    expect(fixture.id).toBe('sync-json-success');
    expect(fixture.expected).toBe('SUCCESS');
    expect(fixture.tests).toEqual([
      {
        id: 'visible-1',
        visibility: 'visible',
        args: [2, 3],
        expected: { sum: 5 },
      },
    ]);
  }
});

test('Missing, duplicate or non-success smoke fixtures fail closed before dispatch', () => {
  const good = acceptance.selectSandboxSmokeFixture(fixtures);
  for (const invalid of [
    [],
    fixtures.filter((fixture) => fixture.id !== 'sync-json-success'),
    [good, good],
    [{ ...good, expected: 'RUNTIME_ERROR' }],
  ])
    expect(() => acceptance.selectSandboxSmokeFixture(invalid)).toThrow();
});

test('Planning leaves every later acceptance capability unobserved and cannot dispatch', () => {
  const scope = acceptance.sandboxSmokeScope({
    region: 'iad1',
    authorizationWindowSeconds: 1800,
    maxHttpRequests: 20,
  });
  expect(scope).toMatchObject({
    kind: 'SINGLE_CREATION_CAPABILITY_SMOKE',
    fixtureId: 'sync-json-success',
    maxCreateDispatches: 1,
    maxHttpRequests: 20,
    authorizationWindowSeconds: 1800,
    vmTimeoutUpperBoundMs: 60000,
    snapshotsPlanned: 0,
    acceptance: 'NOT_ACCEPTED',
    laterAcceptance: { status: 'NOT_RUN', dispatchEnabled: false },
  });
  expect(scope.laterAcceptance.cases.map((item) => item.id)).toEqual([
    'success',
    'total-time-3s',
    'total-memory-128mib',
    'combined-output-64kib',
    'network-isolation',
    'host-and-supervisor-isolation',
    'hidden-confidentiality',
    'cancellation',
    'two-concurrent-executions',
    'uncertain-creation-reconciliation',
    'natural-vm-timeout-60s',
  ]);
  for (const item of scope.laterAcceptance.cases) {
    expect(item.status).toBe('NOT_RUN');
    expect(item.observed).toBeNull();
  }
  expect(
    scope.laterAcceptance.cases.find(
      (item) => item.id === 'two-concurrent-executions',
    ).concurrentExecutions,
  ).toBe(2);
  // Editing a returned report must not manufacture evidence in a later report.
  scope.laterAcceptance.cases[0].status = 'PASS';
  expect(acceptance.sandboxAcceptanceMatrix()[0].status).toBe('NOT_RUN');
});

test('Every declared fixture exists while kernel and lifecycle cases remain separate requirements', () => {
  for (const item of acceptance.sandboxAcceptanceMatrix())
    for (const id of item.fixtures)
      expect(fixtures.some((fixture) => fixture.id === id)).toBe(true);
});

test('Eleven future capability groups propose thirty disposable creations, separately from the one-creation smoke', () => {
  const matrix = acceptance.sandboxAcceptanceMatrix();
  expect(matrix).toHaveLength(11);
  expect(
    matrix.map((item) => item.proposedCreationsByCurrentDisposablePolicy),
  ).toEqual([1, 3, 4, 5, 2, 8, 2, 1, 2, 1, 1]);
  expect(
    matrix.reduce(
      (total, item) => total + item.proposedCreationsByCurrentDisposablePolicy,
      0,
    ),
  ).toBe(30);
  const scope = acceptance.sandboxSmokeScope({
    region: 'iad1',
    authorizationWindowSeconds: 1800,
    maxHttpRequests: 20,
  });
  expect(scope.maxCreateDispatches).toBe(1);
  expect(scope.costs.creations).toBe(1);
  expect(scope.laterAcceptance).toMatchObject({
    status: 'NOT_RUN',
    dispatchEnabled: false,
    caseGroups: 11,
    proposedCreationsByCurrentDisposablePolicy: 30,
    costs: { creations: 30, observed: null },
  });
  // Independent arithmetic: thirty fully active one-minute VMs, two GB each,
  // and thirty creations at the list rate, rather than eleven group charges.
  const thirtyCreationCost =
    (30 * 60 * 0.128) / 3600 + (30 * 2 * 0.0212) / 60 + (30 * 0.6) / 1000000;
  expect(thirtyCreationCost).toBeCloseTo(0.085218, 12);
  expect(
    scope.laterAcceptance.costs.modeled.computeAndCreationsMaximumUsd,
  ).toBeCloseTo(thirtyCreationCost, 12);
});

test('Natural VM timeout needs a dedicated future creation separate from cancellation and other deadlines', () => {
  const scenario = acceptance
    .sandboxAcceptanceMatrix()
    .find((item) => item.id === 'natural-vm-timeout-60s');
  expect(scenario).toMatchObject({
    proposedCreationsByCurrentDisposablePolicy: 1,
    requestedVmTimeoutMs: 60000,
    operationalRunnerDeadlineMs: 30000,
    studentTotalBudgetMs: 3000,
    requiresDedicatedAcceptanceHarness: true,
    requiresSeparateVmFrom: ['cancellation'],
    status: 'NOT_RUN',
    observed: null,
  });
});

test('One-minute full CPU model matches list-price arithmetic and scales by creation count', () => {
  const one = acceptance.modelSandboxCosts();
  expect(one).toMatchObject({
    status: 'MODEL_ONLY',
    region: 'iad1',
    creations: 1,
    vmLifetimeUpperBoundMsPerCreation: 60000,
    vcpus: 1,
    provisionedMemoryGb: 2,
    memoryBillingMinutesPerCreation: 1,
    observed: null,
  });
  expect(one.modeled.computeAndCreationsMaximumUsd).toBeCloseTo(0.0028406, 12);
  expect(one.modeled.computeAndCreationsMaximumClp).toBeCloseTo(2.8406, 10);
  expect(one.modeled.idleCpuFloorUsd).toBeCloseTo(0.000707266666667, 12);
  expect(
    acceptance.modelSandboxCosts({ creations: 3 }).modeled
      .computeAndCreationsMaximumUsd,
  ).toBeCloseTo(0.0085218, 12);
});

test('Global authorization time cannot become VM life or an observed cost', () => {
  const short = acceptance.sandboxSmokeScope({
    region: 'iad1',
    authorizationWindowSeconds: 30,
    maxHttpRequests: 20,
  });
  const long = acceptance.sandboxSmokeScope({
    region: 'iad1',
    authorizationWindowSeconds: 1800,
    maxHttpRequests: 20,
  });
  expect(long.costs.modeled).toEqual(short.costs.modeled);
  expect(long.costs.vmLifetimeUpperBoundMsPerCreation).toBe(60000);
  expect(long.costs.observed).toBeNull();
  expect(long.costs.exclusions).toContain(
    'Provider lifecycle overhead and billing adjustments',
  );
});

test('Short VM lifetime retains minimum memory billing while partial minutes round conservatively', () => {
  const short = acceptance.modelSandboxCosts({ vmLifetimeMs: 1 });
  expect(short.memoryBillingMinutesPerCreation).toBe(1);
  expect(short.modeled.memoryUsd).toBeCloseTo(0.000706666666667, 12);
  const extended = acceptance.modelSandboxCosts({ vmLifetimeMs: 60001 });
  expect(extended.memoryBillingMinutesPerCreation).toBe(2);
  expect(extended.modeled.memoryUsd).toBeCloseTo(0.001413333333333, 12);
});

test('A different region cannot inherit iad1 prices silently', () => {
  expect(acceptance.modelSandboxCosts({ region: 'gru1' })).toMatchObject({
    region: 'gru1',
    status: 'REGIONAL_RATE_CONFIRMATION_REQUIRED',
    modeled: null,
    observed: null,
  });
});

test.each([
  { creations: 0 },
  { creations: -1 },
  { creations: 1.5 },
  { creations: Infinity },
  { vmLifetimeMs: 0 },
  { vmLifetimeMs: NaN },
  { clpPerUsd: 0 },
  { clpPerUsd: Infinity },
])('Invalid planning assumptions fail explicitly: %p', (input) => {
  expect(() => acceptance.modelSandboxCosts(input)).toThrow();
});
