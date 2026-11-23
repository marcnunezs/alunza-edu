const { randomUUID } = require('node:crypto');
const {
  createWatchdogObservation,
} = require('../../infra/runner/watchdog-observation.cjs');
let runner, packetSchema, observationSchema;
beforeAll(async () => {
  runner = await import('../../packages/runner/dist/index.js');
  const schemas = await import('../../packages/runner/dist/remote-result.js');
  packetSchema = schemas.capsulePacketSchema;
  observationSchema = schemas.watchdogObservationSchema;
});

function observation({
  budgetMs = 3000,
  timeout = false,
  leaderExitsFirst = false,
  outputThenFailedKill = false,
  failedSpawn = false,
  preventive = false,
} = {}) {
  let now = 1000;
  const observed = createWatchdogObservation({
    now: () => now,
    originMs: now,
    budgetMs,
  });
  const at = (value) => {
    now = 1000 + value;
  };
  at(40);
  observed.launchRequested();
  at(50);
  observed.arm();
  at(60);
  if (!failedSpawn) observed.spawned();
  if (failedSpawn) {
    at(70);
    observed.killAttempt();
    at(75);
    observed.closed();
    return observed.snapshot();
  }
  if (outputThenFailedKill) {
    at(80);
    observed.killAttempt();
    observed.killCallSucceeded();
  }
  if (leaderExitsFirst) {
    at(100);
    observed.exited();
  }
  if (timeout) {
    at(preventive ? budgetMs - 50 : budgetMs + 50);
    observed.fired();
    observed.killAttempt();
    if (!outputThenFailedKill) {
      at(preventive ? budgetMs - 49 : budgetMs + 51);
      observed.killCallSucceeded();
    }
  }
  if (!leaderExitsFirst) {
    at(timeout ? (preventive ? budgetMs - 45 : budgetMs + 80) : 100);
    observed.exited();
  }
  at(timeout ? (preventive ? budgetMs - 44 : budgetMs + 120) : 120);
  observed.closed();
  return observed.snapshot();
}

