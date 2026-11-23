import { EventEmitter } from 'node:events';
import { jest } from '@jest/globals';
import {
  startContinuousDiagnostics,
  correlateContinuousDiagnostics,
} from '../../scripts/submit-continuous-diagnostics.mjs';
import { testTarget, developmentTarget } from '../../scripts/local-target.mjs';

const initialWall = Date.UTC(2026, 9, 4);
const host = {
  logicalCpus: 2,
  memoryBytes: 4096,
  freeMemoryBytes: 2048,
  cpuTimeMs: { idle: 80, total: 100 },
  loadAverage: [0, 0, 0],
  loadAverageSupported: false,
  privateName: 'private-host-name',
};
function vmCounters({
  total = 100,
  idle = 80,
  ioWait = 5,
  reads = 10,
  inProgress = 2,
  disk = true,
} = {}) {
  return `cpu ${total - idle - ioWait} 0 0 ${idle} ${ioWait} 0 0 0 90 0
cpu0 1 0 0 1 0 0 0 0
MemTotal: 1000 kB
MemAvailable: 500 kB
SwapTotal: 200 kB
SwapFree: 100 kB
${disk ? `8 0 sda ${reads} 0 30 40 50 0 70 80 ${inProgress} 100 110` : ''}
PRIVATE_VALUE=private-kernel-data
`;
}
const drain = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

function fixture(options = {}) {
  const state = {
    mono: 0,
    wallOffset: 0,
    host: { ...host, cpuTimeMs: { ...host.cpuTimeMs } },
    vm: vmCounters(),
  };
  let timerId = 0;
  const timers = new Map();
  const setTimer = jest.fn((callback, delay) => {
    const token = { id: ++timerId, unref: jest.fn() };
    timers.set(token, { callback, at: state.mono + delay });
    return token;
  });
  const clearTimer = jest.fn((token) => timers.delete(token));
  function child(source) {
    const value = new EventEmitter();
    value.pid = source === 'vm' ? 1234 : 1235;
    value.stdout = new EventEmitter();
    value.stdin = new EventEmitter();
    value.stdout.destroy = jest.fn();
    value.stdin.destroy = jest.fn();
    value.unref = jest.fn();
    value.closed = false;
    value.finish = () => {
      if (!value.closed) {
        value.closed = true;
        value.emit('close', 0);
      }
    };
    value.stdin.write = jest.fn(() => {
      if (source === 'vm' && options.respondVm !== false) {
        Promise.resolve().then(() =>
          value.stdout.emit(
            'data',
            Buffer.from(
              '__ALUNZA_VM_BEGIN__\n' + state.vm + '__ALUNZA_VM_END__\n',
            ),
          ),
        );
      }
      return options.writeBackpressure !== true;
    });
    value.stdin.end = jest.fn(() => {
      if (options.closeVm !== false) {
        if (options.ackVm !== false)
          value.stdout.emit('data', Buffer.from('__ALUNZA_VM_STOPPED__\n'));
        value.finish();
      }
    });
    value.kill = jest.fn(() => {
      if (options.closeKill !== false) value.finish();
      return true;
    });
    return value;
  }
  const vm = child('vm');
  const docker = child('docker');
  const processEvents = new EventEmitter();
  const snapshot = jest.fn(() => state.host);
  const spawn = jest.fn((_command, args) => (args[0] === 'exec' ? vm : docker));
  const dependencies = {
    now: () => state.mono,
    wallNow: () => initialWall + state.mono + state.wallOffset,
    hostSnapshot: snapshot,
    spawn,
    setTimeout: setTimer,
    clearTimeout: clearTimer,
    processEvents,
    resignal: jest.fn(),
  };
  async function advance(ms, lag = false) {
    const target = state.mono + ms;
    for (;;) {
      const entry = [...timers]
        .filter(([, value]) => value.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!entry) break;
      state.mono = lag ? target : entry[1].at;
      timers.delete(entry[0]);
      entry[1].callback();
      await drain();
    }
    state.mono = target;
    await drain();
  }
  function stats(values) {
    docker.stdout.emit(
      'data',
      Buffer.from(
        values.map((value) => JSON.stringify(value)).join('\n') + '\n',
      ),
    );
  }
  return {
    state,
    vm,
    docker,
    dependencies,
    snapshot,
    spawn,
    timers,
    processEvents,
    advance,
    stats,
    start: (settings = {}) =>
      startContinuousDiagnostics(testTarget, { ...settings, dependencies }),
  };
}

