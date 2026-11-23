// Explicit TEST recovery gates. Importing this module has no external effects.
// The caller owns process-control.py orchestration; this module never signals a
// process, starts a service, extends a lease, or dispatches directly to a broker.
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import testState from '../laboratory-test-state.cjs';
import {
  canonicalHash,
  validateCandidate,
  validateHttpPayload,
  validateInspection,
} from './linux-vm-api.mjs';
import { createLinuxVmObserver } from './linux-vm-observer.mjs';

const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function gate(condition, code) {
  if (!condition) throw Object.assign(new Error(code), { gateCode: code });
}
function processIdentity(value) {
  gate(
    Number.isSafeInteger(value?.pid) &&
      value.pid > 1 &&
      /^\d+$/.test(value.start),
    'API_PROCESS_IDENTITY',
  );
  return { pid: value.pid, start: value.start };
}
export function assertPrePrepareRecord(record) {
  gate(
    UUID.test(record?.executionId) &&
      UUID.test(record.creationId) &&
      record.resourceId === null &&
      record.creationState === 'PREPARED' &&
      record.cleanupState === 'PENDING' &&
      record.cleanupProof === null &&
      record.dispatchedAt === null &&
      record.inputSha256 === null &&
      record.lifecycleStatus === 'RUNNING' &&
      record.attemptId === null &&
      record.stagedResult === null,
    'EXACT_PRE_PREPARE_STATE_REQUIRED',
  );
  return record;
}
export function assertNotStartedRecovery(before, after) {
  assertPrePrepareRecord(before);
  const proof = after?.cleanupProof;
  gate(
    after?.executionId === before.executionId &&
      after.creationId === before.creationId &&
      after.resourceId === null &&
      after.creationState === 'PREPARED' &&
      after.cleanupState === 'VERIFIED' &&
      after.lifecycleStatus === 'COMPLETED' &&
      UUID.test(after.attemptId) &&
      after.attemptCount === 1 &&
      after.privateResultCount === 1 &&
      after.submittedEvents === 1 &&
      after.completedEvents === 1 &&
      canonicalHash(after.context) === canonicalHash(before.context) &&
      after.stagedResult?.diagnosisCode === 'UNKNOWN' &&
      after.stagedResult?.infrastructureStatus === 'FAILED' &&
      proof?.kind === 'NOT_STARTED' &&
      proof.executionId === before.executionId &&
      proof.creationId === before.creationId &&
      proof.resourceId === null &&
      proof.hostId === before.context.hostId &&
      proof.brokerGeneration === before.context.brokerGeneration &&
      proof.qemuAbsent === true &&
      proof.overlaysAbsent === true &&
      Number.isFinite(Date.parse(proof.observedAt)),
    'NOT_STARTED_RECOVERY_MISMATCH',
  );
}

async function boundedPoll(read, accepted, timeoutMs, code, interval = 25) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    const result = await read();
    if (accepted(result)) return result;
    await sleep(interval);
  }
  gate(false, code);
}

async function readRecord(adminPool, target) {
  const result = await adminPool.query(
    `SELECT r.id AS "executionId",v.creation_id AS "creationId",
    v.provider_resource_id AS "resourceId",v.creation_state AS "creationState",v.cleanup_state AS "cleanupState",
    v.context,v.cleanup_proof AS "cleanupProof",v.dispatched_at AS "dispatchedAt",v.input_sha256 AS "inputSha256",
    r.lifecycle_status AS "lifecycleStatus",r.attempt_id AS "attemptId",r.staged_result AS "stagedResult",
    r.staged_private_results AS "stagedPrivate",r.response_body AS "responseBody",
    (SELECT count(*)::int FROM app.attempts a WHERE a.execution_id=r.id) AS "attemptCount",
    (SELECT count(*)::int FROM app_private.attempt_results a WHERE a.attempt_id=r.attempt_id) AS "privateResultCount",
    (SELECT count(*)::int FROM app_private.attempt_events a WHERE a.attempt_id=r.attempt_id AND event_type='ATTEMPT_SUBMITTED') AS "submittedEvents",
    (SELECT count(*)::int FROM app_private.attempt_events a WHERE a.attempt_id=r.attempt_id AND event_type='EXECUTION_COMPLETED') AS "completedEvents"
    FROM app_private.submission_reservations r JOIN app.operation_keys k ON k.id=r.operation_id
    JOIN app_private.local_vm_resources v ON v.execution_id=r.id
    WHERE k.actor_id=$1 AND k.organization_id=$2 AND k.operation='practice.submit' AND k.key=$3`,
    [target.actorId, target.organizationId, target.key],
  );
  gate(result.rows.length === 1, 'EXACT_OWNED_RESERVATION_REQUIRED');
  return result.rows[0];
}

