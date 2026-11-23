const assert = require('node:assert/strict');
const test = require('node:test');

const load = () => import('../integration/local-vm-capacity-sql.mjs');
function fixture({
  caseError,
  cleanupErrors = [],
  failCleanupAfterCase = false,
} = {}) {
  const rollbacks = [0, 0];
  let loserAdmissions = 0;
  const clients = [0, 1].map((index) => ({
    query(sql) {
      if (sql === 'ROLLBACK') {
        rollbacks[index] += 1;
        if (
          cleanupErrors[index] &&
          (!failCleanupAfterCase || rollbacks[index] === 2)
        ) {
          if (index === 0) throw cleanupErrors[index];
          return Promise.reject(cleanupErrors[index]);
        }
      }
      if (sql.startsWith('SELECT current_user'))
        return Promise.resolve({ rows: [{ role: 'alunza_app' }] });
      if (sql.startsWith('SELECT app_private.admit_practice_')) {
        if (index === 0 && caseError) return Promise.reject(caseError);
        if (index === 1) {
          const admission = loserAdmissions++;
          if (admission % 2 === 0)
            return Promise.reject(
              Object.assign(
                new Error(
                  admission < 8 ? 'REQUEST_IN_PROGRESS' : 'RUNNER_BUSY',
                ),
                { code: 'P0001' },
              ),
            );
        }
        return Promise.resolve({ rows: [{ value: { kind: 'reserved' } }] });
      }
      return Promise.resolve({ rows: [] });
    },
  }));
  const identities = [
    { actorId: 'actor-a', sessionId: 'session-a', organizationId: 'org-a' },
    { actorId: 'actor-b', sessionId: 'session-b', organizationId: 'org-b' },
  ];
  const exercise = {
    activityId: 'activity',
    assignmentId: 'assignment',
    exerciseVersionId: 'version',
    successCode: 'function solve() { return 1; }',
    testsVersion: 'tests',
    visibleTestIds: ['test'],
  };
  return {
    rollbacks,
    args: {
      state: {
        projectId: 'alunza-edu-laboratorio-physical-test',
        authUrl: 'http://127.0.0.1:18421',
        migrationUrl: 'postgresql://127.0.0.1:18422/postgres',
      },
      first: clients[0],
      second: clients[1],
      identities,
      fixturesByActor: Object.fromEntries(
        identities.map(({ actorId }) => [
          actorId,
          { RUN: exercise, SUBMIT: exercise },
        ]),
      ),
    },
  };
}

test('capacity SQL preserves the original failure when both rollbacks succeed', async () => {
  const original = new Error('original');
  const f = fixture({ caseError: original });
  await assert.rejects(
    (await load()).runLocalVmCapacityRaces(f.args),
    (error) => error === original,
  );
  assert.deepEqual(f.rollbacks, [1, 1]);
});

test('capacity SQL retains original and both cleanup errors, including a synchronous rollback failure', async () => {
  const original = new Error('original');
  const cleanup = [new Error('first rollback'), new Error('second rollback')];
  const f = fixture({ caseError: original, cleanupErrors: cleanup });
  await assert.rejects(
    (await load()).runLocalVmCapacityRaces(f.args),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.cause, original);
      assert.deepEqual(error.errors, [original, ...cleanup]);
      return true;
    },
  );
  assert.deepEqual(f.rollbacks, [1, 1]);
});

test('capacity SQL rejects an otherwise passed case if final retirement is unconfirmed', async () => {
  const cleanup = new Error('final rollback');
  const f = fixture({
    cleanupErrors: [undefined, cleanup],
    failCleanupAfterCase: true,
  });
  await assert.rejects(
    (await load()).runLocalVmCapacityRaces(f.args),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [cleanup]);
      assert.equal(error.cause, undefined);
      return true;
    },
  );
  assert.deepEqual(f.rollbacks, [2, 2]);
});

test('capacity SQL completes all eight cases with confirmed retirement', async () => {
  const f = fixture();
  const result = await (await load()).runLocalVmCapacityRaces(f.args);
  assert.equal(result.status, 'passed');
  assert.equal(result.cases.length, 8);
  assert.equal(result.committedAdmissions, 0);
  assert.equal(result.providerCreations, 0);
  assert.deepEqual(f.rollbacks, [16, 16]);
});