test.each([
  developmentTarget,
  { ...testTarget, apiUrl: 'https://remote.example' },
  { ...testTarget, projectId: 'other-project' },
  { ...testTarget, dbPort: 5432 },
  undefined,
])('invalid target %p rejects before starting readers', async (ctx) => {
  const f = fixture();
  await expect(
    startContinuousDiagnostics(ctx, { dependencies: f.dependencies }),
  ).rejects.toThrow();
  expect(f.spawn).not.toHaveBeenCalled();
  expect(f.snapshot).not.toHaveBeenCalled();
});

test('fixed persistent readers observe original counters and numeric grouped workloads only', async () => {
  const f = fixture();
  const collector = await f.start();
  await drain();
  f.stats([
    {
      Name: 'supabase_db_alunza-edu-laboratorio-test',
      CPUPerc: '25.0%',
      ID: 'private-id',
    },
    { Name: 'supabase_db_alunza-edu-laboratorio', CPUPerc: '2.5%' },
    { Name: 'private-other-project', CPUPerc: '7.5%' },
  ]);
  await f.advance(1000);
  const report = await collector.stop();
  expect(f.spawn).toHaveBeenCalledTimes(2);
  expect(f.spawn.mock.calls[0]).toEqual([
    'docker',
    [
      'exec',
      '-i',
      'supabase_db_alunza-edu-laboratorio-test',
      'sh',
      '-c',
      expect.stringContaining('cat /proc/stat /proc/meminfo /proc/diskstats'),
    ],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] },
  ]);
  expect(f.spawn.mock.calls[0][1][5]).not.toMatch(/sleep|docker run|\/sys\//);
  expect(f.spawn.mock.calls[1][1]).toEqual([
    'stats',
    '--format',
    '{{json .}}',
    '--no-trunc',
  ]);
  expect(report).toMatchObject({
    version: 1,
    status: 'observed',
    intervalMs: 1000,
    cleanupVerified: true,
  });
  expect(report.sources.host.capabilities.loadAverage).toBe(false);
  expect(
    report.observations.find((item) => item.source === 'host').values,
  ).toEqual({
    logicalCpus: 2,
    memoryBytes: 4096,
    freeMemoryBytes: 2048,
    cpuTimeMs: { idle: 80, total: 100 },
  });
  expect(
    report.observations.find((item) => item.source === 'vm').values,
  ).toMatchObject({
    logicalCpus: 1,
    cpuTicks: { total: 100, idle: 80, ioWait: 5 },
    memoryBytes: 1024000,
    availableMemoryBytes: 512000,
    disks: [{ deviceOrdinal: 0, reads: 10, ioInProgress: 2, sectorsRead: 30 }],
  });
  expect(
    report.observations.find((item) => item.source === 'docker').values.groups,
  ).toEqual({
    test: { status: 'observed', containers: 1, cpuPercentOfSingleCore: 25 },
    laboratory: {
      status: 'observed',
      containers: 1,
      cpuPercentOfSingleCore: 2.5,
    },
    other: { status: 'observed', containers: 1, cpuPercentOfSingleCore: 7.5 },
  });
  expect(JSON.stringify(report)).not.toMatch(/private|supabase|sda|ID|CPUPerc/);
  for (const item of report.observations) {
    expect(item.finishedAtMs).toBeGreaterThanOrEqual(item.startedAtMs);
    expect(item.observedAt).toMatch(/^2026-10-04T/);
  }
});

