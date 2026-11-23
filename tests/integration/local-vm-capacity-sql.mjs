import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import testState from '../laboratory-test-state.cjs';

/** Already connected, distinct alunza_app sessions in an authorized TEST DB.
 * Every admission is rolled back. No broker/provider, process or VM is started.
 * identities contain actorId, sessionId, organizationId; fixturesByActor is the
 * output of setupLinuxVmFixture. Include actors from two organizations.
 */
export async function runLocalVmCapacityRaces({
  state,
  first,
  second,
  identities,
  fixturesByActor,
}) {
  testState.assertLaboratoryTestState(state);
  assert.notEqual(first, second);
  assert.ok(identities.length >= 2);
  const actor = identities[0];
  const foreign = identities.find(
    (entry) => entry.organizationId !== actor.organizationId,
  );
  assert.ok(
    foreign,
    'Two organizations are required to test host-wide capacity',
  );
  for (const client of [first, second]) {
    assert.equal(
      (await client.query('SELECT current_user AS role')).rows[0].role,
      'alunza_app',
    );
  }
  const context = {
    provider: 'local-vm',
    runnerVersion: 'imp-03-quickjs.13',
    image: `sha256:${'a'.repeat(64)}`,
    hostId: randomUUID(),
    kitManifestSha256: 'b'.repeat(64),
    brokerVersion: 'local-vm-broker-v1',
    guestSha256: 'c'.repeat(64),
    brokerGeneration: randomUUID(),
  };
  const hash = (value) => createHash('sha256').update(value).digest('hex');
  const begin = async (client, identity) => {
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout='1500ms'");
    await client.query(
      "SELECT set_config('app.actor_id',$1,true),set_config('app.session_id',$2,true),set_config('app.organization_id',$3,true)",
      [identity.actorId, identity.sessionId, identity.organizationId],
    );
  };
  const admit = async (
    client,
    identity,
    mode,
    executionId,
    key,
    payload = 'a'.repeat(64),
  ) => {
    const fixture = fixturesByActor[identity.actorId][mode];
    let sql, parameters;
    if (mode === 'RUN') {
      sql =
        'SELECT app_private.admit_practice_run($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8,$9,$10,$11::uuid,$12,$13,$14,$15,$16::jsonb,$17::text) AS value';
      parameters = [
        executionId,
        fixture.activityId,
        fixture.assignmentId,
        fixture.exerciseVersionId,
        key,
        payload,
        hash(fixture.successCode),
        fixture.testsVersion,
        fixture.visibleTestIds.length,
        context.runnerVersion,
        randomUUID(),
        true,
        1,
        4,
        10,
        context,
        'READY',
      ];
    } else {
      sql =
        'SELECT app_private.admit_practice_submit($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8::uuid,$9,$10::uuid,$11,$12,$13,$14,$15::jsonb,$16::text) AS value';
      parameters = [
        executionId,
        fixture.activityId,
        fixture.assignmentId,
        fixture.exerciseVersionId,
        key,
        payload,
        fixture.successCode,
        null,
        context.runnerVersion,
        randomUUID(),
        true,
        2,
        4,
        10,
        context,
        'READY',
      ];
    }
    return (await client.query(sql, parameters)).rows[0].value;
  };
  const cases = [];
  for (const [winnerMode, loserMode, sameKey, changedPayload, contender] of [
    ['RUN', 'RUN', true, false, actor],
    ['RUN', 'RUN', true, true, actor],
    ['SUBMIT', 'SUBMIT', true, false, actor],
    ['SUBMIT', 'SUBMIT', true, true, actor],
    ['RUN', 'RUN', false, false, actor],
    ['RUN', 'SUBMIT', false, false, actor],
    ['SUBMIT', 'RUN', false, false, foreign],
    ['SUBMIT', 'SUBMIT', false, false, foreign],
  ]) {
    const winnerId = randomUUID(),
      loserId = randomUUID(),
      winnerKey = `capacity-${randomUUID()}`;
    const loserKey = sameKey ? winnerKey : `capacity-${randomUUID()}`;
    let caseFailed = false;
    let caseError;
    try {
      await begin(first, actor);
      assert.equal(
        (await admit(first, actor, winnerMode, winnerId, winnerKey)).kind,
        'reserved',
      );
      // Winner remains uncommitted and owns actor/organization/host locks.
      await begin(second, contender);
      const expected = sameKey ? 'REQUEST_IN_PROGRESS' : 'RUNNER_BUSY';
      await assert.rejects(
        admit(
          second,
          contender,
          loserMode,
          loserId,
          loserKey,
          changedPayload ? 'f'.repeat(64) : 'a'.repeat(64),
        ),
        (error) => error.code === 'P0001' && error.message === expected,
      );
      await second.query('ROLLBACK');
      await first.query('ROLLBACK');
      // A loser neither consumed its key nor left a durable slot. Retry can
      // reserve after rollback; this test then rolls that admission back too.
      await begin(second, contender);
      assert.equal(
        (await admit(second, contender, loserMode, loserId, loserKey)).kind,
        'reserved',
      );
      cases.push({
        winnerMode,
        loserMode,
        sameKey,
        changedPayload,
        crossOrganization: contender.organizationId !== actor.organizationId,
        expected,
        status: 'passed',
      });
    } catch (error) {
      caseFailed = true;
      caseError = error;
    }
    const retired = await Promise.allSettled(
      [first, second].map((client) =>
        Promise.resolve().then(() => client.query('ROLLBACK')),
      ),
    );
    const cleanupErrors = retired
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason);
    if (cleanupErrors.length)
      throw new AggregateError(
        [...(caseFailed ? [caseError] : []), ...cleanupErrors],
        'SQL capacity test transaction rollback unconfirmed',
        caseFailed ? { cause: caseError } : undefined,
      );
    if (caseFailed) throw caseError;
  }
  return {
    status: 'passed',
    cases,
    committedAdmissions: 0,
    providerCreations: 0,
  };
}
