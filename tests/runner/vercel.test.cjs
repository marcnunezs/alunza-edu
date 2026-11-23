const { randomUUID } = require('node:crypto');
const { Readable } = require('node:stream');
let VercelAdapter, SandboxRequestBudget, execute, recoverVercelSandbox;
let state, sandbox, createParams, order, originalFetch;
const sdk = { create: jest.fn(), get: jest.fn() };
const snapshots = { list: jest.fn() };
const image = 'alunza-runner@sha256:' + 'a'.repeat(64);
const apiError = (status) =>
  Object.assign(new Error('Provider failure'), {
    response: { status },
  });
const capsuleInput = () => ({
  executionId: randomUUID(),
  code: 'module.exports.solve=()=>true;',
  args: [],
  budgetMs: 3000,
  outputRemaining: 65536,
});
function capsule() {
  return {
    packet: {
      status: 'exited',
      runtimeMs: 100,
      outputBytes: 0,
      stdout: '',
      stderr: '',
      returnData: Buffer.from(
        JSON.stringify({
          kind: 'value',
          value: true,
          invocation: 'QUICKJS_SYNC_CALL',
        }),
      ).toString('base64'),
      outputTruncated: false,
      exitCode: 0,
      signal: null,
      cgroup: {
        'memory.max': '134217728',
        'memory.swap.max': '0',
        'pids.max': '32',
        'cpu.max': '100000 100000',
      },
    },
    exitCode: 0,
    oomKilled: false,
    timedOut: false,
    cancelled: false,
    cleanupVerified: true,
    programWallMs: 100,
    containerWallMs: 100,
    lifecycleMs: 200,
    image: 'sha256:' + 'a'.repeat(64),
  };
}
function makeSandbox(params) {
  const instance = {
    name: params.name,
    tags: params.tags,
    image: params.image,
    region: params.region,
    vcpus: 1,
    memory: 2048,
    persistent: false,
    timeout: params.timeout,
    networkPolicy: 'deny-all',
    currentSnapshotId: undefined,
    sourceSnapshotId: undefined,
    totalDurationMs: state.noMetrics ? undefined : 2400,
    ...state.overrides,
    writeFiles: jest.fn(async () => {}),
    readFile: jest.fn(async () => {
      state.resultStream = Readable.from(
        state.resultChunks ?? [JSON.stringify(state.capsule ?? capsule())],
      );
      return state.resultMissing ? null : state.resultStream;
    }),
    runCommand: jest.fn(async (command) => {
      if (state.commandError) throw state.commandError;
      return {
        exitCode: 0,
        stdout: async () =>
          command.args[0].endsWith('remote-init.mjs')
            ? JSON.stringify({
                ready: true,
                node: 'v24.21.0',
                image: 'sha256:' + 'a'.repeat(64),
              })
            : '',
        stderr: async () => '',
      };
    }),
    stop: jest.fn(async (opts) => {
      await params.fetch(
        'https://api.vercel.com/v2/sandboxes/sessions/mock/stop',
        {
          method: 'POST',
          signal: opts.signal,
        },
      );
      if (state.stopError) throw state.stopError;
      return state.noMetrics
        ? {}
        : {
            activeCpuDurationMs: 200,
            startedAt: 1000,
            stoppedAt: 3400,
            networkTransfer: { ingress: 20, egress: 0 },
          };
    }),
    delete: jest.fn(async (opts) => {
      await params.fetch('https://api.vercel.com/v2/sandboxes/' + params.name, {
        method: 'DELETE',
        signal: opts.signal,
      });
      if (state.deleteError) throw state.deleteError;
      if (!state.remains) state.deleted = true;
    }),
  };
  instance.currentSession = () => ({
    ...instance,
    sessionId: state.sessionId ?? 'mock',
    ...state.sessionDetails,
  });
  return instance;
}
const options = (overrides = {}) => ({
  authorized: true,
  expiresAtMs: Date.now() + 120000,
  token: 'mock-private-token',
  teamId: 'team_mock',
  projectId: 'prj_mock',
  image,
  region: 'iad1',
  allowRequest: jest.fn(),
  recordCorrelation: jest.fn(async (correlation) => {
    order.push('journal');
    state.correlation = correlation;
  }),
  ...overrides,
});
beforeAll(async () => {
  originalFetch = globalThis.fetch;
  jest.unstable_mockModule('@vercel/sandbox', () => ({
    Sandbox: sdk,
    Snapshot: snapshots,
  }));
  ({ VercelAdapter, SandboxRequestBudget, recoverVercelSandbox } =
    await import('../../packages/runner/dist/vercel.js'));
  ({ execute } = await import('../../packages/runner/dist/index.js'));
});
afterAll(() => {
  globalThis.fetch = originalFetch;
});
beforeEach(() => {
  state = { deleted: false, overrides: {} };
  sandbox = undefined;
  order = [];
  jest.clearAllMocks();
  globalThis.fetch = jest.fn(async (url, init) => {
    order.push(
      init?.method === 'POST' && new URL(url).pathname === '/v3/sandboxes'
        ? 'create-post'
        : 'read-or-cleanup',
    );
    return new Response(null, { status: 204 });
  });
  sdk.create.mockImplementation(async (params) => {
    createParams = params;
    await params.fetch('https://api.vercel.com/v3/sandboxes', {
      method: 'POST',
    });
    sandbox = makeSandbox(params);
    if (state.retryCreate) {
      await params.fetch('https://api.vercel.com/v3/sandboxes', {
        method: 'POST',
      });
    }
    if (state.lostResponse) throw new Error('Lost creation response');
    return sandbox;
  });
  sdk.get.mockImplementation(async (params) => {
    await params.fetch(
      'https://api.vercel.com/v2/sandboxes/' + params.name + '?resume=false',
    );
    if (state.readError) throw state.readError;
    if (!sandbox || state.deleted || state.notFound) throw apiError(404);
    return sandbox;
  });
  snapshots.list.mockImplementation(async (params) => {
    await params.fetch(
      'https://api.vercel.com/v2/sandboxes/snapshots?name=' + params.name,
    );
    if (state.snapshotError) throw state.snapshotError;
    return (
      state.snapshotPage ?? {
        snapshots: [],
        pagination: { count: 0, next: null },
      }
    );
  });
});