test('fragmented stats overwrite the previous row instead of counting stream updates twice', async () => {
  const f = fixture();
  const collector = await f.start();
  await drain();
  const row = JSON.stringify({ Name: 'private-container', CPUPerc: '3%' });
  f.docker.stdout.emit('data', Buffer.from('\x1b[2J' + row.slice(0, 15)));
  f.docker.stdout.emit('data', Buffer.from(row.slice(15) + '\n'));
  f.stats([{ Name: 'private-container', CPUPerc: '8%' }]);
  await f.advance(1000);
  const report = await collector.stop();
  expect(
    report.observations.find((item) => item.source === 'docker').values.groups
      .other,
  ).toEqual({ status: 'observed', containers: 1, cpuPercentOfSingleCore: 8 });
  expect(report.overhead.parsing.docker.count).toBe(3);
  expect(JSON.stringify(report)).not.toContain('private-container');
});

test('control-only stats lines are ignored and CSI-prefixed JSON survives chunk boundaries', async () => {
  const f = fixture();
  const collector = await f.start();
  await drain();
  for (const chunk of ['\x1b[', '2J\x1b[H\r\n', '\x1b[0m\r\n', '\x1b[']) {
    f.docker.stdout.emit('data', Buffer.from(chunk));
  }
  const row = JSON.stringify({ Name: 'private-container', CPUPerc: '4%' });
  f.docker.stdout.emit('data', Buffer.from('1;1H' + row.slice(0, 11)));
  f.docker.stdout.emit('data', Buffer.from(row.slice(11) + '\r\n'));
  await f.advance(1000);
  const report = await collector.stop();
  expect(report.overhead.rejectedRecords).toBe(0);
  expect(report.sources.docker.failures).toBe(0);
  expect(report.gaps).not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({ source: 'docker', reason: 'INVALID_DATA' }),
    ]),
  );
  expect(
    report.observations.find((item) => item.source === 'docker').values.groups
      .other,
  ).toEqual({ status: 'observed', containers: 1, cpuPercentOfSingleCore: 4 });
  expect(JSON.stringify(report)).not.toContain('private-container');
});

test('stop is idempotent, closes only its two readers and removes timers and hooks', async () => {
  const f = fixture();
  const unrelated = jest.fn();
  f.processEvents.on('exit', unrelated);
  const collector = await f.start();
  await drain();
  const first = collector.stop();
  const second = collector.stop();
  expect(first).toBe(second);
  const report = await first;
  expect(await collector.stop()).toBe(report);
  expect(f.vm.stdin.end).toHaveBeenCalledWith('stop\n');
  expect(f.vm.kill).not.toHaveBeenCalled();
  expect(f.docker.kill).toHaveBeenCalledTimes(1);
  expect(f.docker.kill).toHaveBeenCalledWith('SIGTERM');
  expect(f.processEvents.listeners('exit')).toEqual([unrelated]);
  expect(f.processEvents.listenerCount('SIGINT')).toBe(0);
  expect(f.processEvents.listenerCount('SIGTERM')).toBe(0);
  expect(f.timers.size).toBe(0);
  expect(report.cleanupVerified).toBe(true);
  const saved = JSON.stringify(report);
  f.vm.stdout.emit(
    'data',
    Buffer.from('__ALUNZA_VM_BEGIN__\n' + vmCounters() + '__ALUNZA_VM_END__\n'),
  );
  f.stats([{ Name: 'private-late-frame', CPUPerc: '8%' }]);
  expect(JSON.stringify(report)).toBe(saved);
});

test('an absent workload group is unavailable rather than an idle or empty zero', async () => {
  const f = fixture();
  const collector = await f.start();
  await drain();
  f.stats([{ Name: 'supabase_db_alunza-edu-laboratorio-test', CPUPerc: '0%' }]);
  await f.advance(1000);
  const report = await collector.stop();
  const observation = report.observations.find(
    (item) => item.source === 'docker',
  );
  expect(observation.status).toBe('partial');
  expect(observation.values.groups).toEqual({
    test: { status: 'observed', containers: 1, cpuPercentOfSingleCore: 0 },
    laboratory: {
      status: 'unavailable',
      containers: null,
      cpuPercentOfSingleCore: null,
    },
    other: {
      status: 'unavailable',
      containers: null,
      cpuPercentOfSingleCore: null,
    },
  });
  expect(report.sources.docker.status).toBe('partial');
  expect(report.status).toBe('partial');
});

