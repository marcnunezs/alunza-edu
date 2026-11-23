const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const {
  validateRequest,
  verifyEnvelope,
  mountDockerStore,
} = require('../../infra/runner/linux-vm/guest.cjs');

function admission() {
  const id = '10000000-0000-4000-8000-000000000001';
  const inputJson = JSON.stringify({ executionId: id, code: 'DATA ONLY' });
  const image = `sha256:${'a'.repeat(64)}`;
  return {
    schemaVersion: 1,
    bootId: id,
    executionId: id,
    creationId: id,
    maxAdmissions: 1,
    ttlMs: 60000,
    createdAtEpochMs: 100000,
    normalDeadlineEpochMs: 130000,
    cleanupDeadlineEpochMs: 140000,
    sourceDigest: 'b'.repeat(64),
    bundleSha256: 'c'.repeat(64),
    bundleManifestSha256: 'd'.repeat(64),
    capsuleImageId: image,
    inputJson,
    inputSha256: createHash('sha256').update(inputJson).digest('hex'),
    context: {
      provider: 'local-vm',
      image,
      runnerVersion: 'imp-03-quickjs.13',
      hostId: id,
      kitManifestSha256: 'e'.repeat(64),
      brokerVersion: 'local-vm-broker-v1',
      guestSha256: 'f'.repeat(64),
      brokerGeneration: id,
    },
    runtime: {
      runtime: 'crun',
      runtimeVersion: '1.31',
      runtimeName: 'alunza-crun',
      runtimeSha256: 'a'.repeat(64),
      runtimePath: '/usr/local/bin/crun',
      strategy: 'cold',
    },
  };
}

test('local VM admission binds exact input bytes, version and single absolute lifetime', () => {
  const value = admission();
  assert.equal(validateRequest(value), value);
  for (const mutate of [
    (row) => {
      row.inputJson += ' ';
    },
    (row) => {
      row.maxAdmissions = 2;
    },
    (row) => {
      row.ttlMs = 60001;
    },
    (row) => {
      row.normalDeadlineEpochMs++;
    },
    (row) => {
      row.cleanupDeadlineEpochMs++;
    },
    (row) => {
      row.context.image = `sha256:${'b'.repeat(64)}`;
    },
    (row) => {
      row.context.runnerVersion = 'imp-03-quickjs.12';
    },
    (row) => {
      row.runtime.strategy = 'warm';
    },
    (row) => {
      row.runtime.runtimePath = '/usr/../bin/crun';
    },
    (row) => {
      row.limits = { runtimeMs: 6000 };
    },
    (row) => {
      row.context.credential = 'DO_NOT_PROPAGATE';
    },
  ]) {
    const changed = admission();
    mutate(changed);
    assert.throws(() => validateRequest(changed));
  }
});

test('guest transport preserves 1CPU/2GiB/swap0 and sole NVMe store', () => {
  const envelope = {
    cpuCount: 1,
    memoryMax: '2147483648',
    swapMax: '0',
    cpuMax: '100000 100000',
    selfGroup: '0::/alunzasingleexecutor.slice/alunza-single.service',
    cgroupVersion: '2',
    cgroupDriver: 'systemd',
  };
  verifyEnvelope(envelope);
  for (const changed of [
    { cpuCount: 2 },
    { memoryMax: '4294967296' },
    { swapMax: '1' },
    { cpuMax: '200000 100000' },
  ])
    assert.throws(() => verifyEnvelope({ ...envelope, ...changed }));
  const calls = [];
  mountDockerStore((...args) => calls.push(args));
  assert.deepEqual(calls, [
    [
      'mount',
      [
        '-t',
        'ext4',
        '-o',
        'nosuid,nodev',
        '/dev/nvme0n1',
        '/run/alunza-docker-store',
      ],
    ],
  ]);
});
