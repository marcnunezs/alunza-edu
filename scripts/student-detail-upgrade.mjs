import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { root, readState, redactDiagnostics } from './local.mjs';
import { testTarget, assertRuntimeTarget } from './local-target.mjs';
import {
  withTestEnvironment,
  testApi,
  buildApi,
  report,
} from './test-environment.mjs';
import { createStudentDetailHarness } from '../tests/e2e/student-detail-fixture.mjs';

const require = createRequire(import.meta.url);
const fromVersion = '20261027155241';
const toVersion = '20261027182430';
const migration = `${toVersion}_student_detail.sql`;
const workersDisabled = {
  SIGNALS_WORKER_ENABLED: 'false',
  INVITATION_WORKER_ENABLED: 'false',
  MATERIALS_WORKER_ENABLED: 'false',
  HELP_WORKER_ENABLED: 'false',
};
const digest = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function schemaState(client) {
  return (
    await client.query(`SELECT
    (SELECT max(version) FROM supabase_migrations.schema_migrations) AS version,
    to_regprocedure('app_private.student_detail_progress(uuid,uuid,jsonb)') IS NOT NULL AS detail_present,
    to_regprocedure('app_private.student_detail_reference(uuid,uuid,uuid,uuid,jsonb)') IS NOT NULL AS reference_present,
    to_regprocedure('app_private.dashboard_processing_scoped(uuid,uuid,uuid,uuid,timestamptz)') IS NOT NULL AS scoped_processing_present,
    (SELECT count(*)::integer FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='app_private' AND p.proname IN ('student_detail_progress','student_detail_evidence','student_detail_attempt',
      'student_detail_feedback_history','student_detail_feedback','student_detail_reference','student_detail_signals','student_detail_signal')
      AND p.provolatile='s' AND p.prosecdef AND pg_get_userbyid(p.proowner)='alunza_identity'
      AND has_function_privilege('alunza_app',p.oid,'EXECUTE')
      AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE')) AS safe_entrypoints`)
  ).rows[0];
}

async function snapshot(client, harness, scope) {
  const result = await harness.snapshot(scope);
  const scoped = [
    'app.exercises',
    'app.activities',
    'app.sources',
    'app.source_versions',
    'app.source_chunks',
    'app.source_index_generations',
    'app.operation_keys',
    'app.signal_rule_versions',
    'app_private.attempt_results',
    'app_private.submission_reservations',
    'app_private.signal_lanes',
    'app_private.signal_input_changes',
  ];
  for (const table of scoped) {
    result[table] = (
      await client.query(
        `SELECT count(*)::integer AS count,md5(coalesce(string_agg(to_jsonb(t)::text,',' ORDER BY to_jsonb(t)::text),'')) AS digest FROM ${table} t WHERE organization_id=$1`,
        [scope.organizationId],
      )
    ).rows[0];
  }
  for (const table of [
    'app_private.signal_jobs',
    'app_private.signal_snapshots',
    'app_private.signal_evaluations',
    'app_private.signal_episodes',
    'app_private.signal_reviews',
    'app_private.signal_witnesses',
    'app_private.signal_projections',
  ]) {
    result[table] = (
      await client.query(
        `SELECT count(*)::integer AS count,md5(coalesce(string_agg(to_jsonb(t)::text,',' ORDER BY to_jsonb(t)::text),'')) AS digest FROM ${table} t
       WHERE lane_id IN (SELECT id FROM app_private.signal_lanes WHERE organization_id=$1)`,
        [scope.organizationId],
      )
    ).rows[0];
  }
  return result;
}

function preserveDiagnostic(error, state, api) {
  let diagnostic = `${error.output ?? error.stack ?? error.message}\n${api?.output ?? ''}`;
  for (const field of [
    'applicationPassword',
    'fixturePassword',
    'authAdminKey',
    'publishableKey',
    'migrationUrl',
  ])
    if (typeof state[field] === 'string' && state[field])
      diagnostic = diagnostic.split(state[field]).join('[redacted]');
  error.output = redactDiagnostics(diagnostic);
  return error;
}

