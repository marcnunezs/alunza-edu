let inspectDoctor;
beforeAll(async () => {
  ({ inspectDoctor } = await import('../../scripts/runner-doctor.mjs'));
});
const daemon = () => ({
  code: 0,
  stdout: JSON.stringify({
    OSType: 'linux',
    CgroupVersion: '2',
    MemoryLimit: true,
    SwapLimit: true,
    PidsLimit: true,
    ServerVersion: 'fixture',
  }),
});
const response = () => ({
  packet: {
    status: 'exited',
    exitCode: 0,
    cgroup: {
      'memory.max': '134217728',
      'memory.swap.max': '0',
      'pids.max': '32',
      'cpu.max': '100000 100000',
    },
    returnData: Buffer.from(
      JSON.stringify({
        kind: 'probe',
        value: {
          node: 'v24.21.0',
          uid: 10001,
          capabilities: {
            CapInh: '0000000000000000',
            CapPrm: '0000000000000000',
            CapEff: '0000000000000000',
            CapBnd: '0000000000000000',
            CapAmb: '0000000000000000',
          },
        },
      }),
    ).toString('base64'),
  },
  exitCode: 0,
  oomKilled: false,
  timedOut: false,
  cancelled: false,
  cleanupVerified: true,
  programWallMs: 100,
});
const check = (value) =>
  inspectDoctor({
    docker: async () => daemon(),
    identify: async () => 'sha256:' + 'a'.repeat(64),
    capsule: async () => value,
  });
test('declared daemon capabilities alone never establish an effective doctor pass', async () => {
  expect(await check({ packet: null, cleanupVerified: true })).toMatchObject({
    status: 'FAIL',
    cleanupVerified: true,
  });
});
test('doctor rejects a different effective memory limit and an unobserved cleanup', async () => {
  const mismatch = response();
  mismatch.packet.cgroup['memory.max'] = 'max';
  expect((await check(mismatch)).status).toBe('FAIL');
  const leaked = response();
  leaked.cleanupVerified = false;
  expect(await check(leaked)).toMatchObject({
    status: 'FAIL',
    cleanupVerified: false,
  });
});
test('doctor accepts measured limits and student identity from the real capsule contract', async () => {
  expect(await check(response())).toMatchObject({
    status: 'PASS',
    effective: { 'memory.max': '134217728', 'pids.max': '32' },
    student: { uid: 10001 },
    cleanupVerified: true,
    remoteCalls: 0,
  });
});
