import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { applicationUrl } from './local.mjs';
import { assertRuntimeTarget, testTarget } from './local-target.mjs';

function check(value, message) {
  if (!value) throw new Error(`Evaluation ledger: ${message}`);
}
const zeroHash = '0'.repeat(64);
const digest = '1'.repeat(64);
const budget = (calls = 1) => ({
  maxCalls: calls,
  maxInputTokens: 100,
  maxOutputTokens: 100,
  maxCostMicroUsd: '10',
});
const profile = (id, model, dimensions) => ({
  id,
  model,
  ...(dimensions ? { dimensions } : {}),
  fingerprint: zeroHash,
  inputMicroUsdPerMillion: '1000000',
  outputMicroUsdPerMillion: '0',
});

async function worker() {
  const input = await new Promise((resolve) =>
    process.once('message', resolve),
  );
  const address = new URL(input.url);
  check(
    address.hostname === '127.0.0.1' &&
      address.port === String(testTarget.dbPort) &&
      address.username === 'alunza_app',
    'child requires the limited TEST role',
  );
  const db = new pg.Client({
    connectionString: input.url,
    connectionTimeoutMillis: 3000,
    statement_timeout: 4000,
  });
  try {
    await db.connect();
    const role = await db.query(
      "select current_user='alunza_app' and not rolbypassrls and not rolsuper as valid from pg_roles where rolname=current_user",
    );
    check(role.rows[0]?.valid, 'child role must obey RLS');
    process.send?.({ ready: true });
    await new Promise((resolve) => process.once('message', resolve));
    await db.query('begin');
    await db.query(
      "select set_config('app.actor_id','',true),set_config('app.session_id','',true),set_config('app.organization_id','',true)",
    );
    const result = await db.query(
      'select app_private.evaluation_reserve($1::jsonb,true) as result',
      [JSON.stringify(input.spec)],
    );
    await db.query('commit');
    process.send?.({ result: result.rows[0].result });
  } catch (error) {
    await db.query('rollback').catch(() => undefined);
    process.send?.({
      error:
        error?.code === 'P0001' && error?.message === 'RATE_LIMITED'
          ? 'RATE_LIMITED'
          : 'FAILED',
    });
  } finally {
    await db.end().catch(() => undefined);
    process.disconnect?.();
  }
}

async function raceDispatches(url, specs) {
  const children = specs.map(() =>
    spawn(process.execPath, [fileURLToPath(import.meta.url), '--child'], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: { ...process.env },
    }),
  );
  try {
    const ready = children.map(
      (child) =>
        new Promise((resolve, reject) => {
          child.once('error', reject);
          child.once('message', (message) =>
            message?.ready
              ? resolve()
              : reject(new Error('Evaluation child did not initialize')),
          );
          child.stdout.on('data', () =>
            reject(new Error('Evaluation child emitted unexpected output')),
          );
        }),
    );
    const completed = children.map(
      (child) =>
        new Promise((resolve, reject) => {
          child.on('message', (message) => {
            if (message?.result || message?.error) resolve(message);
          });
          child.once('error', reject);
          child.once('exit', (code) => {
            if (code) reject(new Error('Evaluation child failed'));
          });
        }),
    );
    children.forEach((child, index) => child.send({ url, spec: specs[index] }));
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('Evaluation children exceeded deadline')),
        12000,
      );
    });
    try {
      await Promise.race([Promise.all(ready), timeout]);
      children.forEach((child) => child.send({ start: true }));
      return await Promise.race([Promise.all(completed), timeout]);
    } finally {
      clearTimeout(timer);
    }
  } finally {
    children.forEach((child) => {
      if (!child.killed) child.kill();
    });
  }
}

/** Executes only inside the caller's already-owned TEST stack, after ordinary
 * product suites. Creates no provider clients, services, containers or resets. */
