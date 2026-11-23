import { spawn as spawnProcess } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { hostSnapshot } from './lab-observability.mjs';
import { linuxVmCounters, workloadCounters } from './submit-measurements.mjs';
import { assertLocalTarget, testTarget } from './local-target.mjs';

const sourceNames = ['host', 'vm', 'docker'];
const maxNumber = Number.MAX_SAFE_INTEGER;
const beginFrame = '__ALUNZA_VM_BEGIN__';
const endFrame = '__ALUNZA_VM_END__';
const stoppedFrame = '__ALUNZA_VM_STOPPED__';
const ansiSequence = new RegExp(
  `${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`,
  'g',
);
// EOF ends the remote loop too: killing only a docker exec client is insufficient.
const vmCommand = `while IFS= read -r operation; do
  [ "$operation" = sample ] || break
  printf '${beginFrame}\\n'
  cat /proc/stat /proc/meminfo /proc/diskstats || exit 1
  printf '${endFrame}\\n'
done
printf '${stoppedFrame}\\n'`;

function numeric(value, maximum = maxNumber) {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= maximum
  );
}
function integer(value, maximum = maxNumber) {
  return numeric(value, maximum) && Number.isSafeInteger(value);
}
function bounded(value, fallback, minimum, maximum) {
  return integer(value, maximum) && value >= minimum ? value : fallback;
}
function hostValues(snapshot) {
  if (
    !integer(snapshot?.logicalCpus, 4096) ||
    snapshot.logicalCpus < 1 ||
    !integer(snapshot.memoryBytes) ||
    !integer(snapshot.freeMemoryBytes) ||
    snapshot.freeMemoryBytes > snapshot.memoryBytes ||
    !integer(snapshot.cpuTimeMs?.idle) ||
    !integer(snapshot.cpuTimeMs?.total) ||
    snapshot.cpuTimeMs.idle > snapshot.cpuTimeMs.total
  )
    throw new Error('INVALID_HOST_COUNTERS');
  const values = {
    logicalCpus: snapshot.logicalCpus,
    memoryBytes: snapshot.memoryBytes,
    freeMemoryBytes: snapshot.freeMemoryBytes,
    cpuTimeMs: {
      idle: snapshot.cpuTimeMs.idle,
      total: snapshot.cpuTimeMs.total,
    },
  };
  if (
    snapshot.loadAverageSupported === true &&
    Array.isArray(snapshot.loadAverage) &&
    snapshot.loadAverage.length === 3 &&
    snapshot.loadAverage.every((value) => numeric(value, 1000000))
  )
    values.loadAverage = [...snapshot.loadAverage];
  return values;
}

