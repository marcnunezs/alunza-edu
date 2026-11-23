const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');
const observers = require('../../infra/runner/watchdog-observation.cjs');
const { createWorkerCostRecorder, createCaseCostObservation } = observers;
let runner, schemas;
beforeAll(async () => {
  runner = await import('../../packages/runner/dist/index.js');
  schemas = await import('../../packages/runner/dist/remote-result.js');
});

function observation(lines, close = 180) {
  const value = createCaseCostObservation({
    now: () => 1080,
    originMs: 1000,
    launchRequestedMs: 40,
  });
  for (const line of lines) value.receive(Buffer.from(line));
  return value.snapshot(close);
}
const mark = (phase, atMs) => JSON.stringify({ phase, atMs }) + '\n';

test('trusted worker writes fixed incremental metadata to fd4 only and ignores diagnostic I/O failures', () => {
  let now = 12;
  const write = jest.fn();
  const cost = createWorkerCostRecorder({ now: () => now, write });
  cost.mark('entry');
  now = 20;
  cost.mark('importsReady');
  now = 21;
  cost.flush();
  expect(write.mock.calls).toEqual([
    [4, mark('entry', 12)],
    [4, mark('importsReady', 20)],
    [4, mark('workerExit', 21)],
  ]);
  cost.mark('serialized');
  expect(write).toHaveBeenCalledTimes(3);
  const broken = createWorkerCostRecorder({
    now: () => 1,
    write: () => {
      throw new Error('closed');
    },
  });
  expect(() => {
    broken.mark('entry');
    broken.flush();
  }).not.toThrow();
});

test('partial pipe frames retain two separate clocks and reached phases after a kill', () => {
  const line = mark('entry', 25);
  const result = observation([
    line.slice(0, 8),
    line.slice(8),
    mark('importsReady', 60),
  ]);
  expect(result).toMatchObject({
    status: 'PARTIAL',
    receivedFirstMs: 80,
    receivedLastMs: 80,
    launchRequestedMs: 40,
    closeObservedMs: 180,
    phases: [
      { phase: 'entry', atMs: 25 },
      { phase: 'importsReady', atMs: 60 },
    ],
  });
  expect(schemas.caseCostObservationSchema.safeParse(result).success).toBe(
    true,
  );
  expect(observation([]).status).toBe('MISSING');
});

test.each([
  mark('unknown-student-field', 30),
  mark('entry', 30),
  mark('wasmReady', -1),
  mark('wasmReady', 60001),
  mark('wasmReady', '12'),
  JSON.stringify({ phase: 'wasmReady', atMs: 40, code: 'PRIVATE' }) + '\n',
  '{"phase":"wasmReady","atMs":NaN}\n',
  'x'.repeat(4097),
  '{',
])(
  'malformed or excessive phase data is discarded without echoing content (%#)',
  (line) => {
    const result = observation([mark('entry', 25), line]);
    expect(result).toMatchObject({ status: 'INVALID', phases: [] });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|unknown-student/);
    expect(schemas.caseCostObservationSchema.safeParse(result).success).toBe(
      true,
    );
  },
);

function bridge(environment = {}, input = {}) {
  const state = { now: 1000 },
    stdin = new EventEmitter(),
    child = new EventEmitter();
  child.pid = 123;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdio = [
    null,
    child.stdout,
    child.stderr,
    new EventEmitter(),
    new EventEmitter(),
  ];
  const spawn = jest.fn(() => child);
  const limits = {
    'memory.max': '134217728',
    'memory.swap.max': '0',
    'pids.max': '32',
    'cpu.max': '100000 100000',
  };
  const modules = {
    'node:child_process': { spawn },
    'node:fs': {
      readFileSync: (file) => limits[path.posix.basename(file)] ?? '0',
      writeFileSync: () => {},
    },
    'node:perf_hooks': { performance: { now: () => state.now } },
    './watchdog-observation.cjs': observers,
  };
  vm.runInNewContext(
    fs.readFileSync(
      path.join(__dirname, '../../infra/runner/bridge.cjs'),
      'utf8',
    ),
    {
      require: (name) => modules[name],
      Buffer,
      process: {
        stdin,
        env: environment,
        stdout: {
          write: (value, done) => {
            state.packet = JSON.parse(value);
            done();
          },
        },
        exit: jest.fn(),
        kill: jest.fn(),
      },
      setTimeout: (callback, delay) => {
        state.timer = { callback, delay };
      },
      clearTimeout: jest.fn(),
    },
  );
  stdin.emit(
    'data',
    Buffer.from(
      JSON.stringify({
        code: 'DATA_NEVER_EXECUTED',
        args: [],
        budgetMs: 3000,
        outputRemaining: 65536,
        profile: 'case-cost-v1',
        ...input,
      }),
    ),
  );
  stdin.emit('end');
  return {
    state,
    child,
    spawn,
    close() {
      state.now = 1180;
      child.emit('exit', 0);
      child.emit('close', 0, null);
    },
  };
}

