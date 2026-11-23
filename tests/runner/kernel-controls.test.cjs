const { randomUUID } = require('node:crypto');
const readFile = jest.fn();
const hostPlatform = jest.fn(() => 'linux');
const runtimeIdentity = jest.fn();
const removed = jest.fn(async () => true);
let controls, capsule, selectedEngine;
jest.unstable_mockModule('node:fs/promises', () => ({ readFile }));
jest.unstable_mockModule('node:os', () => ({ platform: hostPlatform }));
jest.unstable_mockModule('../../infra/runner/docker-runtime.mjs', () => ({
  inspectDockerRuntime: runtimeIdentity,
  runtimeConfigFromIdentity: (value) => value,
}));
jest.unstable_mockModule('../../infra/runner/docker-engine.mjs', () => ({
  localDockerEngine: async () => selectedEngine,
  pinnedDockerEnvironment: jest.fn(),
  capsuleConfiguration: jest.fn(),
  removeAndVerify: removed,
  CreationTracker: class {
    begin() {}
    observed() {}
    has() {
      return false;
    }
    uncertain() {
      return false;
    }
  },
}));
beforeAll(async () => {
  controls = await import('../../infra/runner/kernel-controls.mjs');
  capsule = await import('../../infra/runner/capsule.mjs');
});
const leaf = {
  'memory.max': '134217728',
  'memory.swap.max': '0',
  'pids.max': '32',
  'cpu.max': '100000 100000',
};
function setup() {
  jest.clearAllMocks();
  hostPlatform.mockReturnValue('linux');
  removed.mockResolvedValue(true);
  const id = 'a'.repeat(64);
  const expected = { id, engineId: 'engine-fixture' };
  const info = {
    ID: expected.engineId,
    OSType: 'linux',
    CgroupVersion: '2',
    CgroupDriver: 'systemd',
  };
  const live = { Id: id, State: { Running: true, Pid: 123 } };
  const files = {
    '/proc/123/cgroup': `0::/runner.slice/docker-${id}.scope/container\n`,
    '/sys/fs/cgroup/runner.slice/memory.max': '2147483648',
    '/sys/fs/cgroup/runner.slice/cpu.max': '100000 100000',
  };
  for (const [name, value] of Object.entries(leaf))
    files[`/sys/fs/cgroup/runner.slice/docker-${id}.scope/container/${name}`] =
      value;
  readFile.mockImplementation(async (path) => {
    if (!(path in files)) throw new Error('fixture file unavailable');
    return files[path];
  });
  const engine = {
    endpoint: 'unix:///private/docker.sock',
    request: jest.fn(async (_method, path) => ({
      status: 200,
      data: path === '/info' ? info : live,
    })),
  };
  return { id, expected, info, live, files, engine };
}

test('observes both effective layers and the same running PID before returning the boundary', async () => {
  const f = setup();
  await expect(
    controls.verifyKernelControls(f.engine, f.expected),
  ).resolves.toBe('/sys/fs/cgroup/runner.slice');
  expect(
    readFile.mock.calls.filter(([path]) => path === '/proc/123/cgroup'),
  ).toHaveLength(2);
  expect(f.engine.request.mock.calls.map(([, path]) => path)).toEqual([
    '/info',
    `/containers/${f.id}/json`,
    `/containers/${f.id}/json`,
  ]);
});

test('supports the runc scope without mistaking it for the outer boundary', async () => {
  const f = setup();
  f.files['/proc/123/cgroup'] = `0::/runner.slice/docker-${f.id}.scope\n`;
  for (const [file, value] of Object.entries(leaf))
    f.files[`/sys/fs/cgroup/runner.slice/docker-${f.id}.scope/${file}`] = value;
  await expect(
    controls.verifyKernelControls(f.engine, f.expected),
  ).resolves.toBe('/sys/fs/cgroup/runner.slice');
});

test('cancelled observations do not touch the engine or host proc', async () => {
  const f = setup();
  await expect(
    controls.verifyKernelControls(f.engine, {
      ...f.expected,
      signal: AbortSignal.abort(),
    }),
  ).rejects.toThrow();
  expect(f.engine.request).not.toHaveBeenCalled();
  expect(readFile).not.toHaveBeenCalled();
});

test.each(Object.keys(leaf))(
  'rejects effective leaf drift in %s',
  async (file) => {
    const f = setup();
    f.files[
      `/sys/fs/cgroup/runner.slice/docker-${f.id}.scope/container/${file}`
    ] = 'max';
    await expect(
      controls.verifyKernelControls(f.engine, f.expected),
    ).rejects.toThrow('kernel limit');
  },
);

test.each([
  ['memory.max', 'max'],
  ['memory.max', '2147483649'],
  ['memory.max', '0'],
  ['cpu.max', 'max 100000'],
  ['cpu.max', '100001 100000'],
  ['cpu.max', '0 100000'],
])('the leaf cannot substitute for the ancestor %s=%s', async (file, value) => {
  const f = setup();
  f.files[`/sys/fs/cgroup/runner.slice/${file}`] = value;
  await expect(
    controls.verifyKernelControls(f.engine, f.expected),
  ).rejects.toThrow('shared executor limits');
});

