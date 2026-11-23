import { env as nodeEnvironment } from 'node:process';
import { jest } from '@jest/globals';

// Instantiate the real fixture without connecting to Auth or PostgreSQL. This
// catches lexical-scope regressions before any campaign can prepare its data.
const forbiddenIo = jest.fn(() => {
  throw new Error('Fixture construction must not execute database operations.');
});
const applicationEnd = jest.fn(async () => {});
const baseClose = jest.fn(async () => {});
const pool = jest.fn(() => ({
  connect: forbiddenIo,
  query: forbiddenIo,
  end: applicationEnd,
}));
const baseHarness = jest.fn(async () => ({
  database: { connect: forbiddenIo, query: forbiddenIo },
  actors: {},
  close: baseClose,
}));
jest.unstable_mockModule('pg', () => ({ default: { Pool: pool } }));
jest.unstable_mockModule('../../tests/e2e/dashboard-fixture.mjs', () => ({
  createDashboardHarness: baseHarness,
}));
const { createProgressPhaseHarness } =
  await import('../../tests/e2e/progress-phase-fixture.mjs');

const state = {
  projectId: 'alunza-edu-laboratorio-test',
  authUrl: 'http://127.0.0.1:18421',
  migrationUrl: 'postgresql://fixture:unused@127.0.0.1:18422/postgres',
  applicationPassword: 'unused-offline-fixture',
};
const keys = ['ALUNZA_TEST_DASHBOARD_TIMINGS', 'ALUNZA_E2E_SUITE'];
let saved;
beforeEach(() => {
  saved = Object.fromEntries(keys.map((key) => [key, nodeEnvironment[key]]));
  jest.clearAllMocks();
});
afterEach(() => {
  for (const key of keys) {
    if (saved[key] === undefined) delete nodeEnvironment[key];
    else nodeEnvironment[key] = saved[key];
  }
});

test.each([
  ['normal suite', undefined, 'full'],
  ['context diagnostics', '1', 'phase-context'],
])(
  'real fixture constructs and closes for %s without Auth or database I/O',
  async (_name, flag, suite) => {
    if (flag === undefined)
      delete nodeEnvironment.ALUNZA_TEST_DASHBOARD_TIMINGS;
    else nodeEnvironment.ALUNZA_TEST_DASHBOARD_TIMINGS = flag;
    nodeEnvironment.ALUNZA_E2E_SUITE = suite;
    const harness = await createProgressPhaseHarness(state);
    expect(harness.prepare).toEqual(expect.any(Function));
    expect(harness.performance).toEqual(expect.any(Function));
    await harness.close();
    expect(baseHarness).toHaveBeenCalledTimes(1);
    expect(pool).toHaveBeenCalledTimes(1);
    expect(forbiddenIo).not.toHaveBeenCalled();
    expect(applicationEnd).toHaveBeenCalledTimes(1);
    expect(baseClose).toHaveBeenCalledTimes(1);
  },
);

test('diagnostics still reject a non-context suite with the intended configuration assertion', async () => {
  nodeEnvironment.ALUNZA_TEST_DASHBOARD_TIMINGS = '1';
  nodeEnvironment.ALUNZA_E2E_SUITE = 'full';
  await expect(createProgressPhaseHarness(state)).rejects.toMatchObject({
    code: 'ERR_ASSERTION',
  });
  expect(forbiddenIo).not.toHaveBeenCalled();
});
