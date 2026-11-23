import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import {
  root,
  seed,
  readState,
  apiEnvironment,
  redactDiagnostics,
} from './local.mjs';
import { testTarget, assertRuntimeTarget } from './local-target.mjs';
import {
  testApi,
  buildApi,
  withTestEnvironment,
  report,
} from './test-environment.mjs';
import { activities } from '../fixtures/demo/academic.mjs';

const require = createRequire(import.meta.url);
const fromVersion = '20261025201002';
const toVersion = '20261026005905';
const digest = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Only the exclusive TEST harness calls this helper. It prepares existing .05
// data before the read-only .06 migration; no baseline production data is used.
export async function prepareRulesUpgrade({ ctx, state }) {
  assertRuntimeTarget(state, testTarget);
  assert.equal(ctx.projectId, testTarget.projectId);
  const owner = new pg.Client({ connectionString: state.migrationUrl });
  await owner.connect();
  let api, database;
  try {
    const baseline = (
      await owner.query(
        `SELECT to_regclass('app_private.signal_runtime') IS NOT NULL AS has_episodes,
        to_regprocedure('app_private.effective_signal_rules(uuid)') IS NULL AS no_effective`,
      )
    ).rows[0];
    assert.equal(baseline.has_episodes, true, 'RULES_UPGRADE_REQUIRES_05');
    assert.equal(baseline.no_effective, true, 'RULES_UPGRADE_REQUIRES_PRE_06');
    await seed(ctx);
    await buildApi();
    const fixture = JSON.parse(
      await readFile(join(root, 'fixtures/foundation/identity.json'), 'utf8'),
    );
    const [admin, teacher, student] = fixture.users;
    const activity = activities.find(
      (item) =>
        item.organizationId === student.organizationId &&
        item.state === 'PUBLISHED',
    );
    assert.ok(activity, 'RULES_UPGRADE_MISSING_PUBLISHED_FIXTURE');
    const assignment = activity.exercises[0];
    const sessions = new Map();
    for (const actor of [admin, student]) {
      const auth = createClient(state.authUrl, state.publishableKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const login = await auth.auth.signInWithPassword({
        email: actor.email,
        password: state.fixturePassword,
      });
      if (login.error || !login.data.session)
        throw new Error('RULES_UPGRADE_FIXTURE_LOGIN_FAILED');
      const token = login.data.session.access_token;
      const claims = JSON.parse(
        Buffer.from(token.split('.')[1], 'base64url').toString('utf8'),
      );
      sessions.set(actor.id, { token, sessionId: claims.session_id });
    }
    api = testApi(ctx, state, ctx.webPort, {
      SIGNALS_WORKER_ENABLED: 'false',
    });
    const base = `http://127.0.0.1:${ctx.apiPort}`;
    // The current API is alive, but must not advertise readiness against .05.
    await api.start(`${base}/health/live`);
    await api.wait(`${base}/health/ready`, 503);
    const request = async (path, actor, body, expectedStatus) => {
      const response = await fetch(`${base}/api/v1${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sessions.get(actor.id).token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': randomUUID(),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(45000),
      });
      assert.equal(
        response.status,
        expectedStatus,
        `RULES_UPGRADE_FIXTURE_HTTP_${expectedStatus}`,
      );
      return (await response.json()).data;
    };
    const createRule = (count) =>
      request(
        `/organizations/${admin.organizationId}/signal-rules`,
        admin,
        {
          type: 'REPEATED_ERROR',
          schemaVersion: 1,
          algorithmVersion: 'DEC005_V1',
          parameters: {
            repeatedErrorAttempts: count,
            repeatedErrorWindowDays: 14,
          },
        },
        201,
      );
    const firstRule = await createRule(3);
    await request(
      `/signal-rules/${firstRule.id}/activate`,
      admin,
      { expectedCurrentVersionId: null },
      200,
    );
    const attempts = [];
    for (let index = 0; index < 3; index++)
      attempts.push(
        (
          await request(
            `/activities/${activity.id}/exercises/${assignment.id}/attempts`,
            student,
            {
              exerciseVersionId: assignment.exerciseVersionId,
              code: 'module.exports.solve=()=>0;',
            },
            201,
          )
        ).attemptId,
      );

    await import('reflect-metadata');
    const { loadConfig } = require('../apps/api/dist/config.js');
    const {
      DatabaseService,
    } = require('../apps/api/dist/database/database.service.js');
    const {
      SignalsRepository,
    } = require('../apps/api/dist/signals/signals.repository.js');
    const {
      processSignalSnapshot,
    } = require('../apps/api/dist/signals/signal-processing.js');
    database = new DatabaseService(
      loadConfig({
        ...apiEnvironment(ctx, state),
        SIGNALS_WORKER_ENABLED: 'false',
      }),
    );
    await database.readAs(admin.id, (client) =>
      client.query(
        "SELECT 'app_private.signal_discover_lanes()'::regprocedure",
      ),
    );
    const repository = new SignalsRepository(database);
    await database.internal((client) =>
      client.query('SELECT app_private.signal_discover_lanes()'),
    );
    const lanes = (
      await owner.query(
        `SELECT id FROM app_private.signal_lanes
        WHERE organization_id=$1 AND class_id=$2 AND student_id=$3
        AND activity_id=$4 AND assignment_id=$5 AND type='REPEATED_ERROR'`,
        [
          admin.organizationId,
          activity.classId,
          student.id,
          activity.id,
          assignment.id,
        ],
      )
    ).rows;
    assert.equal(lanes.length, 1, 'RULES_UPGRADE_EXPECTS_ONE_FIXTURE_LANE');
    const laneId = lanes[0].id;
    let complete = false;
    for (let step = 0; step < 20; step++) {
      const job = await repository.claim(laneId);
      assert.ok(job, 'RULES_UPGRADE_CLAIM_FAILED');
      const captured = await repository.capture(job);
      assert.ok(captured, 'RULES_UPGRADE_CAPTURE_FAILED');
      const batch = processSignalSnapshot(captured, 100);
      const result = await repository.finalize(
        job,
        captured.snapshot.id,
        batch,
      );
      assert.ok(
        ['COMMITTED', 'REPLAY'].includes(result.status),
        'RULES_UPGRADE_BATCH_NOT_CONFIRMED',
      );
      if (!batch.checkpoint.hasMore) {
        complete = true;
        break;
      }
    }
    assert.equal(complete, true, 'RULES_UPGRADE_FIXTURE_PROCESSING_INCOMPLETE');
    const episodes = (
      await owner.query(
        'SELECT id,state FROM app_private.signal_episodes WHERE lane_id=$1 ORDER BY qualified_at,id',
        [laneId],
      )
    ).rows;
    assert.equal(episodes.length, 1, 'RULES_UPGRADE_EXPECTS_ONE_EPISODE');
    assert.equal(episodes[0].state, 'ACTIVE');
    const reviewed = (
      await owner.query(
        'SELECT app_private.signal_review_fixture($1::uuid,$2::uuid) AS value',
        [episodes[0].id, teacher.id],
      )
    ).rows[0].value;
    assert.equal(reviewed.state, 'REVIEWED');

    const currentRule = await createRule(4);
    await request(
      `/signal-rules/${currentRule.id}/activate`,
      admin,
      { expectedCurrentVersionId: firstRule.id },
      200,
    );
    const draftRule = await createRule(2);
    await api.stop();
    await database.onModuleDestroy();
    database = undefined;
    const snapshot = async (client) => {
      const value = (
        await client.query(
          `SELECT jsonb_build_object(
          'rules',(SELECT jsonb_agg(to_jsonb(v) ORDER BY v.id) FROM app.signal_rule_versions v WHERE organization_id=$1),
          'scopes',(SELECT jsonb_agg(to_jsonb(v) ORDER BY v.type) FROM app_private.signal_rule_scopes v WHERE organization_id=$1),
          'operations',(SELECT jsonb_agg(to_jsonb(v) ORDER BY v.actor_id,v.operation,v.key) FROM app_private.signal_rule_operations v WHERE organization_id=$1),
          'audit',(SELECT jsonb_agg(to_jsonb(v) ORDER BY v.id) FROM app.audit_events v WHERE organization_id=$1 AND entity_type='SIGNAL_RULE_VERSION'),
          'attempts',(SELECT jsonb_agg(to_jsonb(v) ORDER BY v.id) FROM app.attempts v WHERE id=ANY($2::uuid[])),
          'events',(SELECT jsonb_agg(to_jsonb(v) ORDER BY v.id) FROM app_private.attempt_events v WHERE attempt_id=ANY($2::uuid[])),
          'lane',(SELECT to_jsonb(v) FROM app_private.signal_lanes v WHERE id=$3),
          'job',(SELECT to_jsonb(v) FROM app_private.signal_jobs v WHERE lane_id=$3),
          'snapshots',(SELECT jsonb_agg(to_jsonb(v) ORDER BY v.id) FROM app_private.signal_snapshots v WHERE lane_id=$3),
          'evaluations',(SELECT jsonb_agg(to_jsonb(v) ORDER BY v.id) FROM app_private.signal_evaluations v WHERE lane_id=$3),
          'episodes',(SELECT jsonb_agg(to_jsonb(v) ORDER BY v.id) FROM app_private.signal_episodes v WHERE lane_id=$3),
          'witnesses',(SELECT jsonb_agg(to_jsonb(v) ORDER BY v.rule_version_id,v.witness_key) FROM app_private.signal_witnesses v WHERE lane_id=$3),
          'episodeEvaluations',(SELECT jsonb_agg(to_jsonb(v) ORDER BY v.episode_id,v.evaluation_id) FROM app_private.signal_episode_evaluations v JOIN app_private.signal_episodes e ON e.id=v.episode_id WHERE e.lane_id=$3),
          'reviews',(SELECT jsonb_agg(to_jsonb(v) ORDER BY v.id) FROM app_private.signal_reviews v WHERE lane_id=$3),
          'acks',(SELECT jsonb_agg(to_jsonb(v) ORDER BY v.change_id) FROM app_private.signal_change_acks v WHERE lane_id=$3),
          'receipts',(SELECT jsonb_agg(to_jsonb(v) ORDER BY v.lease_token,v.snapshot_id) FROM app_private.signal_finalize_receipts v WHERE lane_id=$3),
          'projections',(SELECT jsonb_agg(to_jsonb(v) ORDER BY v.episode_id) FROM app_private.signal_projections v WHERE lane_id=$3),
          'changes',(SELECT jsonb_agg(to_jsonb(v) ORDER BY v.change_sequence) FROM app_private.signal_input_changes v WHERE organization_id=$1),
          'runtime',(SELECT to_jsonb(v) FROM app_private.signal_runtime v WHERE singleton),
          'coverage',(SELECT jsonb_agg(to_jsonb(v) ORDER BY v.id) FROM app_private.signal_coverage_epochs v)
        ) AS value`,
          [admin.organizationId, attempts, laneId],
        )
      ).rows[0].value;
      assert.equal(value.rules.length, 3);
      assert.equal(value.audit.length, 5);
      assert.equal(value.attempts.length, 3);
      assert.equal(value.events.length, 6);
      assert.equal(value.episodes.length, 1);
      assert.equal(value.episodes[0].state, 'REVIEWED');
      assert.equal(value.reviews.length, 1);
      const byId = new Map(value.rules.map((rule) => [rule.id, rule]));
      assert.ok(byId.get(firstRule.id).valid_to);
      assert.ok(byId.get(currentRule.id).valid_from);
      assert.equal(byId.get(currentRule.id).valid_to, null);
      assert.equal(byId.get(draftRule.id).valid_from, null);
      return digest(value);
    };
    const beforeDigest = await snapshot(owner);
    const beforeCounts = {
      rules: 3,
      auditEvents: 5,
      attempts: 3,
      episodes: 1,
      reviews: 1,
    };

    return async function verifyRulesUpgrade() {
      const current = await readState(ctx);
      assertRuntimeTarget(current, testTarget);
      const client = new pg.Client({ connectionString: current.migrationUrl });
      await client.connect();
      let readDatabase;
      try {
        assert.equal(
          (
            await client.query(
              "SELECT to_regprocedure('app_private.effective_signal_rules(uuid)') IS NOT NULL AS ready",
            )
          ).rows[0].ready,
          true,
          'RULES_UPGRADE_EFFECTIVE_RPC_MISSING',
        );
        const afterDigest = await snapshot(client);
        assert.equal(
          afterDigest,
          beforeDigest,
          'RULES_UPGRADE_PREVIOUS_EVIDENCE_CHANGED',
        );
        const {
          RuleVersionsService,
        } = require('../apps/api/dist/rules/rule-versions.service.js');
        readDatabase = new DatabaseService(
          loadConfig({
            ...apiEnvironment(ctx, current),
            SIGNALS_WORKER_ENABLED: 'false',
          }),
        );
        const service = new RuleVersionsService(readDatabase);
        const effective = await service.effective(
          {
            actorId: admin.id,
            sessionId: sessions.get(admin.id).sessionId,
            requestId: randomUUID(),
          },
          admin.organizationId,
        );
        assert.equal(effective.organizationId, admin.organizationId);
        assert.equal(effective.rules.length, 3);
        assert.equal(
          effective.rules.find((entry) => entry.type === 'REPEATED_ERROR')
            .ruleVersion.id,
          currentRule.id,
        );
        assert.equal(
          effective.rules.find((entry) => entry.type === 'REPEATED_ERROR')
            .ruleVersion.parameters.repeatedErrorAttempts,
          4,
        );
        assert.equal(
          effective.rules.find((entry) => entry.type === 'INACTIVITY')
            .ruleVersion,
          null,
        );
        assert.equal(
          effective.rules.find((entry) => entry.type === 'STAGNATION')
            .ruleVersion,
          null,
        );
        assert.equal(
          await snapshot(client),
          beforeDigest,
          'RULES_UPGRADE_EFFECTIVE_READ_CHANGED_DATA',
        );
        return {
          status: 'passed',
          from: fromVersion,
          to: toVersion,
          beforeDigest,
          afterDigest,
          preserved: beforeCounts,
          effectiveRead: 'limited-role-current-admin',
          observedAt: effective.observedAt,
          publicReviewImplemented: false,
          remoteProvidersUsed: false,
        };
      } finally {
        await readDatabase?.onModuleDestroy();
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
        assert.ok(upgrade, 'RULES_UPGRADE_REPORT_MISSING');
        await report('rules-upgrade', upgrade, 'imp-05');
        console.log(
          'Actualización .05 → .06: evidencia y revisión preservadas; consulta efectiva comprobada.',
        );
      },
      [],
      { upgradeFromVersion: fromVersion, beforeUpgrade: prepareRulesUpgrade },
    );
  } catch (error) {
    const directory = join(root, '.local/evidence/imp-05-06');
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, 'rules-upgrade-error.log'),
      redactDiagnostics(error.output ?? error.stack ?? error.message),
      { mode: 0o600 },
    );
    await report(
      'rules-upgrade',
      { status: 'failed', from: fromVersion, to: toVersion },
      'imp-05',
    );
    console.error(
      'La actualización de reglas falló; revisar el diagnóstico local saneado.',
    );
    process.exitCode = 1;
  }
}
