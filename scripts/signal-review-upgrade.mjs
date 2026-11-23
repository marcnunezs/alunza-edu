import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
import {
  immutableReviewSources,
  signalReviewFacts,
} from '../tests/integration/helpers/signal-review.mjs';

const fromVersion = '20261027182430';
const toVersion = '20261101172048';
const migration = `${toVersion}_signal_review.sql`;
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
    to_regprocedure('app_private.signal_review(uuid)') IS NOT NULL AS review_present,
    EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='app_private' AND p.proname='signal_review' AND p.prosecdef
      AND pg_get_userbyid(p.proowner)='alunza_identity'
      AND has_function_privilege('alunza_app',p.oid,'EXECUTE')
      AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
      AND NOT has_function_privilege('anon',p.oid,'EXECUTE')) AS safe_entrypoint,
    has_function_privilege('alunza_app','app_private.signal_review_fixture(uuid,uuid)','EXECUTE') AS fixture_granted`)
  ).rows[0];
}
async function snapshot(database, harness, scope) {
  const result = {
    ...(await harness.snapshot(scope)),
    ...(await immutableReviewSources(database, scope)),
  };
  for (const table of [
    'signal_lanes',
    'signal_jobs',
    'signal_snapshots',
    'signal_evaluations',
    'signal_episodes',
    'signal_reviews',
    'signal_witnesses',
    'signal_projections',
    'signal_change_acks',
  ])
    result[table] = (
      await database.query(
        `SELECT count(*)::integer AS count,md5(coalesce(string_agg(to_jsonb(t)::text,',' ORDER BY to_jsonb(t)::text),'')) AS digest
      FROM app_private.${table} t WHERE ${table === 'signal_lanes' ? 'id' : 'lane_id'} IN (SELECT id FROM app_private.signal_lanes WHERE organization_id=$1)`,
        [scope.organizationId],
      )
    ).rows[0];
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
export async function prepareSignalReviewUpgrade({ ctx, state }) {
  assertRuntimeTarget(state, testTarget);
  const owner = new pg.Client({ connectionString: state.migrationUrl });
  let api, harness;
  try {
    await owner.connect();
    const beforeSchema = await schemaState(owner);
    assert.equal(beforeSchema.version, fromVersion);
    assert.equal(beforeSchema.review_present, false);
    assert.equal(beforeSchema.fixture_granted, false);
    await buildApi();
    api = testApi(ctx, state, ctx.webPort, {
      SIGNALS_WORKER_ENABLED: 'false',
      INVITATION_WORKER_ENABLED: 'false',
    });
    await api.start(`${testTarget.apiUrl}/health/live`);
    await api.wait(`${testTarget.apiUrl}/health/ready`, 503);
    harness = await createStudentDetailHarness(state);
    const scope = await harness.prepare();
    const active = scope.signals.filter((signal) => signal.state === 'ACTIVE');
    assert.ok(active.length >= 2);
    const historicalId = active[0].id,
      reviewId = active[1].id;
    await owner.query('SELECT app_private.signal_review_fixture($1,$2)', [
      historicalId,
      harness.actors.teacher.id,
    ]);
    const historical = await signalReviewFacts(owner, scope, historicalId);
    assert.equal(historical.reviews.length, 1);
    await api.stop();
    const before = await snapshot(owner, harness, scope);
    const immutableBefore = await immutableReviewSources(owner, scope);
    assert.ok(before['app.attempts'].count > 0);
    assert.ok(before['app.feedbacks'].count > 0);
    assert.ok(before.signal_reviews.count > 0);
    return async function verifySignalReviewUpgrade() {
      let current = state,
        client,
        upgradedApi;
      try {
        current = await readState(ctx);
        assertRuntimeTarget(current, testTarget);
        client = new pg.Client({ connectionString: current.migrationUrl });
        await client.connect();
        const afterSchema = await schemaState(client);
        assert.equal(afterSchema.version, toVersion);
        assert.equal(afterSchema.safe_entrypoint, true);
        assert.equal(afterSchema.fixture_granted, false);
        const after = await snapshot(client, harness, scope);
        assert.deepEqual(
          after,
          before,
          'SIGNAL_REVIEW_UPGRADE_CHANGED_HISTORY',
        );
        upgradedApi = testApi(ctx, current, ctx.webPort, workersDisabled);
        await upgradedApi.start(`${testTarget.apiUrl}/health/ready`);
        const result = await harness.request(`/signals/${reviewId}/review`, {
          method: 'PUT',
          body: {},
        });
        assert.equal(result.status, 200);
        const contracts = await import('@alunza/contracts');
        contracts.signalReviewResponseSchema.parse({
          data: result.data,
          requestId: result.requestId,
        });
        assert.equal(result.data.reviewedBy, harness.actors.teacher.id);
        assert.equal(
          (await signalReviewFacts(client, scope, reviewId)).audits.length,
          1,
        );
        assert.deepEqual(
          await signalReviewFacts(client, scope, historicalId),
          historical,
        );
        const replay = await harness.request(`/signals/${reviewId}/review`, {
          method: 'PUT',
          body: {},
        });
        assert.deepEqual(replay.data, result.data);
        assert.deepEqual(
          await immutableReviewSources(client, scope),
          immutableBefore,
        );
        return {
          status: 'passed',
          increment: 'IMP-06.04',
          from: fromVersion,
          to: toVersion,
          migration,
          beforeDigest: digest(before),
          afterDigest: digest(after),
          beforeSchema,
          afterSchema,
          preserved: Object.fromEntries(
            Object.entries(before).map(([name, value]) => [name, value.count]),
          ),
          readinessBefore: 503,
          readinessAfter: 200,
          authenticatedReviewSmoke: true,
          historicalReviewPreserved: true,
          replayPreserved: true,
          fixture:
            'Existing .03 APIs, Docker submissions, delivered TEST help and a pre-migration private fixture review; new review is public HTTP only.',
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
export async function runSignalReviewUpgrade() {
  try {
    return await withTestEnvironment(
      async ({ upgrade }) => {
        assert.ok(upgrade, 'SIGNAL_REVIEW_UPGRADE_REPORT_MISSING');
        await report('signal-review-upgrade', upgrade, 'imp-06');
        return upgrade;
      },
      [],
      {
        upgradeFromVersion: fromVersion,
        beforeUpgrade: prepareSignalReviewUpgrade,
      },
    );
  } catch (error) {
    const directory = join(root, '.local/evidence/imp-06');
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, 'signal-review-upgrade-error.log'),
      redactDiagnostics(error.output ?? error.stack ?? error.message),
      { mode: 0o600 },
    );
    await report(
      'signal-review-upgrade',
      { status: 'failed', from: fromVersion, to: toVersion, migration },
      'imp-06',
    );
    throw new Error(
      'La actualización de revisión falló; revisar .local/evidence/imp-06/signal-review-upgrade-error.log.',
      { cause: error },
    );
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  runSignalReviewUpgrade()
    .then(() =>
      console.log(
        'Actualización IMP-06.03 → IMP-06.04: historia preservada y revisión pública verificada.',
      ),
    )
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
