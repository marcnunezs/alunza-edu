import { releaseObservedGovernanceRequests } from '../integration/helpers/governance-phase.mjs';

function fixture({ barrierError, rejectRequest } = {}) {
  const operations = [];
  let finishFirst, finishSecond;
  const first = new Promise((resolve) => {
    finishFirst = resolve;
  });
  const second = new Promise((resolve, reject) => {
    finishSecond = rejectRequest ? reject : resolve;
  });
  const holder = {
    query: async (sql) => {
      operations.push(sql);
      if (sql.includes('pg_backend_pid')) return { rows: [{ pid: 731 }] };
      if (sql === 'ROLLBACK') {
        finishFirst({ status: 200 });
        finishSecond(rejectRequest ?? { status: 200 });
      }
      return { rows: [] };
    },
  };
  const database = {
    query: async (_sql, params) => {
      expect(params).toEqual([731]);
      if (barrierError) throw barrierError;
      return { rows: [{ waiting: 2 }] };
    },
  };
  return { database, holder, requests: [first, second], operations };
}
test('observed waiters release before collecting completed HTTP requests', async () => {
  const value = fixture();
  expect(
    await releaseObservedGovernanceRequests(
      value.database,
      value.holder,
      value.requests,
    ),
  ).toEqual({ observed: 2, responses: [{ status: 200 }, { status: 200 }] });
  expect(value.operations.at(-1)).toBe('ROLLBACK');
});
test('failed observation still releases the row and drains every request', async () => {
  const problem = new Error('OBSERVATION_FAILED');
  const value = fixture({ barrierError: problem });
  await expect(
    releaseObservedGovernanceRequests(
      value.database,
      value.holder,
      value.requests,
    ),
  ).rejects.toBe(problem);
  expect(await Promise.all(value.requests)).toEqual([
    { status: 200 },
    { status: 200 },
  ]);
  expect(value.operations.at(-1)).toBe('ROLLBACK');
});
test('HTTP failure remains a failure after the observed row is released', async () => {
  const problem = new Error('HTTP_FAILED');
  const value = fixture({ rejectRequest: problem });
  await expect(
    releaseObservedGovernanceRequests(
      value.database,
      value.holder,
      value.requests,
    ),
  ).rejects.toBe(problem);
  expect(value.operations.at(-1)).toBe('ROLLBACK');
});