test('read latency uses actual reader boundaries and stays separate from parsing cost', async () => {
  const f = fixture();
  f.snapshot.mockImplementation(() => {
    f.state.mono += 3;
    return f.state.host;
  });
  const collector = await f.start();
  await drain();
  const report = await collector.stop();
  expect(report.overhead.reads.host).toEqual({
    count: 1,
    totalMs: 3,
    maxMs: 3,
  });
  expect(report.overhead.reads.vm).toEqual({ count: 1, totalMs: 0, maxMs: 0 });
  expect(report.overhead.parsing.vm.totalMs).toBe(0);
  expect(
    report.observations.find((item) => item.source === 'vm').startedAtMs,
  ).toBe(3);
});

test('a closed VM client without remote-loop acknowledgement cannot verify cleanup', async () => {
  const f = fixture({ ackVm: false });
  const collector = await f.start();
  await drain();
  const report = await collector.stop();
  expect(report.cleanupVerified).toBe(false);
  expect(report.status).toBe('partial');
});

test('cleanup timeout is bounded and does not reject when readers ignore termination', async () => {
  const f = fixture({ closeVm: false, closeKill: false });
  const collector = await f.start({ stopTimeoutMs: 25 });
  await drain();
  const stopped = collector.stop();
  await f.advance(25);
  await f.advance(25);
  const report = await stopped;
  expect(report.cleanupVerified).toBe(false);
  expect(f.vm.kill).toHaveBeenCalledWith('SIGKILL');
  expect(f.docker.kill.mock.calls.map(([signal]) => signal)).toEqual([
    'SIGTERM',
    'SIGKILL',
  ]);
  expect(f.timers.size).toBe(0);
  expect(f.processEvents.listenerCount('exit')).toBe(0);
  expect(f.vm.stdin.destroy).toHaveBeenCalledTimes(1);
  expect(f.vm.stdout.destroy).toHaveBeenCalledTimes(1);
  expect(f.vm.unref).toHaveBeenCalledTimes(1);
  expect(f.docker.unref).toHaveBeenCalledTimes(1);
});

test('missing binaries and host IO failures are unavailable without invented values or private errors', async () => {
  const f = fixture();
  f.spawn.mockImplementation(() => {
    throw new Error('private-daemon-path');
  });
  f.snapshot.mockImplementation(() => {
    throw new Error('private-host-error');
  });
  const collector = await f.start();
  const report = await collector.stop();
  expect(report.status).toBe('unavailable');
  expect(report.cleanupVerified).toBe(true);
  expect(Object.values(report.sources).map((item) => item.status)).toEqual([
    'unavailable',
    'unavailable',
    'unavailable',
  ]);
  expect(
    report.observations.every(
      (item) => item.status === 'unavailable' && item.values === undefined,
    ),
  ).toBe(true);
  expect(JSON.stringify(report)).not.toMatch(/private|daemon|path/);
});

test('asynchronous child startup error and runtime stream failure remain contained', async () => {
  const f = fixture({ respondVm: false });
  const collector = await f.start();
  f.vm.pid = undefined;
  f.vm.emit('error', new Error('private-startup-error'));
  f.docker.emit('error', new Error('private-stream-error'));
  await drain();
  const report = await collector.stop();
  expect(report.sources.vm.status).toBe('unavailable');
  expect(report.sources.docker.status).toBe('unavailable');
  expect(report.cleanupVerified).toBe(true);
  expect(f.vm.stdin.end).not.toHaveBeenCalled();
  expect(f.docker.kill).toHaveBeenCalledWith('SIGTERM');
  expect(JSON.stringify(report)).not.toContain('private');
});

test('source absence after startup becomes a timed gap instead of an idle zero', async () => {
  const f = fixture({ respondVm: false });
  const collector = await f.start({ staleMs: 2000 });
  await drain();
  await f.advance(2000);
  const report = await collector.stop();
  expect(f.vm.stdin.write).toHaveBeenCalledTimes(1);
  expect(report.gaps).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        source: 'vm',
        startedAtMs: 0,
        finishedAtMs: 2000,
        reason: 'READ_TIMEOUT',
      }),
      expect.objectContaining({ source: 'docker', reason: 'READ_TIMEOUT' }),
    ]),
  );
  expect(report.sources.vm.status).toBe('unavailable');
  expect(report.sources.docker.status).toBe('unavailable');
  expect(
    report.observations
      .filter((item) => item.source !== 'host')
      .every((item) => item.values === undefined),
  ).toBe(true);
});

