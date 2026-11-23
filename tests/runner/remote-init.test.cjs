const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { SourceTextModule, SyntheticModule, createContext } = require('node:vm');

const source = readFileSync(
  resolve(__dirname, '../../infra/runner/remote-init.mjs'),
  'utf8',
);
const ready = {
  ServerVersion: '20.10.24',
  ServerErrors: [],
  OSType: 'linux',
  CgroupVersion: '2',
  MemoryLimit: true,
  SwapLimit: true,
  PidsLimit: true,
  CpuCfsPeriod: true,
  CpuCfsQuota: true,
};
const infoResponse = (value) => ({
  code: 0,
  stdout: JSON.stringify(value),
  stderr: '',
});
const clientOnly = infoResponse({
  ClientInfo: { Version: '20.10.24' },
  ServerErrors: [
    'Cannot connect to the Docker daemon at unix:///var/run/docker.sock',
  ],
});

function bootstrap({
  responses = [infoResponse(ready)],
  probeMs = 0,
  flag = '1',
  uid = 0,
} = {}) {
  let now = 0,
    next = 0;
  const daemon = { unref: jest.fn() };
  const spawn = jest.fn(() => daemon);
  const access = jest.fn(async () => {});
  const imageIdentity = jest.fn(async () => 'sha256:' + 'a'.repeat(64));
  const command = jest.fn(async (args, options) => {
    if (args[0] === 'info') {
      now += Math.min(probeMs, options.timeoutMs);
      return responses[Math.min(next++, responses.length - 1)];
    }
    expect(args).toEqual(['load', '--input', '/opt/alunza/capsule.tar']);
    return { code: 0, stdout: '', stderr: '' };
  });
  const sleep = jest.fn((callback, milliseconds) => {
    now += milliseconds;
    callback();
  });
  const log = jest.fn();
  const context = createContext({
    process: {
      env: { ALUNZA_SANDBOX_BOOTSTRAP: flag },
      getuid: () => uid,
      version: 'v24.21.0',
    },
    Date: { now: () => now },
    setTimeout: sleep,
    console: { log },
  });
  const dependencies = {
    'node:child_process': { spawn },
    'node:fs/promises': { access },
    './capsule.mjs': { command, imageIdentity },
  };
  const evaluate = async () => {
    const module = new SourceTextModule(source, { context });
    await module.link((specifier) => {
      if (!Object.hasOwn(dependencies, specifier))
        throw new Error('Unexpected bootstrap dependency');
      const bindings = dependencies[specifier];
      return new SyntheticModule(
        Object.keys(bindings),
        function () {
          for (const [name, value] of Object.entries(bindings))
            this.setExport(name, value);
        },
        { context },
      );
    });
    return module.evaluate();
  };
  return {
    evaluate,
    spawn,
    daemon,
    access,
    command,
    imageIdentity,
    log,
    sleep,
    elapsed: () => now,
  };
}

test('client-only zero exits and incomplete responses are retried before one daemon load', async () => {
  const execution = bootstrap({
    responses: [
      clientOnly,
      infoResponse({ ClientInfo: {} }),
      infoResponse({ ServerVersion: '  ', ServerErrors: [] }),
      { code: 0, stdout: '{incomplete', stderr: '' },
      infoResponse({ ...ready, ServerErrors: ['Daemon is starting'] }),
      infoResponse({ ...ready, ServerErrors: 'invalid-shape' }),
      { code: 1, stdout: '', stderr: 'Daemon unavailable' },
      infoResponse(ready),
    ],
  });
  await execution.evaluate();
  expect(execution.access).toHaveBeenCalledTimes(1);
  expect(execution.access).toHaveBeenCalledWith('/opt/alunza/capsule.tar');
  expect(execution.spawn).toHaveBeenCalledTimes(1);
  expect(execution.spawn).toHaveBeenCalledWith(
    '/usr/sbin/dockerd',
    [
      '--host=unix:///var/run/docker.sock',
      '--iptables=false',
      '--bridge=none',
      '--ip-forward=false',
      '--ip-masq=false',
      '--log-level=error',
    ],
    {
      detached: true,
      stdio: 'ignore',
      env: { PATH: '/usr/local/bin:/usr/bin:/usr/sbin:/bin:/sbin' },
    },
  );
  expect(execution.daemon.unref).toHaveBeenCalledTimes(1);
  const probes = execution.command.mock.calls.filter(
    ([args]) => args[0] === 'info',
  );
  expect(probes).toHaveLength(8);
  for (const [args, options] of probes) {
    expect(args).toEqual(['info', '--format', '{{json .}}']);
    expect(options).toEqual({ timeoutMs: 1000 });
  }
  expect(
    execution.command.mock.calls.filter(([args]) => args[0] === 'load'),
  ).toEqual([
    [['load', '--input', '/opt/alunza/capsule.tar'], { timeoutMs: 30000 }],
  ]);
  expect(execution.imageIdentity).toHaveBeenCalledTimes(1);
  expect(JSON.parse(execution.log.mock.calls[0][0])).toEqual({
    image: 'sha256:' + 'a'.repeat(64),
    node: 'v24.21.0',
    ready: true,
    cpuCfsPeriod: true,
    cpuCfsQuota: true,
  });
});