test.each(['win32', 'darwin'])(
  'does not read host proc on %s even if Docker reports Linux',
  async (value) => {
    const f = setup();
    hostPlatform.mockReturnValue(value);
    await expect(
      controls.verifyKernelControls(f.engine, f.expected),
    ).rejects.toThrow('local Linux');
    expect(readFile).not.toHaveBeenCalled();
    expect(f.engine.request).not.toHaveBeenCalled();
  },
);

test.each([
  'tcp://localhost:2375',
  'ssh://linux',
  'npipe:////./pipe/docker',
  'unix:////server/socket',
])(
  'does not treat endpoint %s as a local Linux observation',
  async (endpoint) => {
    const f = setup();
    f.engine.endpoint = endpoint;
    await expect(
      controls.verifyKernelControls(f.engine, f.expected),
    ).rejects.toThrow('local Linux');
    expect(readFile).not.toHaveBeenCalled();
  },
);

test.each(['engine', 'pid', 'scope', 'traversal', 'multi-line', 'missing'])(
  'rejects mismatched or ambiguous %s identity',
  async (kind) => {
    const f = setup();
    if (kind === 'engine') f.info.ID = 'another-engine';
    if (kind === 'pid') f.expected.pid = 456;
    if (kind === 'scope')
      f.files['/proc/123/cgroup'] = '0::/runner.slice/docker-foreign.scope';
    if (kind === 'traversal')
      f.files['/proc/123/cgroup'] = `0::/runner.slice/../docker-${f.id}.scope`;
    if (kind === 'multi-line') f.files['/proc/123/cgroup'] += '1:cpu:/another';
    if (kind === 'missing') delete f.files['/proc/123/cgroup'];
    await expect(
      controls.verifyKernelControls(f.engine, f.expected),
    ).rejects.toThrow();
  },
);

test('rejects the same leaf controls under a different reserved boundary', async () => {
  const f = setup();
  await expect(
    controls.verifyKernelControls(f.engine, {
      ...f.expected,
      expectedBoundary: '/sys/fs/cgroup/another.slice',
    }),
  ).rejects.toThrow('boundary changed');
});

test.each(['pid', 'membership', 'stopped'])(
  'rejects %s drift during observation',
  async (kind) => {
    const f = setup();
    const read = readFile.getMockImplementation();
    let reads = 0;
    readFile.mockImplementation(async (path, encoding) => {
      if (path.endsWith('/cpu.max')) {
        if (kind === 'pid') f.live.State.Pid = 456;
        if (kind === 'stopped') f.live.State.Running = false;
      }
      if (kind === 'membership' && path === '/proc/123/cgroup' && ++reads > 1)
        return `0::/another.slice/docker-${f.id}.scope/container`;
      return read(path, encoding);
    });
    await expect(
      controls.verifyKernelControls(f.engine, f.expected),
    ).rejects.toThrow();
  },
);