export async function verifyEvaluationLedger({ ctx, state }) {
  assertRuntimeTarget(state, testTarget);
  const address = new URL(state.migrationUrl);
  check(
    ctx.projectId === testTarget.projectId &&
      state.projectId === ctx.projectId &&
      address.hostname === '127.0.0.1' &&
      address.port === String(testTarget.dbPort),
    'unexpected TEST destination',
  );
  const db = new pg.Client({
    connectionString: state.migrationUrl,
    connectionTimeoutMillis: 3000,
    statement_timeout: 5000,
  });
  const ordinary = new pg.Client({
    connectionString: applicationUrl(ctx, state),
    connectionTimeoutMillis: 3000,
    statement_timeout: 5000,
  });
  const runId = randomUUID(),
    actor = randomUUID(),
    session = randomUUID(),
    org = randomUUID(),
    otherOrg = randomUUID();
  const cls = randomUUID(),
    otherClass = randomUUID(),
    course = randomUUID(),
    otherCourse = randomUUID();
  const jobs = [];
  const call = async (name, values) => {
    await ordinary.query('begin');
    try {
      await ordinary.query(
        "select set_config('app.actor_id','',true),set_config('app.session_id','',true),set_config('app.organization_id','',true)",
      );
      const result = await ordinary.query(
        `select app_private.${name}(${values.map((_, i) => `$${i + 1}`).join(',')}) as result`,
        values,
      );
      await ordinary.query('commit');
      return result.rows[0]?.result;
    } catch (error) {
      await ordinary.query('rollback').catch(() => undefined);
      throw error;
    }
  };
  let authorized = false;
  try {
    await db.connect();
    await ordinary.connect();
    const ordinaryRole = await ordinary.query(
      "select current_user='alunza_app' and not rolbypassrls and not rolsuper as valid from pg_roles where rolname=current_user",
    );
    check(
      ordinaryRole.rows[0]?.valid,
      'fixture reservations require the real limited TEST connection',
    );
    const p = (
      await db.query(
        'select configuration_id,model,dimensions from app_private.material_embedding_profile',
      )
    ).rows[0] ?? {
      configuration_id: 'evaluation-fixture-3d',
      model: 'fixture',
      dimensions: 3,
    };
    const embedding = profile(p.configuration_id, p.model, p.dimensions);
    await db.query('begin');
    await db.query(
      'insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',
      [actor, `evaluation-ledger-${actor}@alunza.test`],
    );
    await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [
      session,
      actor,
    ]);
    await db.query(
      "insert into app.profiles(id,display_name,email_normalized,account_state) values($1,'Ledger fixture',$2,'ACTIVE')",
      [actor, `evaluation-ledger-${actor}@alunza.test`],
    );
    for (const [organization, classroom, courseId] of [
      [org, cls, course],
      [otherOrg, otherClass, otherCourse],
    ]) {
      await db.query(
        "insert into app.organizations(id,code,name) values($1,$2,'Ledger fixture')",
        [
          organization,
          `LEDGER-${organization.replaceAll('-', '').toUpperCase()}`,
        ],
      );
      await db.query(
        "insert into app.organization_memberships(organization_id,user_id,role,state,joined_at) values($1,$2,'TEACHER','ACTIVE',now())",
        [organization, actor],
      );
      await db.query(
        "insert into app.courses(id,organization_id,code,name,academic_period) values($1,$2,'LEDGER','Ledger fixture','2026-2')",
        [courseId, organization],
      );
      await db.query(
        "insert into app.classes(id,organization_id,course_id,teacher_id,code,name) values($1,$2,$3,$4,'LEDGER','Ledger fixture')",
        [classroom, organization, courseId, actor],
      );
    }
    // The limited connection must see committed identity and class fixtures.
    await db.query('commit');
    for (const classroom of [cls, cls, otherClass]) {
      const token = randomUUID();
      let reserved;
      await ordinary.query('begin');
      try {
        await ordinary.query(
          "select set_config('app.actor_id',$1,true),set_config('app.session_id',$2,true),set_config('app.organization_id','',true)",
          [actor, session],
        );
        reserved = (
          await ordinary.query(
            "select app_private.material_reserve_upload($1,null,null,null,'Ledger fixture','ledger.txt','TXT','text/plain',1,$2,$3,$4) as result",
            [classroom, zeroHash, randomUUID(), randomUUID()],
          )
        ).rows[0].result;
        jobs.push({ id: reserved.jobId, token });
        await ordinary.query('commit');
      } catch (error) {
        await ordinary.query('rollback').catch(() => undefined);
        throw error;
      }
      await db.query(
        "update app.material_jobs set lifecycle_status='RUNNING',attempt_count=1,lease_token=$2,lease_until=clock_timestamp()+interval '5 minutes' where id=$1",
        [reserved.jobId, token],
      );
    }
    const manifest = {
      version: 1,
      runId,
      environment: 'TEST',
      provider: 'TEST',
      releaseSha: 'a'.repeat(40),
      environmentHash: zeroHash,
      corpusHash: zeroHash,
      priceVersion: 'TEST-only',
      approvedBy: 'automated TEST fixture',
      approvalReference: 'multiprocess budget verification',
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      globalBudget: budget(),
      stages: Object.fromEntries(
        ['INGESTION', 'CALIBRATION', 'FUNCTIONAL', 'EVALUATION'].map(
          (stage) => [stage, budget()],
        ),
      ),
      profiles: {
        EMBEDDING: embedding,
        GENERATION: profile('fixture-generation', 'fixture'),
        REVIEW: profile('fixture-review', 'fixture'),
      },
      materials: [
        {
          id: randomUUID(),
          actorId: actor,
          organizationId: org,
          classId: cls,
          activityId: null,
          sha256: zeroHash,
          format: 'TXT',
          operation: 'UPLOAD',
          maxOperations: 2,
        },
      ],
      cases: [],
    };
    await db.query('select app_private.evaluation_authorize($1::jsonb,$2)', [
      JSON.stringify(manifest),
      digest,
    ]);
    authorized = true;
    let changed = false;
    try {
      await db.query('select app_private.evaluation_authorize($1::jsonb,$2)', [
        JSON.stringify({ ...manifest, globalBudget: budget(2) }),
        digest,
      ]);
    } catch (error) {
      changed =
        error.code === 'P0001' && error.message === 'IDEMPOTENCY_CONFLICT';
    }
    check(changed, 'modified grant must be rejected');
    await call('evaluation_start_stage', [runId, digest, 'INGESTION']);
    const specification = (job) => ({
      owner: { kind: 'MATERIAL', ...job },
      phase: 'EMBEDDING',
      logicalKey: 'batch:0',
      inputHash: zeroHash,
      configuration: {
        id: embedding.id,
        model: embedding.model,
        dimensions: embedding.dimensions,
        fingerprint: zeroHash,
      },
      reservedInputTokens: 1,
      maxOutputTokens: 0,
    });
    let foreign = false;
    try {
      await call('evaluation_reserve', [
        JSON.stringify(specification(jobs[2])),
        true,
      ]);
    } catch (error) {
      foreign = error.code === '42501';
    }
    check(foreign, 'foreign organization must not bind to the run');
    const outcomes = await raceDispatches(
      applicationUrl(ctx, state),
      jobs.slice(0, 2).map(specification),
    );
    const winner = outcomes.find(
      (entry) => entry.result?.state === 'DISPATCH',
    )?.result;
    check(
      winner &&
        outcomes.filter((entry) => entry.error === 'RATE_LIMITED').length === 1,
      'two independent processes must receive exactly one last slot',
    );
    const counts = (
      await db.query(
        'select count(*)::integer n from app_private.ai_call_receipts where run_id=$1',
        [runId],
      )
    ).rows[0];
    check(
      counts.n === 1,
      'concurrent denial must not leave a duplicate paid call',
    );
    await call('evaluation_complete', [
      winner.callId,
      winner.dispatchToken,
      null,
      null,
    ]);
    const unknown = await call('evaluation_status', [runId, digest]);
    check(
      unknown.totals.unknownCalls === 1 && unknown.totals.costMicroUsd === '1',
      'unknown call retains conservative exposure',
    );
    await call('evaluation_stop', [runId, digest]);
    await call('evaluation_observe', [
      winner.callId,
      winner.dispatchToken,
      JSON.stringify({
        phase: 'EMBEDDING',
        outcome: 'RESPONSE',
        settledAt: new Date().toISOString(),
        aborted: true,
        model: embedding.model,
        requestId: 'test-late',
        usage: { inputTokens: 1 },
      }),
    ]);
    check(
      (await call('evaluation_status', [runId, digest])).state === 'STOPPED',
      'late accounting must not reactivate the run',
    );
    const expiryRun = randomUUID();
    await db.query('select app_private.evaluation_authorize($1::jsonb,$2)', [
      JSON.stringify({
        ...manifest,
        runId: expiryRun,
        materials: manifest.materials.map((item) => ({
          ...item,
          id: randomUUID(),
        })),
        expiresAt: new Date(Date.now() + 300).toISOString(),
      }),
      digest,
    ]);
    await delay(350);
    let expired = false;
    try {
      await call('evaluation_start_stage', [expiryRun, digest, 'INGESTION']);
    } catch (error) {
      expired = error.code === '42501';
    }
    check(expired, 'expired grant cannot start a paid stage');
    for (const operation of [
      'evaluation_status',
      'evaluation_receipts',
      'evaluation_stop',
    ]) {
      let denied = false;
      try {
        await call(operation, [expiryRun, digest]);
      } catch (error) {
        denied = error.code === '42501';
      }
      check(denied, `expired capability cannot call ${operation}`);
    }
    // The expired capability has no operational authority. This isolated TEST
    // fixture is closed using its existing maintenance connection, never renewed.
    await db.query(
      "update app_private.evaluation_runs set state='STOPPED',stopped_at=clock_timestamp() where id=$1 and expires_at<=clock_timestamp()",
      [expiryRun],
    );
    return {
      status: 'PASSED',
      checks: 10,
      processes: 2,
      providerCalls: 0,
      scope: 'TEST-only durable ledger',
    };
  } finally {
    await ordinary.query('rollback').catch(() => undefined);
    await db.query('rollback').catch(() => undefined);
    if (authorized)
      await call('evaluation_stop', [runId, digest]).catch(() => undefined);
    if (jobs.length)
      await db
        .query(
          "update app.material_jobs set lifecycle_status='FAILED',lease_until=null,completed_at=clock_timestamp(),last_error_code='TEST_LEDGER_FINISHED' where id=any($1::uuid[]) and lifecycle_status in('UPLOADING','QUEUED','RUNNING')",
          [jobs.map((job) => job.id)],
        )
        .catch(() => undefined);
    await ordinary.end().catch(() => undefined);
    await db.end().catch(() => undefined);
  }
}

if (process.argv[2] === '--child' && process.send) {
  await worker().catch(() => {
    process.send?.({ error: 'FAILED' });
    process.disconnect?.();
    process.exitCode = 1;
  });
}
