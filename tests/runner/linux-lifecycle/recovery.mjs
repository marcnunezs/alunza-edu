// Run explicitly with Node and the PostgreSQL bin directory as the only argument.
// This experiment exercises the existing SQL contract and a separate Linux inventory model.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';
import { withIsolatedPostgres } from './isolated-postgres.mjs';

const root = new URL('../../../', import.meta.url);
const migrations = new URL('supabase/migrations/', root);
const student = '91000000-0000-4000-8000-000000000003';
const session = '91100000-0000-4000-8000-000000000003';
const organization = '92000000-0000-4000-8000-000000000001';
const unknown = {
  runnerVersion: 'sql-test',
  diagnosisCode: 'UNKNOWN',
  terminationReason: 'RUNNER_FAILURE',
  infrastructureStatus: 'FAILED',
  visibleTestResults: [],
  visiblePassed: 0,
  visibleTotal: 1,
  outputTruncated: false,
  outputBytes: 0,
  runtimeMs: 0,
  lifecycleMs: 0,
  hiddenChecksPassed: null,
  allRequiredPassed: false,
};
const success = {
  ...unknown,
  diagnosisCode: 'SUCCESS',
  terminationReason: 'COMPLETED',
  infrastructureStatus: 'OK',
  visibleTestResults: [{ id: 'visible', passed: true, stdout: '', stderr: '' }],
  visiblePassed: 1,
  hiddenChecksPassed: true,
  allRequiredPassed: true,
};

