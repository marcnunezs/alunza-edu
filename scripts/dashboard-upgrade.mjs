import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import {
  root,
  readState,
  apiEnvironment,
  redactDiagnostics,
} from './local.mjs';
import { testTarget, assertRuntimeTarget } from './local-target.mjs';
import {
  withTestEnvironment,
  testApi,
  buildApi,
  report,
} from './test-environment.mjs';
import { createDashboardHarness } from '../tests/e2e/dashboard-fixture.mjs';

const require = createRequire(import.meta.url);
const fromVersion = '20261026005905';
const toVersion = '20261026163925';
const digest = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function authenticatedActor(state, actor) {
  const auth = createClient(state.authUrl, state.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const login = await auth.auth.signInWithPassword({
    email: actor.email,
    password: state.fixturePassword,
  });
  assert.equal(login.error, null, 'DASHBOARD_UPGRADE_LOGIN_FAILED');
  const token = login.data.session?.access_token;
  assert.ok(token, 'DASHBOARD_UPGRADE_SESSION_MISSING');
  return {
    actorId: actor.id,
    sessionId: JSON.parse(
      Buffer.from(token.split('.')[1], 'base64url').toString(),
    ).session_id,
  };
}

async function canonicalSnapshot(client, organizationId) {
  const { rows } = await client.query(
    `
    WITH lanes AS (SELECT id FROM app_private.signal_lanes WHERE organization_id=$1)
    SELECT jsonb_build_object(
      'attempts',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM app.attempts a WHERE a.organization_id=$1),
      'events',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM app_private.attempt_events e WHERE e.organization_id=$1),
      'observations',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM app_private.student_activity_observations e WHERE e.organization_id=$1),
      'help',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM app_private.help_events e WHERE e.organization_id=$1),
      'rules',(SELECT jsonb_agg(to_jsonb(v) ORDER BY v.id) FROM app.signal_rule_versions v WHERE v.organization_id=$1),
      'lanes',(SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM app_private.signal_lanes l WHERE l.organization_id=$1),
      'jobs',(SELECT jsonb_agg(to_jsonb(j) ORDER BY j.lane_id) FROM app_private.signal_jobs j WHERE j.lane_id IN (SELECT id FROM lanes)),
      'snapshots',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM app_private.signal_snapshots s WHERE s.lane_id IN (SELECT id FROM lanes)),
      'evaluations',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM app_private.signal_evaluations e WHERE e.lane_id IN (SELECT id FROM lanes)),
      'episodes',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM app_private.signal_episodes e WHERE e.lane_id IN (SELECT id FROM lanes)),
      'reviews',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM app_private.signal_reviews r WHERE r.lane_id IN (SELECT id FROM lanes)),
      'witnesses',(SELECT jsonb_agg(to_jsonb(w) ORDER BY w.lane_id,w.rule_version_id,w.witness_key) FROM app_private.signal_witnesses w WHERE w.lane_id IN (SELECT id FROM lanes)),
      'projections',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.episode_id) FROM app_private.signal_projections p WHERE p.lane_id IN (SELECT id FROM lanes)),
      'coverage',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM app_private.signal_coverage_epochs c),
      'audit',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM app.audit_events a WHERE a.organization_id=$1)
    ) AS value`,
    [organizationId],
  );
  return rows[0].value;
}

// The caller owns the exclusive TEST reservation. This helper starts only the
// existing API, creates canonical local facts, stops it, and returns verification.
export async function prepareDashboardUpgrade({ ctx, state }) {
  assertRuntimeTarget(state, testTarget);
  assert.equal(ctx.projectId, testTarget.projectId);
  const owner = new pg.Client({ connectionString: state.migrationUrl });
  await owner.connect();
  let api, harness, database;
  try {
    const baseline = (
      await owner.query(`SELECT
      to_regprocedure('app_private.effective_signal_rules(uuid)') IS NOT NULL AS rules,
      to_regprocedure('app_private.dashboard_read(uuid,jsonb)') IS NULL AS before_dashboard`)
    ).rows[0];
    assert.equal(baseline.rules, true, 'DASHBOARD_UPGRADE_REQUIRES_06');
    assert.equal(
      baseline.before_dashboard,
      true,
      'DASHBOARD_UPGRADE_REQUIRES_PRE_07',
    );
    await buildApi();
    api = testApi(ctx, state, ctx.webPort, { SIGNALS_WORKER_ENABLED: 'false' });
    await api.start(`http://127.0.0.1:${ctx.apiPort}/health/live`);
    await api.wait(`http://127.0.0.1:${ctx.apiPort}/health/ready`, 503);
    harness = await createDashboardHarness(state);
    const scope = await harness.prepare({ signals: true });
    const history = await harness.historical(scope);
    assert.ok(history.reviewedId);
    const student = await authenticatedActor(state, harness.actors.student);
    const teacherAccount = harness.actors.teacher;
    await import('reflect-metadata');
    const {
      DatabaseService,
    } = require('../apps/api/dist/database/database.service.js');
    const { loadConfig } = require('../apps/api/dist/config.js');
    database = new DatabaseService(
      loadConfig({
        ...apiEnvironment(ctx, state),
        SIGNALS_WORKER_ENABLED: 'false',
      }),
    );
    const cut = (
      await owner.query(
        'SELECT app_private.signal_instant(clock_timestamp()) AS value',
      )
    ).rows[0].value;
    const legacy = await database.readAs(
      student.actorId,
      async (client) =>
        (
          await client.query(
            'SELECT app_private.student_progress($1,NULL,NULL,$2) AS value',
            [scope.classroomId, cut],
          )
        ).rows[0].value,
      student.sessionId,
    );
    assert.equal(legacy.summary.completed, 1);
    assert.equal(legacy.summary.required, 3);
    const before = await canonicalSnapshot(owner, scope.organizationId);
    assert.equal(before.attempts.length, 6);
    assert.equal(before.reviews.length, 1);
    assert.ok(
      before.episodes.some(
        (episode) => episode.state === 'ACTIVE' && episode.stopped_at,
      ),
    );
    const beforeDigest = digest(before);
    await api.stop();
    await harness.close();
    harness = undefined;
    await database.onModuleDestroy();
    database = undefined;

    return async function verifyDashboardUpgrade() {
      const current = await readState(ctx);
      assertRuntimeTarget(current, testTarget);
      const client = new pg.Client({ connectionString: current.migrationUrl });
      await client.connect();
      let limited;
      try {
        assert.equal(
          (
            await client.query(
              "SELECT to_regprocedure('app_private.dashboard_read(uuid,jsonb)') IS NOT NULL AS ready",
            )
          ).rows[0].ready,
          true,
        );
        const afterDigest = digest(
          await canonicalSnapshot(client, scope.organizationId),
        );
        assert.equal(
          afterDigest,
          beforeDigest,
          'DASHBOARD_UPGRADE_CHANGED_CANONICAL_FACTS',
        );
        limited = new DatabaseService(
          loadConfig({
            ...apiEnvironment(ctx, current),
            SIGNALS_WORKER_ENABLED: 'false',
          }),
        );
        await limited.ready();
        const options = { asOf: cut };
        const observed = await limited.readAs(
          student.actorId,
          async (db) =>
            (
              await db.query(
                'SELECT app_private.student_progress_observed($1,$2::jsonb) AS value',
                [scope.classroomId, JSON.stringify(options)],
              )
            ).rows[0].value,
          student.sessionId,
        );
        const { observation, ...newLegacy } = observed;
        assert.deepEqual(
          newLegacy,
          legacy,
          'DASHBOARD_UPGRADE_CHANGED_PROGRESS',
        );
        assert.equal(observation.summary.attempts, 6);
        const teacher = await authenticatedActor(current, teacherAccount);
        const dashboard = await limited.readAs(
          teacher.actorId,
          async (db) =>
            (
              await db.query(
                'SELECT app_private.dashboard_read($1,$2::jsonb) AS value',
                [scope.classroomId, JSON.stringify(options)],
              )
            ).rows[0].value,
          teacher.sessionId,
        );
        require('@alunza/contracts').dashboardSchema.parse(dashboard);
        assert.equal(dashboard.summary.students, 2);
        assert.equal(dashboard.summary.completed, 1);
        assert.equal(dashboard.summary.required, 6);
        const detail = await limited.readAs(
          teacher.actorId,
          async (db) =>
            (
              await db.query(
                'SELECT app_private.dashboard_signal($1,$2,$3::jsonb) AS value',
                [
                  scope.classroomId,
                  history.reviewedId,
                  JSON.stringify(options),
                ],
              )
            ).rows[0].value,
          teacher.sessionId,
        );
        require('@alunza/contracts').dashboardSignalDetailSchema.parse(detail);
        assert.equal(detail.signal.state, 'REVIEWED');
        assert.equal(
          digest(await canonicalSnapshot(client, scope.organizationId)),
          beforeDigest,
          'DASHBOARD_READ_CHANGED_CANONICAL_FACTS',
        );
        return {
          status: 'passed',
          from: fromVersion,
          to: toVersion,
          beforeDigest,
          afterDigest,
          preserved: {
            attempts: before.attempts.length,
            events: before.events.length,
            episodes: before.episodes.length,
            reviews: before.reviews.length,
            rules: before.rules.length,
          },
          progressBeforeAndAfterEqual: true,
          publicReadsUsedLimitedRole: true,
          canonicalSubmissionWithStagedTestResult: true,
          remoteProvidersUsed: false,
        };
      } finally {
        await limited?.onModuleDestroy();
        await client.end();
      }
    };
  } catch (error) {
    let diagnostic = `${error.stack ?? error.message}\n${api?.output ?? ''}`;
    for (const field of [
      'applicationPassword',
      'fixturePassword',
      'authAdminKey',
      'migrationUrl',
    ])
      if (state[field])
        diagnostic = diagnostic.split(state[field]).join('[redacted]');
    error.output = redactDiagnostics(diagnostic);
    throw error;
  } finally {
    await api?.stop();
    await harness?.close();
    await database?.onModuleDestroy();
    await owner.end();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    await withTestEnvironment(
      async ({ upgrade }) => {
        assert.ok(upgrade, 'DASHBOARD_UPGRADE_REPORT_MISSING');
        await report('dashboard-upgrade', upgrade, 'imp-05');
        console.log(
          'Actualización .06 → .07: hechos, episodios, revisiones y progreso preservados.',
        );
      },
      [],
      {
        upgradeFromVersion: fromVersion,
        beforeUpgrade: prepareDashboardUpgrade,
      },
    );
  } catch (error) {
    const directory = join(root, '.local/evidence/imp-05-07');
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, 'upgrade-error.log'),
      redactDiagnostics(error.output ?? error.stack ?? error.message),
      { mode: 0o600 },
    );
    await report(
      'dashboard-upgrade',
      { status: 'failed', from: fromVersion, to: toVersion },
      'imp-05',
    );
    console.error(
      'La actualización del tablero falló; revisar el diagnóstico local saneado.',
    );
    process.exitCode = 1;
  }
}