test.each([NaN, Infinity, -Infinity, 0])(
  'invalid expiration %s cannot dispatch a provider request',
  (expiresAtMs) => {
    expect(() => new VercelAdapter(options({ expiresAtMs }))).toThrow(
      'Authorized Sandbox configuration required',
    );
    expect(sdk.create).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  },
);

test('success persists correlation before the only create and records provider metrics and absence', async () => {
  const config = options();
  const adapter = new VercelAdapter(config);
  await adapter.execute(capsuleInput());
  expect(order.slice(0, 2)).toEqual(['journal', 'create-post']);
  expect(state.correlation).toMatchObject({
    sandboxName: createParams.name,
    maxCreateDispatches: 1,
  });
  expect(JSON.stringify(state.correlation)).not.toContain(config.token);
  expect(createParams).toMatchObject({
    resources: { vcpus: 1 },
    persistent: false,
    networkPolicy: 'deny-all',
    ports: [],
    env: {},
  });
  expect(createParams.timeout).toBeLessThanOrEqual(60000);
  expect(adapter.evidence.activeCpuMs).toBeNull();
  await adapter.close();
  expect(adapter.evidence).toMatchObject({
    creationStatus: 'CONFIRMED',
    createDispatches: 1,
    region: 'iad1',
    vcpus: 1,
    memoryMb: 2048,
    image,
    activeCpuMs: 200,
    provisionedDurationMs: 2400,
    durationSource: 'PROVIDER_TOTAL_DURATION_MS',
    networkIngressBytes: 20,
    networkEgressBytes: 0,
    snapshotsRemaining: 0,
    cleanupVerified: true,
    cleanupCheck: 'ABSENT_AND_ZERO_SNAPSHOTS',
  });
  expect(sdk.get.mock.calls[0][0]).toMatchObject({
    name: createParams.name,
    resume: false,
    teamId: config.teamId,
    projectId: config.projectId,
  });
  expect(snapshots.list.mock.calls[0][0]).toMatchObject({
    name: createParams.name,
    limit: 1,
  });
  const requests = globalThis.fetch.mock.calls.length;
  await adapter.close();
  expect(globalThis.fetch).toHaveBeenCalledTimes(requests);
});

