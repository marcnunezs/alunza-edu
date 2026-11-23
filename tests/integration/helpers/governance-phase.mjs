import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

/** Observe real PostgreSQL waiters before releasing the caller's held row. */
export async function releaseObservedGovernanceRequests(
  database,
  holder,
  requests,
  expected = 2,
) {
  const pid = (await holder.query('SELECT pg_backend_pid() AS pid')).rows[0]
    .pid;
  const deadline = Date.now() + 1800;
  let observed = 0,
    failure;
  try {
    while (Date.now() < deadline) {
      const value = (
        await database.query(
          `WITH RECURSIVE blocked(pid) AS (
             SELECT a.pid FROM pg_stat_activity a WHERE $1=ANY(pg_blocking_pids(a.pid))
             UNION
             SELECT a.pid FROM pg_stat_activity a JOIN blocked b ON b.pid=ANY(pg_blocking_pids(a.pid))
           )
           SELECT count(*)::int AS waiting FROM pg_stat_activity a JOIN blocked b ON b.pid=a.pid
           WHERE a.usename='alunza_app' AND a.wait_event_type='Lock'`,
          [pid],
        )
      ).rows[0];
      if (value.waiting >= expected) {
        observed = value.waiting;
        break;
      }
      await delay(10);
    }
    assert.ok(
      observed >= expected,
      'GOVERNANCE_PHASE_LOCK_BARRIER_NOT_OBSERVED',
    );
  } catch (error) {
    failure = error;
  } finally {
    await holder.query('ROLLBACK');
  }
  // Drain every request even on a failed barrier; no request may escape cleanup.
  const completed = await Promise.allSettled(requests);
  if (failure) throw failure;
  const rejected = completed.find((item) => item.status === 'rejected');
  if (rejected) throw rejected.reason;
  return { observed, responses: completed.map((item) => item.value) };
}
