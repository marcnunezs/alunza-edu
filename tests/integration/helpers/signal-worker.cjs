/* eslint @typescript-eslint/no-require-imports: "off" */
// A real isolated worker process. IPC barriers pause only after durable calls;
// no fixture result replaces capture, computation, lease renewal or finalization.
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
const {
  SignalsWorker,
} = require('../../../apps/api/dist/signals/signals.worker.js');

let database;
let release;
let running = false;
let barrier;
const send = (message) => process.send?.(message);
const waitForRelease = () =>
  new Promise((resolve) => {
    release = resolve;
  });

async function main() {
  const state = JSON.parse(readFileSync(process.env.ALUNZA_TEST_STATE, 'utf8'));
  assertLaboratoryTestState(state);
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
  database = new DatabaseService(config);
  await database.ready();
  class BarrierRepository extends SignalsRepository {
    async capture(job) {
      const snapshot = await super.capture(job);
      if (snapshot && barrier === 'capture') {
        const waiting = waitForRelease();
        send({
          type: 'captured',
          laneId: job.laneId,
          snapshotId: snapshot.snapshot.id,
        });
        await waiting;
      }
      return snapshot;
    }
    async finalize(job, snapshotId, batch) {
      const result = await super.finalize(job, snapshotId, batch);
      if (
        barrier === 'finalize' &&
        ['COMMITTED', 'REPLAY'].includes(result.status)
      ) {
        const waiting = waitForRelease();
        send({ type: 'committed', laneId: job.laneId, ...result });
        await waiting;
      }
      return result;
    }
  }
  const worker = new SignalsWorker(new BarrierRepository(database), config);
  process.on('message', async (message) => {
    if (message?.type === 'continue') {
      release?.();
      release = undefined;
      return;
    }
    if (
      message?.type !== 'run' ||
      running ||
      !/^[0-9a-f-]{36}$/.test(message.laneId) ||
      ![null, 'capture', 'finalize'].includes(message.barrier)
    ) {
      send({ type: 'failed', code: 'INVALID_WORKER_MESSAGE' });
      return;
    }
    running = true;
    barrier = message.barrier;
    try {
      await worker.tick(message.laneId);
      send({ type: 'finished', metrics: worker.metrics() });
    } catch {
      send({ type: 'failed', code: 'WORKER_TICK_FAILED' });
    } finally {
      running = false;
    }
  });
  process.on('disconnect', async () => {
    release?.();
    await worker.onModuleDestroy();
    await database.onModuleDestroy();
    process.exit(0);
  });
  send({ type: 'ready' });
}
main().catch(async () => {
  send({ type: 'failed', code: 'WORKER_START_FAILED' });
  await database?.onModuleDestroy();
  process.exitCode = 1;
  process.disconnect?.();
});
