const { randomUUID } = require('node:crypto');
let prepared, engine, current;
const command = jest.fn();
const remove = jest.fn(async () => true);
const runtimeIdentity = jest.fn();
const readFile = jest.fn();
jest.unstable_mockModule('node:fs/promises', () => ({ readFile }));
jest.unstable_mockModule('node:os', () => ({ platform: () => 'linux' }));
jest.unstable_mockModule('../../infra/runner/capsule.mjs', () => ({
  command,
  RUNNER_PREFIX: 'alunza-laboratorio-runner-',
  cleanupDockerExecution: jest.fn(),
}));
jest.unstable_mockModule('../../infra/runner/docker-runtime.mjs', () => ({
  inspectDockerRuntime: runtimeIdentity,
}));
jest.unstable_mockModule('../../infra/runner/docker-engine.mjs', () => ({
  localDockerEngine: async () => engine,
  capsuleConfiguration: (image, labels, _probe, runtime) => ({
    Image: image,
    Labels: labels,
    HostConfig: { Runtime: runtime },
  }),
  removeAndVerify: remove,
}));
beforeAll(async () => {
  prepared = await import('../../infra/runner/prepared-capsule.mjs');
});
const limits = {
  'memory.max': '134217728',
  'memory.swap.max': '0',
  'pids.max': '32',
  'cpu.max': '100000 100000',
};
function setup(state = 'PREPARED') {
  jest.clearAllMocks();
  const ownerToken = randomUUID(),
    resourceId = randomUUID(),
    id = 'a'.repeat(64);
  const context = {
    provider: 'docker',
    image: 'sha256:' + 'b'.repeat(64),
    runnerVersion: 'test',
    engineId: 'engine-fixture',
    runtimeName: 'alunza-crun',
    runtimeVersion: '1.31',
    runtimeSha256: 'c'.repeat(64),
    strategy: 'prepared-pair-v1',
  };
  const pair = {
    pairId: randomUUID(),
    creatorToken: ownerToken,
    ownerToken,
    context,
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    recoveryOnly: false,
  };
  const slot = {
    resourceId,
    name: 'alunza-laboratorio-runner-' + resourceId,
    creationState: state,
    cleanupState: 'PENDING',
    containerId: state === 'CONFIRMED' ? id : null,
  };
  const labels = {
    'org.alunza.runner': 'alunza-edu-laboratorio',
    'org.alunza.prepared-pair': pair.pairId,
    'org.alunza.resource': resourceId,
    'org.alunza.creator': ownerToken,
    'org.alunza.engine': context.engineId,
    'org.alunza.expires': String(Date.parse(pair.expiresAt)),
  };
  const inspection = {
    Id: id,
    Name: '/' + slot.name,
    Image: context.image,
    Config: { Tty: false, OpenStdin: true, StdinOnce: true, Labels: labels },
    HostConfig: {
      Runtime: context.runtimeName,
      Memory: 134217728,
      MemorySwap: 134217728,
      NanoCpus: 1000000000,
      PidsLimit: 32,
      NetworkMode: 'none',
      PidMode: '',
      ReadonlyRootfs: true,
      Privileged: false,
      Binds: [],
      CapDrop: ['ALL'],
      CapAdd: ['SETUID', 'SETGID', 'SETPCAP', 'KILL'],
      SecurityOpt: ['no-new-privileges:true'],
    },
    State: { Running: true, Pid: 123 },
  };
  current = { status: 200, data: inspection };
  engine = {
    endpoint: 'unix:///private/docker.sock',
    request: jest.fn(async (method, path) => {
      if (path === '/info')
        return {
          status: 200,
          data: {
            ID: context.engineId,
            OSType: 'linux',
            CgroupVersion: '2',
            CgroupDriver: 'systemd',
          },
        };
      if (method === 'POST' && path.startsWith('/containers/create?'))
        return { status: 201, data: { Id: id } };
      return current;
    }),
    prepareAttach: jest.fn(async () => ({
      inspection,
      usable: () => true,
      close: jest.fn(),
      consume: jest.fn(),
    })),
  };
  const resources = {
    authorizeCreate: jest.fn(async () => {}),
    confirmCreated: jest.fn(async () => {}),
    markClean: jest.fn(async () => {}),
  };
  runtimeIdentity.mockResolvedValue({
    engineId: context.engineId,
    runtimeName: context.runtimeName,
    runtimeVersion: context.runtimeVersion,
    runtimeSha256: context.runtimeSha256,
    strategy: context.strategy,
  });
  readFile.mockImplementation(async (path) =>
    path.startsWith('/proc/')
      ? `0::/runner.slice/docker-${id}.scope/container\n`
      : path === '/sys/fs/cgroup/runner.slice/memory.max'
        ? '2147483648\n'
        : limits[path.split('/').at(-1)] + '\n',
  );
  return {
    pair,
    slot,
    context,
    inspection,
    resources,
    id,
    config: {
      runtime: 'crun',
      runtimeName: context.runtimeName,
      runtimeVersion: context.runtimeVersion,
      runtimeSha256: context.runtimeSha256,
      strategy: context.strategy,
    },
  };
}

