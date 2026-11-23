'use strict';
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const sha = /^[a-f0-9]{64}$/;
const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
function validateRequest(value) {
  assert.deepEqual(
    Object.keys(value).sort(),
    [
      'schemaVersion',
      'bootId',
      'executionId',
      'creationId',
      'context',
      'maxAdmissions',
      'ttlMs',
      'createdAtEpochMs',
      'normalDeadlineEpochMs',
      'cleanupDeadlineEpochMs',
      'inputJson',
      'inputSha256',
      'sourceDigest',
      'bundleSha256',
      'bundleManifestSha256',
      'capsuleImageId',
      'runtime',
    ].sort(),
  );
  assert.equal(value.schemaVersion, 1);
  assert.equal(value.maxAdmissions, 1);
  assert.equal(value.ttlMs, 60000);
  for (const field of ['bootId', 'executionId', 'creationId'])
    assert.match(value[field], uuid);
  assert.ok(Number.isSafeInteger(value.createdAtEpochMs));
  assert.equal(value.normalDeadlineEpochMs, value.createdAtEpochMs + 30000);
  assert.equal(value.cleanupDeadlineEpochMs, value.createdAtEpochMs + 40000);
  for (const field of [
    'sourceDigest',
    'bundleManifestSha256',
    'bundleSha256',
    'inputSha256',
  ])
    assert.match(value[field], sha);
  assert.match(value.capsuleImageId, /^sha256:[a-f0-9]{64}$/);
  assert.equal(value.context.provider, 'local-vm');
  assert.deepEqual(
    Object.keys(value.context).sort(),
    [
      'provider',
      'image',
      'runnerVersion',
      'hostId',
      'kitManifestSha256',
      'brokerVersion',
      'guestSha256',
      'brokerGeneration',
    ].sort(),
  );
  assert.equal(value.context.image, value.capsuleImageId);
  assert.equal(value.context.runnerVersion, 'imp-03-quickjs.13');
  assert.equal(value.context.brokerVersion, 'local-vm-broker-v1');
  for (const key of ['hostId', 'brokerGeneration'])
    assert.match(value.context[key], uuid);
  for (const key of ['kitManifestSha256', 'guestSha256'])
    assert.match(value.context[key], sha);
  assert.equal(typeof value.inputJson, 'string');
  assert.ok(Buffer.byteLength(value.inputJson) <= 1572864);
  assert.equal(
    createHash('sha256').update(value.inputJson).digest('hex'),
    value.inputSha256,
  );
  const input = JSON.parse(value.inputJson);
  assert.equal(input.executionId, value.executionId);
  const runtime = value.runtime;
  assert.deepEqual(
    Object.keys(runtime).sort(),
    [
      'runtime',
      'runtimeVersion',
      'runtimeSha256',
      'runtimeName',
      'runtimePath',
      'strategy',
    ].sort(),
  );
  assert.ok(['crun', 'runc'].includes(runtime.runtime));
  assert.equal(
    runtime.runtimeVersion,
    runtime.runtime === 'crun' ? '1.31' : '1.3.4',
  );
  assert.match(runtime.runtimeSha256, sha);
  assert.match(runtime.runtimeName, /^alunza-[a-z0-9-]{1,40}$/);
  assert.match(runtime.runtimePath, /^\/[A-Za-z0-9_./-]+$/);
  assert.ok(!runtime.runtimePath.split('/').includes('..'));
  assert.equal(runtime.strategy, 'cold');
  return value;
}
module.exports = { validateRequest };