test('bootstrap records only boolean CPU capabilities and distinguishes an unknown value', async () => {
  const execution = bootstrap({
    responses: [
      infoResponse({ ...ready, CpuCfsPeriod: false, CpuCfsQuota: 'true' }),
    ],
  });
  await execution.evaluate();
  expect(JSON.parse(execution.log.mock.calls[0][0])).toMatchObject({
    cpuCfsPeriod: false,
    cpuCfsQuota: null,
  });
});

test.each([
  { name: 'omitted', ServerErrors: undefined },
  { name: 'null', ServerErrors: null },
  { name: 'empty list', ServerErrors: [] },
])('a real daemon accepts $name ServerErrors', async ({ ServerErrors }) => {
  const execution = bootstrap({
    responses: [infoResponse({ ...ready, ServerErrors })],
  });
  await execution.evaluate();
  expect(execution.command.mock.calls.map(([args]) => args[0])).toEqual([
    'info',
    'load',
  ]);
  expect(execution.sleep).not.toHaveBeenCalled();
});

test('client-only responses exhaust the 15-second window without loading a capsule', async () => {
  const execution = bootstrap({ responses: [clientOnly], probeMs: 999 });
  await expect(execution.evaluate()).rejects.toThrow(
    'Nested Docker unavailable',
  );
  expect(execution.elapsed()).toBe(15000);
  expect(execution.spawn).toHaveBeenCalledTimes(1);
  expect(
    execution.command.mock.calls.every(([args]) => args[0] === 'info'),
  ).toBe(true);
  expect(execution.command.mock.calls.at(-1)[1].timeoutMs).toBeLessThan(1000);
  expect(
    execution.sleep.mock.calls.every(([, timeout]) => timeout <= 200),
  ).toBe(true);
  expect(execution.imageIdentity).not.toHaveBeenCalled();
  expect(execution.log).not.toHaveBeenCalled();
});

test.each([
  { name: 'wrong OS', change: { OSType: 'windows' } },
  { name: 'cgroup v1', change: { CgroupVersion: '1' } },
  { name: 'missing memory controller', change: { MemoryLimit: false } },
  { name: 'missing swap controller', change: { SwapLimit: undefined } },
  { name: 'missing pids controller', change: { PidsLimit: false } },
  { name: 'nonboolean controller flag', change: { MemoryLimit: 'true' } },
])('a responding daemon with $name fails before load', async ({ change }) => {
  const execution = bootstrap({
    responses: [clientOnly, infoResponse({ ...ready, ...change })],
  });
  await expect(execution.evaluate()).rejects.toThrow(
    'Nested cgroup capability gap',
  );
  expect(execution.command.mock.calls.map(([args]) => args[0])).toEqual([
    'info',
    'info',
  ]);
  expect(execution.spawn).toHaveBeenCalledTimes(1);
  expect(execution.imageIdentity).not.toHaveBeenCalled();
  expect(execution.log).not.toHaveBeenCalled();
});

test.each([
  { flag: '', uid: 0 },
  { flag: '0', uid: 0 },
  { flag: '1', uid: 1000 },
])(
  'bootstrap rejects flag=$flag uid=$uid before touching the socket or archive',
  async (guard) => {
    const execution = bootstrap(guard);
    await expect(execution.evaluate()).rejects.toThrow(
      'Sandbox-only bootstrap',
    );
    expect(execution.access).not.toHaveBeenCalled();
    expect(execution.spawn).not.toHaveBeenCalled();
    expect(execution.command).not.toHaveBeenCalled();
  },
);
