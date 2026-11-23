'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {
  createWorkerCostRecorder,
  workerCostPhases,
} = require('../../infra/runner/watchdog-observation.cjs');
const source = fs.readFileSync(
  path.join(__dirname, '../../infra/runner/worker.cjs'),
  'utf8',
);

// Only the fixed trusted worker is evaluated. All QuickJS entry points are inert
// doubles; fixture source is data and is never evaluated by Node or QuickJS.
async function workerHarness({
  env = {},
  identityDenied = false,
  profileWriteFails = false,
  wasmFails = false,
  solveFails = false,
  exhaustBudget = false,
  inputProfile = false,
} = {}) {
  let now = 20;
  const writes = [],
    reads = [],
    imported = [],
    exits = [],
    handles = [];
  const handle = (tag, text) => {
    const value = { tag, text, dispose: jest.fn() };
    handles.push(value);
    return value;
  };
  const exportsObject = handle('exports');
  const context = {
    global: handle('global'),
    undefined: handle('undefined'),
    false: handle('false'),
    true: handle('true'),
    evalCode: jest.fn((_text, filename) => ({
      value: handle(
        filename === 'json-contract.js'
          ? 'serializerFactory'
          : 'stringifyConsole',
      ),
    })),
    newFunction: jest.fn((name) => handle(name)),
    newObject: jest.fn(() => handle('object')),
    newString: jest.fn((text) => handle('string', text)),
    setProp: jest.fn(),
    getProp: jest.fn((_target, name) =>
      name === 'exports' ? exportsObject : handle(String(name)),
    ),
    typeof: jest.fn(() => 'function'),
    getString: jest.fn((value) => value.text),
    dispose: jest.fn(),
  };
  let interrupt;
  const runtime = {
    setMemoryLimit: jest.fn(),
    setMaxStackSize: jest.fn(),
    setInterruptHandler: jest.fn((handler) => {
      interrupt = handler;
    }),
    newContext: jest.fn(() => context),
    dispose: jest.fn(),
  };
  context.callFunction = jest.fn((target) => {
    if (target.tag === 'serializerFactory')
      return { value: handle('serialize') };
    if (target.tag === 'Function') return { value: handle('compiled') };
    if (target.tag === 'solve') {
      if (exhaustBudget) {
        now += 3001;
        interrupt();
      }
      if (solveFails || exhaustBudget) return { error: handle('guest-error') };
    }
    return {
      value:
        target.tag === 'serialize'
          ? handle('json', '{"fixed":true}')
          : handle('value'),
    };
  });
  const baseLoader = jest.fn(),
    candidateLoader = jest.fn();
  const baseVariant = {
    type: 'sync',
    importModuleLoader: jest.fn(async () => baseLoader),
    importFFI: jest.fn(),
  };
  const createModule = jest.fn(async (variant) => {
    if (wasmFails) throw new Error('fixed WASM bootstrap failure');
    await variant.importModuleLoader();
    return { newRuntime: jest.fn(() => runtime) };
  });
  const input = {
    args: [1],
    budgetMs: 3000,
    outputRemaining: 65536,
    ...(inputProfile
      ? {
          ALUNZA_RUNNER_PROFILE: 'case-cost-v1',
          ALUNZA_RUNNER_OPTIMIZATION: 'baseline',
        }
      : {}),
  };
  const localProcess = {
    env,
    exitCode: undefined,
    once: jest.fn((event, callback) => {
      if (event !== 'exit') throw new Error('unexpected process event');
      exits.push(callback);
    }),
  };
  const modules = {
    'node:fs': {
      readFileSync(file) {
        reads.push(file);
        if (file === '/tmp/args.json') return JSON.stringify(input);
        if (file === '/tmp/solution.cjs') return 'STUDENT_SOURCE_IS_DATA_ONLY';
        throw new Error('unexpected file');
      },
      writeSync(fd, bytes) {
        if (fd === 4 && profileWriteFails)
          throw new Error('fixed pipe failure');
        writes.push({ fd, value: bytes.toString() });
      },
    },
    'node:perf_hooks': { performance: { now: () => now++ } },
    './watchdog-observation.cjs': { createWorkerCostRecorder },
    'quickjs-emscripten-core': {
      newQuickJSWASMModuleFromVariant: createModule,
    },
    '@jitl/quickjs-wasmfile-release-sync': { default: baseVariant },
    '@jitl/quickjs-wasmfile-release-sync/emscripten-module': candidateLoader,
    './worker-identity.cjs': {
      assertIdentity() {
        if (identityDenied) throw new Error('identity denied');
      },
    },
  };
  await vm.runInNewContext(source, {
    require(name) {
      imported.push(name);
      if (!(name in modules)) throw new Error('unexpected import');
      return modules[name];
    },
    Buffer,
    process: localProcess,
  });
  for (const callback of exits) callback();
  return {
    writes,
    reads,
    imported,
    handles,
    runtime,
    context,
    createModule,
    baseVariant,
    process: localProcess,
    packet: JSON.parse(writes.find((item) => item.fd === 3).value),
    phases: writes
      .filter((item) => item.fd === 4)
      .map((item) => JSON.parse(item.value).phase),
  };
}

