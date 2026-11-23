const { randomUUID } = require('node:crypto');
let runner;
const prepare = jest.fn();
const cleanup = jest.fn(async () => true);
const coldCapsule = jest.fn();
jest.unstable_mockModule('../../infra/runner/capsule.mjs', () => ({
  runCapsule: coldCapsule,
  imageIdentity: jest.fn(),
  inspectConfiguredDocker: jest.fn(),
  getDockerEngineId: jest.fn(),
  getDockerAvailability: jest.fn(),
  cleanupDockerExecution: jest.fn(),
  sweepExpiredDockerExecutions: jest.fn(),
}));
const cleanupCold = jest.fn(async () => ({
  cleanupVerified: true,
  removed: 0,
}));
jest.unstable_mockModule('../../infra/runner/prepared-capsule.mjs', () => ({
  prepareDockerCapsule: prepare,
  cleanupPreparedSlot: cleanup,
  cleanupBoundDockerExecution: cleanupCold,
}));
beforeAll(async () => {
  runner = await import('../../packages/runner/dist/index.js');
});
beforeEach(() => {
  jest.clearAllMocks();
  coldCapsule.mockImplementation(async (_input, options) => {
    await options.beforeSend?.();
    return {
      cleanupVerified: true,
      kernelBoundary: '/sys/fs/cgroup/runner.slice',
    };
  });
});

const runtime = {
  runtime: 'crun',
  runtimeName: 'alunza-crun',
  runtimeVersion: '1.31',
  runtimeSha256: 'a'.repeat(64),
  strategy: 'prepared-pair-v1',
};
const context = {
  provider: 'docker',
  image: 'sha256:' + 'b'.repeat(64),
  runnerVersion: 'test-version',
  engineId: 'engine-fixture',
  runtimeName: runtime.runtimeName,
  runtimeVersion: runtime.runtimeVersion,
  runtimeSha256: runtime.runtimeSha256,
  strategy: runtime.strategy,
};
const input = () => ({
  executionId: randomUUID(),
  requestId: 'fixture',
  exerciseVersionId: 'fixture',
  testsVersion: 'v1',
  mode: 'RUN',
  entrypoint: 'solve',
  code: 'synthetic private code',
  tests: [{ id: 'v', args: [], expected: true, visibility: 'visible' }],
});
const authority = (ms = 1000) => ({
  leaseToken: randomUUID(),
  normalDeadlineMs: Date.now() + ms,
  cleanupDeadlineMs: Date.now() + ms + 1000,
  assertActive: jest.fn(async () => {}),
});
function fixture() {
  const ownerToken = randomUUID(),
    handles = [];
  let latest;
  const resources = {
    reservePair: jest.fn(async (ctx, owner) => {
      latest = {
        pairId: randomUUID(),
        context: Object.fromEntries(Object.entries(ctx).reverse()),
        creatorToken: owner,
        ownerToken: owner,
        leaseExpiresAt: new Date(Date.now() + 60000).toISOString(),
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        state: 'PREPARING',
        executionId: null,
        recoveryOnly: false,
        slots: Array.from({ length: 2 }, () => {
          const resourceId = randomUUID();
          return {
            resourceId,
            name: 'alunza-laboratorio-runner-' + resourceId,
            containerId: null,
            creationState: 'PREPARED',
            cleanupState: 'PENDING',
          };
        }),
      };
      return latest;
    }),
    authorizeCreate: jest.fn(async () => {}),
    confirmCreated: jest.fn(async () => {}),
    markPairReady: jest.fn(async () => {}),
    assignPair: jest.fn(async (pairId, owner, executionId) => ({
      ...latest,
      pairId,
      ownerToken: owner,
      state: 'ASSIGNED',
      executionId,
      slots: latest.slots.map((slot) => ({
        ...slot,
        creationState: 'CONFIRMED',
        containerId: slot.resourceId.replaceAll('-', '') + '0'.repeat(32),
      })),
    })),
    assertAssignment: jest.fn(async () => {}),
    markClean: jest.fn(async () => {}),
    releasePair: jest.fn(async () => {}),
    listExecutionPairs: jest.fn(async () => []),
    claimRecovery: jest.fn(async () => []),
  };
  prepare.mockImplementation(async (_pair, slot) => {
    const handle = {
      resourceId: slot.resourceId,
      boundary: '/sys/fs/cgroup/runner.slice',
      usable: jest.fn(() => true),
      cleanup: jest.fn(async () => true),
      consume: jest.fn(async (_input, options) => {
        await options.beforeSend();
        return { cleanupVerified: true };
      }),
    };
    handles.push(handle);
    return handle;
  });
  return {
    pool: new runner.DockerPreparedPool({ runtime, resources, ownerToken }),
    resources,
    ownerToken,
    handles,
  };
}

