export const SANDBOX_SMOKE_FIXTURE_ID = 'sync-json-success';
export const SANDBOX_SMOKE_VM_TIMEOUT_MS = 60000;

// Selection is independent of fixture ordering and never expands remote dispatch.
export function selectSandboxSmokeFixture(fixtures) {
  const matches = fixtures.filter(
    (fixture) => fixture.id === SANDBOX_SMOKE_FIXTURE_ID,
  );
  if (matches.length !== 1 || matches[0].expected !== 'SUCCESS')
    throw new Error('Unique successful Sandbox smoke fixture required');
  return matches[0];
}

// Descriptions only: none of these cases dispatches a provider operation.
export function sandboxAcceptanceMatrix() {
  return [
    {
      id: 'success',
      proposedCreationsByCurrentDisposablePolicy: 1,
      fixtures: ['sync-json-success'],
      criteria:
        'Correct JSON result, effective VM resources and verified cleanup',
    },
    {
      id: 'total-time-3s',
      proposedCreationsByCurrentDisposablePolicy: 3,
      fixtures: ['infinite-loop', 'module-infinite-loop', 'cumulative-budget'],
      criteria:
        'Supervisor terminates the entire attempt and descendants within the total 3000 ms student budget; record scheduling latency separately',
    },
    {
      id: 'total-memory-128mib',
      proposedCreationsByCurrentDisposablePolicy: 4,
      fixtures: ['javascript-heap-memory', 'arraybuffer-memory'],
      requiredProbes: ['memory', 'descendant-memory'],
      criteria:
        'Observe the 134217728 byte cgroup limit, native and descendant memory, termination evidence and cleanup; a heap flag alone is insufficient',
    },
    {
      id: 'combined-output-64kib',
      proposedCreationsByCurrentDisposablePolicy: 5,
      fixtures: [
        'output-65535',
        'output-65536',
        'output-65537',
        'combined-stdout-stderr',
        'output-utf8',
      ],
      criteria:
        'Bound combined stdout/stderr to 65536 bytes and preserve exact boundary, truncation and termination evidence',
    },
    {
      id: 'network-isolation',
      proposedCreationsByCurrentDisposablePolicy: 2,
      fixtures: ['guest-no-host-globals'],
      requiredProbes: ['network'],
      criteria:
        'Observe denied DNS, IPv6 and UDP egress in addition to effective VM deny-all policy and zero exposed ports',
    },
    {
      id: 'host-and-supervisor-isolation',
      proposedCreationsByCurrentDisposablePolicy: 8,
      fixtures: [
        'constructor-escape-denied',
        'eval-escape-denied',
        'import-denied',
        'fake-return-verdict',
        'case-state-isolation',
      ],
      requiredProbes: ['identity', 'permissions', 'processes'],
      criteria:
        'Deny host files, secrets and supervisor control; observe student UID, zero capabilities, process limits and clean state between cases',
    },
    {
      id: 'hidden-confidentiality',
      proposedCreationsByCurrentDisposablePolicy: 2,
      fixtures: ['hidden-projection', 'fake-stdout-verdict'],
      criteria:
        'Keep hidden inputs, expectations and output out of public results and logs; reject student-forged verdicts',
    },
    {
      id: 'cancellation',
      proposedCreationsByCurrentDisposablePolicy: 1,
      fixtures: ['infinite-loop'],
      criteria:
        'Cancel an in-flight attempt, terminate descendants and independently verify absence of its exact sandbox and snapshots',
    },
    {
      id: 'two-concurrent-executions',
      proposedCreationsByCurrentDisposablePolicy: 2,
      fixtures: ['sync-json-success'],
      concurrentExecutions: 2,
      criteria:
        'Two distinct executions return correct results without state, files, output or cleanup crossing execution identities',
    },
    {
      id: 'uncertain-creation-reconciliation',
      proposedCreationsByCurrentDisposablePolicy: 1,
      fixtures: [],
      criteria:
        'Persist the exact sandbox correlation before one create dispatch; after a lost response do not retry create, reconcile by exact name without resume under the HTTP budget and verify cleanup',
    },
    {
      id: 'natural-vm-timeout-60s',
      proposedCreationsByCurrentDisposablePolicy: 1,
      fixtures: [],
      requestedVmTimeoutMs: 60000,
      operationalRunnerDeadlineMs: 30000,
      studentTotalBudgetMs: 3000,
      requiresDedicatedAcceptanceHarness: true,
      requiresSeparateVmFrom: ['cancellation'],
      criteria:
        'A separately authorized dedicated creation observes the provider natural 60000 ms VM timeout without stop or cancellation before expiry, then verifies absence of its VM and snapshots. This needs a future harness beyond the current 30000 ms operational runner deadline; the 3000 ms student budget remains separate. Cancellation of this same VM cannot prove its natural timeout',
    },
  ].map((scenario) => ({
    ...scenario,
    status: 'NOT_RUN',
    observed: null,
  }));
}