async function armBeforePrepare(adminPool, target) {
  gate(
    UUID.test(target.actorId) && UUID.test(target.key),
    'FAULT_TARGET_IDENTITY',
  );
  const name = `vm_preprepare_fault_${randomUUID().replaceAll('-', '')}`;
  const bytes = randomBytes(8),
    lock = [
      bytes.readUInt32BE(0) & 0x7fffffff,
      bytes.readUInt32BE(4) & 0x7fffffff,
    ];
  const client = await adminPool.connect();
  let installed = false,
    released = false;
  try {
    await client.query('SELECT pg_advisory_lock($1::int,$2::int)', lock);
    await client.query('BEGIN');
    await client.query(`CREATE FUNCTION app_private.${name}() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
      BEGIN IF OLD.creation_state='PREPARED' AND NEW.creation_state='UNKNOWN' AND EXISTS(
       SELECT 1 FROM app.operation_keys k WHERE k.resource_id=NEW.execution_id AND k.actor_id='${target.actorId}'::uuid
        AND k.operation='practice.submit' AND k.key='${target.key}') THEN
       PERFORM pg_advisory_xact_lock(${lock[0]},${lock[1]}); END IF; RETURN NEW; END $$`);
    await client.query(
      `CREATE TRIGGER ${name} BEFORE UPDATE OF creation_state ON app_private.local_vm_resources FOR EACH ROW EXECUTE FUNCTION app_private.${name}()`,
    );
    await client.query('COMMIT');
    installed = true;
  } catch (error) {
    await client.query('ROLLBACK');
    await client.query('SELECT pg_advisory_unlock($1::int,$2::int)', lock);
    client.release();
    throw error;
  }
  return {
    async blockedBackend() {
      const rows = (
        await adminPool.query(
          `SELECT l.pid FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid
        WHERE l.locktype='advisory' AND l.classid=$1::oid AND l.objid=$2::oid AND l.objsubid=2
         AND NOT l.granted AND a.usename='alunza_app'`,
          lock,
        )
      ).rows;
      gate(rows.length <= 1, 'MULTIPLE_FAULT_BACKENDS');
      return rows[0]?.pid ?? null;
    },
    async restore() {
      if (released) {
        gate(!installed, 'FAULT_REMOVAL_UNCONFIRMED');
        return;
      }
      try {
        await client.query('SELECT pg_advisory_unlock($1::int,$2::int)', lock);
        if (installed) {
          await client.query('BEGIN');
          await client.query(
            `DROP TRIGGER ${name} ON app_private.local_vm_resources`,
          );
          await client.query(`DROP FUNCTION app_private.${name}()`);
          await client.query('COMMIT');
          installed = false;
        }
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        released = true;
        client.release();
      }
    },
  };
}

/** controls are caller-owned identity-checked process-control.py operations:
 * inspectEnabledExclusive(), crash(identity), retired(identity),
 * startDisabled(), inspectDisabledExclusive(). Inspection must also prove the
 * OTHER API replica stopped; disabled admissions do not disable reconcilers.
 * Each inspect/start returns {pid,start}; retired returns true only if absent.
 * Run only after all latency traffic stops. The function does NOT close shared
 * fixture activities, pools, or services. It leaves API admissions disabled.
 */