test('a 404 cannot release an uncertain create, while proven non-dispatch is distinct', async () => {
  const f = setup('UNKNOWN');
  current = { status: 404 };
  await expect(
    prepared.cleanupPreparedSlot(f.pair, f.slot, f.resources),
  ).resolves.toBe(false);
  expect(f.resources.markClean).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
  await expect(
    prepared.cleanupPreparedSlot(
      f.pair,
      { ...f.slot, creationState: 'PREPARED' },
      f.resources,
    ),
  ).resolves.toBe(true);
  expect(f.resources.markClean).toHaveBeenCalledWith(
    f.pair.pairId,
    f.slot.resourceId,
    { kind: 'NOT_DISPATCHED' },
  );
});

test('recovery confirms a late owned ID and removes it without requiring the runtime binary or valid limits', async () => {
  const f = setup('UNKNOWN');
  f.inspection.HostConfig.Memory = 1;
  await expect(
    prepared.cleanupPreparedSlot(
      { ...f.pair, ownerToken: randomUUID(), recoveryOnly: true },
      f.slot,
      f.resources,
    ),
  ).resolves.toBe(true);
  expect(runtimeIdentity).not.toHaveBeenCalled();
  expect(engine.prepareAttach).not.toHaveBeenCalled();
  expect(f.resources.confirmCreated).toHaveBeenCalledWith(
    f.pair.pairId,
    f.slot.resourceId,
    f.id,
  );
  expect(f.resources.markClean).toHaveBeenCalledWith(
    f.pair.pairId,
    f.slot.resourceId,
    { kind: 'ABSENT', containerId: f.id },
  );
});

test('foreign immutable creator labels cannot be retired by a rotated recovery owner', async () => {
  const f = setup('UNKNOWN');
  f.inspection.Config.Labels['org.alunza.creator'] = randomUUID();
  await expect(
    prepared.cleanupPreparedSlot(f.pair, f.slot, f.resources),
  ).rejects.toThrow();
  expect(remove).not.toHaveBeenCalled();
  expect(f.resources.confirmCreated).not.toHaveBeenCalled();
});

test('failure to persist a received ID prevents start; retry only records metadata and cleans', async () => {
  const f = setup();
  f.resources.confirmCreated.mockRejectedValueOnce(
    new Error('lost database response'),
  );
  await expect(
    prepared.prepareDockerCapsule(
      f.pair,
      f.slot,
      f.config,
      f.resources,
      AbortSignal.timeout(1000),
    ),
  ).rejects.toThrow();
  expect(engine.prepareAttach).not.toHaveBeenCalled();
  expect(
    engine.request.mock.calls.filter(
      ([method, path]) =>
        method === 'POST' && path.startsWith('/containers/create?'),
    ),
  ).toHaveLength(1);
  expect(f.resources.confirmCreated).toHaveBeenCalledTimes(2);
  expect(remove).toHaveBeenCalledTimes(1);
});

test('preparation observes exact kernel limits and never consumes student input', async () => {
  const f = setup();
  const handle = await prepared.prepareDockerCapsule(
    f.pair,
    f.slot,
    f.config,
    f.resources,
    AbortSignal.timeout(1000),
  );
  expect(handle.usable()).toBe(true);
  expect(engine.prepareAttach).toHaveBeenCalledTimes(1);
  expect(f.resources.authorizeCreate.mock.invocationCallOrder[0]).toBeLessThan(
    f.resources.confirmCreated.mock.invocationCallOrder[0],
  );
  expect(f.resources.confirmCreated.mock.invocationCallOrder[0]).toBeLessThan(
    engine.prepareAttach.mock.invocationCallOrder[0],
  );
  expect(
    readFile.mock.calls.filter(([path]) => path.startsWith('/sys/fs/cgroup/')),
  ).toHaveLength(6);
  expect(handle.boundary).toBe('/sys/fs/cgroup/runner.slice');
  await handle.cleanup();
});