test.each([
  ['default worker', {}, true, false, false],
  [
    'profiled candidate',
    {
      ALUNZA_RUNNER_PROFILE: 'case-cost-v1',
      ALUNZA_RUNNER_OPTIMIZATION: 'candidate',
    },
    true,
    true,
    false,
  ],
  [
    'profiled baseline',
    {
      ALUNZA_RUNNER_PROFILE: 'case-cost-v1',
      ALUNZA_RUNNER_OPTIMIZATION: 'baseline',
    },
    false,
    true,
    false,
  ],
  [
    'profile without selection',
    { ALUNZA_RUNNER_PROFILE: 'case-cost-v1' },
    true,
    true,
    false,
  ],
  [
    'baseline label without profile',
    { ALUNZA_RUNNER_OPTIMIZATION: 'baseline' },
    true,
    false,
    false,
  ],
  [
    'fixed identity probe',
    {
      ALUNZA_RUNNER_PROBE: 'identity',
      ALUNZA_RUNNER_PROFILE: 'case-cost-v1',
      ALUNZA_RUNNER_OPTIMIZATION: 'candidate',
    },
    false,
    false,
    true,
  ],
])(
  '%s uses exactly the selected worker argv and keeps identity, pipes and deadline',
  (_label, env, optimized, profiled, probe) => {
    const run = bridge(env);
    expect(run.spawn).toHaveBeenCalledTimes(1);
    const [executable, args, options] = run.spawn.mock.calls[0];
    expect(executable).toBe('/usr/bin/setpriv');
    expect(args).toEqual([
      '--reuid=10001',
      '--regid=10001',
      '--clear-groups',
      '--bounding-set=-all',
      '--inh-caps=-all',
      '--ambient-caps=-all',
      '--no-new-privs',
      '/usr/local/bin/node',
      ...(optimized
        ? ['--v8-pool-size=1', '--wasm-num-compilation-tasks=1']
        : []),
      ...(probe
        ? ['/opt/alunza/os-probe.cjs', 'identity']
        : ['/opt/alunza/worker.cjs']),
    ]);
    expect(options.detached).toBe(true);
    expect(options.cwd).toBe('/tmp');
    expect(options.stdio).toEqual(
      profiled
        ? ['ignore', 'pipe', 'pipe', 'pipe', 'pipe']
        : ['ignore', 'pipe', 'pipe', 'pipe'],
    );
    expect(options.env).toEqual({
      PATH: '/usr/local/bin:/usr/bin:/bin',
      HOME: '/tmp',
      LANG: 'C.UTF-8',
      ...(profiled ? { ALUNZA_RUNNER_PROFILE: 'case-cost-v1' } : {}),
      ...(profiled && env.ALUNZA_RUNNER_OPTIMIZATION
        ? { ALUNZA_RUNNER_OPTIMIZATION: env.ALUNZA_RUNNER_OPTIMIZATION }
        : {}),
    });
    expect(run.state.timer.delay).toBe(2950);
    run.close();
    expect(run.state.packet.watchdog).toMatchObject({
      version: 2,
      budgetMs: 3000,
      deadlineMs: 3000,
      retirementReserveMs: 50,
      stopDeadlineMs: 2950,
      launchSkipped: false,
    });
    expect(run.state.packet.cgroup['memory.max']).toBe('134217728');
  },
);