async function foundation(admin) {
  // A minimal Auth fixture replaces GoTrue for a standalone database. No live user or session.
  await admin.query(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA extensions; CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz);
    CREATE TABLE auth.sessions(id uuid PRIMARY KEY, user_id uuid REFERENCES auth.users);`);
  const names = (await readdir(migrations))
    .filter(
      (n) =>
        n.endsWith('.sql') &&
        (n < '20260927' || n.endsWith('_practice_sandbox_lifecycle.sql')),
    )
    .sort();
  for (const name of names) {
    await admin.query(await readFile(new URL(name, migrations), 'utf8'));
  }
  await admin.query(`GRANT USAGE ON SCHEMA auth TO alunza_identity;
    GRANT SELECT(id,email,email_confirmed_at) ON auth.users TO alunza_identity;
    GRANT SELECT(id,user_id) ON auth.sessions TO alunza_identity;`);
  // Use only the real academic fixture data. The pgtap declarations concern the separate full suite.
  const fixture = await readFile(
    new URL('supabase/tests/023_practice_sandbox.test.sql', root),
    'utf8',
  );
  const start = fixture.indexOf('insert into auth.users(');
  const end = fixture.indexOf('-- SANDBOX FIXTURE READY');
  assert.ok(start > 0 && end > start);
  await admin.query('BEGIN;\n' + fixture.slice(start, end) + '\nCOMMIT;');
  return names;
}

async function value(client, sql, params = []) {
  return (await client.query(sql, params)).rows[0].value;
}

async function actor(client, enabled) {
  await client.query(
    `select set_config('app.actor_id',$1,false),set_config('app.session_id',$2,false),
     set_config('app.organization_id',$3,false)`,
    enabled ? [student, session, organization] : ['', '', ''],
  );
}

async function admit(client, key, hash, context, available = true) {
  await actor(client, true);
  try {
    return await value(
      client,
      `select app_private.admit_practice_submit(
        $1::uuid,'97000000-0000-4000-8000-000000000001','98000000-0000-4000-8000-000000000001',
        '96100000-0000-4000-8000-000000000001',$2,$3,'module.exports.solve=(a,b)=>a+b;',null,
        'sql-test',$4::uuid,$5,1,4,10,$6::jsonb) as value`,
      [
        randomUUID(),
        key,
        hash,
        randomUUID(),
        available,
        JSON.stringify(context),
      ],
    );
  } finally {
    await actor(client, false);
  }
}

const load = (c, id) =>
  value(c, 'select app_private.load_sandbox_resource($1) as value', [id]);
const begin = (c, r) =>
  value(c, 'select app_private.begin_sandbox_creation($1,$2) as value', [
    r.executionId,
    r.leaseToken,
  ]);
const claim = (c) =>
  value(c, 'select app_private.claim_expired_practice_submit() as value');
const confirm = (c, r, vm) =>
  value(c, 'select app_private.confirm_sandbox_resource($1,$2,$3) as value', [
    r.executionId,
    r.creationId,
    vm,
  ]);
const verify = (c, r, proof) =>
  value(c, 'select app_private.verify_sandbox_cleanup($1,$2::jsonb) as value', [
    r.executionId,
    JSON.stringify(proof),
  ]);
const finish = (c, r) =>
  value(c, 'select app_private.finish_practice_submit($1,$2,true) as value', [
    r.executionId,
    r.leaseToken,
  ]);
const stage = (c, r, result) =>
  value(
    c,
    'select app_private.stage_practice_submit_result($1,$2,$3::jsonb,$4::jsonb) as value',
    [
      r.executionId,
      r.leaseToken,
      JSON.stringify(result),
      JSON.stringify(
        result.diagnosisCode === 'SUCCESS'
          ? [{ id: 'hidden-sentinel', passed: true }]
          : [],
      ),
    ],
  );

function cleanupProof(resource, vm) {
  return {
    kind: 'ABSENT_AND_ZERO_SNAPSHOTS',
    creationId: resource.creationId,
    sandboxId: vm,
    lookupAbsent: true,
    snapshotsRemaining: 0,
    observedAt: new Date().toISOString(),
  };
}

async function submitScenario({
  admin,
  first,
  second,
  stageName,
  context,
  checks,
}) {
  const key = 'synthetic-linux-lab-' + stageName;
  const preparedOnly = stageName === 'prepared';
  const lostReceipt = stageName === 'lost-receipt';
  const stagedResult = stageName === 'staged';
  const hash = 'a'.repeat(64);
  const r = await admit(first, key, hash, context);
  assert.equal(r.kind, 'reserved');
  const resource = await load(first, r.executionId);
  assert.equal(resource.creationState, 'PREPARED');
  const expired = () =>
    admin.query(
      "update app_private.submission_reservations set lease_until=clock_timestamp()-interval '1 second' where id=$1",
      [r.executionId],
    );
  const vm = 'fixture-' + randomUUID();

  if (!preparedOnly) {
    const dispatches = await Promise.allSettled([
      begin(first, r),
      begin(second, r),
    ]);
    assert.equal(dispatches.filter((d) => d.status === 'fulfilled').length, 1);
    assert.match(
      dispatches.find((d) => d.status === 'rejected').reason.message,
      /REQUEST_IN_PROGRESS/,
    );
    assert.equal((await load(second, r.executionId)).creationState, 'UNKNOWN');
    if (lostReceipt) {
      await first.query('BEGIN');
      await confirm(first, resource, vm);
      // The caller received the ID, but its database transaction did not commit.
      await first.query('ROLLBACK');
      assert.equal(
        (await load(second, r.executionId)).providerResourceId,
        null,
      );
      checks.push('rolled-back receipt leaves ID unknown to the other worker');
    }
    if (stagedResult) {
      await confirm(first, resource, vm);
      assert.equal(await stage(first, r, success), true);
      await assert.rejects(finish(first, r), /REQUEST_IN_PROGRESS/);
      checks.push('staged success survives failed finalization');
    }
  }
  await expired();
  // Deliberately hold worker one's claim transaction while worker two queries the same row.
  await first.query('BEGIN');
  const recovery = await claim(first);
  assert.equal(recovery.executionId, r.executionId);
  assert.notEqual(recovery.leaseToken, r.leaseToken);
  try {
    assert.equal(await claim(second), null);
  } finally {
    await first.query('COMMIT');
  }
  assert.equal(await claim(second), null);
  await assert.rejects(
    value(second, 'select app_private.assert_sandbox_active($1,$2) as value', [
      r.executionId,
      r.leaseToken,
    ]),
    /REQUEST_IN_PROGRESS/,
  );
  await assert.rejects(
    value(second, 'select app_private.assert_sandbox_active($1,$2) as value', [
      r.executionId,
      recovery.leaseToken,
    ]),
    /REQUEST_IN_PROGRESS/,
  );
  if (preparedOnly) {
    await verify(second, resource, {
      kind: 'NOT_DISPATCHED',
      creationId: resource.creationId,
    });
    checks.push('prepared crash has proof of zero dispatch');
  } else {
    assert.equal((await load(second, r.executionId)).cleanupState, 'PENDING');
    if (lostReceipt) {
      // A complete negative lookup by the provider still cannot prove absence without the receipt.
      await assert.rejects(
        verify(second, resource, cleanupProof(resource, vm)),
        /INVALID_SANDBOX_CLEANUP/,
      );
      await assert.rejects(
        admit(second, 'while-pending', 'd'.repeat(64), context),
        /RATE_LIMITED/,
      );
      await confirm(first, resource, vm);
      assert.equal(
        (await confirm(second, resource, vm)).providerResourceId,
        vm,
      );
      await assert.rejects(
        confirm(second, resource, 'foreign-receipt'),
        /INVALID_SANDBOX_RECEIPT/,
      );
      checks.push(
        'uncertain creation holds capacity; late exact receipt cannot run',
      );
    }
    const proof = cleanupProof(resource, vm);
    await assert.rejects(
      verify(second, resource, { ...proof, snapshotsRemaining: 1 }),
      /INVALID_SANDBOX_CLEANUP/,
    );
    await verify(second, resource, proof);
  }
  if (!stagedResult) assert.equal(await stage(second, recovery, unknown), true);
  const result = await finish(second, recovery);
  assert.equal(
    result.technicalResult.diagnosisCode,
    stagedResult ? 'SUCCESS' : 'UNKNOWN',
  );
  assert.equal((await load(second, r.executionId)).cleanupState, 'VERIFIED');
  const replay = await admit(first, key, hash, context, false);
  assert.equal(replay.kind, 'replay');
  assert.deepEqual(replay.response, result);
  await assert.rejects(
    admit(first, key, 'b'.repeat(64), context, false),
    /IDEMPOTENCY_CONFLICT/,
  );
  if (stagedResult) {
    await admin.query('delete from auth.sessions where id=$1', [session]);
    await assert.rejects(admit(first, key, hash, context, false), /FORBIDDEN/);
    checks.push(
      'revoking the synthetic session denies replay of the persisted success',
    );
  }
  assert.equal(
    await value(
      admin,
      'select count(*)::int as value from app.attempts where execution_id=$1',
      [r.executionId],
    ),
    1,
  );
}

async function runInterrupted(admin, first, second, context) {
  const run = async (hash, available) => {
    await actor(first, true);
    try {
      return await value(
        first,
        `select app_private.admit_practice_run(
        $1,'97000000-0000-4000-8000-000000000001','98000000-0000-4000-8000-000000000001',
        '96100000-0000-4000-8000-000000000001','synthetic-interrupted-run',$2,repeat('b',64),
        repeat('c',64),1,'sql-test',$3,$4,1,4,10,$5::jsonb) as value`,
        [randomUUID(), hash, randomUUID(), available, JSON.stringify(context)],
      );
    } finally {
      await actor(first, false);
    }
  };
  const reservation = await run('a'.repeat(64), true);
  const resource = await begin(first, reservation);
  const vm = 'fixture-' + randomUUID();
  await confirm(first, resource, vm);
  await value(
    first,
    'select app_private.assert_sandbox_active($1,$2) as value',
    [reservation.executionId, reservation.leaseToken],
  );
  await admin.query(
    "update app.executions set lease_until=clock_timestamp()-interval '1 second' where id=$1",
    [reservation.executionId],
  );
  const recovery = await value(
    second,
    'select app_private.claim_expired_practice_run() as value',
  );
  assert.equal(recovery.executionId, reservation.executionId);
  assert.notEqual(recovery.leaseToken, reservation.leaseToken);
  const result = { ...unknown };
  delete result.hiddenChecksPassed;
  delete result.allRequiredPassed;
  const finalize = (token) =>
    value(
      second,
      'select app_private.finish_practice_run($1,$2,$3::jsonb,true) as value',
      [reservation.executionId, token, JSON.stringify(result)],
    );
  await assert.rejects(finalize(reservation.leaseToken), /REQUEST_IN_PROGRESS/);
  await assert.rejects(finalize(recovery.leaseToken), /REQUEST_IN_PROGRESS/);
  await verify(second, resource, cleanupProof(resource, vm));
  const finished = await finalize(recovery.leaseToken);
  assert.equal(finished.technicalResult.diagnosisCode, 'UNKNOWN');
  assert.deepEqual((await run('a'.repeat(64), false)).response, finished);
  await assert.rejects(run('b'.repeat(64), false), /IDEMPOTENCY_CONFLICT/);
  assert.equal(
    await value(
      admin,
      'select count(*)::int as value from app.attempts where execution_id=$1',
      [reservation.executionId],
    ),
    0,
  );
}

// A separate Linux design model, not a new provider in NestJS.
function acceptsLinuxObservation(receipt, observed) {
  const required = ['vm', 'disk', 'nic', 'snapshot'];
  return (
    Number.isFinite(observed.observedAt) &&
    typeof observed.inventory === 'object' &&
    observed.inventory !== null &&
    observed.scope === receipt.scope &&
    observed.vmId === receipt.vmId &&
    observed.dispatchId === receipt.dispatchId &&
    observed.observedAt >= receipt.confirmedAt &&
    required.every(
      (kind) =>
        observed.inventory[kind]?.status === 'complete' &&
        Array.isArray(observed.inventory[kind].ownedIds) &&
        observed.inventory[kind].ownedIds.length === 0,
    )
  );
}

function linuxInventoryCases() {
  const receipt = {
    scope: 'synthetic-private-target',
    vmId: 'vm-fixed',
    dispatchId: 'dispatch-fixed',
    confirmedAt: 100,
  };
  const observation = {
    ...receipt,
    observedAt: 101,
    inventory: Object.fromEntries(
      ['vm', 'disk', 'nic', 'snapshot'].map((k) => [
        k,
        { status: 'complete', ownedIds: [] },
      ]),
    ),
  };
  assert.equal(acceptsLinuxObservation(receipt, observation), true);
  let rejected = 0;
  const reject = (candidate) => {
    assert.equal(acceptsLinuxObservation(receipt, candidate), false);
    rejected++;
  };
  for (const field of ['scope', 'vmId', 'dispatchId'])
    reject({ ...observation, [field]: 'foreign' });
  reject({ ...observation, observedAt: 99 });
  reject({ ...observation, observedAt: Number.POSITIVE_INFINITY });
  reject({ ...observation, inventory: null });
  for (const kind of ['vm', 'disk', 'nic', 'snapshot']) {
    for (const sample of [
      undefined,
      { status: 'permission-denied', ownedIds: [] },
      { status: 'partial', ownedIds: [] },
      { status: 'complete', ownedIds: ['remaining'] },
    ]) {
      reject({
        ...observation,
        inventory: { ...observation.inventory, [kind]: sample },
      });
    }
  }
  return { accepted: 1, rejected, simulatedInventory: true };
}

const binaryDirectory = process.argv[2];
if (!binaryDirectory || process.argv.length !== 3)
  throw new Error('Provide only the installed PostgreSQL bin directory');
const report = await withIsolatedPostgres(
  binaryDirectory,
  async (admin, connection) => {
    const installedMigrations = await foundation(admin);
    const cred = randomBytes(32).toString('hex');
    await admin.query("alter role alunza_app password '" + cred + "'");
    const first = new pg.Client({
      ...connection,
      user: 'alunza_app',
      password: cred,
    });
    const second = new pg.Client({
      ...connection,
      user: 'alunza_app',
      password: cred,
    });
    await first.connect();
    try {
      await second.connect();
      try {
        const context = {
          provider: 'vercel',
          runnerVersion: 'sql-test',
          image: 'alunza/runner@sha256:' + 'a'.repeat(64),
          teamId: 'team_test',
          projectId: 'prj_test',
          region: 'iad1',
          campaignId: randomUUID(),
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
          maxCreations: 3,
          maxRequests: 42,
        };
        const checks = [];
        await assert.rejects(
          admit(first, 'linux-unsupported', 'c'.repeat(64), {
            ...context,
            provider: 'linux',
          }),
          /INVALID_EXECUTION_CONTEXT/,
        );
        checks.push(
          'current migration rejects an unimplemented Linux provider',
        );
        await runInterrupted(admin, first, second, context);
        checks.push(
          'interrupted RUN with confirmed resource: fenced lease, required cleanup, recovered UNKNOWN replay, no attempt',
        );
        for (const stageName of ['prepared', 'lost-receipt', 'staged'])
          await submitScenario({
            admin,
            first,
            second,
            stageName,
            context,
            checks,
          });
        const usage = await value(
          admin,
          'select creations as value from app_private.sandbox_campaigns where id=$1',
          [context.campaignId],
        );
        assert.equal(usage, 3);
        checks.push(
          'two live alunza_app sessions, SKIP LOCKED, rotated leases, fenced prior workers',
          'one durable dispatch per authorized execution',
          'missing or partial cleanup evidence prevents finish',
          'admissions off: replay with current authorization; conflicting payload rejected; one attempt',
        );
        return {
          status: 'passed',
          pgVersion: (await admin.query('show server_version')).rows[0]
            .server_version,
          sqlProviderContract: 'vercel',
          hypervisorCalls: 0,
          providerCalls: 0,
          syntheticAuth: true,
          installedMigrations,
          sqlScenarios: { RUN: 1, SUBMIT: 3 },
          sqlChecks: checks,
          linuxInventory: linuxInventoryCases(),
        };
      } finally {
        await second.end();
      }
    } finally {
      await first.end();
    }
  },
);
console.log(
  JSON.stringify({ ...report, temporaryClusterRemoved: true }, null, 2),
);
