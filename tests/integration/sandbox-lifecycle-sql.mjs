import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { applicationUrl } from '../../scripts/local.mjs';
import {
  assertRuntimeTarget,
  testTarget,
} from '../../scripts/local-target.mjs';

/** Keep live pre-migration Docker reservations and canonical SUBMIT evidence. */
export async function prepareSandboxLegacyUpgrade({ state }) {
  assertRuntimeTarget(state, testTarget);
  const before = new pg.Client({ connectionString: state.migrationUrl });
  await before.connect();
  const runId = '99200000-0000-4000-8000-000000001001';
  const submitId = '99200000-0000-4000-8000-000000001002';
  const technical = {
    runnerVersion: 'sql-test',
    diagnosisCode: 'SUCCESS',
    terminationReason: 'COMPLETED',
    infrastructureStatus: 'OK',
    visibleTestResults: [
      { id: 'visible', passed: true, stdout: '', stderr: '' },
    ],
    visiblePassed: 1,
    visibleTotal: 1,
    outputTruncated: false,
    outputBytes: 0,
    runtimeMs: 10,
    lifecycleMs: 20,
    hiddenChecksPassed: true,
    allRequiredPassed: true,
  };
  const snapshotSql = `SELECT id,organization_id,class_id,code,code_hash,test_suite_hash,runner_version,admitted_at,lease_token,staged_result,staged_private_results
    FROM app_private.submission_reservations WHERE id=$1`;
  let run;
  let submit;
  let snapshot;
  try {
    const fixture = (
      await readFile(
        new URL(
          '../../supabase/tests/023_practice_sandbox.test.sql',
          import.meta.url,
        ),
        'utf8',
      )
    )
      .split('-- SANDBOX FIXTURE READY')[0]
      .replace('select no_plan();', '');
    await before.query(fixture);
    await before.query('COMMIT');
    await before.query(`BEGIN; SET LOCAL ROLE alunza_app;
      SET LOCAL app.actor_id='91000000-0000-4000-8000-000000000003';
      SET LOCAL app.session_id='91100000-0000-4000-8000-000000000003';
      SET LOCAL app.organization_id='92000000-0000-4000-8000-000000000001'`);
    run = (
      await before.query(
        `SELECT app_private.admit_practice_run($1::uuid,'97000000-0000-4000-8000-000000000001','98000000-0000-4000-8000-000000000001',
      '96100000-0000-4000-8000-000000000001','upgrade-live-run',repeat('a',64),repeat('b',64),repeat('c',64),1,'sql-test',$2::uuid,true,1,4,10) AS value`,
        [runId, randomUUID()],
      )
    ).rows[0].value;
    submit = (
      await before.query(
        `SELECT app_private.admit_practice_submit($1::uuid,'97000000-0000-4000-8000-000000000001','98000000-0000-4000-8000-000000000001',
      '96100000-0000-4000-8000-000000000001','upgrade-live-submit',repeat('a',64),'module.exports.solve=(a,b)=>a+b;',null,'sql-test',$2::uuid,true,2,4,10) AS value`,
        [submitId, randomUUID()],
      )
    ).rows[0].value;
    await before.query(
      "SET LOCAL app.actor_id=''; SET LOCAL app.session_id=''",
    );
    await before.query(
      'SELECT app_private.stage_practice_submit_result($1::uuid,$2::uuid,$3::jsonb,$4::jsonb)',
      [
        submitId,
        submit.leaseToken,
        JSON.stringify(technical),
        JSON.stringify([{ id: 'hidden-sentinel', passed: true }]),
      ],
    );
    await before.query('COMMIT');
    // Fixture extension keeps migration runtime outside the behavior under test.
    await before.query(
      "UPDATE app.executions SET lease_until=clock_timestamp()+interval '30 minutes' WHERE id=$1",
      [runId],
    );
    await before.query(
      "UPDATE app_private.submission_reservations SET lease_until=clock_timestamp()+interval '30 minutes' WHERE id=$1",
      [submitId],
    );
    snapshot = (await before.query(snapshotSql, [submitId])).rows[0];
  } finally {
    await before.end();
  }
  return async () => {
    const after = new pg.Client({ connectionString: state.migrationUrl });
    await after.connect();
    try {
      assert.deepEqual(
        (await after.query(snapshotSql, [submitId])).rows[0],
        snapshot,
      );
      assert.equal(
        (
          await after.query(
            'SELECT execution_context FROM app_private.submission_reservations WHERE id=$1',
            [submitId],
          )
        ).rows[0].execution_context,
        null,
      );
      assert.equal(
        (
          await after.query(
            'SELECT count(*)::int AS count FROM app_private.sandbox_resources',
          )
        ).rows[0].count,
        0,
      );
      await after.query(
        "BEGIN; SET LOCAL ROLE alunza_app; SET LOCAL app.actor_id=''; SET LOCAL app.session_id=''",
      );
      const runResult = { ...technical };
      delete runResult.hiddenChecksPassed;
      delete runResult.allRequiredPassed;
      const completedRun = (
        await after.query(
          'SELECT app_private.finish_practice_run($1::uuid,$2::uuid,$3::jsonb,true) AS value',
          [runId, run.leaseToken, JSON.stringify(runResult)],
        )
      ).rows[0].value;
      const completedSubmit = (
        await after.query(
          'SELECT app_private.finish_practice_submit($1::uuid,$2::uuid,true) AS value',
          [submitId, submit.leaseToken],
        )
      ).rows[0].value;
      assert.equal(completedRun.executionId, runId);
      assert.deepEqual(completedSubmit.technicalResult, technical);
      await after.query('COMMIT');
      assert.equal(
        (
          await after.query(
            'SELECT count(*)::int AS count FROM app.attempts WHERE execution_id=$1',
            [submitId],
          )
        ).rows[0].count,
        1,
      );
      return {
        status: 'passed',
        from: '20261103005407',
        to: '20261104023230',
        checks: 6,
        provider: 'NONE',
        preserved: [
          'live-run',
          'live-submit',
          'canonical-stage',
          'admission-scope',
          'source-and-suite-hashes',
          'legacy-finalization',
        ],
      };
    } finally {
      await after.end();
    }
  };
}

