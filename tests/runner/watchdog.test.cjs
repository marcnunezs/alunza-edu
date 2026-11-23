const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {
  createWatchdogObservation,
} = require('../../infra/runner/watchdog-observation.cjs');

// Execute only the fixed trusted bridge with inert OS/clock/child-process doubles.
// The fixture input remains data: no student code runs on the test host.
const bridgeSource = fs.readFileSync(
  path.join(__dirname, '../../infra/runner/bridge.cjs'),
  'utf8',
);

function bridgeHarness({
  budgetMs = 300,
  outputRemaining = 65536,
  memoryMax = '134217728',
  kill = () => {},
} = {}) {
  const state = { now: 1000, packet: null, timer: null };
  const input = new EventEmitter();
  const child = new EventEmitter();
  child.pid = 123;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdio = [null, child.stdout, child.stderr, new EventEmitter()];
  const limits = {
    'memory.max': memoryMax,
    'memory.swap.max': '0',
    'pids.max': '32',
    'cpu.max': '100000 100000',
    'memory.peak': '12345',
    'memory.events': 'oom 0\noom_kill 0',
  };
  const spawn = jest.fn(() => {
    state.now += 10;
    return child;
  });
  const killProcessGroup = jest.fn((...args) => kill(state, ...args));
  const writeFile = jest.fn(() => {
    state.now += 20;
  });
  const clearTimer = jest.fn();
  const exit = jest.fn();
  const modules = {
    'node:child_process': { spawn },
    'node:fs': {
      readFileSync: (file) => limits[path.posix.basename(file)],
      writeFileSync: writeFile,
    },
    'node:perf_hooks': { performance: { now: () => state.now } },
    './watchdog-observation.cjs': { createWatchdogObservation },
  };
  vm.runInNewContext(bridgeSource, {
    require(name) {
      if (!(name in modules)) throw new Error('Unexpected trusted import');
      return modules[name];
    },
    Buffer,
    process: {
      stdin: input,
      stdout: {
        write(value, done) {
          state.packet = JSON.parse(value);
          done();
        },
      },
      env: {},
      kill: killProcessGroup,
      exit,
    },
    setTimeout(callback, delay) {
      state.timer = { callback, delay };
      return state.timer;
    },
    clearTimeout: clearTimer,
  });
  input.emit(
    'data',
    Buffer.from(
      JSON.stringify({
        code: 'STUDENT_PRIVATE_FIXTURE_NOT_EXECUTED',
        args: ['PRIVATE_ARGUMENT_NOT_LOGGED'],
        budgetMs,
        outputRemaining,
      }),
    ),
  );
  input.emit('end');
  return {
    state,
    child,
    spawn,
    writeFile,
    killProcessGroup,
    clearTimer,
    exit,
    at(offset) {
      state.now = 1000 + offset;
    },
  };
}

test('watchdog records a late callback and kill acknowledgement without inventing an exact cutoff', () => {
  const run = bridgeHarness({
    kill(state) {
      state.now += 1;
    },
  });
  expect(run.state.timer.delay).toBe(200);
  run.at(60);
  run.child.emit('spawn');
  run.at(350);
  run.state.timer.callback();
  run.at(380);
  run.child.emit('exit', null, 'SIGKILL');
  run.at(420);
  run.child.emit('close', null, 'SIGKILL');

  expect(run.killProcessGroup).toHaveBeenCalledWith(-123, 'SIGKILL');
  expect(run.clearTimer).toHaveBeenCalledWith(run.state.timer);
  expect(run.state.packet).toMatchObject({
    status: 'timeout',
    runtimeMs: 420,
    outputBytes: 0,
    outputTruncated: false,
    watchdog: {
      version: 2,
      clock: 'PERFORMANCE_NOW',
      origin: 'BRIDGE_INPUT_PARSED',
      budgetMs: 300,
      deadlineMs: 300,
      retirementReserveMs: 50,
      stopDeadlineMs: 250,
      launchSkipped: false,
      launchRequestedMs: 40,
      spawnObservedMs: 60,
      timerArmedMs: 50,
      timerDelayMs: 200,
      watchdogFiredMs: 350,
      watchdogLatenessMs: 100,
      killAttempts: 1,
      firstKillAttemptMs: 350,
      lastKillAttemptMs: 350,
      killCallSuccesses: 1,
      firstKillCallSucceededMs: 351,
      lastKillCallSucceededMs: 351,
      exitObservedMs: 380,
      closeObservedMs: 420,
      lastGuestInstructionObservedMs: null,
    },
  });
});

test('normal exit records separate exit and pipe-close notifications, with no manufactured watchdog event', () => {
  const run = bridgeHarness();
  run.at(70);
  run.child.emit('spawn');
  run.at(100);
  run.child.emit('exit', 0, null);
  expect(run.clearTimer).not.toHaveBeenCalled();
  run.at(150);
  run.child.emit('close', 0, null);
  expect(run.state.packet).toMatchObject({
    status: 'exited',
    runtimeMs: 150,
    watchdog: {
      spawnObservedMs: 70,
      exitObservedMs: 100,
      closeObservedMs: 150,
      watchdogFiredMs: null,
      watchdogLatenessMs: null,
      killAttempts: 0,
      firstKillAttemptMs: null,
      lastKillAttemptMs: null,
      killCallSuccesses: 0,
      firstKillCallSucceededMs: null,
      lastKillCallSucceededMs: null,
      lastGuestInstructionObservedMs: null,
    },
  });
  expect(run.killProcessGroup).not.toHaveBeenCalled();
});

