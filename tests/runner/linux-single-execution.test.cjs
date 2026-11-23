const { execFileSync } = require('node:child_process');
const { randomUUID, createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  validateRequest,
  fixedInput,
  verifyEnvelope,
  verifyExtractedBundle,
  publicResult,
  mountDockerStore,
} = require('./linux-single-execution/guest.cjs');

function admission(mode = 'SUBMIT', caseCount = 8) {
  return {
    schemaVersion: 1,
    bootId: randomUUID(),
    executionId: randomUUID(),
    mode,
    caseCount,
    fixture: 'sum-fixed-v1',
    maxAdmissions: 1,
    createdAtEpochMs: 100000,
    normalDeadlineEpochMs: 130000,
    cleanupDeadlineEpochMs: 140000,
    ttlMs: 60000,
    sourceDigest: 'a'.repeat(64),
    bundleManifestSha256: 'b'.repeat(64),
    bundleSha256: 'c'.repeat(64),
    capsuleImageId: `sha256:${'d'.repeat(64)}`,
    runtime: {
      runtime: 'crun',
      runtimeVersion: '1.31',
      runtimeSha256: 'e'.repeat(64),
      runtimeName: 'alunza-crun',
      runtimePath: '/usr/local/bin/crun',
      strategy: 'cold',
    },
  };
}

test.each([
  ['RUN', 1],
  ['RUN', 2],
  ['RUN', 8],
  ['SUBMIT', 2],
  ['SUBMIT', 8],
])(
  'one %s admission supports %i fresh cases without arbitrary input',
  (mode, count) => {
    const input = fixedInput(admission(mode, count));
    expect(input.mode).toBe(mode);
    expect(input.tests).toHaveLength(count);
    expect(input.tests[0].visibility).toBe('visible');
    expect(
      input.tests.every((item, index) => item.expected.sum === index + 4),
    ).toBe(true);
    expect(
      input.tests
        .slice(1)
        .every(
          (item) =>
            item.visibility === (mode === 'SUBMIT' ? 'hidden' : 'visible'),
        ),
    ).toBe(true);
    expect(input.code).toBe('module.exports.solve=(a,b)=>({sum:a+b});');
  },
);

test.each([
  { maxAdmissions: 2 },
  { ttlMs: 60001 },
  { normalDeadlineEpochMs: 130001 },
  { cleanupDeadlineEpochMs: 140001 },
  { caseCount: 50 },
  { mode: 'SUBMIT', caseCount: 1 },
  { fixture: 'caller-supplied-code' },
])('rejects changed admission/clock contract %j', (changes) => {
  expect(() => validateRequest({ ...admission(), ...changes })).toThrow();
});

const envelope = () => ({
  cpuCount: 1,
  memoryMax: '2147483648',
  swapMax: '0',
  cpuMax: '100000 100000',
  selfGroup: '0::/alunzasingleexecutor.slice/alunza-single.service',
  cgroupVersion: '2',
  cgroupDriver: 'systemd',
});

test('accepts observed shared envelope and rejects missing or weaker limits', () => {
  expect(() => verifyEnvelope(envelope())).not.toThrow();
  for (const change of [
    { cpuCount: 2 },
    { memoryMax: 'max' },
    { memoryMax: '4294967296' },
    { swapMax: 'max' },
    { cpuMax: '200000 100000' },
    { selfGroup: '0::/system.slice/other.service' },
    { cgroupDriver: 'cgroupfs' },
  ])
    expect(() => verifyEnvelope({ ...envelope(), ...change })).toThrow();
});

function resultFixture(request) {
  return {
    diagnosisCode: 'SUCCESS',
    terminationReason: 'COMPLETED',
    infrastructureStatus: 'OK',
    allRequiredPassed: true,
    runtimeMs: 2,
    outputBytes: 0,
    outputTruncated: false,
    visibleTestResults: [{}],
    privateTestResults: Array.from({ length: 7 }, () => ({
      expected: 'DO_NOT_EXPOSE',
    })),
    stdout: 'DO_NOT_EXPOSE',
    evidence: {
      image: request.capsuleImageId,
      cleanupVerified: true,
      timings: Array.from({ length: 8 }, (_, index) => ({
        hostStartAttachMs: 20,
        containerWallMs: 15,
        supervisorProcessMs: 0.25,
        budgetMs: 3000 - index * 0.25,
        caseCost: null,
      })),
      cgroups: Array.from({ length: 8 }, () => ({
        'memory.max': '134217728',
        'memory.swap.max': '0',
        'pids.max': '32',
        'cpu.max': '100000 100000',
      })),
    },
  };
}