function capsule(watchdog, status = 'exited') {
  const runtimeMs = watchdog?.closeObservedMs ?? 120;
  return {
    packet: {
      status,
      runtimeMs,
      outputBytes: 0,
      stdout: '',
      stderr: '',
      returnData: Buffer.from(
        JSON.stringify({
          kind: 'value',
          value: true,
          invocation: 'QUICKJS_SYNC_CALL',
        }),
      ).toString('base64'),
      outputTruncated: false,
      exitCode: status === 'exited' ? 0 : null,
      signal: status === 'exited' || watchdog?.launchSkipped ? null : 'SIGKILL',
      ...(watchdog ? { watchdog } : {}),
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
    programWallMs: runtimeMs + 10,
    containerWallMs: runtimeMs + 50,
    lifecycleMs: runtimeMs + 100,
    image: 'sha256:' + 'a'.repeat(64),
  };
}

function input() {
  return {
    executionId: randomUUID(),
    requestId: 'watchdog-observation-fixture',
    exerciseVersionId: 'watchdog-fixture',
    testsVersion: 'v1',
    mode: 'SUBMIT',
    entrypoint: 'solve',
    code: 'module.exports.solve = () => true',
    tests: [{ id: 'visible', visibility: 'visible', args: [], expected: true }],
  };
}

function adapter(responses) {
  return {
    provider: 'docker',
    execute: jest.fn(async () => responses.shift()),
    close: jest.fn(async () => {}),
  };
}

test('execute retains successful watchdog evidence privately and omits it from the entire public projection', async () => {
  const watchdog = observation();
  const result = await runner.execute(input(), adapter([capsule(watchdog)]));
  expect(result.diagnosisCode).toBe('SUCCESS');
  expect(result.evidence.timings[0].watchdog).toEqual(watchdog);
  const publicResult = runner.publicResult(result);
  expect(publicResult).not.toHaveProperty('evidence');
  expect(JSON.stringify(publicResult)).not.toMatch(
    /watchdog|PERFORMANCE_NOW|BRIDGE_INPUT_PARSED|killCall|lastGuestInstruction/,
  );
  expect(publicResult.runtimeMs).toBe(120);
});

test('late watchdog observations retain the measured overshoot without changing timeout classification', async () => {
  const watchdog = observation({ timeout: true });
  const result = await runner.execute(
    input(),
    adapter([capsule(watchdog, 'timeout')]),
  );
  expect(result).toMatchObject({
    diagnosisCode: 'TIMEOUT',
    terminationReason: 'EXECUTION_DEADLINE',
    runtimeMs: 3120,
  });
  expect(result.evidence.timings[0].watchdog).toMatchObject({
    deadlineMs: 3000,
    retirementReserveMs: 50,
    stopDeadlineMs: 2950,
    watchdogFiredMs: 3050,
    watchdogLatenessMs: 100,
    firstKillCallSucceededMs: 3051,
    exitObservedMs: 3080,
    closeObservedMs: 3120,
    lastGuestInstructionObservedMs: null,
  });
  expect(runner.publicResult(result)).not.toHaveProperty('watchdog');
});

test('remaining budget for a second case stays cumulative in the request and its private observation', async () => {
  const first = observation();
  const remaining = 3000 - first.closeObservedMs;
  const second = observation({ budgetMs: remaining, timeout: true });
  const backend = adapter([capsule(first), capsule(second, 'timeout')]);
  const source = input();
  source.tests.push({
    id: 'hidden',
    visibility: 'hidden',
    args: [],
    expected: true,
  });
  const result = await runner.execute(source, backend);
  expect(backend.execute.mock.calls[1][0].budgetMs).toBe(2880);
  expect(result.evidence.timings[1].watchdog.budgetMs).toBe(2880);
  expect(result.diagnosisCode).toBe('TIMEOUT');
  expect(result.runtimeMs).toBe(3120);
});

test('preventive stop remains TIMEOUT with the measured close below 3000, never a manufactured success', async () => {
  const watchdog = observation({ timeout: true, preventive: true });
  const result = await runner.execute(
    input(),
    adapter([capsule(watchdog, 'timeout')]),
  );
  expect(result).toMatchObject({
    diagnosisCode: 'TIMEOUT',
    terminationReason: 'EXECUTION_DEADLINE',
    allRequiredPassed: false,
    runtimeMs: 2956,
  });
  expect(result.evidence.timings[0].watchdog).toMatchObject({
    deadlineMs: 3000,
    stopDeadlineMs: 2950,
    retirementReserveMs: 50,
    watchdogFiredMs: 2950,
    closeObservedMs: 2956,
    lastGuestInstructionObservedMs: null,
  });
});

function skippedObservation(budgetMs, elapsedMs) {
  const observed = createWatchdogObservation({
    now: () => elapsedMs,
    originMs: 0,
    budgetMs,
  });
  observed.launchRequested();
  observed.arm();
  observed.skipLaunch();
  observed.fired();
  observed.closed();
  return observed.snapshot();
}

test('a rejected second launch charges its setup and preserves the remaining attempt budget', async () => {
  const first = { ...observation(), closeObservedMs: 2940 };
  const second = capsule(skippedObservation(60, 40), 'timeout');
  delete second.packet.returnData;
  second.packet.signal = null;
  const source = input();
  source.tests.push({
    id: 'hidden',
    visibility: 'hidden',
    args: [],
    expected: true,
  });
  const backend = adapter([capsule(first), second]);
  const result = await runner.execute(source, backend);
  expect(backend.execute.mock.calls[1][0].budgetMs).toBe(60);
  expect(result).toMatchObject({
    diagnosisCode: 'TIMEOUT',
    runtimeMs: 2980,
    allRequiredPassed: false,
  });
  expect(result.evidence.timings[1].watchdog).toMatchObject({
    launchSkipped: true,
    spawnObservedMs: null,
    exitObservedMs: null,
    killAttempts: 0,
    killCallSuccesses: 0,
    watchdogFiredMs: 40,
    closeObservedMs: 40,
  });
});

test('a delayed close without a callback can be TIMEOUT but cannot be SUCCESS inside the reserve', async () => {
  const watchdog = observation({ budgetMs: 150 });
  expect(packetSchema.safeParse(capsule(watchdog).packet).success).toBe(false);
  const response = capsule(watchdog, 'timeout');
  expect(packetSchema.safeParse(response.packet).success).toBe(true);
  const result = await runner.execute(input(), adapter([response]));
  expect(result).toMatchObject({
    diagnosisCode: 'TIMEOUT',
    runtimeMs: 120,
    allRequiredPassed: false,
  });
  expect(result.evidence.timings[0].watchdog.watchdogFiredMs).toBeNull();
});

test('historical v1 observations retain their original full-budget timer contract', () => {
  const current = observation({ timeout: true });
  const { retirementReserveMs, stopDeadlineMs, launchSkipped, ...legacy } =
    current;
  expect([retirementReserveMs, stopDeadlineMs, launchSkipped]).toEqual([
    50,
    2950,
    false,
  ]);
  legacy.version = 1;
  legacy.timerDelayMs = 2950;
  legacy.watchdogLatenessMs = 50;
  expect(observationSchema.safeParse(legacy).success).toBe(true);
  expect(
    packetSchema.safeParse(capsule(legacy, 'timeout').packet).success,
  ).toBe(true);
  expect(
    observationSchema.safeParse({ ...legacy, retirementReserveMs: 50 }).success,
  ).toBe(false);
});

test.each([
  ['student return', { returnData: 'PRIVATE_VALUE' }],
  ['success verdict', { status: 'exited' }],
  ['output', { outputBytes: 1, stdout: 'eA==' }],
  ['invented exit code', { exitCode: 0 }],
  ['invented kill signal', { signal: 'SIGKILL' }],
  ['missing exit observation', { exitCode: undefined }],
  ['missing signal observation', { signal: undefined }],
])('a no-spawn packet rejects %s', (_label, patch) => {
  const response = capsule(skippedObservation(25, 0), 'timeout');
  delete response.packet.returnData;
  expect(packetSchema.safeParse(response.packet).success).toBe(true);
  expect(packetSchema.safeParse({ ...response.packet, ...patch }).success).toBe(
    false,
  );
});

test.each([
  ['launched worker', { spawnObservedMs: 0 }],
  ['invented exit', { exitObservedMs: 0 }],
  [
    'missing rejection observation',
    { watchdogFiredMs: null, watchdogLatenessMs: null },
  ],
])('no-spawn observation rejects %s', (_label, patch) => {
  expect(
    observationSchema.safeParse({ ...skippedObservation(25, 0), ...patch })
      .success,
  ).toBe(false);
});

test('legacy envelopes without watchdog stay valid and explicitly record unavailable observation', async () => {
  const response = capsule();
  expect(packetSchema.safeParse(response.packet).success).toBe(true);
  const result = await runner.execute(input(), adapter([response]));
  expect(result.diagnosisCode).toBe('SUCCESS');
  expect(result.evidence.timings[0].watchdog).toBeNull();
});

test('bridge observations accept leader exit before watchdog and a failed later kill after an earlier success', () => {
  const watchdog = observation({
    timeout: true,
    leaderExitsFirst: true,
    outputThenFailedKill: true,
  });
  expect(watchdog).toMatchObject({
    exitObservedMs: 100,
    watchdogFiredMs: 3050,
    killAttempts: 2,
    killCallSuccesses: 1,
    lastKillAttemptMs: 3050,
    lastKillCallSucceededMs: 80,
  });
  expect(observationSchema.safeParse(watchdog).success).toBe(true);
  expect(
    packetSchema.safeParse(capsule(watchdog, 'output').packet).success,
  ).toBe(true);
});

test('failed spawn accepts absent spawn/exit and unsuccessful kill observations', () => {
  const watchdog = observation({ failedSpawn: true });
  expect(observationSchema.safeParse(watchdog).success).toBe(true);
  expect(watchdog).toMatchObject({
    spawnObservedMs: null,
    exitObservedMs: null,
    killAttempts: 1,
    killCallSuccesses: 0,
  });
});

test.each([
  ['string duration', { timerArmedMs: '50' }],
  ['nonfinite clock', { watchdogFiredMs: Infinity }],
  ['NaN close', { closeObservedMs: NaN }],
  ['negative duration', { launchRequestedMs: -1 }],
  ['extra private content', { code: 'PRIVATE_STUDENT_DATA' }],
  ['invented last instruction', { lastGuestInstructionObservedMs: 3060 }],
  ['unsupported clock', { clock: 'DATE_NOW' }],
  ['unsupported version', { version: 3 }],
  ['changed deadline', { deadlineMs: 2999 }],
  ['enlarged retirement reserve', { retirementReserveMs: 51 }],
  ['reduced retirement reserve', { retirementReserveMs: 49 }],
  ['changed stop window', { stopDeadlineMs: 2949 }],
  ['missing retirement policy', { retirementReserveMs: undefined }],
  ['missing launch disposition', { launchSkipped: undefined }],
  ['reset timer budget', { timerDelayMs: 3000 }],
  ['wrong lateness', { watchdogLatenessMs: 0 }],
  ['missing lateness', { watchdogLatenessMs: null }],
  ['more successful calls than attempts', { killCallSuccesses: 2 }],
  ['events after close', { exitObservedMs: 3121 }],
  ['spawn before launch', { spawnObservedMs: 39 }],
  ['exit before launch', { exitObservedMs: 39 }],
  ['callback before arming', { watchdogFiredMs: 49, watchdogLatenessMs: 0 }],
  ['kill before launch', { firstKillAttemptMs: 39 }],
  ['success before kill attempt', { firstKillCallSucceededMs: 3049 }],
])(
  'private observation rejects %s instead of silently coercing it',
  (_name, patch) => {
    const watchdog = { ...observation({ timeout: true }), ...patch };
    expect(observationSchema.safeParse(watchdog).success).toBe(false);
  },
);

test('packet runtime and close observation must match, including before execute can retain the evidence', async () => {
  const response = capsule(observation());
  response.packet.runtimeMs = 119;
  expect(packetSchema.safeParse(response.packet).success).toBe(false);
  const result = await runner.execute(input(), adapter([response]));
  expect(result).toMatchObject({
    diagnosisCode: 'UNKNOWN',
    terminationReason: 'PROTOCOL_INVALID',
    allRequiredPassed: false,
  });
  expect(result.evidence.timings[0].watchdog).toBeNull();
});

test('an invalid nested observation cannot leak private extra fields into retained runner evidence or public data', async () => {
  const response = capsule({
    ...observation(),
    code: 'PRIVATE_STUDENT_DATA',
  });
  const result = await runner.execute(input(), adapter([response]));
  expect(result.terminationReason).toBe('PROTOCOL_INVALID');
  expect(JSON.stringify(result.evidence)).not.toContain('PRIVATE_STUDENT_DATA');
  expect(JSON.stringify(runner.publicResult(result))).not.toContain(
    'PRIVATE_STUDENT_DATA',
  );
});