test('pending host and VM reads never overlap and report backpressure and incomplete reads', async () => {
  const f = fixture({ respondVm: false, writeBackpressure: true });
  let resolveHost;
  f.snapshot.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveHost = resolve;
      }),
  );
  const collector = await f.start();
  await f.advance(2000);
  expect(f.snapshot).toHaveBeenCalledTimes(1);
  expect(f.vm.stdin.write).toHaveBeenCalledTimes(1);
  const report = await collector.stop();
  expect(report.gaps).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ source: 'host', reason: 'BACKPRESSURE' }),
      expect.objectContaining({ source: 'vm', reason: 'BACKPRESSURE' }),
      expect.objectContaining({ source: 'host', reason: 'READ_INCOMPLETE' }),
    ]),
  );
  const saved = JSON.stringify(report);
  resolveHost(host);
  await drain();
  expect(JSON.stringify(report)).toBe(saved);
});

test('late scheduler ticks expose lag without catch-up read bursts', async () => {
  const f = fixture();
  const collector = await f.start();
  await drain();
  await f.advance(3500, true);
  const report = await collector.stop();
  expect(f.snapshot).toHaveBeenCalledTimes(2);
  expect(f.vm.stdin.write).toHaveBeenCalledTimes(2);
  expect(report.overhead.maxLagMs).toBe(2500);
  expect(
    report.gaps.filter((item) => item.reason === 'SCHEDULER_DELAY'),
  ).toHaveLength(3);
});

test('original cumulative counters and reset flags survive a host and VM restart', async () => {
  const f = fixture();
  const collector = await f.start();
  await drain();
  f.state.host.cpuTimeMs = { idle: 4, total: 10 };
  f.state.vm = vmCounters({
    total: 10,
    idle: 4,
    ioWait: 1,
    reads: 1,
    inProgress: 0,
  });
  await f.advance(1000);
  const report = await collector.stop();
  expect(report.sources.host.counterResets).toBe(1);
  expect(report.sources.vm.counterResets).toBe(1);
  expect(
    report.observations.find(
      (item) => item.source === 'host' && item.counterReset,
    ).values.cpuTimeMs,
  ).toEqual({ idle: 4, total: 10 });
  expect(
    report.observations.find(
      (item) => item.source === 'vm' && item.counterReset,
    ).values.cpuTicks,
  ).toEqual({ total: 10, idle: 4, ioWait: 1 });
});

test('disk gauge changes do not imply a reset while unavailable disk and load-average capabilities remain explicit', async () => {
  const f = fixture();
  const collector = await f.start();
  await drain();
  f.state.vm = vmCounters({ inProgress: 0 });
  f.state.host.loadAverageSupported = true;
  f.state.host.loadAverage = [0.1, 0.2, 0.3];
  await f.advance(1000);
  f.state.vm = vmCounters({ disk: false });
  await f.advance(1000);
  const report = await collector.stop();
  expect(report.sources.vm.counterResets).toBe(0);
  expect(report.sources.vm.capabilities.disk).toBe(false);
  expect(report.sources.vm.status).toBe('partial');
  expect(report.sources.host.capabilities.loadAverage).toBe(true);
  expect(
    report.observations.filter((item) => item.source === 'host').at(-1).values
      .loadAverage,
  ).toEqual([0.1, 0.2, 0.3]);
});

test('wall-clock jumps are recorded while monotonic observation intervals stay stable', async () => {
  const f = fixture();
  const collector = await f.start();
  await drain();
  f.state.wallOffset = 10000;
  await f.advance(1000);
  const report = await collector.stop();
  expect(report.overhead.wallClockJumps).toBe(1);
  expect(report.gaps).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ source: 'host', reason: 'WALL_CLOCK_JUMP' }),
    ]),
  );
  expect(
    report.observations.every(
      (item) => item.startedAtMs >= 0 && item.finishedAtMs <= 1000,
    ),
  ).toBe(true);
  expect(report.status).toBe('partial');
});

