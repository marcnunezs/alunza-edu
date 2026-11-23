import { test, expect } from '@jest/globals';
import { wrapGovernancePhaseTask } from '../e2e/governance-phase-fixture.mjs';

test('task awaits asynchronous rejection and excludes private error content', async () => {
  const task = wrapGovernancePhaseTask('request', async () => {
    await Promise.resolve();
    throw new Error('PRIVATE_SQL_CREDENTIAL_SENTINEL');
  });
  const error = await task({}).catch((caught) => caught);
  expect(error).toBeInstanceOf(Error);
  expect(error.message).toBe(
    'No se completó el fixture integrado (request; FIXTURE_FAILURE).',
  );
  expect(error.cause).toBeUndefined();
  expect(error.stack).not.toContain('PRIVATE_SQL_CREDENTIAL_SENTINEL');
});

test('task retains only a safe error code and successful values', async () => {
  const error = Object.assign(new Error('PRIVATE_SOURCE_SENTINEL'), {
    code: 'SCOPE_DENIED',
  });
  await expect(
    wrapGovernancePhaseTask('snapshot', () => Promise.reject(error))(),
  ).rejects.toThrow(
    'No se completó el fixture integrado (snapshot; SCOPE_DENIED).',
  );
  await expect(
    wrapGovernancePhaseTask('facts', async (value) => value)({ count: 3 }),
  ).resolves.toEqual({ count: 3 });
});