test('cases 3–8 retain the prepared pair boundary and recheck durable authority', async () => {
  const f = fixture(),
    request = input(),
    auth = authority();
  const adapter = await f.pool.adapterFor(request, context, auth);
  const capsuleInput = {
    executionId: request.executionId,
    code: request.code,
    args: [],
    budgetMs: 3000,
    outputRemaining: 65536,
  };
  for (let index = 0; index < 8; index++) await adapter.execute(capsuleInput);
  expect(f.handles.map((handle) => handle.consume.mock.calls.length)).toEqual([
    1, 1,
  ]);
  expect(coldCapsule).toHaveBeenCalledTimes(6);
  for (const [sent, options] of coldCapsule.mock.calls) {
    expect(sent.executionId).toBe(request.executionId);
    expect(options).toMatchObject({
      expectedBoundary: '/sys/fs/cgroup/runner.slice',
      runtime: context,
      image: context.image,
      deadlineMs: auth.normalDeadlineMs,
    });
  }
  expect(auth.assertActive).toHaveBeenCalledTimes(9);
  await adapter.close();
  await f.pool.afterRequestClosed(request.executionId, context, {
    replenish: false,
  });
  await f.pool.drain();
});

test('cold cases bind the first observed executor boundary without preparing a pair', async () => {
  const resources = fixture().resources;
  const pool = new runner.DockerPreparedPool({
    runtime: { ...runtime, strategy: 'cold' },
    resources,
    ownerToken: randomUUID(),
  });
  const request = input(),
    auth = authority();
  const adapter = await pool.adapterFor(
    request,
    { ...context, strategy: 'cold' },
    auth,
  );
  for (let index = 0; index < 8; index++)
    await adapter.execute({
      executionId: request.executionId,
      code: request.code,
      args: [],
      budgetMs: 3000,
      outputRemaining: 65536,
    });
  expect(prepare).not.toHaveBeenCalled();
  expect(coldCapsule).toHaveBeenCalledTimes(8);
  expect(coldCapsule.mock.calls[0][1].expectedBoundary).toBeUndefined();
  expect(
    coldCapsule.mock.calls
      .slice(1)
      .every(
        ([, options]) =>
          options.expectedBoundary === '/sys/fs/cgroup/runner.slice',
      ),
  ).toBe(true);
  expect(auth.assertActive).toHaveBeenCalledTimes(9);
  await adapter.close();
  await pool.drain();
});

