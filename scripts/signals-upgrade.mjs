import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
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
import { testApi, buildApi } from './test-environment.mjs';
import { activities } from '../fixtures/demo/academic.mjs';

const require = createRequire(import.meta.url);
const hash = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Called only inside the existing exclusive TEST reservation, after migration
// .03 and before .05. This helper never resets a database or starts Supabase.
export async function prepareSignalUpgrade({ ctx, state }) {
  assertRuntimeTarget(state, testTarget);
  assert.equal(ctx.projectId, testTarget.projectId);
  const owner = new pg.Client({ connectionString: state.migrationUrl });
  await owner.connect();
  try {
    assert.equal(
      (
        await owner.query(
          "SELECT to_regclass('app_private.signal_runtime') IS NULL AS baseline",
        )
      ).rows[0].baseline,
      true,
    );
  } finally {
    await owner.end();
  }
  await seed(ctx);
  await buildApi();
  const fixture = JSON.parse(
    await readFile(join(root, 'fixtures/foundation/identity.json'), 'utf8'),
  );
  const [admin, , student] = fixture.users;
  const activity = activities.find(
    (item) =>
      item.organizationId === student.organizationId &&
      item.state === 'PUBLISHED',
  );
  assert.ok(activity);
  const assignment = activity.exercises[0];
  const tokens = new Map();
  for (const actor of [admin, student]) {
    const auth = createClient(state.authUrl, state.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const login = await auth.auth.signInWithPassword({
      email: actor.email,
      password: state.fixturePassword,
    });
    if (login.error || !login.data.session)
      throw new Error('SIGNAL_UPGRADE_FIXTURE_LOGIN_FAILED');
    tokens.set(actor.id, login.data.session.access_token);
  }
  const api = testApi(ctx, state, ctx.webPort, {
    SIGNALS_WORKER_ENABLED: 'false',
  });
  const base = `http://127.0.0.1:${ctx.apiPort}`;
  const request = async (path, actor, body, status) => {
    const response = await fetch(`${base}/api/v1${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.get(actor.id)}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': randomUUID(),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45000),
    });
    assert.equal(
      response.status,
      status,
      `SIGNAL_UPGRADE_FIXTURE_HTTP_${status}`,
    );
    return (await response.json()).data;
  };
  let ruleId, openingId;
  const attempts = [];
  try {
    // Only legacy routes prepare the baseline; the candidate must report its
    // new schema as unavailable until the deferred migrations have been applied.
    await api.start(`${base}/health/live`);
    await api.wait(`${base}/health/ready`, 503);
    const rule = await request(
      `/organizations/${student.organizationId}/signal-rules`,
      admin,
      {
        type: 'REPEATED_ERROR',
        schemaVersion: 1,
        algorithmVersion: 'DEC005_V1',
        parameters: { repeatedErrorAttempts: 3, repeatedErrorWindowDays: 14 },
      },
      201,
    );
    ruleId = rule.id;
    await request(
      `/signal-rules/${rule.id}/activate`,
      admin,
      { expectedCurrentVersionId: null },
      200,
    );
    openingId = (
      await request(`/activities/${activity.id}/open-events`, student, {}, 201)
    ).eventId;
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
  } catch (error) {
    let diagnostic = `${error.stack ?? error.message}\n${api.output}`;
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
    await api.stop();
  }
  const scope = {
    organizationId: student.organizationId,
    classId: activity.classId,
    studentId: student.id,
    activityId: activity.id,
  };
  const snapshot = async (client) => {
    const value = (
      await client.query(
        `SELECT jsonb_build_object(
      'attempts',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM app.attempts a WHERE id=ANY($1::uuid[])),
      'attemptEvents',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM app_private.attempt_events e WHERE attempt_id=ANY($1::uuid[])),
      'opening',(SELECT to_jsonb(o) FROM app_private.student_activity_observations o WHERE id=$2),
      'rule',(SELECT to_jsonb(r) FROM app.signal_rule_versions r WHERE id=$3),
      'ruleScope',(SELECT to_jsonb(s) FROM app_private.signal_rule_scopes s WHERE organization_id=$4 AND type='REPEATED_ERROR'),
      'ruleOperations',(SELECT jsonb_agg(to_jsonb(o) ORDER BY operation,key) FROM app_private.signal_rule_operations o WHERE organization_id=$4)
    ) AS value`,
        [attempts, openingId, ruleId, scope.organizationId],
      )
    ).rows[0].value;
    assert.equal(
      value.attempts.length,
      3,
      'SIGNAL_UPGRADE_EXPECTS_THREE_CANONICAL_ATTEMPTS',
    );
    assert.equal(
      value.attemptEvents.length,
      6,
      'SIGNAL_UPGRADE_EXPECTS_TWO_EVENTS_PER_ATTEMPT',
    );
    assert.ok(
      value.opening && value.rule.valid_from,
      'SIGNAL_UPGRADE_MISSING_OPENING_OR_ACTIVE_RULE',
    );
    return hash(value);
  };
  const baseline = new pg.Client({ connectionString: state.migrationUrl });
  await baseline.connect();
  let beforeDigest, preparedAt;
  try {
    beforeDigest = await snapshot(baseline);
    preparedAt = (
      await baseline.query('SELECT clock_timestamp()::text AS value')
    ).rows[0].value;
  } finally {
    await baseline.end();
  }

  return async function verifySignalUpgrade() {
    const current = await readState(ctx);
    assertRuntimeTarget(current, testTarget);
    const client = new pg.Client({ connectionString: current.migrationUrl });
    await client.connect();
    let database;
    try {
      assert.equal(
        await snapshot(client),
        beforeDigest,
        'SIGNAL_UPGRADE_CANONICAL_EVIDENCE_CHANGED',
      );
      const installation = (
        await client.query(
          `SELECT app_private.signal_instant(bootstrap_at) AS bootstrap,
        bootstrap_at>=$1::timestamptz AS installed_after_fixture,
        (SELECT count(*)=4 AND bool_and(starts_at>=runtime.bootstrap_at) FROM app_private.signal_coverage_epochs WHERE ends_at IS NULL) AS honest_coverage
        FROM app_private.signal_runtime runtime WHERE singleton`,
          [preparedAt],
        )
      ).rows[0];
      assert.equal(installation.installed_after_fixture, true);
      assert.equal(installation.honest_coverage, true);
      assert.equal(
        (
          await client.query(
            'SELECT count(*)::integer AS count FROM app_private.signal_episodes',
          )
        ).rows[0].count,
        0,
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
      const config = loadConfig({
        ...apiEnvironment(ctx, current),
        SIGNALS_WORKER_ENABLED: 'false',
      });
      database = new DatabaseService(config);
      await database.ready();
      const repository = new SignalsRepository(database);
      await database.internal((connection) =>
        connection.query('SELECT app_private.signal_discover_lanes()'),
      );
      const lane = (
        await client.query(
          "SELECT id FROM app_private.signal_lanes WHERE organization_id=$1 AND class_id=$2 AND student_id=$3 AND activity_id=$4 AND assignment_id=$5 AND type='REPEATED_ERROR'",
          [...Object.values(scope), assignment.id],
        )
      ).rows;
      assert.equal(
        lane.length,
        1,
        'SIGNAL_UPGRADE_EXPECTS_ONE_SCOPED_ASSIGNMENT_LANE',
      );
      let complete = false;
      for (let step = 0; step < 20; step++) {
        const job = await repository.claim(lane[0].id);
        assert.ok(job);
        const captured = await repository.capture(job);
        assert.ok(captured);
        assert.equal(captured.bootstrapAt, installation.bootstrap);
        assert.deepEqual(
          captured.submissions.map((submission) => submission.id).sort(),
          [...attempts].sort(),
        );
        const batch = processSignalSnapshot(captured, 100);
        const finalized = await repository.finalize(
          job,
          captured.snapshot.id,
          batch,
        );
        assert.ok(['COMMITTED', 'REPLAY'].includes(finalized.status));
        if (!batch.checkpoint.hasMore) {
          complete = true;
          break;
        }
      }
      assert.equal(complete, true, 'SIGNAL_UPGRADE_BOOTSTRAP_DID_NOT_FINISH');
      assert.equal(
        (
          await client.query(
            'SELECT count(*)::integer AS count FROM app_private.signal_episodes WHERE qualified_at<(SELECT bootstrap_at FROM app_private.signal_runtime WHERE singleton)',
          )
        ).rows[0].count,
        0,
      );
      assert.equal(await snapshot(client), beforeDigest);
      return {
        status: 'passed',
        from: '20261005233736',
        to: '20261025201002',
        canonicalDigest: beforeDigest,
        preservedAttempts: 3,
        preservedRules: 1,
        preservedOpenings: 1,
        bootstrapAt: installation.bootstrap,
        retroactiveEpisodes: 0,
      };
    } finally {
      await database?.onModuleDestroy();
      await client.end();
    }
  };
}