test.each([
  {},
  {
    ALUNZA_RUNNER_PROFILE: 'unrecognized',
    ALUNZA_RUNNER_OPTIMIZATION: 'baseline',
  },
  {
    ALUNZA_RUNNER_PROFILE: 'case-cost-v1',
    ALUNZA_RUNNER_OPTIMIZATION: '--no-wasm-tier-up',
  },
])(
  'host environment and input cannot replace the fixed worker flags (%#)',
  (selection) => {
    const run = bridge(
      {
        ...selection,
        NODE_OPTIONS: '--eval=HOST_DATA_NEVER_EXECUTED',
        NODE_PATH: '/untrusted/modules',
        PATH: '/untrusted/bin',
        HOME: '/untrusted/home',
        LANG: 'untrusted',
        PRIVATE_ENV_FIXTURE: 'MUST_NOT_REACH_WORKER',
      },
      {
        argv: ['--eval=INPUT_DATA_NEVER_EXECUTED'],
        nodeOptions: '--v8-pool-size=128',
        optimization: 'baseline',
        ALUNZA_RUNNER_OPTIMIZATION: 'baseline',
        ALUNZA_RUNNER_PROFILE: 'case-cost-v1',
        ALUNZA_RUNNER_PROBE: 'identity',
      },
    );
    const [, args, options] = run.spawn.mock.calls[0];
    expect(args.slice(7)).toEqual([
      '/usr/local/bin/node',
      '--v8-pool-size=1',
      '--wasm-num-compilation-tasks=1',
      '/opt/alunza/worker.cjs',
    ]);
    expect(options.env).toEqual({
      PATH: '/usr/local/bin:/usr/bin:/bin',
      HOME: '/tmp',
      LANG: 'C.UTF-8',
      ...(selection.ALUNZA_RUNNER_PROFILE === 'case-cost-v1'
        ? { ALUNZA_RUNNER_PROFILE: 'case-cost-v1' }
        : {}),
    });
  },
);

test('input cannot replace an explicitly profiled baseline selection', () => {
  const run = bridge(
    {
      ALUNZA_RUNNER_PROFILE: 'case-cost-v1',
      ALUNZA_RUNNER_OPTIMIZATION: 'baseline',
    },
    {
      ALUNZA_RUNNER_OPTIMIZATION: 'candidate',
      argv: ['--v8-pool-size=1'],
    },
  );
  const [, args, options] = run.spawn.mock.calls[0];
  expect(args.slice(7)).toEqual([
    '/usr/local/bin/node',
    '/opt/alunza/worker.cjs',
  ]);
  expect(options.env.ALUNZA_RUNNER_OPTIMIZATION).toBe('baseline');
});

test('default flags preserve the 3000-ms budget and the combined 65536-byte cap', () => {
  const run = bridge({}, { budgetMs: 3000, outputRemaining: 65536 });
  expect(run.state.timer.delay).toBe(2950);
  run.child.stdout.emit('data', Buffer.alloc(32768, 'a'));
  run.child.stderr.emit('data', Buffer.alloc(32769, 'b'));
  run.close();
  expect(run.state.packet).toMatchObject({
    status: 'output',
    outputBytes: 65536,
    outputTruncated: true,
    watchdog: { budgetMs: 3000, deadlineMs: 3000, stopDeadlineMs: 2950 },
  });
  expect(Buffer.from(run.state.packet.stdout, 'base64').length).toBe(32768);
  expect(Buffer.from(run.state.packet.stderr, 'base64').length).toBe(32768);
});

test('a profiled image does not invent worker metadata when a 25-ms remaining budget skips launch', () => {
  const run = bridge(
    { ALUNZA_RUNNER_PROFILE: 'case-cost-v1' },
    { budgetMs: 25 },
  );
  expect(run.spawn).not.toHaveBeenCalled();
  expect(run.state.timer).toBeUndefined();
  expect(run.state.packet).toMatchObject({
    status: 'timeout',
    runtimeMs: 0,
    outputBytes: 0,
    outputTruncated: false,
    watchdog: {
      version: 2,
      budgetMs: 25,
      deadlineMs: 25,
      retirementReserveMs: 25,
      stopDeadlineMs: 0,
      launchSkipped: true,
      spawnObservedMs: null,
      exitObservedMs: null,
      killAttempts: 0,
    },
  });
  expect(run.state.packet).not.toHaveProperty('caseCost');
  expect(run.state.packet).not.toHaveProperty('returnData');
});

test('profiling is an image-owned opt-in and never enabled by student input or probes', () => {
  for (const env of [
    {},
    { ALUNZA_RUNNER_PROFILE: 'case-cost-v1', ALUNZA_RUNNER_PROBE: 'identity' },
  ]) {
    const run = bridge(env);
    expect(run.spawn.mock.calls[0][2].stdio).toHaveLength(4);
    expect(run.spawn.mock.calls[0][2].env).not.toHaveProperty(
      'ALUNZA_RUNNER_PROFILE',
    );
    run.close();
    expect(run.state.packet).not.toHaveProperty('caseCost');
  }
});