test.each([NaN, Infinity, -1, 'private-clock'])(
  'invalid monotonic readings %p cannot escape or create negative intervals',
  async (invalid) => {
    const f = fixture();
    const collector = await f.start();
    await drain();
    f.state.mono = invalid;
    const report = await collector.stop();
    expect(report.overhead.clockFailures).toBeGreaterThan(0);
    expect(
      report.observations.every(
        (item) =>
          item.startedAtMs >= 0 && item.finishedAtMs >= item.startedAtMs,
      ),
    ).toBe(true);
    expect(JSON.stringify(report)).not.toContain('private-clock');
  },
);

test('invalid UTC never fabricates an observed timestamp', async () => {
  const f = fixture();
  f.dependencies.wallNow = () => NaN;
  const collector = await f.start();
  await drain();
  const report = await collector.stop();
  expect(report.status).toBe('unavailable');
  expect(report.observations).toEqual([]);
  expect(report.gaps.some((item) => item.reason === 'CLOCK_INVALID')).toBe(
    true,
  );
});

test.each([
  { logicalCpus: 0 },
  { freeMemoryBytes: 5000 },
  { cpuTimeMs: { idle: 101, total: 100 } },
  { memoryBytes: NaN },
])(
  'malformed host counters %p are rejected rather than projected as zero',
  async (invalid) => {
    const f = fixture();
    f.state.host = { ...host, ...invalid };
    const collector = await f.start();
    await drain();
    const report = await collector.stop();
    expect(report.sources.host.status).toBe('unavailable');
    expect(
      report.observations
        .filter((item) => item.source === 'host')
        .every((item) => item.values === undefined),
    ).toBe(true);
  },
);

test('invalid streamed data cannot publish private fields, nonfinite counters or unbounded buffers', async () => {
  const f = fixture({ respondVm: false });
  const collector = await f.start({ maxBufferBytes: 256 });
  await drain();
  f.stats([{ Name: 'private-container', CPUPerc: '1000001%' }]);
  f.docker.stdout.emit('data', Buffer.from('private-container\n'));
  f.vm.stdout.emit('data', Buffer.from('private-raw-value'.repeat(100)));
  const report = await collector.stop();
  expect(report.overhead.rejectedRecords).toBe(3);
  expect(report.overhead.bufferPeakBytes).toBeLessThanOrEqual(256);
  expect(report.sources.vm.status).toBe('unavailable');
  expect(report.sources.docker.status).toBe('unavailable');
  expect(JSON.stringify(report)).not.toContain('private');
});

test('resource saturation bounds rows, observations and gaps while retaining explicit drops', async () => {
  const f = fixture();
  const collector = await f.start({
    maxObservations: 2,
    maxGaps: 2,
    maxDockerEntries: 1,
  });
  await drain();
  f.stats([
    { Name: 'private-first', CPUPerc: '1%' },
    { Name: 'private-second', CPUPerc: '2%' },
  ]);
  await f.advance(6000);
  const report = await collector.stop();
  expect(report.observations).toHaveLength(2);
  expect(report.gaps).toHaveLength(2);
  expect(report.overhead.droppedObservations).toBeGreaterThan(0);
  expect(report.overhead.droppedGaps).toBeGreaterThan(0);
  expect(report.gaps.some((item) => item.reason === 'RECORD_LIMIT')).toBe(true);
  expect(report.status).toBe('partial');
  expect(JSON.stringify(report)).not.toContain('private');
});

test('unavailable scheduler is contained at startup and shutdown', async () => {
  const f = fixture();
  f.dependencies.setTimeout = () => {
    throw new Error('private-timer-error');
  };
  const collector = await f.start();
  await drain();
  const report = await collector.stop();
  expect(
    report.gaps.filter((item) => item.reason === 'SCHEDULER_UNAVAILABLE'),
  ).toHaveLength(3);
  expect(report.cleanupVerified).toBe(true);
  expect(JSON.stringify(report)).not.toContain('private');
});