test('missing provider metrics stay null and timestamp duration has an explicit source', async () => {
  state.noMetrics = true;
  const adapter = new VercelAdapter(options());
  await adapter.execute(capsuleInput());
  await adapter.close();
  expect(adapter.evidence).toMatchObject({
    activeCpuMs: null,
    provisionedDurationMs: null,
    networkIngressBytes: null,
  });
  state.noMetrics = false;
  state.overrides = { totalDurationMs: undefined };
  const second = new VercelAdapter(options());
  state.deleted = false;
  await second.execute(capsuleInput());
  await second.close();
  expect(second.evidence).toMatchObject({
    provisionedDurationMs: 2400,
    durationSource: 'PROVIDER_STOPPED_MINUS_STARTED_AT',
  });
});

test.each([
  ['CPU', { vcpus: 2 }],
  ['memory', { memory: 4096 }],
  ['region', { region: 'gru1' }],
  ['image', { image: 'another@sha256:' + 'b'.repeat(64) }],
  ['persistence', { persistent: true }],
  ['network', { networkPolicy: 'allow-all' }],
  ['snapshot', { currentSnapshotId: 'snap_foreign' }],
  ['VM timeout', { timeout: 60001 }],
  ['missing VM timeout', { timeout: undefined }],
])(
  'unexpected %s refuses bootstrap and still cleans its own resource',
  async (_label, overrides) => {
    state.overrides = overrides;
    const adapter = new VercelAdapter(options());
    await expect(adapter.execute(capsuleInput())).rejects.toThrow(
      'Unexpected Sandbox',
    );
    expect(sandbox.runCommand).not.toHaveBeenCalled();
    await adapter.close();
    expect(adapter.evidence.cleanupVerified).toBe(true);
  },
);

test('lost creation response reconciles the exact owned resource without resuming or recreating', async () => {
  state.lostResponse = true;
  const adapter = new VercelAdapter(options());
  await expect(adapter.execute(capsuleInput())).rejects.toThrow(
    'Lost creation response',
  );
  await expect(adapter.execute(capsuleInput())).rejects.toThrow(
    'cannot be repeated',
  );
  await adapter.close();
  expect(sdk.create).toHaveBeenCalledTimes(1);
  expect(sdk.get).toHaveBeenCalledTimes(2);
  expect(sandbox.runCommand).not.toHaveBeenCalled();
  expect(adapter.evidence).toMatchObject({
    creationStatus: 'RECONCILED',
    cleanupVerified: true,
  });
  expect(
    sdk.get.mock.calls.every(
      ([params]) =>
        params.name === state.correlation.sandboxName &&
        params.resume === false,
    ),
  ).toBe(true);
});

test('404 after an uncertain creation cannot certify cleanup of a possible in-flight VM', async () => {
  state.lostResponse = true;
  state.notFound = true;
  const adapter = new VercelAdapter(options());
  await expect(adapter.execute(capsuleInput())).rejects.toThrow();
  await expect(adapter.close()).rejects.toThrow('remains unverified');
  expect(adapter.evidence).toMatchObject({
    cleanupVerified: false,
    cleanupCheck: 'CREATION_UNRESOLVED',
  });
  expect(sandbox.stop).not.toHaveBeenCalled();
  expect(sandbox.delete).not.toHaveBeenCalled();
});

test('reconciliation permission denial stays unresolved without broad listing or permission changes', async () => {
  state.lostResponse = true;
  state.readError = apiError(403);
  const adapter = new VercelAdapter(options());
  await expect(adapter.execute(capsuleInput())).rejects.toThrow();
  await expect(adapter.close()).rejects.toThrow();
  expect(adapter.evidence).toMatchObject({
    cleanupVerified: false,
    cleanupCheck: 'READ_ACCESS_REQUIRED',
  });
  expect(sandbox.delete).not.toHaveBeenCalled();
  expect(snapshots.list).not.toHaveBeenCalled();
});