test('sanitized result excludes code, expected values, stdout and private results', () => {
  const request = admission();
  const result = resultFixture(request);
  const value = publicResult(
    result,
    [
      {
        phase: 'start',
        durationMs: 1,
        completed: true,
        private: 'DO_NOT_EXPOSE',
      },
    ],
    request,
    4,
  );
  expect(value.ok).toBe(true);
  expect(JSON.stringify(value)).not.toContain('DO_NOT_EXPOSE');
  expect(value.admissions).toBe(1);
  expect(value.caseTimings).toHaveLength(8);
  expect(value.limits).toEqual({
    vcpus: 1,
    envelopeMemoryBytes: 2147483648,
    studentMemoryBytes: 134217728,
    swapBytes: 0,
    runtimeMs: 3000,
    outputBytes: 65536,
  });
  result.evidence.cgroups.pop();
  expect(publicResult(result, [], request, 4).ok).toBe(false);
});

test.each([
  { runtimeMs: 3000 },
  { runtimeMs: 3001 },
  { outputBytes: 65537 },
  { outputTruncated: true },
  { diagnosisCode: 'TIMEOUT', terminationReason: 'EXECUTION_DEADLINE' },
  { diagnosisCode: 'UNKNOWN', terminationReason: 'OUTPUT_LIMIT' },
  { diagnosisCode: 'UNKNOWN', terminationReason: 'MEMORY_LIMIT' },
  { diagnosisCode: 'UNKNOWN', terminationReason: 'CAPABILITY_GAP' },
  { infrastructureStatus: 'FAILED' },
])(
  'does not certify limits or native execution from a failed fixture %j',
  (change) => {
    const request = admission();
    expect(
      publicResult({ ...resultFixture(request), ...change }, [], request, 4).ok,
    ).toBe(false);
  },
);

test('optional per-case profiling is sanitized and cannot decide success', () => {
  const request = admission();
  const result = resultFixture(request);
  result.evidence.timings[0].caseCost = {
    version: 1,
    workerClock: 'PERFORMANCE_NOW',
    workerOrigin: 'NODE_PERFORMANCE_TIME_ORIGIN',
    bridgeOrigin: 'BRIDGE_INPUT_PARSED',
    status: 'COMPLETE',
    phases: [
      { phase: 'entry', atMs: 1, secret: 'DO_NOT_EXPOSE' },
      { phase: 'workerExit', atMs: 5 },
    ],
    receivedFirstMs: 3,
    receivedLastMs: 8,
    launchRequestedMs: 0.5,
    closeObservedMs: 10,
    secret: 'DO_NOT_EXPOSE',
  };
  const value = publicResult(result, [], request, 4);
  expect(value.ok).toBe(true);
  expect(value.caseTimings[0].caseCost.status).toBe('COMPLETE');
  expect(JSON.stringify(value)).not.toContain('DO_NOT_EXPOSE');
  result.evidence.timings[0].caseCost.phases.push({
    phase: 'student-controlled',
    atMs: 6,
  });
  const invalid = publicResult(result, [], request, 4);
  expect(invalid.caseTimings[0].caseCost).toEqual({ status: 'INVALID' });
  expect(invalid.ok).toBe(true);
});

test('success cannot reset the shared budget for eight individually short cases', () => {
  const request = admission();
  const result = resultFixture(request);
  expect(publicResult(result, [], request, 4).ok).toBe(true);
  result.evidence.timings.forEach((row) => {
    row.budgetMs = 3000;
  });
  expect(publicResult(result, [], request, 4).ok).toBe(false);
});

