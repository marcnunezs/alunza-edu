import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';

const require = createRequire(import.meta.url);
require('reflect-metadata');
const {
  assertLaboratoryTestState,
} = require('../../laboratory-test-state.cjs');

export async function signalReviewFacts(database, scope, signalId) {
  const episode = (
    await database.query(
      `SELECT to_jsonb(e) AS value FROM app_private.signal_episodes e
       JOIN app_private.signal_lanes l ON l.id=e.lane_id
       WHERE e.id=$1 AND l.organization_id=$2`,
      [signalId, scope.organizationId],
    )
  ).rows[0]?.value;
  assert.ok(episode, 'SIGNAL_REVIEW_FIXTURE_EPISODE');
  const reviews = (
    await database.query(
      'SELECT to_jsonb(r) AS value FROM app_private.signal_reviews r WHERE episode_id=$1 ORDER BY id',
      [signalId],
    )
  ).rows.map((row) => row.value);
  const audits = (
    await database.query(
      "SELECT to_jsonb(a) AS value FROM app.audit_events a WHERE organization_id=$1 AND entity_id=$2 AND action='SIGNAL_REVIEWED' ORDER BY id",
      [scope.organizationId, signalId],
    )
  ).rows.map((row) => row.value);
  const projection =
    (
      await database.query(
        'SELECT payload FROM app_private.signal_projections WHERE episode_id=$1',
        [signalId],
      )
    ).rows[0]?.payload ?? null;
  return { episode, reviews, audits, projection };
}

export async function immutableReviewSources(database, scope) {
  const result = {};
  for (const table of [
    'app.attempts',
    'app.executions',
    'app.exercise_versions',
    'app.activity_exercises',
    'app.feedbacks',
    'app.feedback_requests',
    'app.feedback_source_refs',
    'app_private.attempt_results',
    'app_private.help_events',
    'app_private.help_calls',
    'app_private.student_activity_observations',
    'app_private.attempt_events',
  ]) {
    result[table] = (
      await database.query(
        `SELECT count(*)::integer AS count,md5(coalesce(string_agg(to_jsonb(t)::text,',' ORDER BY to_jsonb(t)::text),'')) AS digest FROM ${table} t WHERE organization_id=$1`,
        [scope.organizationId],
      )
    ).rows[0];
  }
  return result;
}

export async function reviewAuditFailure(database, scope) {
  assert.match(scope.organizationId, /^[a-f0-9-]{36}$/);
  const name = `imp06_review_${scope.organizationId.replaceAll('-', '')}`;
  assert.match(name, /^imp06_review_[a-f0-9]{32}$/);
  await database.query(
    `CREATE FUNCTION app_private.${name}() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN RAISE EXCEPTION USING ERRCODE='XX000',MESSAGE='SIGNAL_REVIEW_AUDIT_TEST_FAILURE'; END $$`,
  );
  try {
    await database.query(
      `CREATE TRIGGER ${name} BEFORE INSERT ON app.audit_events FOR EACH ROW WHEN (NEW.organization_id='${scope.organizationId}'::uuid AND NEW.action='SIGNAL_REVIEWED') EXECUTE FUNCTION app_private.${name}()`,
    );
  } catch (error) {
    await database.query(`DROP FUNCTION app_private.${name}()`);
    throw error;
  }
  return async () => {
    await database.query(`DROP TRIGGER IF EXISTS ${name} ON app.audit_events`);
    await database.query(`DROP FUNCTION IF EXISTS app_private.${name}()`);
  };
}

// An observed database lock is the barrier; elapsed time is never the oracle.
export async function waitForReviewLocks(database, expected = 1) {
  const deadline = Date.now() + 1400;
  while (Date.now() < deadline) {
    const count = (
      await database.query(
        `SELECT count(*)::integer AS count FROM pg_stat_activity
         WHERE usename='alunza_app' AND query LIKE '%app_private.signal_review(%'
           AND wait_event_type='Lock' AND cardinality(pg_blocking_pids(pid))>0`,
      )
    ).rows[0].count;
    if (count >= expected) return count;
    await delay(10);
  }
  throw new Error('SIGNAL_REVIEW_LOCK_BARRIER_NOT_OBSERVED');
}

export async function signalReviewWorker(state) {
  assertLaboratoryTestState(state);
  const limited = new URL(state.migrationUrl);
  limited.username = 'alunza_app';
  limited.password = state.applicationPassword;
  const pool = new pg.Pool({ connectionString: limited.href, max: 2 });
  const internal = async (action) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        "SELECT set_config('app.actor_id','',true),set_config('app.session_id','',true),set_config('app.organization_id','',true)",
      );
      const result = await action(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  };
  const {
    SignalsRepository,
  } = require('../../../apps/api/dist/signals/signals.repository.js');
  const {
    processSignalSnapshot,
  } = require('../../../apps/api/dist/signals/signal-processing.js');
  const repository = new SignalsRepository({ internal });
  return {
    repository,
    async finish(job, snapshot) {
      return repository.finalize(
        job,
        snapshot.snapshot.id,
        processSignalSnapshot(snapshot),
      );
    },
    close: () => pool.end(),
  };
}