export function modelSandboxCosts({
  creations = 1,
  vmLifetimeMs = SANDBOX_SMOKE_VM_TIMEOUT_MS,
  region = 'iad1',
  clpPerUsd = 1000,
} = {}) {
  if (!Number.isSafeInteger(creations) || creations < 1)
    throw new Error('Positive integer Sandbox creation count required');
  if (!Number.isSafeInteger(vmLifetimeMs) || vmLifetimeMs < 1)
    throw new Error('Positive integer VM lifetime required');
  if (!Number.isFinite(clpPerUsd) || clpPerUsd <= 0)
    throw new Error('Positive CLP/USD assumption required');
  const basis = {
    region,
    creations,
    vmLifetimeUpperBoundMsPerCreation: vmLifetimeMs,
    vcpus: 1,
    provisionedMemoryGb: 2,
    clpPerUsd,
    tariffReference: 'https://vercel.com/docs/sandbox/pricing',
    tariffsVerifiedOn: '2026-10-04',
    observed: null,
  };
  if (region !== 'iad1')
    return {
      ...basis,
      status: 'REGIONAL_RATE_CONFIRMATION_REQUIRED',
      modeled: null,
    };
  const rates = {
    activeCpuUsdPerHour: 0.128,
    memoryUsdPerGbHour: 0.0212,
    creationUsd: 0.6 / 1000000,
  };
  // Memory rounds up in one-minute increments; CPU uses the whole VM duration
  // at 100% utilization. The authorization window is never a VM duration input.
  const memoryBillingMinutesPerCreation = Math.ceil(vmLifetimeMs / 60000);
  const cpuMaximumUsd =
    creations * (vmLifetimeMs / 3600000) * rates.activeCpuUsdPerHour;
  const memoryUsd =
    creations *
    (memoryBillingMinutesPerCreation / 60) *
    2 *
    rates.memoryUsdPerGbHour;
  const creationsUsd = creations * rates.creationUsd;
  const idleCpuFloorUsd = memoryUsd + creationsUsd;
  const computeAndCreationsMaximumUsd = cpuMaximumUsd + idleCpuFloorUsd;
  return {
    ...basis,
    status: 'MODEL_ONLY',
    rates,
    memoryBillingMinutesPerCreation,
    modeled: {
      cpuMaximumUsd,
      memoryUsd,
      creationsUsd,
      idleCpuFloorUsd,
      computeAndCreationsMaximumUsd,
      computeAndCreationsMaximumClp: computeAndCreationsMaximumUsd * clpPerUsd,
    },
    exclusions: [
      'Not a bill or a measured CPU utilization forecast',
      'Provider lifecycle overhead and billing adjustments',
      'Plan fees, taxes and actual currency conversion',
      'Container Registry image storage and preparation',
      'Network, snapshots, drives and unrelated account usage',
      'Additional creations or sessions require separate authorization',
    ],
  };
}

export function sandboxSmokeScope({
  region,
  authorizationWindowSeconds,
  maxHttpRequests,
}) {
  const laterCases = sandboxAcceptanceMatrix();
  const proposedCreations = laterCases.reduce(
    (total, scenario) =>
      total + scenario.proposedCreationsByCurrentDisposablePolicy,
    0,
  );
  return {
    kind: 'SINGLE_CREATION_CAPABILITY_SMOKE',
    fixtureId: SANDBOX_SMOKE_FIXTURE_ID,
    maxCreateDispatches: 1,
    maxHttpRequests,
    authorizationWindowSeconds,
    vmTimeoutUpperBoundMs: SANDBOX_SMOKE_VM_TIMEOUT_MS,
    snapshotsPlanned: 0,
    acceptance: 'NOT_ACCEPTED',
    laterAcceptance: {
      status: 'NOT_RUN',
      dispatchEnabled: false,
      caseGroups: laterCases.length,
      proposedCreationsByCurrentDisposablePolicy: proposedCreations,
      costs: modelSandboxCosts({ region, creations: proposedCreations }),
      cases: laterCases,
    },
    costs: modelSandboxCosts({ region }),
  };
}