async function verifyReads(harness, scope) {
  const contracts = require('@alunza/contracts');
  const base = harness.path(scope);
  const cut = `asOf=${encodeURIComponent(scope.asOf)}`;
  const read = async (suffix, schema) => {
    const result = await harness.request(`${base}${suffix}`);
    assert.equal(result.status, 200, `STUDENT_DETAIL_UPGRADE_READ_${suffix}`);
    assert.equal(result.noStore, true);
    schema.parse({ data: result.data, requestId: result.requestId });
    return result.data;
  };
  const progress = await read(
    `/progress?${cut}`,
    contracts.studentDetailProgressResponseSchema,
  );
  assert.equal(progress.roster, 'CURRENT_ACTIVE');
  assert.equal(progress.progress.summary.completed, scope.oracle.completed);
  assert.equal(progress.progress.summary.required, scope.oracle.required);
  const evidence = await read(
    `/evidence?limit=1&${cut}`,
    contracts.studentDetailEvidenceResponseSchema,
  );
  assert.equal(evidence.data.length, 1);
  const attempt = await read(
    `/attempts/${scope.attemptId}?${cut}`,
    contracts.studentDetailAttemptResponseSchema,
  );
  assert.deepEqual(attempt.attempt, scope.originalAttempt);
  assert.ok(
    attempt.exercise.tests.every((test) => test.visibility === 'visible'),
  );
  const history = await read(
    `/attempts/${scope.attemptId}/feedback?${cut}`,
    contracts.studentDetailFeedbackHistoryResponseSchema,
  );
  assert.deepEqual(
    new Set(history.items.map((item) => item.id)),
    new Set([scope.feedbackId, scope.hintId]),
  );
  await read(
    `/feedback/${scope.feedbackId}?${cut}`,
    contracts.studentDetailFeedbackResponseSchema,
  );
  await read(
    `/feedback/${scope.hintId}?${cut}`,
    contracts.studentDetailFeedbackResponseSchema,
  );
  await read(
    `/feedback/${scope.hintId}/sources/${scope.chunkId}?${cut}`,
    contracts.studentDetailReferenceResponseSchema,
  );
  const content = await harness.content(
    `${base}/feedback/${scope.hintId}/sources/${scope.chunkId}/content?${cut}`,
  );
  assert.equal(content.status, 200);
  assert.equal(content.noStore, true);
  assert.ok(content.text.length > 0);
  const signals = await read(
    `/signals?state=ALL&${cut}`,
    contracts.studentDetailSignalsResponseSchema,
  );
  assert.ok(
    signals.data.length > 0,
    'STUDENT_DETAIL_UPGRADE_PRIOR_SIGNALS_REQUIRED',
  );
  assert.ok(
    signals.data.every((signal) => signal.studentId === scope.studentId),
  );
  await read(
    `/signals/${signals.data[0].id}?${cut}`,
    contracts.studentDetailSignalResponseSchema,
  );
  for (const feedback of [scope.preparedId, scope.presentedId])
    assert.equal(
      (await harness.request(`${base}/feedback/${feedback}?${cut}`)).status,
      404,
    );
  assert.equal(
    (await harness.request(`${base}/attempts/${scope.otherAttemptId}?${cut}`))
      .status,
    404,
  );
  assert.equal(
    (await harness.request(`${base}/progress?${cut}`, { actor: 'admin' }))
      .status,
    404,
  );
  return {
    routes: 9,
    withheldHelpDenied: 2,
    crossClassDenied: true,
    adminDenied: true,
  };
}