/** Runs only inside the exclusive withTestEnvironment fixture, without providers. */
export async function runSandboxLifecycleConcurrency({ ctx, state }) {
  assertRuntimeTarget(state, testTarget);
  const admin = new pg.Client({ connectionString: state.migrationUrl });
  await admin.connect();
  const id = (n) => `99200000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  try {
    const fixture = (
      await readFile(
        new URL(
          '../../supabase/tests/023_practice_sandbox.test.sql',
          import.meta.url,
        ),
        'utf8',
      )
    )
      .split('-- SANDBOX FIXTURE READY')[0]
      .replace('select no_plan();', '');
    await admin.query(fixture);
    await admin.query('COMMIT');
    const context = (campaign) => ({
      provider: 'vercel',
      runnerVersion: 'sql-test',
      image: `alunza/runner@sha256:${'a'.repeat(64)}`,
      teamId: 'team_test',
      projectId: 'prj_test',
      region: 'iad1',
      campaignId: id(campaign),
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      maxCreations: 1,
      maxRequests: 10,
    });
    const transaction = async (action, actor = false) => {
      const client = new pg.Client({
        connectionString: applicationUrl(ctx, state),
      });
      await client.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          "SELECT set_config('app.actor_id',$1,true),set_config('app.session_id',$2,true),set_config('app.organization_id',$3,true)",
          [
            actor ? '91000000-0000-4000-8000-000000000003' : '',
            actor ? '91100000-0000-4000-8000-000000000003' : '',
            actor ? '92000000-0000-4000-8000-000000000001' : '',
          ],
        );
        const result = await action(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        await client.end();
      }
    };
    const admit = (n, campaign, key = `concurrent-sandbox-${n}`) =>
      transaction(
        async (client) =>
          (
            await client.query(
              `SELECT app_private.admit_practice_submit($1::uuid,'97000000-0000-4000-8000-000000000001','98000000-0000-4000-8000-000000000001',
       '96100000-0000-4000-8000-000000000001',$2,repeat('a',64),'module.exports.solve=(a,b)=>a+b;',null,'sql-test',$3::uuid,true,10,32,120,$4::jsonb) AS admission`,
              [id(n), key, randomUUID(), JSON.stringify(campaign)],
            )
          ).rows[0].admission,
        true,
      );
    const begin = (reservation) =>
      transaction(
        async (client) =>
          (
            await client.query(
              'SELECT app_private.begin_sandbox_creation($1::uuid,$2::uuid) AS resource',
              [reservation.executionId, reservation.leaseToken],
            )
          ).rows[0].resource,
      );
    const observe = async (campaign) =>
      (
        await transaction((client) =>
          client.query(
            'SELECT app_private.observe_sandbox_campaign($1::uuid) AS value',
            [campaign.campaignId],
          ),
        )
      ).rows[0].value;

    const sameCampaign = context(901);
    const same = await admit(101, sameCampaign);
    const duplicateDispatch = await Promise.allSettled([
      begin(same),
      begin(same),
    ]);
    assert.equal(
      duplicateDispatch.filter((value) => value.status === 'fulfilled').length,
      1,
    );
    assert.equal(
      duplicateDispatch.find((value) => value.status === 'rejected').reason
        .message,
      'REQUEST_IN_PROGRESS',
    );
    assert.equal((await observe(sameCampaign)).creations, 1);

    const quotaCampaign = context(902);
    const [first, second] = await Promise.all([
      admit(102, quotaCampaign),
      admit(103, quotaCampaign),
    ]);
    const quotaRace = await Promise.allSettled([begin(first), begin(second)]);
    assert.equal(
      quotaRace.filter((value) => value.status === 'fulfilled').length,
      1,
    );
    assert.equal(
      quotaRace.find((value) => value.status === 'rejected').reason.message,
      'DEPENDENCY_UNAVAILABLE',
    );
    assert.equal((await observe(quotaCampaign)).creations, 1);

    const replayCampaign = context(903);
    const transport = await Promise.allSettled([
      admit(104, replayCampaign, 'shared-transport-key'),
      admit(105, replayCampaign, 'shared-transport-key'),
    ]);
    assert.equal(
      transport.filter((value) => value.status === 'fulfilled').length,
      1,
    );
    assert.equal(
      transport.find((value) => value.status === 'rejected').reason.message,
      'REQUEST_IN_PROGRESS',
    );
    assert.equal((await observe(replayCampaign)).resources.length, 1);

    const cleanupCampaign = context(904);
    const prepared = await admit(106, cleanupCampaign);
    const initial = (await observe(cleanupCampaign)).resources[0];
    const cleanupRace = await Promise.allSettled([
      begin(prepared),
      transaction((client) =>
        client.query(
          'SELECT app_private.verify_sandbox_cleanup($1::uuid,$2::jsonb)',
          [
            prepared.executionId,
            JSON.stringify({
              creationId: initial.creationId,
              kind: 'NOT_DISPATCHED',
            }),
          ],
        ),
      ),
    ]);
    assert.equal(
      cleanupRace.filter((value) => value.status === 'fulfilled').length,
      1,
    );
    const final = (await observe(cleanupCampaign)).resources[0];
    assert.ok(
      (final.creationState === 'PREPARED' &&
        final.cleanupState === 'VERIFIED') ||
        (final.creationState === 'UNKNOWN' && final.cleanupState === 'PENDING'),
    );

    const running = duplicateDispatch.find(
      (value) => value.status === 'fulfilled',
    ).value;
    const normalRequests = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        transaction((client) =>
          client.query(
            'SELECT app_private.consume_sandbox_request($1::uuid,$2::uuid,false)',
            [same.executionId, running.creationId],
          ),
        ),
      ),
    );
    assert.equal(
      normalRequests.filter((value) => value.status === 'fulfilled').length,
      2,
    );
    const cleanupRequests = await Promise.allSettled(
      Array.from({ length: 12 }, () =>
        transaction((client) =>
          client.query(
            'SELECT app_private.consume_sandbox_request($1::uuid,$2::uuid,true)',
            [same.executionId, running.creationId],
          ),
        ),
      ),
    );
    assert.equal(
      cleanupRequests.filter((value) => value.status === 'fulfilled').length,
      8,
    );
    assert.equal((await observe(sameCampaign)).totalRequests, 10);
    return {
      status: 'passed',
      cases: 5,
      checks: 16,
      provider: 'NONE',
      environment: 'LAB TEST',
      claims: [
        'one-dispatch',
        'campaign-creation-race',
        'idempotent-admission-race',
        'cleanup-dispatch-race',
        'durable-request-race',
      ],
    };
  } finally {
    await admin.query('ROLLBACK').catch(() => undefined);
    await admin.end();
  }
}
