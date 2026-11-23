let runtime;
beforeAll(async () => {
  runtime = await import('../../infra/runner/docker-runtime.mjs');
});
const config = {
  runtime: 'crun',
  runtimeName: 'alunza-crun',
  runtimeVersion: '1.31',
  runtimeSha256: 'a'.repeat(64),
  strategy: 'prepared-pair-v1',
};
const info = {
  ID: 'engine-fixture',
  OSType: 'linux',
  CgroupVersion: '2',
  CgroupDriver: 'systemd',
  Runtimes: { 'alunza-crun': { path: '/opt/alunza/crun' } },
};
const evidence = {
  path: '/opt/alunza/crun',
  sha256: 'a'.repeat(64),
  elf: true,
  exitCode: 0,
  versionLine: 'crun version 1.31',
};

test('configured runtime requires the pinned binary, actual version and systemd cgroup v2', () => {
  expect(runtime.validateDockerRuntimeEvidence(config, info, evidence)).toEqual(
    {
      engineId: 'engine-fixture',
      runtimeName: 'alunza-crun',
      runtimeVersion: '1.31',
      runtimeSha256: 'a'.repeat(64),
      strategy: 'prepared-pair-v1',
    },
  );
  for (const changed of [
    { ...evidence, sha256: 'b'.repeat(64) },
    { ...evidence, versionLine: 'crun version 1.14.1' },
    { ...evidence, versionLine: 'crun version 1.31-dev' },
    { ...evidence, elf: false },
    { ...evidence, exitCode: 1 },
    { ...evidence, path: '/other/crun' },
  ])
    expect(() =>
      runtime.validateDockerRuntimeEvidence(config, info, changed),
    ).toThrow();
  for (const changed of [
    { ...info, CgroupVersion: '1' },
    { ...info, CgroupDriver: 'cgroupfs' },
    { ...info, OSType: 'windows' },
    { ...info, ID: '' },
    { ...info, Runtimes: { 'alunza-crun': { path: 'crun' } } },
  ])
    expect(() =>
      runtime.validateDockerRuntimeEvidence(config, changed, evidence),
    ).toThrow();
});

test('configuration rejects unpinned versions, missing fields and runtime injection', () => {
  for (const changed of [
    { ...config, runtimeVersion: 'latest' },
    { ...config, runtimeVersion: '1.14.1' },
    { ...config, runtimeName: 'crun --privileged' },
    { ...config, runtimeSha256: 'abc' },
    { ...config, runtime: 'docker' },
    { ...config, strategy: 'reuse' },
    { ...config, runtimePath: '/tmp/crun' },
    { ...config, runtimeName: undefined },
  ])
    expect(() => runtime.validateDockerRuntimeConfig(changed)).toThrow();
  expect(
    runtime.validateDockerRuntimeConfig({
      ...config,
      runtime: 'runc',
      runtimeVersion: '1.3.4',
      strategy: 'cold',
    }).runtime,
  ).toBe('runc');
});

test('configured runtime availability never falls back or issues a mutation', async () => {
  const engine = {
    request: jest.fn(async () => ({
      status: 200,
      data: { ...info, Runtimes: {} },
    })),
  };
  await expect(
    runtime.inspectDockerRuntime(engine, config, AbortSignal.timeout(1000)),
  ).rejects.toThrow();
  expect(
    engine.request.mock.calls.every(
      ([method, path]) => method === 'GET' && path === '/info',
    ),
  ).toBe(true);
});