test.each([
  ['missing KILL', ['SETUID', 'SETGID', 'SETPCAP']],
  ['extra capability', ['SETUID', 'SETGID', 'SETPCAP', 'KILL', 'SYS_ADMIN']],
  ['duplicate KILL', ['SETUID', 'SETGID', 'SETPCAP', 'KILL', 'KILL']],
])(
  'prepared rejects bridge capabilities with %s before attaching',
  async (_name, capabilities) => {
    const f = setup();
    f.inspection.HostConfig.CapAdd = capabilities;
    await expect(
      prepared.prepareDockerCapsule(f.pair, f.slot, f.config, f.resources),
    ).rejects.toThrow('controls mismatch');
    expect(engine.prepareAttach).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledTimes(1);
  },
);

test('prepared accepts exactly the bridge capabilities with Docker CAP_ prefixes', () => {
  const f = setup();
  f.inspection.HostConfig.CapAdd = [
    'CAP_KILL',
    'CAP_SETPCAP',
    'CAP_SETGID',
    'CAP_SETUID',
  ];
  expect(() =>
    prepared.validatePreparedInspection(f.inspection, f.pair, f.slot, true),
  ).not.toThrow();
});

test.each(['host', 'container:' + 'd'.repeat(64), undefined])(
  'prepared requires a private PID namespace and rejects PidMode %s',
  async (pidMode) => {
    const f = setup();
    f.inspection.HostConfig.PidMode = pidMode;
    await expect(
      prepared.prepareDockerCapsule(f.pair, f.slot, f.config, f.resources),
    ).rejects.toThrow('controls mismatch');
    expect(engine.prepareAttach).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledTimes(1);
  },
);

test('a failed effective limit rejects readiness and still retires the owned resource', async () => {
  const f = setup();
  readFile.mockImplementation(async (path) =>
    path.startsWith('/proc/')
      ? `0::/system.slice/docker-${f.id}.scope\n`
      : 'max\n',
  );
  await expect(
    prepared.prepareDockerCapsule(
      f.pair,
      f.slot,
      f.config,
      f.resources,
      AbortSignal.timeout(1000),
    ),
  ).rejects.toThrow('kernel limit');
  expect(remove).toHaveBeenCalledTimes(1);
  expect(f.resources.markClean).toHaveBeenCalled();
});

test('the capsule leaf alone does not establish a shared executor memory and CPU boundary', async () => {
  const f = setup();
  readFile.mockImplementation(async (path) =>
    path.startsWith('/proc/')
      ? `0::/runner.slice/docker-${f.id}.scope/container\n`
      : path.includes(`/docker-${f.id}.scope/`)
        ? limits[path.split('/').at(-1)] + '\n'
        : 'max\n',
  );
  await expect(
    prepared.prepareDockerCapsule(
      f.pair,
      f.slot,
      f.config,
      f.resources,
      AbortSignal.timeout(1000),
    ),
  ).rejects.toThrow('shared executor limits');
  expect(remove).toHaveBeenCalledTimes(1);
});

test.each(['engine', 'pid', 'boundary'])(
  'a prepared capsule rechecks %s after the durable authority wait before sending input',
  async (change) => {
    const f = setup();
    const dispatched = jest.fn();
    engine.prepareAttach.mockResolvedValueOnce({
      inspection: globalThis.structuredClone(f.inspection),
      usable: () => true,
      close: jest.fn(),
      consume: async (_input, options) => {
        await options.beforeSend();
        dispatched();
        throw new Error('fixture should never dispatch');
      },
    });
    const handle = await prepared.prepareDockerCapsule(
      f.pair,
      f.slot,
      f.config,
      f.resources,
      AbortSignal.timeout(1000),
    );
    const beforeSend = jest.fn(async () => {
      if (change === 'engine') {
        const request = engine.request.getMockImplementation();
        engine.request.mockImplementation((method, path, options) =>
          path === '/info'
            ? { status: 200, data: { ID: 'another-engine' } }
            : request(method, path, options),
        );
      } else if (change === 'pid') f.inspection.State.Pid++;
      else {
        const read = readFile.getMockImplementation();
        readFile.mockImplementation((path, encoding) =>
          read(path, encoding).then((value) =>
            path.startsWith('/proc/')
              ? value.replace('runner.slice', 'another.slice')
              : value,
          ),
        );
      }
    });
    await expect(
      handle.consume(
        { executionId: randomUUID(), code: 'synthetic', args: [] },
        {
          signal: AbortSignal.timeout(1000),
          deadlineMs: Date.now() + 1000,
          cleanupDeadlineMs: Date.now() + 2000,
          beforeSend,
        },
      ),
    ).rejects.toThrow();
    expect(beforeSend).toHaveBeenCalledTimes(1);
    expect(dispatched).not.toHaveBeenCalled();
  },
);
