// TEST-only SQL fault/observation helpers. Import has no external effects.
import { request } from 'node:http';
import { lstat, realpath } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import testState from '../laboratory-test-state.cjs';
import {
  canonicalHash,
  validateCandidate,
  validateObservation,
} from './linux-vm-api.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const assert = (value, message) => {
  if (!value) throw new Error(message);
};
const empty = () => ({
  executionId: null,
  attemptId: null,
  completed: false,
  resultDurable: false,
  attemptCount: 0,
  technicalResultSha256: null,
  codeSha256: null,
  testsVersion: null,
  visibleTestCount: 0,
  hiddenTestCount: 0,
  privateTestCount: 0,
  vmCreations: [],
});

/** Only POST /snapshot {} is allowed here. It cannot prepare/start/retire a VM. */
export async function readLinuxVmSnapshot(socketPath) {
  assert(
    process.platform === 'linux' &&
      typeof socketPath === 'string' &&
      socketPath.startsWith('/') &&
      socketPath.length <= 103,
    'Linux private broker socket required.',
  );
  const [socket, parent, resolved] = await Promise.all([
    lstat(socketPath),
    lstat(dirname(socketPath)),
    realpath(socketPath),
  ]);
  assert(
    socket.isSocket() &&
      parent.isDirectory() &&
      !parent.isSymbolicLink() &&
      resolved === socketPath &&
      socket.uid === process.getuid() &&
      parent.uid === process.getuid() &&
      (socket.mode & 0o077) === 0 &&
      (parent.mode & 0o077) === 0,
    'Broker socket identity rejected.',
  );
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };
    const req = request(
      {
        socketPath,
        path: '/snapshot',
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': 2 },
      },
      (res) => {
        let bytes = 0;
        const chunks = [];
        res.on('data', (chunk) => {
          bytes += chunk.length;
          if (bytes > 1048576)
            req.destroy(new Error('Broker metadata exceeds limit.'));
          else chunks.push(chunk);
        });
        res.on('error', () =>
          finish(new Error('Broker metadata transport failed.')),
        );
        res.on('end', () => {
          if (res.statusCode !== 200)
            return finish(new Error('Broker snapshot rejected.'));
          try {
            finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch {
            finish(new Error('Broker snapshot invalid.'));
          }
        });
      },
    );
    const timer = setTimeout(
      () => req.destroy(new Error('Broker snapshot deadline.')),
      5000,
    );
    req.on('error', () =>
      finish(new Error('Broker metadata transport failed.')),
    );
    req.end('{}');
  });
}

export function validateBrokerSnapshot(value, candidate) {
  assert(
    value?.schemaVersion === 1 &&
      Array.isArray(value.records) &&
      value.records.length <= 10000 &&
      value.totals &&
      value.context,
    'Broker snapshot envelope invalid.',
  );
  const context = value.context;
  assert(
    context.provider === 'local-vm' &&
      context.image === candidate.capsuleImageId &&
      context.runnerVersion === candidate.runnerVersion &&
      context.kitManifestSha256 === candidate.kitManifestSha256 &&
      context.guestSha256 === candidate.guestSha256 &&
      context.brokerVersion === 'local-vm-broker-v1' &&
      UUID.test(context.hostId) &&
      UUID.test(context.brokerGeneration),
    'Broker candidate mismatch.',
  );
  const executions = new Set(),
    creations = new Set(),
    boots = new Set();
  for (const row of value.records) {
    assert(
      UUID.test(row.executionId) &&
        UUID.test(row.creationId) &&
        (row.resourceId === null || UUID.test(row.resourceId)) &&
        !executions.has(row.executionId) &&
        !creations.has(row.creationId) &&
        (row.resourceId === null || !boots.has(row.resourceId)) &&
        ['PREPARED', 'STARTING', 'CLOSED'].includes(row.state) &&
        typeof row.qemuStarted === 'boolean' &&
        typeof row.cleanupVerified === 'boolean',
      'Broker duplicate or malformed record.',
    );
    assert(
      !row.qemuStarted || row.resourceId !== null,
      'Started VM lacks identity.',
    );
    executions.add(row.executionId);
    creations.add(row.creationId);
    if (row.resourceId) boots.add(row.resourceId);
  }
  assert(
    ['qemuStarted', 'active', 'uncertain'].every(
      (key) =>
        Number.isSafeInteger(value.totals[key]) && value.totals[key] >= 0,
    ) &&
      value.totals.qemuStarted ===
        value.records.filter((r) => r.qemuStarted).length &&
      value.totals.active <= 1 &&
      value.totals.active ===
        value.records.filter((r) => r.state === 'STARTING').length &&
      value.totals.uncertain >=
        value.records.filter((r) => r.state === 'CLOSED' && !r.cleanupVerified)
          .length &&
      (value.totals.active !== 0 ||
        !value.records.some(
          (r) => r.qemuStarted && !r.cleanupVerified && r.state !== 'CLOSED',
        )),
    'Broker totals inconsistent.',
  );
  return value;
}