test('reconciliation refuses cleanup when the ownership correlation differs', async () => {
  state.lostResponse = true;
  state.overrides = {
    tags: { owner: 'alunza-imp-00-06', correlation: 'another' },
  };
  const adapter = new VercelAdapter(options());
  await expect(adapter.execute(capsuleInput())).rejects.toThrow();
  await expect(adapter.close()).rejects.toThrow('scope');
  expect(adapter.evidence.cleanupCheck).toBe('CORRELATION_MISMATCH');
  expect(sandbox.stop).not.toHaveBeenCalled();
  expect(sandbox.delete).not.toHaveBeenCalled();
});

test('delete and readback can recover a failed stop while leaving unavailable metrics null', async () => {
  state.stopError = apiError(503);
  const adapter = new VercelAdapter(options());
  await adapter.execute(capsuleInput());
  await adapter.close();
  expect(sandbox.delete).toHaveBeenCalledWith(
    expect.objectContaining({ deleteOrphanSnapshots: true }),
  );
  expect(adapter.evidence).toMatchObject({
    stopOutcome: 'FAILED',
    cleanupVerified: true,
    activeCpuMs: null,
  });
});

test.each([
  ['delete failure', { deleteError: apiError(503) }, 'UNVERIFIED'],
  ['remaining sandbox', { remains: true }, 'SANDBOX_REMAINS'],
  ['read denial', { readError: apiError(403) }, 'READ_ACCESS_REQUIRED'],
  ['snapshot denial', { snapshotError: apiError(403) }, 'READ_ACCESS_REQUIRED'],
  [
    'remaining snapshots',
    {
      snapshotPage: {
        snapshots: [{ id: 'snap_mock' }],
        pagination: { count: 1, next: null },
      },
    },
    'SNAPSHOTS_UNVERIFIED_OR_REMAINING',
  ],
  [
    'incomplete empty snapshot page',
    {
      snapshotPage: {
        snapshots: [],
        pagination: { count: 0, next: 'next-page' },
      },
    },
    'SNAPSHOTS_UNVERIFIED_OR_REMAINING',
  ],
])(
  '%s cannot grant a successful runner result',
  async (_label, failure, expectedCheck) => {
    Object.assign(state, failure);
    const adapter = new VercelAdapter(options());
    const result = await execute(
      {
        executionId: randomUUID(),
        requestId: 'mock-unit',
        exerciseVersionId: 'synthetic',
        testsVersion: 'v1',
        mode: 'RUN',
        entrypoint: 'solve',
        code: 'module.exports.solve=()=>true;',
        tests: [
          { id: 'visible', visibility: 'visible', args: [], expected: true },
        ],
      },
      adapter,
    );
    expect(result.diagnosisCode).toBe('UNKNOWN');
    expect(result.allRequiredPassed).toBe(false);
    expect(result.evidence.cleanupVerified).toBe(false);
    expect(adapter.evidence).toMatchObject({
      cleanupVerified: false,
      cleanupCheck: expectedCheck,
    });
  },
);

test('an SDK retry cannot dispatch a second billable create POST', async () => {
  state.retryCreate = true;
  const adapter = new VercelAdapter(options());
  await expect(adapter.execute(capsuleInput())).rejects.toThrow(
    'already dispatched',
  );
  await adapter.close();
  expect(
    globalThis.fetch.mock.calls.filter(
      ([url, init]) =>
        new URL(url).pathname === '/v3/sandboxes' && init.method === 'POST',
    ),
  ).toHaveLength(1);
  expect(adapter.evidence).toMatchObject({
    createDispatches: 1,
    creationStatus: 'RECONCILED',
  });
});

test('failure to persist correlation prevents any SDK creation', async () => {
  const adapter = new VercelAdapter(
    options({
      recordCorrelation: async () => {
        throw new Error('disk unavailable');
      },
    }),
  );
  await expect(adapter.execute(capsuleInput())).rejects.toThrow(
    'disk unavailable',
  );
  await adapter.close();
  expect(sdk.create).not.toHaveBeenCalled();
  expect(globalThis.fetch).not.toHaveBeenCalled();
  expect(adapter.evidence.cleanupCheck).toBe('NO_CREATION_ATTEMPT');
});