export async function runLinuxVmCapacityRecovery({
  state,
  adminPool,
  applicationPool,
  candidate,
  socketPath,
  actors,
  origin = 'http://127.0.0.1:4300',
  gateKind,
  outputDirectory,
  controls,
}) {
  testState.assertLaboratoryTestState(state);
  validateCandidate(candidate);
  gate(
    process.platform === 'linux' &&
      ['pre-prepare', 'staged'].includes(gateKind) &&
      ['http://127.0.0.1:4300', 'http://127.0.0.1:4301'].includes(origin) &&
      actors.length === 8,
    'EXPLICIT_LINUX_TEST_GATE_REQUIRED',
  );
  await mkdir(outputDirectory, { mode: 0o700 }); // fresh path; never overwrites a previous receipt
  const actor = actors[0],
    fixture = actor.fixtures.SUBMIT;
  const target = {
    actorId: actor.id,
    organizationId: actor.organizationId,
    mode: 'SUBMIT',
    key: randomUUID(),
  };
  const code =
    gateKind === 'staged'
      ? 'module.exports.solve=()=>{while(true){}};'
      : fixture.successCode;
  const report = {
    schemaVersion: 1,
    gateKind,
    pass: false,
    excludedFromLatency: true,
    candidate,
    target,
    checks: {},
    requests: [],
    failure: null,
  };
  let restore, requestPending;
  const post = async (key, status, expectedError) => {
    const row = {
      key,
      expectedStatus: status,
      status: null,
      responseComplete: false,
      transportAborted: false,
      dataSha256: null,
    };
    report.requests.push(row);
    try {
      const response = await fetch(
        `${origin}/api/v1/activities/${fixture.activityId}/exercises/${fixture.assignmentId}/attempts`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${actor.token}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': key,
          },
          body: JSON.stringify({
            code,
            exerciseVersionId: fixture.exerciseVersionId,
          }),
          redirect: 'manual',
          signal: AbortSignal.timeout(45000),
        },
      );
      row.status = response.status;
      let bytes = 0;
      const chunks = [];
      for await (const chunk of response.body) {
        bytes += chunk.length;
        gate(bytes <= 524288, 'HTTP_RESPONSE_LIMIT');
        chunks.push(chunk);
      }
      row.responseComplete = true;
      const checked = validateHttpPayload(
        JSON.parse(Buffer.concat(chunks).toString('utf8')),
        {
          actor,
          fixture,
          mode: 'SUBMIT',
          code,
          expectedStatus: status,
          status: response.status,
          expectedError,
          expectedDiagnosis: gateKind === 'staged' ? 'TIMEOUT' : 'UNKNOWN',
          expectedInfrastructure: gateKind === 'staged' ? 'OK' : 'FAILED',
        },
      );
      gate(
        checked.failures.length === 0 &&
          response.headers.get('cache-control')?.includes('no-store'),
        'HTTP_EXPECTATION_FAILED',
      );
      row.dataSha256 = checked.data ? canonicalHash(checked.data) : null;
      return checked.data;
    } catch (error) {
      row.transportAborted = !row.responseComplete;
      throw error;
    }
  };
  try {
    const originalApi = processIdentity(
      await controls.inspectEnabledExclusive(),
    );
    report.originalApi = originalApi;
    const observer = await createLinuxVmObserver({
      state,
      adminPool,
      applicationPool,
      actors,
      candidate,
      socketPath,
    });
    const before = validateInspection(await observer.inspect(), candidate);
    report.before = before;
    let pending;
    if (gateKind === 'pre-prepare') {
      const fault = await armBeforePrepare(adminPool, target);
      restore = () => fault.restore();
      requestPending = post(target.key, null).then(
        () => ({ returned: true }),
        () => ({ returned: false }),
      );
      const backend = await boundedPoll(
        () => fault.blockedBackend(),
        Number.isSafeInteger,
        1500,
        'PRE_PREPARE_BARRIER_NOT_OBSERVED',
        10,
      );
      pending = assertPrePrepareRecord(await readRecord(adminPool, target));
      await controls.crash(originalApi);
      gate(await controls.retired(originalApi), 'ORIGINAL_API_STILL_LIVE');
      // Do not release a blocked PG query merely because its HTTP process died.
      // Let the existing 2s statement timeout/disconnection roll its transaction
      // back, then prove that exact backend absent before opening the barrier.
      await boundedPoll(
        async () =>
          (
            await adminPool.query(
              'SELECT 1 FROM pg_stat_activity WHERE pid=$1',
              [backend],
            )
          ).rowCount,
        (count) => count === 0,
        6000,
        'OWNED_DATABASE_BACKEND_STILL_ACTIVE',
      );
      await restore();
      restore = undefined;
      gate(
        (await requestPending).returned === false &&
          report.requests[0].transportAborted === true &&
          report.requests[0].responseComplete === false,
        'INTERRUPTED_REQUEST_RETURNED',
      );
      assertPrePrepareRecord(await readRecord(adminPool, target));
      report.checks.committedPendingWithoutDispatch = true;
    } else {
      const fault = await observer.faults.armCommitFault(target);
      restore = () => fault.restore();
      await post(target.key, 503, 'PERSISTENCE_UNAVAILABLE');
      await restore();
      restore = undefined;
      pending = await readRecord(adminPool, target);
      gate(
        pending.lifecycleStatus === 'RUNNING' &&
          pending.attemptId === null &&
          pending.stagedResult?.diagnosisCode === 'TIMEOUT' &&
          pending.stagedResult?.infrastructureStatus === 'OK' &&
          pending.stagedResult.runtimeMs <= 3000 &&
          pending.cleanupState === 'VERIFIED' &&
          pending.cleanupProof?.kind === 'RETIRED' &&
          UUID.test(pending.resourceId),
        'STAGED_TIMEOUT_REQUIRED',
      );
      await controls.crash(originalApi);
      gate(await controls.retired(originalApi), 'ORIGINAL_API_STILL_LIVE');
    }
    report.executionId = pending.executionId;
    report.creationId = pending.creationId;
    report.resourceId = pending.resourceId;
    const currentApi = processIdentity(await controls.startDisabled());
    gate(
      currentApi.pid !== originalApi.pid ||
        currentApi.start !== originalApi.start,
      'API_NOT_RESTARTED',
    );
    gate(
      canonicalHash(
        processIdentity(await controls.inspectDisabledExclusive()),
      ) === canonicalHash(currentApi),
      'RESTARTED_API_CHANGED',
    );
    report.currentApi = currentApi;
    await observer.faults.reconcile(target); // only this TEST lease is shortened, never extended
    const completed = await boundedPoll(
      () => readRecord(adminPool, target),
      (record) => record.lifecycleStatus === 'COMPLETED',
      45000,
      'RECOVERY_NOT_COMPLETED',
      250,
    );
    if (gateKind === 'pre-prepare')
      assertNotStartedRecovery(pending, completed);
    else
      gate(
        completed.executionId === pending.executionId &&
          completed.creationId === pending.creationId &&
          completed.resourceId === pending.resourceId &&
          completed.attemptCount === 1 &&
          completed.privateResultCount === 1 &&
          completed.submittedEvents === 1 &&
          completed.completedEvents === 1 &&
          canonicalHash(completed.stagedResult) ===
            canonicalHash(pending.stagedResult) &&
          canonicalHash(completed.stagedPrivate) ===
            canonicalHash(pending.stagedPrivate) &&
          canonicalHash(completed.cleanupProof) ===
            canonicalHash(pending.cleanupProof),
        'STAGED_RECOVERY_CHANGED',
      );
    const first = await post(target.key, 201),
      second = await post(target.key, 201);
    gate(
      first.executionId === pending.executionId &&
        first.attemptId === completed.attemptId &&
        canonicalHash(first) === canonicalHash(second) &&
        canonicalHash(first) === canonicalHash(completed.responseBody),
      'REPLAY_CHANGED',
    );
    const newKey = randomUUID();
    await post(newKey, 503, 'DEPENDENCY_UNAVAILABLE');
    gate(
      (await observer.observe({ ...target, key: newKey })).executionId === null,
      'DISABLED_REQUEST_ADMITTED',
    );
    const after = validateInspection(await observer.inspect(), candidate);
    const delta = gateKind === 'staged' ? 1 : 0;
    gate(
      after.vmCreationsTotal === before.vmCreationsTotal + delta &&
        after.creationRecordsTotal === before.creationRecordsTotal + 1,
      'UNEXPECTED_VM_OR_RESOURCE',
    );
    report.after = after;
    report.cleanupProof = completed.cleanupProof;
    report.technicalResultSha256 = canonicalHash(completed.stagedResult);
    report.privateResultSha256 = canonicalHash(completed.stagedPrivate);
    report.responseDataSha256 = canonicalHash(first);
    report.checks = {
      ...report.checks,
      originalApiRetired: true,
      newApiAdmissionsDisabled: true,
      exactlyOneAttempt: true,
      onePrivateResultAndTwoEvents: true,
      twoIdenticalReplays: true,
      newKeyRejected: true,
      expectedVmCreations: delta,
      cleanupVerified: true,
    };
    report.pass = true;
  } catch (error) {
    report.failure =
      typeof error?.gateCode === 'string'
        ? error.gateCode
        : 'RECOVERY_GATE_FAILED';
  } finally {
    if (restore) {
      try {
        await restore();
      } catch {
        report.pass = false;
        report.failure = 'FAULT_REMOVAL_UNCONFIRMED';
      }
    }
    if (requestPending) await requestPending;
    await writeFile(
      `${outputDirectory}/receipt.json`,
      JSON.stringify(report, null, 2) + '\n',
      { flag: 'wx', mode: 0o600 },
    );
  }
  return report;
}