// These exercise ordering and exclusivity with a durable-port double. They do
// not certify Docker resource isolation; the Linux integration gate does that.
test('single reserve has no student input, is assigned once, and replenishes only after HTTP close', async () => {
  const f = fixture();
  await Promise.all([f.pool.prepare(context), f.pool.prepare(context)]);
  expect(f.resources.reservePair).toHaveBeenCalledTimes(1);
  expect(prepare).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(prepare.mock.calls)).not.toContain(
    'synthetic private code',
  );
  const request = input(),
    auth = authority();
  const adapter = await f.pool.adapterFor(request, context, auth);
  await adapter.execute({
    executionId: request.executionId,
    code: request.code,
    args: [],
    budgetMs: 3000,
    outputRemaining: 65536,
  });
  expect(f.resources.assertAssignment).toHaveBeenCalledWith(
    expect.any(String),
    f.handles[0].resourceId,
    f.ownerToken,
    request.executionId,
    auth.leaseToken,
  );
  await adapter.close();
  expect(f.handles[1].consume).not.toHaveBeenCalled();
  expect(f.handles[1].cleanup).toHaveBeenCalled();
  await f.pool.prepare(context);
  expect(f.resources.reservePair).toHaveBeenCalledTimes(1);
  expect(f.resources.releasePair).not.toHaveBeenCalled();
  await f.pool.afterRequestClosed(request.executionId, context, {
    replenish: false,
  });
  expect(f.resources.releasePair).toHaveBeenCalledTimes(1);
  expect(f.resources.reservePair).toHaveBeenCalledTimes(1);
  await f.pool.drain();
});

test('a second admitted execution waits without falling back or sharing a pair', async () => {
  const f = fixture();
  await f.pool.prepare(context);
  const first = input(),
    adapter = await f.pool.adapterFor(first, context, authority());
  await expect(
    f.pool.adapterFor(input(), context, authority(35)),
  ).rejects.toThrow();
  expect(f.resources.assignPair).toHaveBeenCalledTimes(1);
  expect(prepare).toHaveBeenCalledTimes(2);
  await adapter.close();
  await f.pool.afterRequestClosed(first.executionId, context, {
    replenish: false,
  });
  await f.pool.drain();
});

test('a queue wait does not restart the preparation budget', async () => {
  const f = fixture();
  await f.pool.prepare(context);
  const first = input(),
    adapter = await f.pool.adapterFor(first, context, authority());
  const observedSignals = [];
  prepare.mockImplementation(
    (_pair, _slot, _config, _resources, signal) =>
      new Promise((_, reject) => {
        observedSignals.push(signal);
        signal.addEventListener(
          'abort',
          () => reject(new Error('preparation stopped')),
          { once: true },
        );
        if (signal.aborted) reject(new Error('preparation stopped'));
      }),
  );
  const waiting = f.pool.adapterFor(input(), context, authority(85));
  const closed = new Promise((resolve) => setTimeout(resolve, 20)).then(
    async () => {
      await adapter.close();
      await f.pool.afterRequestClosed(first.executionId, context, {
        replenish: false,
      });
    },
  );
  await expect(waiting).rejects.toThrow();
  await closed;
  expect(observedSignals).toHaveLength(2);
  expect(observedSignals.every((signal) => signal.aborted)).toBe(true);
  await f.pool.drain();
});

test('recovery works with admissions unconfigured and never prepares or executes', async () => {
  const f = fixture();
  const pair = await f.resources.reservePair(context, f.ownerToken);
  f.resources.reservePair.mockClear();
  const owner = randomUUID();
  f.resources.claimRecovery.mockResolvedValue([
    { ...pair, ownerToken: owner, recoveryOnly: true },
  ]);
  const pool = new runner.DockerPreparedPool({
    resources: f.resources,
    ownerToken: owner,
  });
  await expect(pool.prepare(context)).rejects.toThrow();
  await expect(pool.sweep(context)).resolves.toMatchObject({
    cleanupVerified: true,
  });
  expect(prepare).not.toHaveBeenCalled();
  expect(cleanup).toHaveBeenCalledTimes(2);
  expect(cleanup.mock.calls[0][0].creatorToken).toBe(f.ownerToken);
  expect(f.resources.releasePair).toHaveBeenCalledWith(pair.pairId, owner);
  await pool.drain();
});