export async function createLinuxVmObserver({
  state,
  adminPool,
  applicationPool,
  actors,
  candidate,
  socketPath,
}) {
  testState.assertLaboratoryTestState(state);
  validateCandidate(candidate);
  assert(actors.length === 8, 'Eight authenticated actors required.');
  const byActor = new Map(actors.map((actor) => [actor.id, actor]));
  const role = (
    await applicationPool.query(`SELECT current_user AS name,rolsuper AS superuser,rolbypassrls AS "bypassRls"
    FROM pg_roles WHERE rolname=current_user`)
  ).rows[0];
  assert(
    role?.name === 'alunza_app' &&
      role.superuser === false &&
      role.bypassRls === false,
    'Nonprivileged API database role required.',
  );
  let brokerGeneration;
  const snapshot = async () => {
    const current = validateBrokerSnapshot(
      await readLinuxVmSnapshot(socketPath),
      candidate,
    );
    brokerGeneration ??= current.context.brokerGeneration;
    assert(
      current.context.brokerGeneration === brokerGeneration,
      'Broker generation changed during campaign.',
    );
    return current;
  };
  const target = ({ actorId, mode, key }) => {
    const actor = byActor.get(actorId);
    assert(
      actor && ['RUN', 'SUBMIT'].includes(mode) && UUID.test(key),
      'Unknown TEST operation.',
    );
    return {
      actor,
      operation: mode === 'RUN' ? 'practice.run' : 'practice.submit',
      table:
        mode === 'RUN'
          ? 'app.executions'
          : 'app_private.submission_reservations',
    };
  };
  async function observe(input) {
    const { actor, operation, table } = target(input),
      client = await adminPool.connect();
    let resource, vmRows, suite, attempt;
    try {
      await client.query('BEGIN READ ONLY');
      resource = (
        await client.query(
          `SELECT r.id,r.lifecycle_status,r.code_hash,r.test_suite_hash,r.exercise_version_id,r.cleanup_verified,
        r.response_body ${input.mode === 'SUBMIT' ? ',r.attempt_id,r.staged_result,r.staged_private_results' : ''}
        FROM ${table} r JOIN app.operation_keys k ON k.id=r.operation_id
        WHERE k.actor_id=$1 AND k.operation=$2 AND k.key=$3 AND k.organization_id=$4`,
          [actor.id, operation, input.key, actor.organizationId],
        )
      ).rows;
      assert(resource.length <= 1, 'Duplicate durable admission.');
      resource = resource[0];
      if (!resource) {
        await client.query('COMMIT');
        return empty();
      }
      suite = (
        await client.query(
          `SELECT count(*) FILTER(WHERE visibility='visible')::int AS visible,
        count(*) FILTER(WHERE visibility='hidden')::int AS hidden FROM app_private.exercise_tests WHERE exercise_version_id=$1`,
          [resource.exercise_version_id],
        )
      ).rows[0];
      vmRows = (
        await client.query(
          `SELECT execution_id,creation_id,provider_resource_id,context,creation_state,cleanup_state,cleanup_proof
        FROM app_private.local_vm_resources WHERE execution_id=$1`,
          [resource.id],
        )
      ).rows;
      if (input.mode === 'SUBMIT')
        attempt = (
          await client.query(
            `SELECT a.id,a.technical_result,ar.private_test_results
          FROM app.attempts a LEFT JOIN app_private.attempt_results ar ON ar.attempt_id=a.id WHERE a.execution_id=$1`,
            [resource.id],
          )
        ).rows;
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    assert(
      vmRows.length <= 1 && (!attempt || attempt.length <= 1),
      'Duplicate VM or attempt.',
    );
    const technical =
      input.mode === 'RUN'
        ? resource.response_body?.technicalResult
        : (attempt[0]?.technical_result ?? resource.staged_result);
    const result = {
      executionId: resource.id,
      attemptId: attempt?.[0]?.id ?? null,
      completed: resource.lifecycle_status === 'COMPLETED',
      resultDurable: Boolean(technical),
      attemptCount: attempt?.length ?? 0,
      technicalResultSha256: technical ? canonicalHash(technical) : null,
      codeSha256: resource.code_hash,
      testsVersion: resource.test_suite_hash,
      visibleTestCount: suite.visible,
      hiddenTestCount: input.mode === 'RUN' ? 0 : suite.hidden,
      privateTestCount:
        input.mode === 'RUN'
          ? 0
          : (
              attempt[0]?.private_test_results ??
              resource.staged_private_results ??
              []
            ).length,
      vmCreations: vmRows
        .filter((row) => row.provider_resource_id !== null)
        .map((row) => {
          const proof = row.cleanup_proof;
          const retired =
            row.cleanup_state === 'VERIFIED' &&
            proof?.kind === 'RETIRED' &&
            proof.qemuAbsent === true &&
            proof.overlaysAbsent === true &&
            proof.executionId === row.execution_id &&
            proof.creationId === row.creation_id &&
            proof.resourceId === row.provider_resource_id &&
            proof.hostId === row.context.hostId &&
            proof.brokerGeneration === row.context.brokerGeneration;
          return {
            executionId: row.execution_id,
            creationId: row.creation_id,
            bootId: row.provider_resource_id,
            kitManifestSha256: row.context.kitManifestSha256,
            guestSha256: row.context.guestSha256,
            runnerVersion: row.context.runnerVersion,
            capsuleImageId: row.context.image,
            cleanupVerified: retired,
            receiptSha256: proof ? canonicalHash(proof) : null,
          };
        }),
    };
    validateObservation(result, candidate);
    if (result.completed) {
      // Independently read the same committed projection as the authenticated actor.
      const app = await applicationPool.connect();
      try {
        const session = JSON.parse(
          Buffer.from(actor.token.split('.')[1], 'base64url').toString('utf8'),
        ).session_id;
        assert(UUID.test(session), 'Authenticated fixture session missing.');
        await app.query('BEGIN READ ONLY');
        await app.query(
          "SELECT set_config('app.actor_id',$1,true),set_config('app.session_id',$2,true),set_config('app.organization_id',$3,true)",
          [actor.id, session, actor.organizationId],
        );
        const visible =
          input.mode === 'RUN'
            ? await app.query(
                'SELECT response_body FROM app.executions WHERE id=$1',
                [resource.id],
              )
            : await app.query(
                'SELECT technical_result FROM app.attempts WHERE id=$1',
                [result.attemptId],
              );
        assert(
          visible.rowCount === 1 &&
            canonicalHash(
              input.mode === 'RUN'
                ? visible.rows[0].response_body?.technicalResult
                : visible.rows[0].technical_result,
            ) === result.technicalResultSha256,
          'Application role cannot read the durable result.',
        );
        await app.query('COMMIT');
      } catch (error) {
        await app.query('ROLLBACK');
        throw error;
      } finally {
        app.release();
      }
    }
    return result;
  }
  return {
    observe,
    async inspect() {
      const current = await snapshot();
      return {
        provider: 'local-vm',
        candidate,
        applicationRole: role,
        vmCreationsTotal: current.totals.qemuStarted,
        creationRecordsTotal: current.records.length,
        activeVms: current.totals.active,
        cleanupUncertain: current.totals.uncertain > 0,
      };
    },
    faults: {
      async armCommitFault(input) {
        const { actor, operation } = target(input),
          suffix = randomUUID().replaceAll('-', '');
        const name = `vm_commit_fault_${suffix}`;
        // All interpolated identifiers/literals are fixed or validated UUIDs. Domain values remain parameters elsewhere.
        const table = input.mode === 'RUN' ? 'app.executions' : 'app.attempts';
        const predicate =
          input.mode === 'RUN'
            ? "new.lifecycle_status='COMPLETED' AND k.resource_id=new.id"
            : 'k.resource_id=new.execution_id';
        const client = await adminPool.connect();
        try {
          await client.query('BEGIN');
          await client.query(`CREATE FUNCTION app_private.${name}() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
            BEGIN IF EXISTS(SELECT 1 FROM app.operation_keys k WHERE ${predicate} AND k.actor_id='${actor.id}'::uuid
              AND k.operation='${operation}' AND k.key='${input.key}') THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='VM_TEST_COMMIT_FAULT'; END IF; RETURN new; END $$`);
          await client.query(
            `CREATE TRIGGER ${name} BEFORE ${input.mode === 'RUN' ? 'UPDATE' : 'INSERT'} ON ${table} FOR EACH ROW EXECUTE FUNCTION app_private.${name}()`,
          );
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
        let removed = false;
        return {
          async restore() {
            if (removed) return;
            const db = await adminPool.connect();
            try {
              await db.query('BEGIN');
              await db.query(`DROP TRIGGER ${name} ON ${table}`);
              await db.query(`DROP FUNCTION app_private.${name}()`);
              await db.query('COMMIT');
              removed = true;
            } catch (error) {
              await db.query('ROLLBACK');
              throw error;
            } finally {
              db.release();
            }
          },
        };
      },
      async reconcile(input) {
        const { actor, operation, table } = target(input);
        const result = await adminPool.query(
          `UPDATE ${table} r SET lease_until=clock_timestamp()-interval '1 second'
          FROM app.operation_keys k WHERE r.operation_id=k.id AND k.actor_id=$1 AND k.operation=$2 AND k.key=$3
          AND r.lifecycle_status='RUNNING'`,
          [actor.id, operation, input.key],
        );
        assert(
          result.rowCount === 1,
          'Exactly one owned incomplete operation must be reconciled.',
        );
      },
      async waitForAdmission(input) {
        target(input);
        while (!input.signal.aborted) {
          const value = await observe(input),
            current = await snapshot();
          const row = current.records.find(
            (r) => r.executionId === value.executionId && r.qemuStarted,
          );
          if (row)
            return {
              executionId: row.executionId,
              creationId: row.creationId,
              bootId: row.resourceId,
            };
          await sleep(25, undefined, { signal: input.signal });
        }
        throw new Error('No observed VM admission before deadline.');
      },
    },
  };
}