test('a missing correlation recorder cannot authorize creation', () => {
  expect(
    () => new VercelAdapter(options({ recordCorrelation: undefined })),
  ).toThrow('Authorized Sandbox configuration required');
  expect(sdk.create).not.toHaveBeenCalled();
});

test('cancellation during bootstrap still deletes and verifies the owned VM', async () => {
  const controller = new AbortController();
  state.commandError = Object.assign(new Error('Aborted'), {
    name: 'AbortError',
  });
  const adapter = new VercelAdapter(options());
  await expect(
    adapter.execute(capsuleInput(), controller.signal),
  ).rejects.toThrow('Aborted');
  controller.abort();
  await adapter.close();
  expect(adapter.evidence.cleanupVerified).toBe(true);
  expect(sdk.get.mock.calls[0][0].signal.aborted).toBe(false);
});

test('reconciliation and readback use the same bounded cleanup request reserve after dispatch expiry', async () => {
  let now = 0;
  const budget = new SandboxRequestBudget(10, 1, () => now);
  const adapter = new VercelAdapter(
    options({ allowRequest: (cleanup) => budget.consume(cleanup) }),
  );
  await adapter.execute(capsuleInput());
  now = 2;
  await adapter.close();
  expect(budget.requests).toBe(5);
  for (let index = 0; index < 4; index++) budget.consume(true);
  expect(() => budget.consume(true)).toThrow('exhausted');
  expect(adapter.evidence.cleanupVerified).toBe(true);
});

test('each case uploads only its private input and keeps the supervisor in the image', async () => {
  const adapter = new VercelAdapter(options());
  try {
    const inputs = [capsuleInput(), capsuleInput()];
    for (const input of inputs) await adapter.execute(input);
    const uploads = sandbox.writeFiles.mock.calls.map(([files]) => files);
    expect(uploads).toEqual(
      inputs.map((input) => [
        {
          path: expect.stringMatching(
            /^\/vercel\/sandbox\/alunza-input-[a-f0-9-]{36}\.json$/,
          ),
          content: JSON.stringify(input),
          mode: 0o600,
        },
      ]),
    );
    expect(uploads[0][0].path).not.toBe(uploads[1][0].path);
    expect(sandbox.runCommand.mock.calls.map(([call]) => call.args[0])).toEqual(
      [
        '/opt/alunza/supervisor/remote-init.mjs',
        ...Array(4).fill('/opt/alunza/supervisor/remote-driver.mjs'),
      ],
    );
  } finally {
    await adapter.close();
  }
});

test('durable receipt and active fence precede uploads; receipt failure cannot be bypassed by reusing the adapter', async () => {
  const recordResource = jest.fn(async () => {
    throw new Error('receipt unavailable');
  });
  const adapter = new VercelAdapter(options({ recordResource }));
  await expect(adapter.execute(capsuleInput())).rejects.toThrow(
    'receipt unavailable',
  );
  expect(recordResource).toHaveBeenCalledWith(
    expect.objectContaining({
      sandboxId: 'mock',
      sandboxName: createParams.name,
    }),
  );
  expect(sandbox.writeFiles).not.toHaveBeenCalled();
  await expect(adapter.execute(capsuleInput())).rejects.toThrow(
    'cannot be repeated',
  );
  recordResource.mockResolvedValue();
  await adapter.close();
  expect(adapter.evidence.cleanupVerified).toBe(true);
});

test('lost lease after resource receipt permits cleanup but no student upload or command', async () => {
  let active = true;
  const adapter = new VercelAdapter(
    options({
      recordResource: async () => {
        active = false;
      },
      assertActive: async () => {
        if (!active) throw new Error('lease lost');
      },
    }),
  );
  await expect(adapter.execute(capsuleInput())).rejects.toThrow('lease lost');
  expect(sandbox.writeFiles).not.toHaveBeenCalled();
  expect(sandbox.runCommand).not.toHaveBeenCalled();
  await adapter.close();
  expect(adapter.evidence.cleanupVerified).toBe(true);
});