/** Optional TEST-only diagnostics. Injected dependencies are for isolated unit tests. */
export async function startContinuousDiagnostics(ctx, options = {}) {
  assertLocalTarget(ctx);
  if (ctx.test !== true) throw new Error('Continuous diagnostics require TEST');
  const settings = options && typeof options === 'object' ? options : {};
  const deps =
    settings.dependencies && typeof settings.dependencies === 'object'
      ? settings.dependencies
      : {};
  const now = deps.now ?? (() => performance.now());
  const wallNow = deps.wallNow ?? (() => Date.now());
  const snapshotHost = deps.hostSnapshot ?? hostSnapshot;
  const spawn = deps.spawn ?? spawnProcess;
  const schedule = deps.setTimeout ?? setTimeout;
  const unschedule = deps.clearTimeout ?? clearTimeout;
  const processEvents = deps.processEvents ?? process;
  const resignal =
    deps.resignal ?? ((signal) => process.kill(process.pid, signal));
  const intervalMs = 1000;
  const staleMs = bounded(settings.staleMs, 5000, intervalMs, 60000);
  const stopTimeoutMs = bounded(settings.stopTimeoutMs, 1500, 1, 10000);
  const maxObservations = bounded(settings.maxObservations, 10000, 1, 100000);
  const maxGaps = bounded(settings.maxGaps, 10000, 1, 100000);
  const maxBufferBytes = bounded(settings.maxBufferBytes, 131072, 256, 1048576);
  const maxDockerEntries = bounded(settings.maxDockerEntries, 1024, 1, 4096);
  const observations = [];
  const gaps = [];
  const sources = Object.fromEntries(
    sourceNames.map((name) => [
      name,
      {
        status: 'unavailable',
        observations: 0,
        failures: 0,
        counterResets: 0,
        capabilities: {},
      },
    ]),
  );
  const overhead = {
    reads: Object.fromEntries(
      sourceNames.map((name) => [name, { count: 0, totalMs: 0, maxMs: 0 }]),
    ),
    parsing: Object.fromEntries(
      ['vm', 'docker'].map((name) => [
        name,
        { count: 0, totalMs: 0, maxMs: 0 },
      ]),
    ),
    ticks: 0,
    maxLagMs: 0,
    rejectedRecords: 0,
    droppedObservations: 0,
    droppedGaps: 0,
    bytes: 0,
    bufferPeakBytes: 0,
    clockFailures: 0,
    wallClockJumps: 0,
  };
  const children = [];
  const hooks = [];
  const pendingDocker = new Map();
  const devices = new Map();
  let previousHost;
  let previousVm;
  let hostPending;
  let vmPending;
  let dockerDirty = false;
  let dockerLastData;
  let vmLastData;
  let previousWall;
  let lastTime = 0;
  let stopping = false;
  let stopPromise;
  let timer;
  let nextTick;
  let referenceCleanupFailed = false;

  function time() {
    try {
      const value = now();
      if (numeric(value) && value >= lastTime) {
        lastTime = value;
        return value;
      }
    } catch {
      /* A broken observation clock cannot affect requests. */
    }
    overhead.clockFailures++;
    return lastTime;
  }
  function gap(source, startedAtMs, finishedAtMs, reason) {
    sources[source].failures++;
    if (gaps.length < maxGaps)
      gaps.push({
        source,
        startedAtMs,
        finishedAtMs: Math.max(startedAtMs, finishedAtMs),
        reason,
      });
    else overhead.droppedGaps++;
  }
  function utc(at) {
    try {
      const value = wallNow();
      if (!integer(value) || value > 8640000000000000)
        throw new Error('INVALID_CLOCK');
      if (
        previousWall &&
        Math.abs(value - previousWall.wall - (at - previousWall.mono)) > 1000
      ) {
        overhead.wallClockJumps++;
        gap('host', previousWall.mono, at, 'WALL_CLOCK_JUMP');
      }
      previousWall = { wall: value, mono: at };
      return new Date(value).toISOString();
    } catch {
      overhead.clockFailures++;
      return undefined;
    }
  }
  function cost(kind, source, durationMs) {
    const counter = overhead[kind][source];
    counter.count++;
    counter.totalMs = Math.min(maxNumber, counter.totalMs + durationMs);
    counter.maxMs = Math.max(counter.maxMs, durationMs);
  }
  function observe(source, startedAtMs, status, values, reset = false) {
    const finishedAtMs = Math.max(startedAtMs, time());
    const observedAt = utc(finishedAtMs);
    cost('reads', source, finishedAtMs - startedAtMs);
    if (!observedAt) {
      gap(source, startedAtMs, finishedAtMs, 'CLOCK_INVALID');
      return;
    }
    if (overhead.clockFailures)
      status = status === 'unavailable' ? status : 'partial';
    if (observations.length >= maxObservations) {
      overhead.droppedObservations++;
      return;
    }
    observations.push({
      source,
      startedAtMs,
      finishedAtMs,
      observedAt,
      status,
      ...(values === undefined ? {} : { values }),
      ...(reset ? { counterReset: true } : {}),
    });
    if (status !== 'unavailable') sources[source].observations++;
  }
  function unavailable(source, started, reason) {
    const finished = time();
    gap(source, started, finished, reason);
    observe(source, started, 'unavailable');
  }
  function terminate(record, forced = false) {
    try {
      if (record.source === 'vm' && !forced) record.child.stdin?.end('stop\n');
      else if (!record.closed && !record.spawnFailed)
        record.child.kill(forced ? 'SIGKILL' : 'SIGTERM');
    } catch {
      record.cleanupFailed = true;
    }
  }
  function emergencyClose() {
    if (timer !== undefined) {
      try {
        unschedule(timer);
      } catch {
        /* optional */
      }
    }
    for (const record of children) {
      terminate(record);
      if (record.source === 'vm' && !record.closed) terminate(record, true);
      if (!record.closed) {
        try {
          record.child.unref?.();
        } catch {
          /* optional */
        }
      }
    }
  }

  function readHost(at) {
    if (hostPending) {
      gap(
        'host',
        hostPending.started,
        at,
        at - hostPending.started >= staleMs ? 'READ_TIMEOUT' : 'BACKPRESSURE',
      );
      return;
    }
    const pending = { started: at };
    hostPending = pending;
    try {
      Promise.resolve(snapshotHost())
        .then((snapshot) => {
          if (stopping) return;
          const values = hostValues(snapshot);
          const reset =
            !!previousHost &&
            (values.cpuTimeMs.total < previousHost.cpuTimeMs.total ||
              values.cpuTimeMs.idle < previousHost.cpuTimeMs.idle ||
              values.logicalCpus !== previousHost.logicalCpus);
          if (reset) sources.host.counterResets++;
          previousHost = values;
          sources.host.capabilities = {
            cpu: true,
            memory: true,
            loadAverage: values.loadAverage !== undefined,
          };
          observe('host', at, 'observed', values, reset);
        })
        .catch(() => {
          if (!stopping) unavailable('host', at, 'INVALID_DATA');
        })
        .finally(() => {
          if (hostPending === pending) hostPending = undefined;
        });
    } catch {
      hostPending = undefined;
      unavailable('host', at, 'SOURCE_UNAVAILABLE');
    }
  }

  function vmValues(raw) {
    const parsed = linuxVmCounters(raw);
    if (
      !integer(parsed.logicalCpus, 4096) ||
      parsed.logicalCpus < 1 ||
      parsed.disks.length > 256 ||
      !Object.values(parsed.cpuTicks).every((value) => integer(value)) ||
      parsed.cpuTicks.idle > parsed.cpuTicks.total ||
      parsed.cpuTicks.ioWait > parsed.cpuTicks.total ||
      parsed.availableMemoryBytes > parsed.memoryBytes ||
      parsed.freeSwapBytes > parsed.swapBytes
    )
      throw new Error('INVALID_VM_COUNTERS');
    const disks = parsed.disks.map(({ device, ...counters }) => {
      if (!devices.has(device)) {
        if (devices.size >= 256) throw new Error('DEVICE_LIMIT');
        devices.set(device, devices.size);
      }
      return { deviceOrdinal: devices.get(device), ...counters };
    });
    return { ...parsed, disks };
  }
  function completedVm(record, raw) {
    const started = vmPending?.started;
    vmPending = undefined;
    if (record.disabled) return;
    if (started === undefined) {
      overhead.rejectedRecords++;
      unavailable('vm', time(), 'UNEXPECTED_FRAME');
      return;
    }
    try {
      const values = vmValues(raw);
      const reset =
        !!previousVm &&
        (values.cpuTicks.total < previousVm.cpuTicks.total ||
          values.cpuTicks.idle < previousVm.cpuTicks.idle ||
          values.cpuTicks.ioWait < previousVm.cpuTicks.ioWait ||
          values.logicalCpus !== previousVm.logicalCpus ||
          values.disks.some((disk) => {
            const previous = previousVm.disks.find(
              (item) => item.deviceOrdinal === disk.deviceOrdinal,
            );
            return (
              previous &&
              [
                'reads',
                'sectorsRead',
                'readMs',
                'writes',
                'sectorsWritten',
                'writeMs',
                'ioMs',
                'weightedIoMs',
              ].some((key) => disk[key] < previous[key])
            );
          }));
      if (reset) sources.vm.counterResets++;
      previousVm = values;
      vmLastData = time();
      sources.vm.capabilities = {
        cpu: true,
        memory: true,
        swap: true,
        disk: values.disks.length > 0,
      };
      observe(
        'vm',
        started,
        values.disks.length ? 'observed' : 'partial',
        values,
        reset,
      );
    } catch {
      overhead.rejectedRecords++;
      unavailable('vm', started, 'INVALID_DATA');
    }
  }
  function line(record, value) {
    if (record.source === 'vm') {
      if (value === stoppedFrame) {
        record.acknowledged = true;
        vmPending = undefined;
        return;
      }
      if (record.disabled) return;
      if (value === beginFrame) {
        record.frame = '';
        record.inFrame = true;
        return;
      }
      if (value === endFrame && record.inFrame) {
        record.inFrame = false;
        completedVm(record, record.frame);
        record.frame = '';
      } else if (record.inFrame) {
        if (
          Buffer.byteLength(record.frame) + Buffer.byteLength(value) + 1 >
          maxBufferBytes
        )
          throw new Error('BUFFER_LIMIT');
        record.frame += value + '\n';
      } else if (value.trim()) {
        overhead.rejectedRecords++;
        unavailable('vm', time(), 'UNEXPECTED_FRAME');
      }
      return;
    }
    if (record.disabled || stopping) return;
    const normalized = value.replace(ansiSequence, '').replace(/\r/g, '');
    if (!normalized.trim()) return;
    const parsed = JSON.parse(normalized);
    if (
      typeof parsed?.Name !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,255}$/.test(parsed.Name)
    )
      throw new Error('INVALID_DOCKER_COUNTERS');
    const projected = workloadCounters(
      JSON.stringify({ Name: parsed.Name, CPUPerc: parsed.CPUPerc }),
    );
    if (
      !Object.values(projected.groups).every((group) =>
        numeric(group.cpuPercentOfSingleCore, 1000000),
      )
    )
      throw new Error('INVALID_DOCKER_COUNTERS');
    if (
      !pendingDocker.has(parsed.Name) &&
      pendingDocker.size >= maxDockerEntries
    )
      throw new Error('ENTRY_LIMIT');
    const at = time();
    pendingDocker.set(parsed.Name, {
      value: { Name: parsed.Name, CPUPerc: parsed.CPUPerc },
      at,
    });
    dockerLastData = at;
    dockerDirty = true;
  }
  function data(record, chunk) {
    const started = time();
    try {
      const bytes = Buffer.byteLength(chunk);
      overhead.bytes = Math.min(maxNumber, overhead.bytes + bytes);
      if (
        bytes +
          Buffer.byteLength(record.buffer) +
          Buffer.byteLength(record.frame) >
        maxBufferBytes
      )
        throw new Error('BUFFER_LIMIT');
      record.buffer += chunk.toString('utf8');
      overhead.bufferPeakBytes = Math.max(
        overhead.bufferPeakBytes,
        Buffer.byteLength(record.buffer) + Buffer.byteLength(record.frame),
      );
      let delimiter;
      while ((delimiter = record.buffer.indexOf('\n')) >= 0) {
        const value = record.buffer.slice(0, delimiter).replace(/\r$/, '');
        record.buffer = record.buffer.slice(delimiter + 1);
        try {
          line(record, value);
        } catch (error) {
          overhead.rejectedRecords++;
          const limited = ['ENTRY_LIMIT', 'BUFFER_LIMIT'].includes(
            error.message,
          );
          unavailable(
            record.source,
            started,
            error.message === 'ENTRY_LIMIT'
              ? 'RECORD_LIMIT'
              : error.message === 'BUFFER_LIMIT'
                ? 'BUFFER_LIMIT'
                : 'INVALID_DATA',
          );
          if (limited) {
            record.disabled = true;
            record.frame = '';
            record.inFrame = false;
            terminate(record);
          }
        }
      }
    } catch {
      overhead.rejectedRecords++;
      record.buffer = '';
      record.frame = '';
      record.disabled = true;
      unavailable(record.source, started, 'BUFFER_LIMIT');
      terminate(record);
    } finally {
      cost('parsing', record.source, Math.max(0, time() - started));
    }
  }
  function launch(source, args) {
    try {
      const child = spawn('docker', args, {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      const record = {
        source,
        child,
        buffer: '',
        frame: '',
        closed: false,
        disabled: false,
        acknowledged: false,
      };
      children.push(record);
      record.onData = (chunk) => data(record, chunk);
      child.stdout.on('data', record.onData);
      child.on('error', () => {
        record.disabled = true;
        record.spawnFailed = child.pid === undefined;
        if (!stopping) unavailable(source, time(), 'SOURCE_UNAVAILABLE');
      });
      child.stdin?.on('error', () => {
        record.disabled = true;
        if (!stopping) unavailable(source, time(), 'READ_ERROR');
        terminate(record);
      });
      child.on('close', () => {
        record.closed = true;
        record.disabled = true;
        if (!stopping) unavailable(source, time(), 'STREAM_ENDED');
      });
      return record;
    } catch {
      unavailable(source, time(), 'SOURCE_UNAVAILABLE');
      return undefined;
    }
  }
  function flushDocker(at) {
    for (const [name, entry] of pendingDocker)
      if (at - entry.at > staleMs) pendingDocker.delete(name);
    if (dockerDirty && pendingDocker.size) {
      dockerDirty = false;
      const records = [...pendingDocker.values()];
      const started = Math.min(...records.map((entry) => entry.at));
      try {
        const values = workloadCounters(
          records.map((entry) => JSON.stringify(entry.value)).join('\n'),
        ).groups;
        if (
          !Object.values(values).every(
            (group) =>
              integer(group.containers, maxDockerEntries) &&
              numeric(group.cpuPercentOfSingleCore, 1000000),
          )
        )
          throw new Error('INVALID_DOCKER_COUNTERS');
        sources.docker.capabilities = {
          groupedCpu: true,
          groupedContainers: true,
          runnerCapsuleAttribution: false,
        };
        // An unframed stats stream cannot establish that an absent group is empty.
        const groups = Object.fromEntries(
          Object.entries(values).map(([group, value]) => [
            group,
            value.containers > 0
              ? { status: 'observed', ...value }
              : {
                  status: 'unavailable',
                  containers: null,
                  cpuPercentOfSingleCore: null,
                },
          ]),
        );
        observe(
          'docker',
          started,
          Object.values(groups).every((group) => group.status === 'observed')
            ? 'observed'
            : 'partial',
          {
            groups,
            maxAgeMs: at - started,
          },
        );
      } catch {
        unavailable('docker', started, 'INVALID_DATA');
      }
    } else if (at - (dockerLastData ?? startedAtMs) >= staleMs) {
      unavailable('docker', dockerLastData ?? startedAtMs, 'READ_TIMEOUT');
    }
  }
  function tick() {
    if (stopping) return;
    const at = time();
    overhead.ticks++;
    const lag = Math.max(0, at - nextTick);
    overhead.maxLagMs = Math.max(overhead.maxLagMs, lag);
    if (lag >= intervalMs)
      for (const source of sourceNames)
        gap(source, nextTick, at, 'SCHEDULER_DELAY');
    readHost(at);
    const vm = children.find((record) => record.source === 'vm');
    if (vm && !vm.disabled && !vm.closed) {
      if (vmPending) {
        if (at - vmPending.started >= staleMs) {
          unavailable('vm', vmPending.started, 'READ_TIMEOUT');
          vm.disabled = true;
          terminate(vm);
        } else gap('vm', vmPending.started, at, 'BACKPRESSURE');
      } else {
        vmPending = { started: time() };
        try {
          if (vm.child.stdin.write('sample\n') === false)
            gap('vm', vmPending.started, time(), 'BACKPRESSURE');
        } catch {
          vm.disabled = true;
          unavailable('vm', vmPending.started, 'READ_ERROR');
          terminate(vm);
        }
      }
    } else if (at - (vmLastData ?? startedAtMs) >= staleMs)
      unavailable('vm', vmLastData ?? startedAtMs, 'SOURCE_UNAVAILABLE');
    flushDocker(at);
    nextTick = at + intervalMs;
    try {
      timer = schedule(safeTick, intervalMs);
      timer?.unref?.();
    } catch {
      for (const source of sourceNames)
        unavailable(source, at, 'SCHEDULER_UNAVAILABLE');
    }
  }
  function safeTick() {
    try {
      tick();
    } catch {
      for (const source of sourceNames)
        unavailable(source, time(), 'COLLECTOR_UNAVAILABLE');
    }
  }
  const startedAtMs = time();
  launch('vm', [
    'exec',
    '-i',
    `supabase_db_${testTarget.projectId}`,
    'sh',
    '-c',
    vmCommand,
  ]);
  launch('docker', ['stats', '--format', '{{json .}}', '--no-trunc']);
  nextTick = startedAtMs;
  safeTick();
  try {
    const exit = () => emergencyClose();
    processEvents.once('exit', exit);
    hooks.push(['exit', exit]);
    for (const signal of ['SIGINT', 'SIGTERM']) {
      const existing = processEvents.listenerCount(signal);
      const listener = () => {
        emergencyClose();
        processEvents.removeListener(signal, listener);
        if (!existing) {
          try {
            resignal(signal);
          } catch {
            /* The host owns termination. */
          }
        }
      };
      processEvents.once(signal, listener);
      hooks.push([signal, listener]);
    }
  } catch {
    gap('host', startedAtMs, time(), 'EXIT_HOOK_UNAVAILABLE');
  }

  async function closeChild(record) {
    if (record.closed || record.spawnFailed) return;
    terminate(record);
    const wait = () =>
      new Promise((resolve) => {
        if (record.closed || record.spawnFailed) {
          resolve();
          return;
        }
        let timeout;
        const done = () => {
          try {
            record.child.removeListener('close', done);
            unschedule(timeout);
          } catch {
            record.cleanupFailed = true;
          }
          resolve();
        };
        try {
          record.child.once('close', done);
          timeout = schedule(done, stopTimeoutMs);
        } catch {
          done();
        }
      });
    await wait();
    if (!record.closed && !record.spawnFailed) {
      terminate(record, true);
      await wait();
    }
    if (!record.closed && !record.spawnFailed) {
      record.cleanupFailed = true;
      // Release only owned handles after the deadline; this does not prove that
      // the remote reader stopped. EOF is its fallback and ACK remains required.
      for (const stream of [
        record.child.stdin,
        record.child.stdout,
        record.child.stderr,
      ]) {
        try {
          stream?.destroy?.();
        } catch {
          /* cleanup remains unverified */
        }
      }
      try {
        record.child.unref?.();
      } catch {
        /* cleanup remains unverified */
      }
    }
  }
  function stop() {
    if (stopPromise) return stopPromise;
    stopping = true;
    stopPromise = (async () => {
      try {
        if (timer !== undefined) unschedule(timer);
      } catch {
        referenceCleanupFailed = true;
      }
      try {
        await Promise.all(children.map(closeChild));
      } catch {
        /* Report failure, never lose request samples. */
      }
      for (const [event, listener] of hooks) {
        try {
          processEvents.removeListener(event, listener);
        } catch {
          referenceCleanupFailed = true;
        }
      }
      if (dockerDirty) flushDocker(time());
      pendingDocker.clear();
      for (const record of children) {
        try {
          record.child.stdout?.removeListener('data', record.onData);
        } catch {
          record.cleanupFailed = true;
        }
        record.buffer = '';
        record.frame = '';
      }
      const finishedAtMs = time();
      if (hostPending)
        gap('host', hostPending.started, finishedAtMs, 'READ_INCOMPLETE');
      if (vmPending)
        gap('vm', vmPending.started, finishedAtMs, 'READ_INCOMPLETE');
      const cleanupVerified =
        !referenceCleanupFailed &&
        children.every(
          (record) =>
            (record.closed || record.spawnFailed) &&
            !record.cleanupFailed &&
            (record.source !== 'vm' ||
              record.spawnFailed ||
              record.acknowledged),
        );
      for (const source of sourceNames)
        sources[source].status = !sources[source].observations
          ? 'unavailable'
          : sources[source].failures ||
              observations.some(
                (item) => item.source === source && item.status === 'partial',
              )
            ? 'partial'
            : 'observed';
      const observed = sourceNames.some(
        (source) => sources[source].observations > 0,
      );
      const complete =
        sourceNames.every((source) => sources[source].status === 'observed') &&
        !overhead.clockFailures &&
        !overhead.droppedObservations &&
        !overhead.droppedGaps &&
        cleanupVerified;
      return {
        version: 1,
        workloadGrouping:
          'Supabase project suffixes; unmatched containers include unattributed runner capsules. Other does not establish unrelated service load.',
        status: complete ? 'observed' : observed ? 'partial' : 'unavailable',
        intervalMs,
        startedAtMs,
        finishedAtMs,
        sources,
        observations,
        gaps,
        overhead,
        cleanupVerified,
      };
    })();
    return stopPromise;
  }
  return { stop };
}

/** Interval intersections describe coincidence only, never a cause of a slow request. */
export function correlateContinuousDiagnostics(report, window) {
  const valid =
    numeric(window?.startedAtMs) &&
    numeric(window?.finishedAtMs) &&
    window.finishedAtMs >= window.startedAtMs;
  const result = { version: 1, status: 'unavailable', sources: {} };
  for (const source of sourceNames) {
    const intersects = (item) =>
      valid &&
      item?.source === source &&
      numeric(item.startedAtMs) &&
      numeric(item.finishedAtMs) &&
      item.finishedAtMs >= item.startedAtMs &&
      item.startedAtMs <= window.finishedAtMs &&
      item.finishedAtMs >= window.startedAtMs;
    const matching = Array.isArray(report?.observations)
      ? report.observations
          .slice(0, 100000)
          .filter(
            (item) =>
              intersects(item) &&
              ['observed', 'partial', 'unavailable'].includes(item.status),
          )
      : [];
    const gaps = Array.isArray(report?.gaps)
      ? report.gaps.slice(0, 100000).filter(intersects)
      : [];
    const intervals = gaps
      .map((item) => [
        Math.max(item.startedAtMs, window.startedAtMs),
        Math.min(item.finishedAtMs, window.finishedAtMs),
      ])
      .sort((a, b) => a[0] - b[0]);
    let gapMs = 0;
    let previous;
    for (const [start, end] of intervals) {
      if (previous && start <= previous[1])
        previous[1] = Math.max(end, previous[1]);
      else {
        if (previous) gapMs += previous[1] - previous[0];
        previous = [start, end];
      }
    }
    if (previous) gapMs += previous[1] - previous[0];
    result.sources[source] = {
      status: !matching.some((item) => item.status !== 'unavailable')
        ? 'unavailable'
        : gaps.length || matching.some((item) => item.status !== 'observed')
          ? 'partial'
          : 'observed',
      observations: matching.length,
      observed: matching.filter((item) => item.status === 'observed').length,
      partial: matching.filter((item) => item.status === 'partial').length,
      unavailable: matching.filter((item) => item.status === 'unavailable')
        .length,
      gaps: gaps.length,
      gapMs: Math.min(maxNumber, gapMs),
      counterResets: matching.filter((item) => item.counterReset === true)
        .length,
    };
  }
  if (
    Object.values(result.sources).some(
      (source) => source.status !== 'unavailable',
    )
  )
    result.status = Object.values(result.sources).every(
      (source) => source.status === 'observed',
    )
      ? 'observed'
      : 'partial';
  return result;
}