// Exclusive TEST reservation is owned by withTestEnvironment. All pre-migration
// fixture actions use existing .02 routes; no .03 function is needed for setup.
export async function prepareStudentDetailUpgrade({ ctx, state }) {
  assertRuntimeTarget(state, testTarget);
  assert.equal(ctx.projectId, testTarget.projectId);
  assert.equal(ctx.apiPort, testTarget.apiPort);
  const owner = new pg.Client({ connectionString: state.migrationUrl });
  let api, harness;
  try {
    await owner.connect();
    const beforeSchema = await schemaState(owner);
    assert.equal(
      beforeSchema.version,
      fromVersion,
      'STUDENT_DETAIL_UPGRADE_BASELINE',
    );
    assert.equal(beforeSchema.detail_present, false);
    assert.equal(beforeSchema.reference_present, false);
    assert.equal(beforeSchema.safe_entrypoints, 0);
    await buildApi();
    api = testApi(ctx, state, ctx.webPort, {
      SIGNALS_WORKER_ENABLED: 'false',
      INVITATION_WORKER_ENABLED: 'false',
    });
    await api.start(`${testTarget.apiUrl}/health/live`);
    await api.wait(`${testTarget.apiUrl}/health/ready`, 503);
    harness = await createStudentDetailHarness(state);
    const scope = await harness.prepare({ help: true });
    await api.stop();
    const before = await snapshot(owner, harness, scope);
    for (const table of [
      'app.attempts',
      'app.feedbacks',
      'app_private.help_events',
      'app_private.signal_episodes',
      'app.audit_events',
    ])
      assert.ok(
        before[table].count > 0,
        `STUDENT_DETAIL_UPGRADE_PRIOR_FACTS_REQUIRED_${table}`,
      );
    return async function verifyStudentDetailUpgrade() {
      let current = state,
        client,
        upgradedApi;
      try {
        current = await readState(ctx);
        assertRuntimeTarget(current, testTarget);
        client = new pg.Client({ connectionString: current.migrationUrl });
        await client.connect();
        const afterSchema = await schemaState(client);
        assert.equal(
          afterSchema.version,
          toVersion,
          'STUDENT_DETAIL_UPGRADE_TARGET',
        );
        assert.equal(afterSchema.detail_present, true);
        assert.equal(afterSchema.reference_present, true);
        assert.equal(afterSchema.scoped_processing_present, true);
        assert.equal(afterSchema.safe_entrypoints, 8);
        const after = await snapshot(client, harness, scope);
        assert.deepEqual(after, before, 'STUDENT_DETAIL_UPGRADE_CHANGED_FACTS');
        upgradedApi = testApi(ctx, current, ctx.webPort, workersDisabled);
        await upgradedApi.start(`${testTarget.apiUrl}/health/ready`);
        const reads = await verifyReads(harness, scope);
        const afterReads = await snapshot(client, harness, scope);
        assert.deepEqual(
          afterReads,
          before,
          'STUDENT_DETAIL_UPGRADE_READS_CHANGED_FACTS',
        );
        return {
          status: 'passed',
          increment: 'IMP-06.03',
          from: fromVersion,
          to: toVersion,
          migration,
          beforeDigest: digest(before),
          afterDigest: digest(after),
          afterReadsDigest: digest(afterReads),
          preserved: Object.fromEntries(
            Object.entries(before).map(([name, value]) => [name, value.count]),
          ),
          beforeSchema,
          afterSchema,
          readinessBefore: 503,
          readinessAfter: 200,
          authenticatedReadSmoke: reads,
          fixture:
            'Existing APIs, canonical Docker attempts and TEST help delivery before migration; inherited deterministic dashboard capacity facts.',
          remoteProvidersUsed: false,
          academicAcceptance: 'pending',
        };
      } catch (error) {
        throw preserveDiagnostic(error, current, upgradedApi);
      } finally {
        try {
          await upgradedApi?.stop();
        } finally {
          await harness.close();
          await client?.end();
        }
      }
    };
  } catch (error) {
    await harness?.close();
    throw preserveDiagnostic(error, state, api);
  } finally {
    try {
      await api?.stop();
    } finally {
      await owner.end();
    }
  }
}

export async function runStudentDetailUpgrade() {
  try {
    return await withTestEnvironment(
      async ({ upgrade }) => {
        assert.ok(upgrade, 'STUDENT_DETAIL_UPGRADE_REPORT_MISSING');
        await report('student-detail-upgrade', upgrade, 'imp-06');
        return upgrade;
      },
      [],
      {
        upgradeFromVersion: fromVersion,
        beforeUpgrade: prepareStudentDetailUpgrade,
      },
    );
  } catch (error) {
    const directory = join(root, '.local/evidence/imp-06');
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, 'student-detail-upgrade-error.log'),
      redactDiagnostics(error.output ?? error.stack ?? error.message),
      { mode: 0o600 },
    );
    await report(
      'student-detail-upgrade',
      { status: 'failed', from: fromVersion, to: toVersion, migration },
      'imp-06',
    );
    throw new Error(
      'La actualización del detalle docente falló; revisar .local/evidence/imp-06/student-detail-upgrade-error.log.',
      { cause: error },
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  runStudentDetailUpgrade()
    .then(() => {
      console.log(
        'Actualización IMP-06.02 → IMP-06.03: evidencia y auditoría preservadas; detalle docente de solo lectura verificado.',
      );
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