test.each([
  [
    'oversized stream',
    { resultChunks: [Buffer.alloc(524288), Buffer.from('x')] },
    'protocol limit',
  ],
  ['malformed JSON', { resultChunks: ['{'] }, 'protocol invalid'],
  [
    'unknown envelope field',
    { capsule: { ...capsule(), secret: 'MUST_NOT_LOG' } },
    'protocol invalid',
  ],
  ['missing file', { resultMissing: true }, 'result missing'],
  [
    'invalid image identity',
    { capsule: { ...capsule(), image: 'mutable:latest' } },
    'protocol invalid',
  ],
])(
  '%s is rejected with file cleanup and no private result in command logs',
  async (_name, setup, error) => {
    Object.assign(state, setup);
    const adapter = new VercelAdapter(options());
    await expect(adapter.execute(capsuleInput())).rejects.toThrow(error);
    expect(sandbox.runCommand.mock.calls.at(-1)[0].args[1]).toBe('cleanup');
    if (!state.resultMissing) expect(state.resultStream.destroyed).toBe(true);
    await adapter.close();
  },
);

test('trusted OS probe is a fixed command argument, never part of student input', async () => {
  const adapter = new VercelAdapter(options({ trustedProbe: 'memory' }));
  await adapter.execute(capsuleInput());
  expect(sandbox.runCommand.mock.calls[1][0].args.slice(-2)).toEqual([
    'memory',
    expect.stringMatching(/^--deadline-ms=\d+$/),
  ]);
  expect(
    JSON.parse(sandbox.writeFiles.mock.calls[0][0][0].content),
  ).not.toHaveProperty('probe');
  await adapter.close();
  expect(
    () => new VercelAdapter(options({ trustedProbe: 'student-choice' })),
  ).toThrow();
});

const recoveryOptions = (overrides = {}) => ({
  token: 'mock-private-token',
  teamId: 'team_mock',
  projectId: 'prj_mock',
  image,
  region: 'iad1',
  sandboxName: 'alunza-practice-' + 'a'.repeat(36),
  sandboxId: null,
  owner: 'alunza-imp-03-07',
  correlationId: 'creation-test',
  creationState: 'UNKNOWN',
  ...overrides,
});

test('recovery PREPARED performs no provider request or execution', async () => {
  const evidence = await recoverVercelSandbox(
    recoveryOptions({ creationState: 'PREPARED' }),
  );
  expect(evidence.cleanupVerified).toBe(true);
  expect(globalThis.fetch).not.toHaveBeenCalled();
  expect(sdk.create).not.toHaveBeenCalled();
});

test('recovery distinguishes unknown creation 404 from known session 404 and still verifies snapshots', async () => {
  const unknown = await recoverVercelSandbox(recoveryOptions());
  expect(unknown).toMatchObject({
    cleanupVerified: false,
    cleanupCheck: 'CREATION_UNRESOLVED',
  });
  expect(snapshots.list).not.toHaveBeenCalled();
  const known = await recoverVercelSandbox(
    recoveryOptions({ creationState: 'CONFIRMED', sandboxId: 'mock' }),
  );
  expect(known).toMatchObject({
    cleanupVerified: true,
    sandboxId: 'mock',
    cleanupCheck: 'ABSENT_AND_ZERO_SNAPSHOTS',
  });
  expect(snapshots.list).toHaveBeenCalledTimes(1);
  expect(sdk.create).not.toHaveBeenCalled();
});

test('recovery records an observed ID before deletion and refuses a replacement session', async () => {
  const config = options({
    sandboxName: recoveryOptions().sandboxName,
    owner: 'alunza-imp-03-07',
    correlationId: 'creation-test',
  });
  const original = new VercelAdapter(config);
  await original.execute(capsuleInput());
  sandbox.writeFiles.mockClear();
  sandbox.runCommand.mockClear();
  const mismatch = await recoverVercelSandbox(
    recoveryOptions({ creationState: 'CONFIRMED', sandboxId: 'other' }),
  );
  expect(mismatch.cleanupVerified).toBe(false);
  expect(sandbox.delete).not.toHaveBeenCalled();
  const receipt = jest.fn(async () => {
    expect(sandbox.delete).not.toHaveBeenCalled();
  });
  const evidence = await recoverVercelSandbox(
    recoveryOptions({ recordResource: receipt }),
  );
  expect(receipt).toHaveBeenCalledWith(
    expect.objectContaining({ sandboxId: 'mock' }),
  );
  expect(evidence).toMatchObject({ cleanupVerified: true, sandboxId: 'mock' });
  expect(sandbox.writeFiles).not.toHaveBeenCalled();
  expect(sandbox.runCommand).not.toHaveBeenCalled();
});