test('exit of the leader does not disarm the existing watchdog while descendant pipes remain open', () => {
  const run = bridgeHarness();
  run.at(60);
  run.child.emit('spawn');
  run.at(200);
  run.child.emit('exit', 0, null);
  expect(run.clearTimer).not.toHaveBeenCalled();
  run.at(340);
  run.state.timer.callback();
  run.at(360);
  run.child.emit('close', 0, null);
  expect(run.state.packet).toMatchObject({
    status: 'timeout',
    watchdog: {
      exitObservedMs: 200,
      watchdogFiredMs: 340,
      watchdogLatenessMs: 90,
      closeObservedMs: 360,
      lastGuestInstructionObservedMs: null,
    },
  });
});

test.each([0, 1, 25, 50])(
  'a remaining budget of %s ms rejects launch before file writes without spending a new case budget',
  (budgetMs) => {
    const run = bridgeHarness({ budgetMs });
    expect(run.spawn).not.toHaveBeenCalled();
    expect(run.writeFile).not.toHaveBeenCalled();
    expect(run.state.timer).toBeNull();
    expect(run.killProcessGroup).not.toHaveBeenCalled();
    expect(run.state.packet).toMatchObject({
      status: 'timeout',
      runtimeMs: 0,
      exitCode: null,
      signal: null,
      watchdog: {
        budgetMs,
        deadlineMs: budgetMs,
        retirementReserveMs: budgetMs,
        stopDeadlineMs: 0,
        launchSkipped: true,
        launchRequestedMs: 0,
        timerArmedMs: 0,
        timerDelayMs: 0,
        watchdogFiredMs: 0,
        watchdogLatenessMs: 0,
        spawnObservedMs: null,
        exitObservedMs: null,
        closeObservedMs: 0,
        killAttempts: 0,
        killCallSuccesses: 0,
        lastGuestInstructionObservedMs: null,
      },
    });
  },
);

test('setup that consumes the stop window retains its real time and skips spawn', () => {
  const run = bridgeHarness({ budgetMs: 80 });
  expect(run.spawn).not.toHaveBeenCalled();
  expect(run.state.packet).toMatchObject({
    status: 'timeout',
    runtimeMs: 40,
    watchdog: {
      budgetMs: 80,
      deadlineMs: 80,
      retirementReserveMs: 50,
      stopDeadlineMs: 30,
      launchSkipped: true,
      launchRequestedMs: 40,
      timerArmedMs: 40,
      timerDelayMs: 0,
      watchdogFiredMs: 40,
      watchdogLatenessMs: 10,
      closeObservedMs: 40,
    },
  });
});

test('synchronous spawn exhaustion triggers the stop immediately without waiting for a timer', () => {
  const run = bridgeHarness({ budgetMs: 100 });
  expect(run.spawn).toHaveBeenCalledTimes(1);
  expect(run.state.timer).toBeNull();
  expect(run.killProcessGroup).toHaveBeenCalledWith(-123, 'SIGKILL');
  run.at(55);
  run.child.emit('spawn');
  run.child.emit('exit', null, 'SIGKILL');
  run.at(60);
  run.child.emit('close', null, 'SIGKILL');
  expect(run.state.packet).toMatchObject({
    status: 'timeout',
    runtimeMs: 60,
    watchdog: {
      budgetMs: 100,
      retirementReserveMs: 50,
      stopDeadlineMs: 50,
      launchSkipped: false,
      watchdogFiredMs: 50,
      watchdogLatenessMs: 0,
      killCallSuccesses: 1,
    },
  });
});

test('the reserve requests termination before 3000 ms while close time and worker input budget remain real', () => {
  const run = bridgeHarness({ budgetMs: 3000 });
  expect(JSON.parse(run.writeFile.mock.calls[1][1]).budgetMs).toBe(3000);
  expect(run.state.timer.delay).toBe(2900);
  run.at(60);
  run.child.emit('spawn');
  run.at(2950);
  run.state.timer.callback();
  run.at(2955);
  run.child.emit('exit', null, 'SIGKILL');
  run.at(2956.25);
  run.child.emit('close', null, 'SIGKILL');
  expect(run.state.packet).toMatchObject({
    status: 'timeout',
    runtimeMs: 2956.25,
    watchdog: {
      deadlineMs: 3000,
      stopDeadlineMs: 2950,
      closeObservedMs: 2956.25,
    },
  });
});