test('bridge keeps metadata out of console and result channels and retains the same parse-to-close budget', () => {
  const run = bridge({
    ALUNZA_RUNNER_PROFILE: 'case-cost-v1',
    ALUNZA_RUNNER_OPTIMIZATION: 'candidate',
  });
  expect(run.spawn.mock.calls[0][2].stdio).toHaveLength(5);
  expect(run.spawn.mock.calls[0][2].env.ALUNZA_RUNNER_OPTIMIZATION).toBe(
    'candidate',
  );
  expect(run.state.timer.delay).toBe(2950);
  run.state.now = 1080;
  run.child.stdio[4].emit(
    'data',
    Buffer.from(mark('entry', 20) + mark('workerExit', 50)),
  );
  run.child.stdout.emit('data', Buffer.from('console'));
  run.child.stdio[3].emit('data', Buffer.from('{"kind":"value"}'));
  run.close();
  expect(run.state.packet.runtimeMs).toBe(180);
  expect(run.state.packet.watchdog.closeObservedMs).toBe(180);
  expect(run.state.packet.watchdog).toMatchObject({
    budgetMs: 3000,
    deadlineMs: 3000,
    retirementReserveMs: 50,
    stopDeadlineMs: 2950,
  });
  expect(run.state.packet.caseCost).toMatchObject({
    status: 'COMPLETE',
    closeObservedMs: 180,
  });
  expect(run.state.packet.outputBytes).toBe(7);
  expect(Buffer.from(run.state.packet.stdout, 'base64').toString()).toBe(
    'console',
  );
  expect(Buffer.from(run.state.packet.returnData, 'base64').toString()).toBe(
    '{"kind":"value"}',
  );
});

test('malformed private profiling cannot change the bridge outcome or watchdog', () => {
  const run = bridge({ ALUNZA_RUNNER_PROFILE: 'case-cost-v1' });
  run.state.now = 1080;
  run.child.stdio[4].emit('data', Buffer.from('x'.repeat(4097)));
  run.close();
  expect(run.state.packet).toMatchObject({
    status: 'exited',
    runtimeMs: 180,
    outputBytes: 0,
    caseCost: { status: 'INVALID', phases: [] },
  });
});

test('runner retains sanitized phases only in private evidence and charges the unchanged total across cases', async () => {
  const cost = observation([mark('entry', 25), mark('workerExit', 75)]);
  const response = {
    packet: {
      status: 'exited',
      runtimeMs: 180,
      outputBytes: 0,
      stdout: '',
      stderr: '',
      outputTruncated: false,
      exitCode: 0,
      signal: null,
      caseCost: cost,
      returnData: Buffer.from(
        JSON.stringify({
          kind: 'value',
          value: true,
          invocation: 'QUICKJS_SYNC_CALL',
        }),
      ).toString('base64'),
      cgroup: {
        'memory.max': '134217728',
        'memory.swap.max': '0',
        'pids.max': '32',
        'cpu.max': '100000 100000',
      },
    },
    exitCode: 0,
    oomKilled: false,
    timedOut: false,
    cancelled: false,
    cleanupVerified: true,
    programWallMs: 200,
    containerWallMs: 210,
    lifecycleMs: 220,
    image: 'sha256:' + 'a'.repeat(64),
  };
  const adapter = {
    provider: 'docker',
    execute: jest.fn(async () => response),
    close: jest.fn(async () => {}),
  };
  const input = {
    executionId: randomUUID(),
    requestId: 'fixture',
    exerciseVersionId: 'fixture',
    testsVersion: 'v1',
    mode: 'SUBMIT',
    entrypoint: 'solve',
    code: 'DATA_NOT_EXECUTED',
    tests: [
      { id: 'visible', visibility: 'visible', args: [], expected: true },
      { id: 'hidden', visibility: 'hidden', args: [], expected: true },
    ],
  };
  const result = await runner.execute(input, adapter);
  expect(result).toMatchObject({ diagnosisCode: 'SUCCESS', runtimeMs: 360 });
  expect(adapter.execute.mock.calls.map(([call]) => call.budgetMs)).toEqual([
    3000, 2820,
  ]);
  expect(result.evidence.timings.map((item) => item.caseCost)).toEqual([
    cost,
    cost,
  ]);
  expect(JSON.stringify(runner.publicResult(result))).not.toMatch(
    /caseCost|workerOrigin|phases|receivedFirst|hidden"/,
  );
  expect(
    schemas.capsulePacketSchema.safeParse({
      ...response.packet,
      runtimeMs: 179,
    }).success,
  ).toBe(false);
});