test('extracted bundle must match every hashed regular file exactly', () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'alunza-guest-bundle-test-'),
  );
  try {
    const content = 'export const fixed = true;\n';
    fs.writeFileSync(path.join(directory, 'index.js'), content);
    const manifest = {
      schemaVersion: 1,
      scope: 'LOCAL_DOCKER_COLD_ONLY',
      inventory: [
        {
          path: 'index.js',
          bytes: Buffer.byteLength(content),
          sha256: createHash('sha256').update(content).digest('hex'),
        },
      ],
    };
    expect(() => verifyExtractedBundle(manifest, directory)).not.toThrow();
    fs.writeFileSync(path.join(directory, 'extra.js'), 'extra');
    expect(() => verifyExtractedBundle(manifest, directory)).toThrow();
    fs.unlinkSync(path.join(directory, 'extra.js'));
    fs.writeFileSync(path.join(directory, 'index.js'), 'altered');
    expect(() => verifyExtractedBundle(manifest, directory)).toThrow();
  } finally {
    const absolute = fs.realpathSync(directory);
    expect(path.dirname(absolute)).toBe(fs.realpathSync(os.tmpdir()));
    expect(path.basename(absolute)).toMatch(/^alunza-guest-bundle-test-/);
    fs.rmSync(absolute, { recursive: true });
  }
});

test('root and Docker store use distinct single-disk families before any guest boot', () => {
  const launcher = path.join(__dirname, 'linux-single-execution/launch.py');
  const args = JSON.parse(
    execFileSync(
      process.platform === 'win32' ? 'python' : 'python3',
      [
        '-B',
        '-c',
        [
          'import importlib.util, json, sys',
          'from pathlib import Path',
          'spec = importlib.util.spec_from_file_location("storage_layout", sys.argv[1])',
          'module = importlib.util.module_from_spec(spec)',
          'spec.loader.exec_module(module)',
          'print(json.dumps(module.vm_args(Path("/supplied-kit"), "00000000-0000-4000-8000-000000000001")))',
        ].join('\n'),
        launcher,
      ],
      {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 5000,
        maxBuffer: 65536,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    ),
  );
  const values = (flag) =>
    args.flatMap((value, index) => (value === flag ? [args[index + 1]] : []));
  const devices = values('-device').map((value) => {
    const [driver, ...properties] = value.split(',');
    return {
      driver,
      ...Object.fromEntries(properties.map((entry) => entry.split('='))),
    };
  });
  expect(devices).toHaveLength(3);
  expect(
    devices.filter((device) => device.driver === 'virtio-blk-pci'),
  ).toEqual([
    { driver: 'virtio-blk-pci', drive: 'osdisk', serial: 'ALUNZAROOT' },
  ]);
  expect(devices.filter((device) => device.driver === 'nvme')).toEqual([
    { driver: 'nvme', id: 'ctrl', serial: 'ALUNZASINGLE' },
  ]);
  expect(devices.filter((device) => device.driver === 'nvme-ns')).toEqual([
    { driver: 'nvme-ns', bus: 'ctrl', drive: 'store', nsid: '1' },
  ]);
  expect(values('-drive')).toEqual([
    'if=none,id=osdisk,file=os.qcow2,format=qcow2',
    'if=none,id=store,file=store.qcow2,format=qcow2',
  ]);
  const root = values('-append')[0]
    .split(' ')
    .find((value) => value.startsWith('root='))
    .slice('root='.length);
  expect(root).toBe('/dev/vda');
  const cli = jest.fn();
  mountDockerStore(cli);
  expect(cli).toHaveBeenCalledTimes(1);
  expect(cli).toHaveBeenCalledWith('mount', [
    '-t',
    'ext4',
    '-o',
    'nosuid,nodev',
    '/dev/nvme0n1',
    '/run/alunza-docker-store',
  ]);
  expect(cli.mock.calls[0][1][4]).not.toBe(root);
  expect(args).not.toContain('-initrd');
  expect(values('-nic')).toEqual(['none']);
});

test('a rejected store mount propagates before Docker can start', () => {
  const cli = jest.fn(() => {
    throw new Error('STORE_MOUNT_FAILED');
  });
  expect(() => mountDockerStore(cli)).toThrow('STORE_MOUNT_FAILED');
  expect(cli).toHaveBeenCalledTimes(1);
});

test('Python launcher rejects unsafe protocols and retires mocked resources offline', () => {
  const output = execFileSync(
    process.platform === 'win32' ? 'python' : 'python3',
    ['-B', path.join(__dirname, 'linux-single-execution/test_launch.py')],
    {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30000,
      maxBuffer: 1048576,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  expect(output).not.toContain('measured');
});