test.each(['exit', 'SIGINT', 'SIGTERM'])(
  'harness %s closes owned readers without adding containers',
  async (event) => {
    const f = fixture();
    const collector = await f.start();
    await drain();
    f.processEvents.emit(event);
    expect(f.vm.stdin.end).toHaveBeenCalledWith('stop\n');
    expect(f.docker.kill).toHaveBeenCalledWith('SIGTERM');
    expect(f.spawn).toHaveBeenCalledTimes(2);
    expect(f.timers.size).toBe(0);
    if (event !== 'exit')
      expect(f.dependencies.resignal).toHaveBeenCalledWith(event);
    expect((await collector.stop()).cleanupVerified).toBe(true);
  },
);

test('an existing harness signal handler keeps ownership of process termination', async () => {
  const f = fixture();
  const handler = jest.fn();
  f.processEvents.on('SIGTERM', handler);
  const collector = await f.start();
  await drain();
  f.processEvents.emit('SIGTERM');
  expect(handler).toHaveBeenCalledTimes(1);
  expect(f.dependencies.resignal).not.toHaveBeenCalled();
  await collector.stop();
  expect(f.processEvents.listeners('SIGTERM')).toEqual([handler]);
});

test('correlation uses monotonic intersections, clips and unions gaps, and reports missing sources', () => {
  const observation = (
    source,
    startedAtMs,
    finishedAtMs,
    status = 'observed',
  ) => ({ source, startedAtMs, finishedAtMs, status });
  const report = {
    observations: [
      observation('host', 10, 20),
      {
        ...observation('host', 30, 40, 'partial'),
        counterReset: true,
        privateName: 'private-value',
      },
      observation('vm', 20, 35),
      observation('docker', 5, 9),
      observation('host', 30, 40, 'unavailable'),
      observation('host', 10, 20, 'invalid'),
      observation('host', 30, NaN),
    ],
    gaps: [
      observation('host', 0, 25),
      observation('host', 20, 30),
      observation('host', 32, 50),
    ],
  };
  const result = correlateContinuousDiagnostics(report, {
    startedAtMs: 15,
    finishedAtMs: 35,
  });
  expect(result).toEqual({
    version: 1,
    status: 'partial',
    sources: {
      host: {
        status: 'partial',
        observations: 3,
        observed: 1,
        partial: 1,
        unavailable: 1,
        gaps: 3,
        gapMs: 18,
        counterResets: 1,
      },
      vm: {
        status: 'observed',
        observations: 1,
        observed: 1,
        partial: 0,
        unavailable: 0,
        gaps: 0,
        gapMs: 0,
        counterResets: 0,
      },
      docker: {
        status: 'unavailable',
        observations: 0,
        observed: 0,
        partial: 0,
        unavailable: 0,
        gaps: 0,
        gapMs: 0,
        counterResets: 0,
      },
    },
  });
  expect(JSON.stringify(result)).not.toContain('private');
});

test.each([
  undefined,
  null,
  { startedAtMs: -1, finishedAtMs: 4 },
  { startedAtMs: 4, finishedAtMs: 2 },
  { startedAtMs: NaN, finishedAtMs: 2 },
])(
  'invalid request window %p yields unavailable bounded correlation',
  (window) => {
    const result = correlateContinuousDiagnostics({ observations: [] }, window);
    expect(result.status).toBe('unavailable');
    for (const item of Object.values(result.sources))
      expect(item).toMatchObject({
        observations: 0,
        gaps: 0,
        gapMs: 0,
        status: 'unavailable',
      });
  },
);

test('absent diagnostics are unavailable and valid complete intersections are observed', () => {
  const window = { startedAtMs: 1, finishedAtMs: 2 };
  expect(correlateContinuousDiagnostics(undefined, window).status).toBe(
    'unavailable',
  );
  const report = {
    observations: ['host', 'vm', 'docker'].map((source) => ({
      source,
      startedAtMs: 1,
      finishedAtMs: 2,
      status: 'observed',
    })),
  };
  expect(correlateContinuousDiagnostics(report, window).status).toBe(
    'observed',
  );
});
