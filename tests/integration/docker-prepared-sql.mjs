import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';

/** Three already connected clients in a dedicated local test DB, never a provider. */
export async function runDockerPreparedConcurrency({ admin, first, second }) {
  const ownerA = randomUUID();
  const ownerB = randomUUID();
  const recoveryOwner = randomUUID();
  const context = {
    provider: 'docker',
    image: `sha256:${'a'.repeat(64)}`,
    runnerVersion: 'sql-concurrency-test',
    engineId: `sql-test-${randomUUID()}`,
    runtimeName: 'alunza-crun',
    runtimeVersion: '1.31',
    runtimeSha256: 'b'.repeat(64),
    strategy: 'prepared-pair-v1',
  };
  const query = async (client, sql, args = []) =>
    (await client.query(sql, args)).rows[0]?.value;
  for (const client of [first, second]) {
    await client.query("SET app.actor_id=''; SET app.session_id=''");
    assert.equal(
      (await client.query('SELECT current_user AS role')).rows[0].role,
      'alunza_app',
    );
  }
  let pair;
  let transaction = false;
  let temporaryOwnerMembership = false;
  try {
    assert.equal(
      (await admin.query('SELECT current_user AS role')).rows[0].role,
      'postgres',
    );
    const inheritedOwnerPrivileges = (
      await admin.query(
        "SELECT pg_has_role('postgres','alunza_identity','USAGE') AS inherited",
      )
    ).rows[0].inherited;
    if (!inheritedOwnerPrivileges) {
      // Supabase may retain an admin-only grant from supabase_admin. It is
      // MEMBER=true but grants no inherited privileges. Preserve that grant;
      // create and remove only this test connection's own temporary grant.
      assert.equal(
        (
          await admin.query(
            "SELECT count(*)::int AS count FROM pg_auth_members WHERE roleid='alunza_identity'::regrole AND member='postgres'::regrole AND grantor='postgres'::regrole",
          )
        ).rows[0].count,
        0,
        'Unexpected pre-existing migration-owner grant',
      );
      await admin.query('GRANT alunza_identity TO postgres');
      temporaryOwnerMembership = true;
    }
    const raced = await Promise.all([
      query(first, 'SELECT app_private.docker_reserve_pair($1,$2) AS value', [
        context,
        ownerA,
      ]),
      query(second, 'SELECT app_private.docker_reserve_pair($1,$2) AS value', [
        context,
        ownerB,
      ]),
    ]);
    assert.equal(raced.filter(Boolean).length, 1);
    pair = raced.find(Boolean);
    assert.equal(pair.slots.length, 2);
    assert.equal(
      (
        await admin.query(
          'SELECT count(*)::int AS count FROM app_private.docker_prepared_pairs WHERE engine_id=$1',
          [context.engineId],
        )
      ).rows[0].count,
      1,
    );
    await first.query('SELECT app_private.docker_authorize_create($1,$2,$3)', [
      pair.pairId,
      pair.slots[0].resourceId,
      pair.ownerToken,
    ]);
    await admin.query(
      "UPDATE app_private.docker_prepared_pairs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
      [pair.pairId],
    );
    await first.query('BEGIN');
    transaction = true;
    const claimed = await query(
      first,
      'SELECT app_private.docker_claim_recovery($1,$2) AS value',
      [context, recoveryOwner],
    );
    assert.equal(claimed.length, 1);
    assert.equal(claimed[0].recoveryOnly, true);
    assert.equal(claimed[0].ownerToken, recoveryOwner);
    assert.equal(claimed[0].creatorToken, pair.creatorToken);
    // Keep the first row lock open. SKIP LOCKED must let another replica
    // return immediately instead of waiting for that transaction to commit.
    await second.query("SET statement_timeout='2s'");
    assert.deepEqual(
      await query(
        second,
        'SELECT app_private.docker_claim_recovery($1,$2) AS value',
        [context, ownerB],
      ),
      [],
    );
    await first.query('COMMIT');
    transaction = false;
    await assert.rejects(
      second.query('SELECT app_private.docker_authorize_create($1,$2,$3)', [
        pair.pairId,
        pair.slots[1].resourceId,
        recoveryOwner,
      ]),
      (error) => error.code === 'P0001',
    );
    const containerId = randomBytes(32).toString('hex');
    // A delayed create receipt remains useful after ownership was reclaimed.
    await second.query('SELECT app_private.docker_confirm_created($1,$2,$3)', [
      pair.pairId,
      pair.slots[0].resourceId,
      containerId,
    ]);
    await Promise.all([
      first.query('SELECT app_private.docker_mark_clean($1,$2,$3)', [
        pair.pairId,
        pair.slots[0].resourceId,
        { kind: 'ABSENT', containerId },
      ]),
      second.query('SELECT app_private.docker_mark_clean($1,$2,$3)', [
        pair.pairId,
        pair.slots[1].resourceId,
        { kind: 'NOT_DISPATCHED' },
      ]),
    ]);
    const final = (
      await admin.query(
        'SELECT state FROM app_private.docker_prepared_pairs WHERE id=$1',
        [pair.pairId],
      )
    ).rows[0];
    assert.equal(final.state, 'RETIRED');
    return {
      status: 'passed',
      checks: 8,
      engineId: context.engineId,
      providerCreations: 0,
      cases: [
        'simultaneous-reservation-single-winner',
        'two-durable-slots',
        'one-row-per-engine',
        'recovery-only-claim',
        'skip-locked-with-open-transaction',
        'recovery-cannot-create',
        'late-identity-after-claim',
        'concurrent-cleanup-retires-pair',
      ],
    };
  } finally {
    try {
      if (transaction) await first.query('ROLLBACK');
    } finally {
      try {
        await second.query('RESET statement_timeout');
      } finally {
        if (temporaryOwnerMembership)
          await admin.query(
            'REVOKE alunza_identity FROM postgres GRANTED BY postgres',
          );
      }
    }
  }
}