test('two individually bounded capsules cannot form a pair under different executor groups', async () => {
  const f = fixture();
  prepare.mockImplementation(async (_pair, slot) => ({
    resourceId: slot.resourceId,
    boundary: '/sys/fs/cgroup/' + slot.resourceId,
    usable: () => true,
    cleanup: jest.fn(async () => true),
    consume: jest.fn(),
  }));
  await expect(f.pool.prepare(context)).rejects.toThrow('share the executor');
  expect(f.resources.markPairReady).not.toHaveBeenCalled();
  await f.pool.drain();
});

test.each(['authorized-before-post', 'post-awaiting-response'])(
  'graceful drain preserves the sole creation in flight at %s and retires confirmed IDs',
  async (pauseAt) => {
    const f = fixture();
    const signals = [],
      ledger = [],
      posts = [],
      confirmed = [];
    let continueCreation, bothReached;
    const paused = new Promise((resolve) => {
      bothReached = resolve;
    });
    const continuation = new Promise((resolve) => {
      continueCreation = resolve;
    });
    prepare.mockImplementation(
      async (_pair, slot, _config, _resources, signal) => {
        signals.push(signal);
        const row = {
          resourceId: slot.resourceId,
          state: 'UNKNOWN',
          cleanup: 'PENDING',
          id: null,
        };
        ledger.push(row);
        if (pauseAt === 'post-awaiting-response') posts.push(slot.resourceId);
        if (ledger.length === 2) bothReached();
        await continuation;
        signal.throwIfAborted();
        if (pauseAt === 'authorized-before-post') posts.push(slot.resourceId);
        row.id = String(ledger.indexOf(row) + 1).repeat(64);
        row.state = 'CONFIRMED';
        confirmed.push(row.id);
        return {
          resourceId: slot.resourceId,
          boundary: '/sys/fs/cgroup/runner.slice',
          usable: () => true,
          consume: jest.fn(),
          cleanup: jest.fn(async () => {
            expect(row.state).toBe('CONFIRMED');
            row.cleanup = 'VERIFIED';
            return true;
          }),
        };
      },
    );
    // The durable port/transport are controlled doubles: this specifically
    // checks shutdown scheduling, not the SQL implementation or Docker itself.
    const preparing = f.pool.prepare(context).catch((error) => error);
    await paused;
    const draining = f.pool.drain();
    expect(signals.every((signal) => !signal.aborted)).toBe(true);
    continueCreation();
    await draining;
    await preparing;
    expect(posts).toHaveLength(2);
    expect(new Set(posts).size).toBe(2);
    expect(confirmed).toHaveLength(2);
    expect(
      ledger.every(
        (row) => row.state === 'CONFIRMED' && row.cleanup === 'VERIFIED',
      ),
    ).toBe(true);
    expect(f.resources.markPairReady).not.toHaveBeenCalled();
    const calls = f.resources.reservePair.mock.calls.length;
    await f.pool.prepare(context);
    expect(f.resources.reservePair).toHaveBeenCalledTimes(calls);
  },
);

test('another pool can retire a failed close and the original pool admits a new execution without reusing channels', async () => {
  const f = fixture(),
    first = input();
  const adapter = await f.pool.adapterFor(first, context, authority());
  const assigned = await f.resources.assignPair.mock.results[0].value;
  await adapter.close();
  f.resources.releasePair.mockRejectedValueOnce(
    new Error('transient close failure'),
  );
  await expect(
    f.pool.afterRequestClosed(first.executionId, context, { replenish: false }),
  ).rejects.toThrow();
  const otherOwner = randomUUID();
  let ledger = {
    ...assigned,
    ownerToken: otherOwner,
    recoveryOnly: true,
    slots: assigned.slots.map((slot) => ({
      ...slot,
      cleanupState: 'VERIFIED',
    })),
  };
  f.resources.listExecutionPairs.mockImplementation(async (id) =>
    id === first.executionId ? [ledger] : [],
  );
  f.resources.claimRecovery.mockImplementation(async (_context, owner) =>
    owner === otherOwner ? [ledger] : [],
  );
  f.resources.releasePair.mockImplementation(async (_pairId, owner) => {
    if (owner === otherOwner) ledger = { ...ledger, state: 'RETIRED' };
  });
  const otherPool = new runner.DockerPreparedPool({
    resources: f.resources,
    ownerToken: otherOwner,
  });
  await expect(otherPool.sweep(context)).resolves.toMatchObject({
    cleanupVerified: true,
  });
  await f.pool.sweep(context); // Its claim returns []; the durable closed row remains observable.
  const second = input(),
    next = await f.pool.adapterFor(second, context, authority());
  expect(f.resources.reservePair).toHaveBeenCalledTimes(2);
  expect(prepare).toHaveBeenCalledTimes(4);
  expect(
    f.handles
      .slice(0, 2)
      .every((handle) => handle.consume.mock.calls.length === 0),
  ).toBe(true);
  await expect(
    adapter.execute({ executionId: first.executionId }),
  ).rejects.toThrow();
  await next.close();
  await f.pool.afterRequestClosed(second.executionId, context, {
    replenish: false,
  });
  await otherPool.drain();
  await f.pool.drain();
});