test('default uses public CJS loader and preserves process limits without profiling', async () => {
  const run = await workerHarness();
  expect(run.imported).toContain(
    '@jitl/quickjs-wasmfile-release-sync/emscripten-module',
  );
  expect(run.baseVariant.importModuleLoader).not.toHaveBeenCalled();
  expect(run.runtime.setMemoryLimit).toHaveBeenCalledWith(134217728);
  expect(run.runtime.setMaxStackSize).toHaveBeenCalledWith(1048576);
  expect(run.runtime.setInterruptHandler).toHaveBeenCalledTimes(1);
  expect(run.phases).toEqual([]);
  expect(run.packet).toEqual({
    kind: 'value',
    value: { fixed: true },
    invocation: 'QUICKJS_SYNC_CALL',
  });
});

test('baseline requires both trusted profile and baseline selection', async () => {
  const run = await workerHarness({
    env: {
      ALUNZA_RUNNER_PROFILE: 'case-cost-v1',
      ALUNZA_RUNNER_OPTIMIZATION: 'baseline',
    },
  });
  expect(run.createModule).toHaveBeenCalledWith(run.baseVariant);
  expect(run.baseVariant.importModuleLoader).toHaveBeenCalledTimes(1);
  expect(run.imported).not.toContain(
    '@jitl/quickjs-wasmfile-release-sync/emscripten-module',
  );
  expect(run.phases).toEqual(workerCostPhases);
});

test.each([undefined, 'other'])(
  'baseline label alone cannot change loader with profile=%s',
  async (profile) => {
    const run = await workerHarness({
      env: {
        ALUNZA_RUNNER_PROFILE: profile,
        ALUNZA_RUNNER_OPTIMIZATION: 'baseline',
      },
    });
    expect(run.baseVariant.importModuleLoader).not.toHaveBeenCalled();
    expect(run.phases).toEqual([]);
  },
);

test('capsule input cannot enable instrumentation or select the baseline loader', async () => {
  const run = await workerHarness({ inputProfile: true });
  expect(run.phases).toEqual([]);
  expect(run.baseVariant.importModuleLoader).not.toHaveBeenCalled();
});

test('candidate and baseline emit equal private phases and equal unchanged packets', async () => {
  const runs = [];
  for (const optimization of ['baseline', 'candidate'])
    runs.push(
      await workerHarness({
        env: {
          ALUNZA_RUNNER_PROFILE: 'case-cost-v1',
          ALUNZA_RUNNER_OPTIMIZATION: optimization,
        },
      }),
    );
  expect(runs[0].packet).toEqual(runs[1].packet);
  for (const run of runs) {
    expect(run.phases).toEqual(workerCostPhases);
    expect(run.writes.every((item) => [3, 4].includes(item.fd))).toBe(true);
    expect(run.packet).not.toHaveProperty('phases');
    expect(run.context.dispose).toHaveBeenCalledTimes(1);
    expect(run.runtime.dispose).toHaveBeenCalledTimes(1);
  }
  expect(runs[0].runtime).not.toBe(runs[1].runtime);
  expect(runs[0].context).not.toBe(runs[1].context);
});

test('identity failure prevents input reads and WASM construction', async () => {
  const run = await workerHarness({
    identityDenied: true,
    env: { ALUNZA_RUNNER_PROFILE: 'case-cost-v1' },
  });
  expect(run.packet).toEqual({ kind: 'invalid', reason: 'CAPABILITY_GAP' });
  expect(run.process.exitCode).toBe(71);
  expect(run.createModule).not.toHaveBeenCalled();
  expect(run.reads).toEqual([]);
  expect(run.phases).toEqual(['entry', 'importsReady', 'workerExit']);
});

test('WASM initialization failure remains runner failure with partial private phases', async () => {
  const run = await workerHarness({
    wasmFails: true,
    env: { ALUNZA_RUNNER_PROFILE: 'case-cost-v1' },
  });
  expect(run.packet).toEqual({ kind: 'invalid', reason: 'RUNNER_FAILURE' });
  expect(run.phases).toEqual([
    'entry',
    'importsReady',
    'identityChecked',
    'inputRead',
    'workerExit',
  ]);
});

test('profiling pipe failure cannot change result, limits or cleanup', async () => {
  const run = await workerHarness({
    profileWriteFails: true,
    env: { ALUNZA_RUNNER_PROFILE: 'case-cost-v1' },
  });
  expect(run.packet.kind).toBe('value');
  expect(run.runtime.setMemoryLimit).toHaveBeenCalledWith(134217728);
  expect(run.context.dispose).toHaveBeenCalledTimes(1);
  expect(run.runtime.dispose).toHaveBeenCalledTimes(1);
});

test.each([false, true])(
  'guest failure preserves cleanup and deadline precedence=%s',
  async (exhaustBudget) => {
    const run = await workerHarness({
      solveFails: true,
      exhaustBudget,
      env: { ALUNZA_RUNNER_PROFILE: 'case-cost-v1' },
    });
    expect(run.packet).toEqual(
      exhaustBudget
        ? { kind: 'invalid', reason: 'EXECUTION_DEADLINE' }
        : { kind: 'exception' },
    );
    expect(run.runtime.dispose).toHaveBeenCalledTimes(1);
    expect(run.context.dispose).toHaveBeenCalledTimes(1);
    expect(run.phases).toContain('moduleEvaluated');
    expect(run.phases).not.toContain('solveReturned');
    expect(run.phases.slice(-2)).toEqual(['disposed', 'workerExit']);
  },
);
