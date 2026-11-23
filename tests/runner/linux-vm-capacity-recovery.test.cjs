const assert = require('node:assert/strict');
const { test } = require('node:test');

const modulePromise = import('../integration/linux-vm-capacity-recovery.mjs');
const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function pending() {
  return {
    executionId: id(1),
    creationId: id(2),
    resourceId: null,
    creationState: 'PREPARED',
    cleanupState: 'PENDING',
    cleanupProof: null,
    dispatchedAt: null,
    inputSha256: null,
    lifecycleStatus: 'RUNNING',
    attemptId: null,
    stagedResult: null,
    context: { hostId: id(3), brokerGeneration: id(4) },
  };
}
function completed() {
  const value = pending();
  return {
    ...value,
    cleanupState: 'VERIFIED',
    lifecycleStatus: 'COMPLETED',
    attemptId: id(5),
    attemptCount: 1,
    privateResultCount: 1,
    submittedEvents: 1,
    completedEvents: 1,
    stagedResult: { diagnosisCode: 'UNKNOWN', infrastructureStatus: 'FAILED' },
    cleanupProof: {
      kind: 'NOT_STARTED',
      executionId: value.executionId,
      creationId: value.creationId,
      resourceId: null,
      hostId: value.context.hostId,
      brokerGeneration: value.context.brokerGeneration,
      qemuAbsent: true,
      overlaysAbsent: true,
      observedAt: '2026-11-18T00:00:00Z',
    },
  };
}
test('pre-prepare evidence rejects dispatch, staging or a provider resource', async () => {
  const { assertPrePrepareRecord } = await modulePromise;
  assert.equal(assertPrePrepareRecord(pending()).creationState, 'PREPARED');
  for (const patch of [
    { resourceId: id(6) },
    { creationState: 'UNKNOWN' },
    { dispatchedAt: '2026-11-18T00:00:00Z' },
    { inputSha256: 'a'.repeat(64) },
    { stagedResult: {} },
    { cleanupState: 'VERIFIED' },
    { attemptId: id(7) },
  ])
    assert.throws(
      () => assertPrePrepareRecord({ ...pending(), ...patch }),
      /EXACT_PRE_PREPARE_STATE_REQUIRED/,
    );
});
test('only a correlated NOT_STARTED proof plus one durable attempt passes', async () => {
  const { assertNotStartedRecovery } = await modulePromise;
  assert.doesNotThrow(() => assertNotStartedRecovery(pending(), completed()));
  for (const patch of [
    { attemptCount: 2 },
    { privateResultCount: 0 },
    { submittedEvents: 0 },
    { completedEvents: 2 },
    { creationId: id(7) },
    { resourceId: id(8) },
    { context: { ...pending().context, brokerGeneration: id(9) } },
    { stagedResult: { diagnosisCode: 'SUCCESS', infrastructureStatus: 'OK' } },
  ])
    assert.throws(
      () => assertNotStartedRecovery(pending(), { ...completed(), ...patch }),
      /NOT_STARTED_RECOVERY_MISMATCH/,
    );
  for (const patch of [
    { kind: 'RETIRED' },
    { executionId: id(8) },
    { creationId: id(9) },
    { resourceId: id(7) },
    { hostId: id(8) },
    { brokerGeneration: id(9) },
    { qemuAbsent: false },
    { overlaysAbsent: false },
    { observedAt: 'unknown' },
  ]) {
    const value = completed();
    value.cleanupProof = { ...value.cleanupProof, ...patch };
    assert.throws(
      () => assertNotStartedRecovery(pending(), value),
      /NOT_STARTED_RECOVERY_MISMATCH/,
    );
  }
});