test.each([
  [249.5, 'exited'],
  [250, 'timeout'],
  [280, 'timeout'],
])(
  'close at %s ms is %s even if the timer callback has not run',
  (closedMs, status) => {
    const run = bridgeHarness();
    run.at(60);
    run.child.emit('spawn');
    run.at(240);
    run.child.emit('exit', 0, null);
    run.at(closedMs);
    run.child.emit('close', 0, null);
    expect(run.state.packet).toMatchObject({
      status,
      runtimeMs: closedMs,
      watchdog: {
        watchdogFiredMs: null,
        watchdogLatenessMs: null,
        killAttempts: 0,
        killCallSuccesses: 0,
        lastGuestInstructionObservedMs: null,
      },
    });
  },
);

test('an output limit keeps its first termination reason and records failed later kill calls separately', () => {
  let attempts = 0;
  const run = bridgeHarness({
    outputRemaining: 9,
    kill() {
      if (++attempts > 1) throw new Error('already exited');
    },
  });
  run.at(60);
  run.child.emit('spawn');
  run.at(80);
  run.child.stdout.emit('data', Buffer.from('12345'));
  run.child.stderr.emit('data', Buffer.from('67890'));
  run.at(340);
  run.state.timer.callback();
  run.at(350);
  run.child.emit('exit', null, 'SIGKILL');
  run.at(370);
  run.child.emit('close', null, 'SIGKILL');
  expect(run.state.packet).toMatchObject({
    status: 'output',
    outputBytes: 9,
    outputTruncated: true,
    watchdog: {
      watchdogFiredMs: 340,
      killAttempts: 2,
      firstKillAttemptMs: 80,
      lastKillAttemptMs: 340,
      killCallSuccesses: 1,
      firstKillCallSucceededMs: 80,
      lastKillCallSucceededMs: 80,
    },
  });
  expect(Buffer.from(run.state.packet.stdout, 'base64').toString()).toBe(
    '12345',
  );
  expect(Buffer.from(run.state.packet.stderr, 'base64').toString()).toBe(
    '6789',
  );
});

test('worker return data cannot forge bridge watchdog observations or add private payload to them', () => {
  const run = bridgeHarness();
  const forged = JSON.stringify({
    watchdog: { watchdogFiredMs: 1, lastGuestInstructionObservedMs: 2 },
    private: 'UNTRUSTED_RETURN_DATA',
  });
  run.at(60);
  run.child.emit('spawn');
  run.child.stdio[3].emit('data', Buffer.from(forged));
  run.at(90);
  run.child.emit('exit', 0, null);
  run.at(95);
  run.child.emit('close', 0, null);
  expect(Buffer.from(run.state.packet.returnData, 'base64').toString()).toBe(
    forged,
  );
  expect(run.state.packet.watchdog.watchdogFiredMs).toBeNull();
  expect(run.state.packet.watchdog.lastGuestInstructionObservedMs).toBeNull();
  expect(JSON.stringify(run.state.packet.watchdog)).not.toMatch(
    /STUDENT_PRIVATE|PRIVATE_ARGUMENT|UNTRUSTED_RETURN|123|SIGKILL/,
  );
});

test('failed spawn keeps absent spawn/exit observations and does not label a failed kill as successful', () => {
  const run = bridgeHarness({
    kill() {
      throw new Error('no process');
    },
  });
  run.at(70);
  run.child.emit('error', new Error('spawn unavailable'));
  run.at(75);
  run.child.emit('close', -1, null);
  expect(run.state.packet).toMatchObject({
    status: 'failure',
    watchdog: {
      spawnObservedMs: null,
      exitObservedMs: null,
      closeObservedMs: 75,
      killAttempts: 1,
      firstKillAttemptMs: 70,
      lastKillAttemptMs: 70,
      killCallSuccesses: 0,
      firstKillCallSucceededMs: null,
      lastKillCallSucceededMs: null,
    },
  });
});

test('capability refusal still occurs before launch and produces no invented lifecycle observation', () => {
  const run = bridgeHarness({ memoryMax: '125829120' });
  expect(run.spawn).not.toHaveBeenCalled();
  expect(run.state.timer).toBeNull();
  expect(run.state.packet).toMatchObject({
    status: 'capability-gap',
    runtimeMs: 0,
  });
  expect(run.state.packet.watchdog).toBeUndefined();
});

test.each([0, 1, 123.25, 3000, 9000])(
  'trusted observation retains the bounded remaining budget for %s ms',
  (budgetMs) => {
    const observation = createWatchdogObservation({
      now: () => 1234,
      originMs: 1234,
      budgetMs,
    });
    const expected = Math.min(3000, budgetMs);
    expect(observation.arm()).toBe(Math.max(0, expected - 50));
    const snapshot = observation.snapshot();
    expect(snapshot.budgetMs).toBe(expected);
    expect(snapshot.deadlineMs).toBe(expected);
    expect(snapshot.retirementReserveMs).toBe(Math.min(50, expected));
    expect(snapshot.stopDeadlineMs).toBe(Math.max(0, expected - 50));
    snapshot.lastGuestInstructionObservedMs = 1;
    expect(observation.snapshot().lastGuestInstructionObservedMs).toBeNull();
  },
);