function coldFixture() {
  const f = setup();
  selectedEngine = f.engine;
  const image = 'sha256:' + 'b'.repeat(64);
  const runtime = {
    engineId: f.expected.engineId,
    runtimeName: 'alunza-crun',
    runtimeVersion: '1.31',
    runtimeSha256: 'c'.repeat(64),
    strategy: 'cold',
  };
  runtimeIdentity.mockResolvedValue(runtime);
  const inspection = {
    Id: f.id,
    Image: image,
    Config: {
      Tty: false,
      OpenStdin: true,
      StdinOnce: true,
      Labels: { 'org.alunza.runner': 'alunza-edu-laboratorio' },
    },
    HostConfig: {
      Runtime: runtime.runtimeName,
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
    State: f.live.State,
  };
  f.engine.request.mockImplementation(async (method, path) => {
    if (path === '/info') return { status: 200, data: f.info };
    if (method === 'POST' && path.startsWith('/containers/create?'))
      return { status: 201, data: { Id: f.id } };
    return { status: 200, data: inspection };
  });
  const dispatch = jest.fn();
  f.engine.startAttach = jest.fn(async (_name, options) => {
    await options.beforeSend?.();
    dispatch(options.input);
    inspection.State = { Running: false, ExitCode: 0, OOMKilled: false };
    return { stdout: '{}', exitCode: 0 };
  });
  const input = {
    executionId: randomUUID(),
    code: 'synthetic fixture, never executed',
    args: [],
    budgetMs: 3000,
    outputRemaining: 65536,
  };
  return { ...f, runtime, image, input, dispatch, inspection };
}

test.each([
  ['missing KILL', ['SETUID', 'SETGID', 'SETPCAP']],
  ['extra capability', ['SETUID', 'SETGID', 'SETPCAP', 'KILL', 'SYS_ADMIN']],
  ['duplicate KILL', ['SETUID', 'SETGID', 'SETPCAP', 'KILL', 'KILL']],
])(
  'cold rejects bridge capabilities with %s before starting student input',
  async (_name, capabilities) => {
    const f = coldFixture();
    f.inspection.HostConfig.CapAdd = capabilities;
    await expect(
      capsule.runCapsule(f.input, { image: f.image, runtime: f.runtime }),
    ).rejects.toThrow('resource configuration mismatch');
    expect(f.engine.startAttach).not.toHaveBeenCalled();
    expect(f.dispatch).not.toHaveBeenCalled();
    expect(removed).toHaveBeenCalledTimes(1);
  },
);

test('cold accepts exactly the bridge capabilities with Docker CAP_ prefixes', async () => {
  const f = coldFixture();
  f.inspection.HostConfig.CapAdd = [
    'CAP_KILL',
    'CAP_SETPCAP',
    'CAP_SETGID',
    'CAP_SETUID',
  ];
  await capsule.runCapsule(f.input, { image: f.image, runtime: f.runtime });
  expect(f.dispatch).toHaveBeenCalledTimes(1);
});

test.each(['host', 'container:' + 'd'.repeat(64), undefined])(
  'cold requires a private PID namespace and rejects PidMode %s',
  async (pidMode) => {
    const f = coldFixture();
    f.inspection.HostConfig.PidMode = pidMode;
    await expect(
      capsule.runCapsule(f.input, { image: f.image, runtime: f.runtime }),
    ).rejects.toThrow('resource configuration mismatch');
    expect(f.engine.startAttach).not.toHaveBeenCalled();
    expect(f.dispatch).not.toHaveBeenCalled();
    expect(removed).toHaveBeenCalledTimes(1);
  },
);

test('configured cold verifies the running boundary after authority and before its first stdin', async () => {
  const f = coldFixture();
  const authority = jest.fn(async () => {
    expect(readFile).not.toHaveBeenCalled();
    expect(f.dispatch).not.toHaveBeenCalled();
  });
  const result = await capsule.runCapsule(f.input, {
    image: f.image,
    runtime: f.runtime,
    beforeSend: authority,
  });
  expect(result.kernelBoundary).toBe('/sys/fs/cgroup/runner.slice');
  expect(authority).toHaveBeenCalledTimes(1);
  expect(f.dispatch).toHaveBeenCalledTimes(1);
  expect(removed).toHaveBeenCalledTimes(1);
});

test('a cold fallback cannot dispatch under another boundary after waiting for authority', async () => {
  const f = coldFixture();
  await expect(
    capsule.runCapsule(f.input, {
      image: f.image,
      runtime: f.runtime,
      expectedBoundary: '/sys/fs/cgroup/reserved.slice',
      beforeSend: async () => {},
    }),
  ).rejects.toThrow('boundary changed');
  expect(f.dispatch).not.toHaveBeenCalled();
  expect(removed).toHaveBeenCalledTimes(1);
});

test.each(['engine', 'memory'])(
  'cold rejects %s drift during the authority wait and retires its capsule',
  async (changed) => {
    const f = coldFixture();
    await expect(
      capsule.runCapsule(f.input, {
        image: f.image,
        runtime: f.runtime,
        beforeSend: async () => {
          if (changed === 'engine') f.info.ID = 'another-engine';
          else f.files['/sys/fs/cgroup/runner.slice/memory.max'] = 'max';
        },
      }),
    ).rejects.toThrow();
    expect(f.dispatch).not.toHaveBeenCalled();
    expect(removed).toHaveBeenCalledTimes(1);
  },
);

test('configured cold cannot use Windows proc to attest its Linux daemon', async () => {
  const f = coldFixture();
  hostPlatform.mockReturnValue('win32');
  await expect(
    capsule.runCapsule(f.input, { image: f.image, runtime: f.runtime }),
  ).rejects.toThrow('local Linux');
  expect(readFile).not.toHaveBeenCalled();
  expect(f.dispatch).not.toHaveBeenCalled();
  expect(removed).toHaveBeenCalledTimes(1);
});

test('a boundary cannot silently opt generic Docker into configured observations', async () => {
  const f = coldFixture();
  await expect(
    capsule.runCapsule(f.input, {
      image: f.image,
      expectedBoundary: '/sys/fs/cgroup/runner.slice',
    }),
  ).rejects.toThrow('configured Docker runtime');
  expect(f.engine.request).not.toHaveBeenCalled();
});

test('generic Docker does not attempt host kernel observation', async () => {
  const f = coldFixture();
  hostPlatform.mockReturnValue('win32');
  const result = await capsule.runCapsule(f.input, { image: f.image });
  expect(result).not.toHaveProperty('kernelBoundary');
  expect(runtimeIdentity).not.toHaveBeenCalled();
  expect(readFile).not.toHaveBeenCalled();
  expect(f.dispatch).toHaveBeenCalledTimes(1);
});