test('async quota rejection is awaited before any provider dispatch', async () => {
  const adapter = new VercelAdapter(
    options({
      allowRequest: async () => {
        throw new Error('quota denied');
      },
    }),
  );
  await expect(adapter.execute(capsuleInput())).rejects.toThrow('quota denied');
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

test.each([
  null,
  [],
  {},
  { naturalTimeoutObservation: false },
  { discardCreateResponse: 'true' },
  { onCapsuleDispatched: true },
  { unexpected: true },
  { naturalTimeoutObservation: true, discardCreateResponse: true },
])(
  'invalid trusted acceptance seam %p is rejected before provider effects',
  (acceptance) => {
    expect(() => new VercelAdapter(options({ acceptance }))).toThrow(
      'Invalid trusted',
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  },
);

test('normal execution cannot use the long natural-expiry window or observer', async () => {
  const adapter = new VercelAdapter(
    options({ cleanupDeadlineMs: Date.now() + 90000 }),
  );
  expect(adapter.cleanupDeadlineMs).toBeLessThanOrEqual(Date.now() + 40000);
  await expect(adapter.observeNaturalTimeout()).rejects.toThrow('dedicated');
  expect(sdk.get).not.toHaveBeenCalled();
});

test('natural-expiry observation requires matching stopped timestamps and never stops the VM itself', async () => {
  const adapter = new VercelAdapter(
    options({ acceptance: { naturalTimeoutObservation: true } }),
  );
  await adapter.execute(capsuleInput());
  const started = Date.now() - 65000;
  state.sessionDetails = {
    status: 'running',
    startedAt: new Date(started),
    stoppedAt: undefined,
  };
  expect((await adapter.observeNaturalTimeout()).verified).toBe(false);
  state.sessionDetails = {
    status: 'stopped',
    startedAt: new Date(started),
    stoppedAt: new Date(started + 59000),
  };
  expect((await adapter.observeNaturalTimeout()).verified).toBe(false);
  state.sessionDetails.stoppedAt = new Date(started + 60000);
  expect(await adapter.observeNaturalTimeout()).toMatchObject({
    verified: true,
    sandboxId: 'mock',
    sessionStatus: 'stopped',
    expiresAtMs: started + 60000,
  });
  expect(sandbox.stop).not.toHaveBeenCalled();
  expect(
    sdk.get.mock.calls.every(([parameters]) => parameters.resume === false),
  ).toBe(true);
  await adapter.close();
  await expect(adapter.observeNaturalTimeout()).rejects.toThrow('dedicated');
});

test('natural-expiry absence without provider timestamps is not accepted', async () => {
  const adapter = new VercelAdapter(
    options({ acceptance: { naturalTimeoutObservation: true } }),
  );
  await adapter.execute(capsuleInput());
  state.notFound = true;
  expect(await adapter.observeNaturalTimeout()).toMatchObject({
    verified: false,
    sessionStatus: 'ABSENT_WITHOUT_EXPIRY_EVIDENCE',
  });
  await adapter.close();
});

test('a stalled private result stream is destroyed at the normal deadline', async () => {
  const adapter = new VercelAdapter(
    options({ normalDeadlineMs: Date.now() + 100 }),
  );
  await adapter.execute(capsuleInput());
  const stream = new Readable({ read() {} });
  sandbox.readFile.mockResolvedValue(stream);
  await expect(adapter.execute(capsuleInput())).rejects.toThrow();
  expect(stream.destroyed).toBe(true);
  await adapter.close();
});