test.each([
  'http-open',
  'missing-row',
  'wrong-creator',
  'wrong-container',
  'cleanup-pending',
  'owner-rotated-only',
])(
  'local capacity is retained without exact retirement evidence: %s',
  async (scenario) => {
    const f = fixture(),
      first = input();
    const adapter = await f.pool.adapterFor(first, context, authority());
    const assigned = await f.resources.assignPair.mock.results[0].value;
    await adapter.close();
    if (scenario !== 'http-open') {
      f.resources.releasePair.mockRejectedValueOnce(
        new Error('transient close failure'),
      );
      await expect(
        f.pool.afterRequestClosed(first.executionId, context, {
          replenish: false,
        }),
      ).rejects.toThrow();
    }
    const retired = {
      ...assigned,
      state: 'RETIRED',
      ownerToken: randomUUID(),
      slots: assigned.slots.map((slot) => ({
        ...slot,
        cleanupState: 'VERIFIED',
      })),
    };
    if (scenario === 'wrong-creator') retired.creatorToken = randomUUID();
    if (scenario === 'wrong-container')
      retired.slots[0].containerId = 'f'.repeat(64);
    if (scenario === 'cleanup-pending')
      retired.slots[0].cleanupState = 'PENDING';
    if (scenario === 'owner-rotated-only') retired.state = 'ASSIGNED';
    f.resources.listExecutionPairs.mockResolvedValue(
      scenario === 'missing-row' ? [] : [retired],
    );
    await expect(
      f.pool.adapterFor(input(), context, authority(35)),
    ).rejects.toThrow();
    expect(f.resources.reservePair).toHaveBeenCalledTimes(1);
    expect(prepare).toHaveBeenCalledTimes(2);
    await f.pool.drain();
  },
);

test('durable retirement cannot discard a locally running operation', async () => {
  const f = fixture(),
    first = input();
  const adapter = await f.pool.adapterFor(first, context, authority());
  const assigned = await f.resources.assignPair.mock.results[0].value;
  let finish;
  f.handles[0].consume.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const running = adapter.execute({ executionId: first.executionId });
  f.resources.releasePair.mockRejectedValueOnce(
    new Error('transient close failure'),
  );
  await expect(
    f.pool.afterRequestClosed(first.executionId, context, { replenish: false }),
  ).rejects.toThrow();
  f.resources.listExecutionPairs.mockResolvedValue([
    {
      ...assigned,
      state: 'RETIRED',
      ownerToken: randomUUID(),
      slots: assigned.slots.map((slot) => ({
        ...slot,
        cleanupState: 'VERIFIED',
      })),
    },
  ]);
  await expect(
    f.pool.adapterFor(input(), context, authority(35)),
  ).rejects.toThrow();
  expect(f.resources.reservePair).toHaveBeenCalledTimes(1);
  finish({ cleanupVerified: true });
  await running;
  await adapter.close();
  await f.pool.drain();
});
