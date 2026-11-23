// Linux operator-owned control bridge. No service starts on import.
// CLI: node scripts/linux-vm-browser-control.mjs --manifest /private/manifest.json
// Manifest: see validateManifest in linux-vm-browser-contract.mjs. statePath is
// the NEW physical TEST state, never the prior campaign's state. HTTP binds only
// 127.0.0.1:4302; /task exposes fixed actions, no SQL or shell supplied by clients.
import { createServer } from 'node:http';
import { randomUUID, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, mkdir, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import { classes, additionalStudents } from '../fixtures/demo/academic.mjs';
import { setupLinuxVmFixture } from '../tests/integration/linux-vm-fixture.mjs';
import {
  loginLinuxVmActors,
  validateHttpPayload,
  assertDurable,
  canonicalHash,
} from '../tests/integration/linux-vm-api.mjs';
import {
  createLinuxVmObserver,
  readLinuxVmSnapshot,
  validateBrokerSnapshot,
} from '../tests/integration/linux-vm-observer.mjs';
import {
  loadManifest,
  readPrivateJson,
  requireValue as check,
  validateAction,
  publicContext,
} from './linux-vm-browser-contract.mjs';

// The unified functional vertical runs the two public cases of the same
// published SUBMIT8 version. Its RUN suite hash excludes the six private cases.
// Normal latency fixtures still require the original RUN8/SUBMIT8 pairing.
export function actorForVerification(actor, scope, mode, exerciseVersionId) {
  if (
    scope !== 'F01' ||
    mode !== 'RUN' ||
    exerciseVersionId !== actor.fixtures.SUBMIT.exerciseVersionId
  )
    return actor;
  const f = actor.fixtures.SUBMIT;
  check(
    /^[a-f0-9]{64}$/.test(f.runTestsVersion),
    'VISIBLE_SUITE_HASH_REQUIRED',
  );
  return {
    ...actor,
    fixtures: {
      ...actor.fixtures,
      RUN: {
        ...f,
        testsVersion: f.runTestsVersion,
        hiddenTestIds: [],
        hiddenMarkers: [],
      },
    },
  };
}

// Only the fixtures retained by this controller can be closed. Their close()
// changes activity state; executions, attempts and audit history stay intact.
export async function retireControlScopes({ scopes, inspect, record }) {
  const pending = [...scopes].filter(([, scope]) => !scope.closed);
  if (pending.length === 0) return;
  const snapshot = await inspect();
  check(
    snapshot.totals.active === 0 &&
      snapshot.totals.uncertain === 0 &&
      snapshot.ledger.pending === 0 &&
      snapshot.records.every(
        (resource) => resource.state === 'CLOSED' && resource.cleanupVerified,
      ),
    'FIXTURE_CLEANUP_HOST_NOT_IDLE',
  );
  const failures = [];
  for (const [name, scope] of pending) {
    try {
      await scope.fixture.close();
      scope.closed = true;
    } catch {
      failures.push(name);
    }
    try {
      await record({
        event: scope.closed ? 'SCOPE_CLOSED' : 'SCOPE_CLOSE_FAILED',
        scope: name,
        fixtureCampaignId: scope.fixture.campaignId,
        reason: 'CONTROL_SHUTDOWN',
      });
    } catch {
      failures.push(name);
    }
  }
  check(failures.length === 0, 'CONTROL_FIXTURES_CLOSE_FAILED');
}

// A rejected HTTP promise must not skip DDL/membership/fixture/pool retirement. Cleanup
// itself still checks observed host/ledger idleness before touching the trigger.
export async function drainControlShutdown({
  release,
  waitHeld,
  cleanupBarrier,
  restore,
  closeScopes,
  closePools,
  record,
}) {
  const failures = [];
  for (const [name, run] of Object.entries({
    release,
    waitHeld,
    cleanupBarrier,
    restore,
    closeScopes,
    closePools,
  })) {
    try {
      await run();
    } catch {
      failures.push(name);
    }
  }
  await record({
    event: 'CONTROL_SHUTDOWN',
    pass: failures.length === 0,
    failedSteps: failures,
  });
  check(failures.length === 0, 'CONTROL_SHUTDOWN_INCOMPLETE');
}

export async function createController(m) {
  check(process.platform === 'linux', 'PHYSICAL_CONTROLLER_LINUX_ONLY');
  const state = await readPrivateJson(m.statePath);
  check(
    state.projectId === 'alunza-edu-laboratorio-physical-test' &&
      state.authUrl === m.endpoints.auth,
    'FRESH_PHYSICAL_TEST_REQUIRED',
  );
  const dbUrl = new URL(state.migrationUrl);
  check(
    dbUrl.hostname === '127.0.0.1' &&
      dbUrl.port === '18422' &&
      dbUrl.pathname === '/postgres',
    'DATABASE_TARGET',
  );
  const appUrl = new URL(dbUrl);
  appUrl.username = 'alunza_app';
  appUrl.password = state.applicationPassword;
  const adminPool = new pg.Pool({ connectionString: dbUrl.href, max: 8 }),
    applicationPool = new pg.Pool({ connectionString: appUrl.href, max: 4 });
  const identity = JSON.parse(
    await readFile(
      new URL('../fixtures/foundation/identity.json', import.meta.url),
      'utf8',
    ),
  );
  const users = [...identity.users, ...additionalStudents];
  const scopes = new Map(),
    revoked = new Map();
  let barrier = null,
    pendingBarrier = null,
    held = null;
  await mkdir(m.outputDir, { recursive: false, mode: 0o700 });
  const record = async (value) =>
    appendFile(
      join(m.outputDir, 'control-events.jsonl'),
      JSON.stringify({ at: new Date().toISOString(), ...value }) + '\n',
      { mode: 0o600 },
    );
  const inspect = async () => {
    const raw = validateBrokerSnapshot(
      await readLinuxVmSnapshot(m.brokerSocket),
      m.candidate,
    );
    const ledger = (
      await adminPool.query(
        `SELECT count(*)::int AS total,count(*) FILTER(WHERE cleanup_state='PENDING')::int AS pending
       FROM app_private.local_vm_resources WHERE context->>'hostId'=$1`,
        [raw.context.hostId],
      )
    ).rows[0];
    return {
      candidate: m.candidate,
      webSourceDigest: m.webSourceDigest,
      context: raw.context,
      records: raw.records,
      totals: raw.totals,
      ledger,
    };
  };
  function scope(name) {
    const s = scopes.get(name);
    check(s && !s.closed, 'UNKNOWN_OR_CLOSED_SCOPE');
    return s;
  }
  function actor(s, id) {
    const a = s.actors.find((a) => a.id === id);
    check(a, 'UNKNOWN_ACTOR');
    return a;
  }
  const login = async (s, id) => {
    check(
      s.actors.some((a) => a.id === id) ||
        classes.some(
          (c) => c.teacherId === id && s.actors.some((a) => a.classId === c.id),
        ),
      'LOGIN_SCOPE',
    );
    const user = users.find((u) => u.id === id);
    check(user, 'LOGIN_USER');
    const auth = createClient(state.authUrl, state.publishableKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    const result = await auth.auth.signInWithPassword({
      email: user.email,
      password: state.fixturePassword,
    });
    check(
      !result.error && result.data.session?.user.id === id,
      'REAL_AUTH_REQUIRED',
    );
    const a = s.actors.find((a) => a.id === id);
    if (a) a.token = result.data.session.access_token;
    return result.data.session;
  };
  async function membership(input) {
    const a = actor(scope(input.scope), input.actorId),
      key = `${a.classId}:${a.id}`;
    if (!input.active) {
      check(!revoked.has(key), 'ALREADY_REVOKED');
      const result = await adminPool.query(
        'UPDATE app.class_memberships SET ended_at=clock_timestamp() WHERE class_id=$1 AND user_id=$2 AND ended_at IS NULL RETURNING class_id',
        [a.classId, a.id],
      );
      check(result.rowCount === 1, 'REVOCATION_TARGET');
      revoked.set(key, { classId: a.classId, actorId: a.id });
    } else if (revoked.has(key)) {
      const result = await adminPool.query(
        'UPDATE app.class_memberships SET ended_at=NULL WHERE class_id=$1 AND user_id=$2 AND ended_at IS NOT NULL',
        [a.classId, a.id],
      );
      check(result.rowCount === 1, 'REVOCATION_RESTORE');
      revoked.delete(key);
    }
    return { active: input.active, actorId: a.id, classId: a.classId };
  }
  const absent = async (input) => {
    const s = scope(input.scope),
      a = actor(s, input.actorId);
    const result = await adminPool.query(
      `SELECT count(*)::int AS keys FROM app.operation_keys WHERE actor_id=$1 AND organization_id=$2 AND operation=$3 AND key=$4`,
      [
        a.id,
        a.organizationId,
        input.mode === 'RUN' ? 'practice.run' : 'practice.submit',
        input.key,
      ],
    );
    const observed = await s.observer.observe(input);
    check(
      result.rows[0].keys === 0 &&
        observed.executionId === null &&
        observed.attemptCount === 0 &&
        observed.vmCreations.length === 0,
      'BUSY_LEFT_DURABLE_STATE',
    );
    return {
      keyCount: 0,
      reservationCount: 0,
      attemptCount: 0,
      resourceCount: 0,
      observation: observed,
    };
  };
  const release = async () => {
    if (!barrier)
      return pendingBarrier
        ? {
            released: pendingBarrier.released,
            automatic: pendingBarrier.automatic,
            ddlPending: true,
          }
        : { released: false };
    const b = barrier;
    barrier = null;
    pendingBarrier = b;
    clearTimeout(b.timer);
    try {
      const unlocked = await b.client.query(
        'SELECT pg_advisory_unlock($1::integer,$2::integer)',
        b.lock,
      );
      check(
        unlocked.rows[0]?.pg_advisory_unlock === true,
        'BARRIER_UNLOCK_UNCONFIRMED',
      );
      b.released = true;
    } finally {
      b.client.release(!b.released);
    }
    await record({
      event: 'BARRIER_RELEASED',
      key: b.key,
      automatic: b.automatic,
      ddlPending: true,
    });
    return { released: true, automatic: b.automatic, ddlPending: true };
  };
  const cleanupBarrier = async () => {
    check(!barrier && !held, 'BARRIER_REQUESTS_STILL_ACTIVE');
    if (!pendingBarrier) return { cleaned: true, alreadyAbsent: true };
    const b = pendingBarrier;
    check(b.released === true, 'BARRIER_UNLOCK_UNCONFIRMED');
    const snapshot = await inspect();
    check(
      snapshot.totals.active === 0 &&
        snapshot.totals.uncertain === 0 &&
        snapshot.ledger.pending === 0,
      'BARRIER_CLEANUP_HOST_NOT_IDLE',
    );
    // Call only after all offered HTTP requests finish. An early DROP queues an
    // exclusive relation lock and can block the very admission being observed.
    const db = await adminPool.connect();
    try {
      await db.query('BEGIN');
      await db.query("SET LOCAL lock_timeout='500ms'");
      await db.query("SET LOCAL statement_timeout='2000ms'");
      await db.query(
        `DROP TRIGGER ${b.name} ON app_private.local_vm_resources`,
      );
      await db.query(`DROP FUNCTION app_private.${b.name}()`);
      await db.query('COMMIT');
      pendingBarrier = null;
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally {
      db.release();
    }
    await record({
      event: 'BARRIER_DDL_REMOVED',
      key: b.key,
    });
    return { cleaned: true, alreadyAbsent: false };
  };
  const arm = async (input) => {
    check(!barrier && !held && !pendingBarrier, 'BARRIER_CLEANUP_REQUIRED');
    const s = scope(input.scope),
      a = actor(s, input.actorId);
    await absent(input);
    const snapshot = await inspect();
    check(
      snapshot.totals.active === 0 && snapshot.totals.uncertain === 0,
      'HOST_NOT_IDLE',
    );
    const name = `z_physical_hold_${randomBytes(8).toString('hex')}`,
      lock = [214013, randomBytes(4).readUInt32BE(0) & 0x7fffffff],
      client = await adminPool.connect();
    await client.query(
      'SELECT pg_advisory_lock($1::integer,$2::integer)',
      lock,
    );
    try {
      await adminPool.query(
        `CREATE FUNCTION app_private.${name}() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN IF EXISTS(SELECT 1 FROM app.operation_keys k WHERE k.resource_id=NEW.execution_id AND k.actor_id='${a.id}'::uuid AND k.key='${input.key}') THEN PERFORM pg_advisory_xact_lock(${lock[0]},${lock[1]}); END IF; RETURN NEW; END $$`,
      );
      await adminPool.query(
        `CREATE TRIGGER ${name} BEFORE INSERT ON app_private.local_vm_resources FOR EACH ROW EXECUTE FUNCTION app_private.${name}()`,
      );
    } catch (error) {
      await client.query(
        'SELECT pg_advisory_unlock($1::integer,$2::integer)',
        lock,
      );
      client.release();
      throw error;
    }
    barrier = {
      client,
      name,
      lock,
      key: input.key,
      automatic: false,
      released: false,
      timer: null,
    };
    barrier.timer = setTimeout(() => {
      if (barrier) {
        barrier.automatic = true;
        void release().catch(() => record({ event: 'BARRIER_CLEANUP_FAILED' }));
      }
    }, 12000);
    await record({ event: 'BARRIER_ARMED', key: input.key });
    return { armed: true, key: input.key, maximumHoldMs: 12000 };
  };
  const waitBarrier = async () => {
    check(barrier, 'BARRIER_MISSING');
    const b = barrier,
      start = Date.now();
    while (Date.now() - start < 5000) {
      const rows = await adminPool.query(
        "SELECT count(*)::int AS n FROM pg_locks WHERE locktype='advisory' AND classid=$1::oid AND objid=$2::oid AND objsubid=2 AND NOT granted",
        b.lock,
      );
      if (rows.rows[0].n === 1) return { waiting: true, key: b.key };
      check(barrier === b, 'BARRIER_EXPIRED');
      await sleep(20);
    }
    throw new Error('BARRIER_WINNER_NOT_OBSERVED');
  };
  async function verify(input) {
    const s = scope(input.scope),
      a = actorForVerification(
        actor(s, input.actorId),
        input.scope,
        input.mode,
        input.payload?.data?.exerciseVersionId,
      ),
      fixture = a.fixtures[input.mode];
    const checked = validateHttpPayload(input.payload, {
      actor: a,
      fixture,
      mode: input.mode,
      code: input.code,
      status: input.status,
      expectedStatus: input.status,
      expectedDiagnosis: input.diagnosis,
    });
    check(checked.failures.length === 0, 'PUBLIC_RESULT_REJECTED');
    const observation = await s.observer.observe(input);
    assertDurable(
      observation,
      checked.data,
      a,
      input.mode,
      input.code,
      m.candidate,
    );
    const proof = {
      requestId: checked.requestId,
      executionId: checked.data.executionId,
      attemptId: checked.data.attemptId ?? null,
      technicalResultSha256: canonicalHash(checked.data.technicalResult),
      dataSha256: canonicalHash(checked.data),
      observationSha256: canonicalHash(observation),
      observation,
    };
    await record({
      event: 'RESULT_VERIFIED',
      scope: input.scope,
      mode: input.mode,
      key: input.key,
      ...proof,
    });
    return proof;
  }
  async function dispatch(action, input) {
    validateAction(action, input);
    if (action === 'inspect') return inspect();
    if (action === 'prepare') {
      if (!scopes.has(input.scope)) {
        const fixture = await setupLinuxVmFixture({
          state,
          adminPool,
          campaignId: randomUUID(),
          publish: input.scope !== 'F01',
        });
        const actors = await loginLinuxVmActors(state, fixture.fixturesByActor);
        const observer = await createLinuxVmObserver({
          state,
          adminPool,
          applicationPool,
          actors,
          candidate: m.candidate,
          socketPath: m.brokerSocket,
        });
        scopes.set(input.scope, { fixture, actors, observer, closed: false });
        await record({
          event: 'SCOPE_PREPARED',
          scope: input.scope,
          fixtureCampaignId: fixture.campaignId,
        });
      }
      const s = scope(input.scope);
      return publicContext(
        input.scope,
        s.actors,
        Object.fromEntries(classes.map((c) => [c.id, c.teacherId])),
      );
    }
    if (action === 'login') return login(scope(input.scope), input.actorId);
    if (action === 'membership') return membership(input);
    if (action === 'verify') return verify(input);
    if (action === 'absent') return absent(input);
    if (action === 'snapshot') {
      const s = scope(input.scope),
        ids = s.fixture.activities.map((a) => a.id);
      const rows = await adminPool.query(
        `SELECT id,student_id AS "actorId",activity_id AS "activityId",technical_result->>'diagnosisCode' AS diagnosis,technical_result->>'allRequiredPassed' AS "allRequiredPassed" FROM app.attempts WHERE activity_id=ANY($1::uuid[]) ORDER BY submitted_at,id`,
        [ids],
      );
      const states = await adminPool.query(
        'SELECT id,state FROM app.activities WHERE id=ANY($1::uuid[]) ORDER BY id',
        [ids],
      );
      return {
        attempts: rows.rows,
        activities: states.rows,
        broker: await inspect(),
      };
    }
    if (action === 'barrier-arm') return arm(input);
    if (action === 'barrier-wait') return waitBarrier();
    if (action === 'barrier-release') return release();
    if (action === 'barrier-cleanup') return cleanupBarrier();
    if (action === 'hold-start') {
      const s = scope(input.scope),
        a = actor(s, input.actorId),
        key = randomUUID(),
        f = a.fixtures[input.mode];
      await arm({ ...input, key });
      const promise = fetch(
        `${m.endpoints.api}/api/v1/activities/${f.activityId}/exercises/${f.assignmentId}/${input.mode === 'RUN' ? 'executions' : 'attempts'}`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${a.token}`,
            'content-type': 'application/json',
            'idempotency-key': key,
          },
          body: JSON.stringify({
            exerciseVersionId: f.exerciseVersionId,
            code: f.successCode,
          }),
          signal: AbortSignal.timeout(45000),
        },
      ).then(async (r) => ({ status: r.status, payload: await r.json() }));
      held = { promise, input: { ...input, key }, code: f.successCode };
      promise.catch(() => {});
      await waitBarrier();
      return { held: true, key };
    }
    if (action === 'hold-finish') {
      check(held, 'NO_HELD_REQUEST');
      const h = held;
      held = null;
      const released = await release(),
        r = await h.promise;
      await cleanupBarrier();
      check(released.automatic === false, 'HOLD_EXPIRED');
      return verify({ ...h.input, ...r, code: h.code, diagnosis: 'SUCCESS' });
    }
    if (action === 'close') {
      const s = scope(input.scope);
      if (input.scope === 'F06')
        for (const v of [...revoked.values()])
          await membership({ scope: 'F06', actorId: v.actorId, active: true });
      check(!barrier && !held, 'ACTIVE_HOLD');
      await cleanupBarrier();
      const snapshot = await inspect();
      check(
        snapshot.totals.active === 0 &&
          snapshot.totals.uncertain === 0 &&
          snapshot.records.every(
            (r) => r.state === 'CLOSED' && r.cleanupVerified,
          ),
        'RETIREMENT_UNVERIFIED',
      );
      await s.fixture.close();
      s.closed = true;
      await record({ event: 'SCOPE_CLOSED', scope: input.scope });
      return { closed: true, broker: snapshot };
    }
    throw new Error('CONTROL_ACTION_REJECTED');
  }
  return {
    dispatch,
    async shutdown() {
      await drainControlShutdown({
        release,
        waitHeld: async () => {
          try {
            if (held) await held.promise;
          } finally {
            held = null;
          }
        },
        cleanupBarrier,
        restore: async () => {
          const results = await Promise.allSettled(
            [...revoked.values()].map((v) =>
              membership({ scope: 'F06', actorId: v.actorId, active: true }),
            ),
          );
          check(
            results.every((r) => r.status === 'fulfilled'),
            'MEMBERSHIP_RESTORE_FAILED',
          );
        },
        closeScopes: async () => {
          check(!barrier && !held, 'ACTIVE_HOLD');
          await retireControlScopes({ scopes, inspect, record });
        },
        closePools: async () => {
          const results = await Promise.allSettled([
            adminPool.end(),
            applicationPool.end(),
          ]);
          check(
            results.every((r) => r.status === 'fulfilled'),
            'CONTROL_POOLS_CLOSE_FAILED',
          );
        },
        record,
      });
    },
  };
}

export async function serve(m) {
  const controller = await createController(m);
  const server = createServer(async (req, res) => {
    let status = 400,
      data = { ok: false, error: 'CONTROL_REQUEST_REJECTED' };
    try {
      const key = String(req.headers['x-alunza-control-key'] ?? '');
      check(
        req.socket.remoteAddress === '127.0.0.1' &&
          req.method === 'POST' &&
          req.url === '/task' &&
          !req.headers.origin &&
          req.headers['content-type'] === 'application/json' &&
          key.length === m.controlKey.length &&
          timingSafeEqual(Buffer.from(key), Buffer.from(m.controlKey)),
        'PRIVATE_PEER',
      );
      let bytes = 0;
      const chunks = [];
      for await (const chunk of req) {
        bytes += chunk.length;
        check(bytes <= 1048576, 'CONTROL_BODY_LIMIT');
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      check(
        body.campaignId === m.campaignId &&
          Object.keys(body).sort().join(',') === 'action,campaignId,input',
        'CONTROL_ENVELOPE',
      );
      data = {
        campaignId: m.campaignId,
        ok: true,
        data: await controller.dispatch(body.action, body.input),
      };
      status = 200;
    } catch (error) {
      if (/^[A-Z][A-Z0-9_]{1,80}$/.test(error?.message ?? ''))
        data.error = error.message;
      /* Never expose raw SQL, environment, request or provider errors. */
    }
    res.writeHead(status, {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    });
    res.end(JSON.stringify(data));
  });
  server.requestTimeout = 50000;
  server.headersTimeout = 5000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(4302, '127.0.0.1', resolve);
  });
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    server.close();
    await controller.shutdown();
  };
  process.once('SIGTERM', () => {
    void stop();
  });
  process.once('SIGINT', () => {
    void stop();
  });
  console.log(
    JSON.stringify({
      status: 'ready',
      scope: 'PHYSICAL_PRIVATE_CONTROL',
      campaignId: m.campaignId,
      port: 4302,
    }),
  );
  return { server, stop };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (process.argv.length !== 4 || process.argv[2] !== '--manifest')
    throw new Error('Usage: --manifest private.json');
  await serve(await loadManifest(process.argv[3]));
}
