import { jest, test, expect } from '@jest/globals';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { nodeService } from '../../scripts/test-environment.mjs';

const require = createRequire(import.meta.url);
const { testStartupObserver } = require('../test-startup-observer.cjs');

function observer() {
  const records = [];
  let tick = 0;
  return {
    records,
    startup: testStartupObserver('EVALUATION', {
      now: () => (tick += 10),
      write: (line) => records.push(JSON.parse(line)),
    }),
  };
}

test('isolated instance initialization is timed and observation is disabled afterwards', async () => {
  const { startup, records } = observer();
  const app = {
    init: jest.fn(async function () {
      return this;
    }),
  };
  const init = app.init;
  const factory = { create: jest.fn(async () => app) };
  const create = factory.create;
  startup.mark('IMPORTS_START');
  startup.mark('IMPORTS_COMPLETE');
  const result = await startup.createApp(factory, async () => {
    const instance = await factory.create({ secret: 'must-not-be-logged' });
    await instance.init();
    return instance;
  });
  expect(result.init).toBe(init);
  expect(factory.create).toBe(create);
  expect(app.init).toBe(init);
  expect(records.map((item) => item.phase)).toEqual([
    'IMPORTS_START',
    'IMPORTS_COMPLETE',
    'CREATE_APP_START',
    'APP_INIT_START',
    'APP_INIT_COMPLETE',
    'CREATE_APP_COMPLETE',
  ]);
  expect(records.every((item) => item.phaseMs === 10)).toBe(true);
  expect(records.at(-1).elapsedMs).toBe(60);
  expect(JSON.stringify(records)).not.toContain('must-not-be-logged');
});

test('Nest proxy that ignores method assignments still emits init timing without mutation', async () => {
  const { startup, records } = observer();
  const app = {
    init: jest.fn(async function () {
      return this;
    }),
  };
  const ignoredWrite = jest.fn(() => true);
  // Nest 12 returns fresh method wrappers and uses its read trap for writes,
  // so app.init = wrapper succeeds superficially without changing init.
  const nestApp = new Proxy(app, {
    get(target, property) {
      const value = Reflect.get(target, property);
      return typeof value === 'function'
        ? (...args) => Reflect.get(target, property).apply(target, args)
        : value;
    },
    set: ignoredWrite,
  });
  const factory = { create: jest.fn(async () => nestApp) };
  const originalCreate = factory.create;
  let capturedInit;
  const result = await startup.createApp(factory, async () => {
    const instance = await factory.create();
    capturedInit = instance.init;
    expect(await instance.init()).toBe(app);
    return instance;
  });
  expect(records.map((item) => item.phase)).toEqual([
    'CREATE_APP_START',
    'APP_INIT_START',
    'APP_INIT_COMPLETE',
    'CREATE_APP_COMPLETE',
  ]);
  expect(factory.create).toBe(originalCreate);
  expect(ignoredWrite).not.toHaveBeenCalled();
  await result.init();
  await capturedInit();
  expect(app.init).toHaveBeenCalledTimes(3);
  expect(records).toHaveLength(4);
});

test('failed initialization preserves its phase without serializing the error', async () => {
  const { startup, records } = observer();
  const failure = new Error('private-database-url');
  const app = {
    init: jest.fn(async () => {
      throw failure;
    }),
  };
  const init = app.init;
  const factory = { create: jest.fn(async () => app) };
  const create = factory.create;
  await expect(
    startup.createApp(factory, async () => {
      const instance = await factory.create();
      return instance.init();
    }),
  ).rejects.toBe(failure);
  startup.failed(failure);
  expect(factory.create).toBe(create);
  expect(app.init).toBe(init);
  expect(records.at(-1)).toMatchObject({
    phase: 'STARTUP_FAILED',
    failedPhase: 'APP_INIT_START',
  });
  expect(JSON.stringify(records)).not.toContain('private-database-url');
});

test('import failures are visible before application loading and reject arbitrary phases', () => {
  const { startup, records } = observer();
  startup.mark('IMPORTS_START');
  startup.failed();
  expect(records.at(-1).failedPhase).toBe('IMPORTS_START');
  expect(() => startup.mark('secret-value')).toThrow(
    'Unknown TEST startup phase',
  );
  expect(JSON.stringify(records)).not.toContain('secret-value');
});

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  return child;
}

test('nodeService retains failed readiness and subsequent readiness without retries', async () => {
  const child = fakeChild();
  const spawnProcess = jest.fn(() => child);
  const service = nodeService([], {}, undefined, { spawnProcess });
  const failure = new Error('private-readiness-url');
  service.wait = jest
    .fn()
    .mockRejectedValueOnce(failure)
    .mockResolvedValueOnce();
  await expect(service.start('http://127.0.0.1/health/ready')).rejects.toBe(
    failure,
  );
  expect(service.wait).toHaveBeenCalledTimes(1);
  await service.start('http://127.0.0.1/health/ready');
  expect(spawnProcess).toHaveBeenCalledTimes(1);
  expect(service.startupMeasurements).toHaveLength(2);
  expect(service.startupMeasurements[0]).toMatchObject({
    status: 'FAILED',
    readyMs: null,
    timeoutMs: 30000,
    failureCode: 'READINESS_FAILED',
  });
  expect(service.startupMeasurements[1]).toMatchObject({
    status: 'READY',
    readyMs: expect.any(Number),
    failureCode: null,
  });
  expect(JSON.stringify(service.startupMeasurements)).not.toContain(
    'private-readiness-url',
  );
});

test('nodeService retains synchronous spawn failure without its arguments or error body', async () => {
  const failure = new Error('private-environment');
  const service = nodeService(['private-argument'], {}, undefined, {
    spawnProcess: () => {
      throw failure;
    },
  });
  await expect(service.start('http://127.0.0.1/health/ready')).rejects.toBe(
    failure,
  );
  expect(service.startupMeasurements[0]).toMatchObject({
    status: 'FAILED',
    readyMs: null,
    failureCode: 'PROCESS_SPAWN_FAILED',
  });
  expect(JSON.stringify(service.startupMeasurements)).not.toContain('private-');
});
