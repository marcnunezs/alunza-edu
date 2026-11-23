/* eslint @typescript-eslint/no-require-imports: "off" */
// Inject a corrupted transport response after reading real canonical snapshots.
// No stored source, snapshot or evaluation is modified by this fault injection.
const { readFileSync } = require('node:fs');
const {
  assertLaboratoryTestState,
} = require('../../laboratory-test-state.cjs');
require('reflect-metadata');
const { loadConfig } = require('../../../apps/api/dist/config.js');
const {
  DatabaseService,
} = require('../../../apps/api/dist/database/database.service.js');
const {
  SignalsRepository,
} = require('../../../apps/api/dist/signals/signals.repository.js');

async function main() {
  const state = JSON.parse(readFileSync(process.env.ALUNZA_TEST_STATE, 'utf8'));
  assertLaboratoryTestState(state);
  const scope = JSON.parse(process.argv[2]);
  const { apiEnvironment } = await import('../../../scripts/local.mjs');
  const { testContext } = await import('../../../scripts/test-environment.mjs');
  const config = loadConfig({
    ...apiEnvironment(testContext, state),
    INVITATION_WORKER_ENABLED: 'false',
    MATERIALS_WORKER_ENABLED: 'false',
    HELP_WORKER_ENABLED: 'false',
    SIGNALS_WORKER_ENABLED: 'false',
    PRACTICE_RUNNER_ENABLED: 'false',
    EVALUATION_ENABLED: 'false',
  });
  const database = new DatabaseService(config);
  let tamperedResponses = 0;
  let reconstructionCalls = 0;
  const transport = {
    internal: (action) =>
      database.internal(async (client) =>
        action({
          query: async (...args) => {
            if (args[0].includes('app_private.signal_rebuild'))
              reconstructionCalls++;
            const response = await client.query(...args);
            if (args[0].includes('app_private.signal_replay_inputs')) {
              const changed = {
                ...response,
                rows: globalThis.structuredClone(response.rows),
              };
              const evaluation = changed.rows[0].data.flatMap(
                (input) => input.evaluations,
              )[0];
              if (!evaluation) throw new Error('MISSING_REPLAY_FIXTURE');
              evaluation.result = {
                ...evaluation.result,
                outcome: 'CORRUPTED_TRANSPORT',
              };
              tamperedResponses++;
              return changed;
            }
            return response;
          },
        }),
      ),
  };
  try {
    await database.ready();
    try {
      await new SignalsRepository(transport).maintenance('rebuild', scope);
      throw new Error('CORRUPTION_WAS_ACCEPTED');
    } catch (error) {
      if (error.message !== 'SIGNAL_HISTORICAL_RESULT_MISMATCH') throw error;
      console.log(
        JSON.stringify({
          errorCode: error.message,
          tamperedResponses,
          reconstructionCalls,
        }),
      );
    }
  } finally {
    await database.onModuleDestroy();
  }
}
main().catch(() => {
  console.error('SIGNAL_MAINTENANCE_FAULT_TEST_FAILED');
  process.exitCode = 1;
});
