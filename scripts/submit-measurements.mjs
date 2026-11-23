import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { performance } from 'node:perf_hooks';
import { assertLocalTarget, testTarget } from './local-target.mjs';

const executeFile = promisify(execFile);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const isUuid = (value) =>
  typeof value === 'string' && value.length === 36 && uuid.test(value);

// Independent private clock channel. It never contains domain input or output.
export function submitClockEvents(output) {
  const events = [];
  let rejected = 0;
  for (const line of output.split(/\r?\n/)) {
    if (!line.includes('TEST_SUBMIT_CLOCK')) continue;
    if (line.length > 1024 || events.length >= 10000) {
      rejected++;
      continue;
    }
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      rejected++;
      continue;
    }
    if (
      value?.event !== 'TEST_SUBMIT_CLOCK' ||
      value.version !== 1 ||
      !isUuid(value.requestId) ||
      !['start', 'end'].includes(value.boundary) ||
      !Number.isFinite(value.monotonicMs) ||
      value.monotonicMs < 0 ||
      !Number.isSafeInteger(value.utcMs) ||
      value.utcMs < 0 ||
      !Number.isFinite(value.uncertaintyMs) ||
      value.uncertaintyMs < 0 ||
      value.uncertaintyMs > 10 ||
      Object.keys(value).some(
        (key) =>
          ![
            'event',
            'version',
            'requestId',
            'boundary',
            'monotonicMs',
            'utcMs',
            'uncertaintyMs',
          ].includes(key),
      )
    ) {
      rejected++;
      continue;
    }
    events.push(value);
  }
  return { events, rejected };
}

export function alignSubmitTimings(timings, anchors, correlation, httpWindow) {
  const missing = { status: 'unavailable', clockJump: false, intervals: [] };
  if (
    !Array.isArray(timings) ||
    !Array.isArray(anchors) ||
    !isUuid(correlation?.requestId) ||
    !httpWindow ||
    !['startedAtMs', 'finishedAtMs', 'startedAtUtcMs', 'finishedAtUtcMs'].every(
      (field) => Number.isFinite(httpWindow[field]),
    ) ||
    httpWindow.finishedAtMs < httpWindow.startedAtMs
  )
    return missing;
  const selected = anchors.filter(
    (event) => event?.requestId === correlation.requestId,
  );
  const start = selected.filter((event) => event.boundary === 'start');
  const end = selected.filter((event) => event.boundary === 'end');
  if (
    start.length !== 1 ||
    end.length !== 1 ||
    ![start[0], end[0]].every(
      (event) =>
        Number.isFinite(event.monotonicMs) &&
        event.monotonicMs >= 0 &&
        Number.isSafeInteger(event.utcMs) &&
        event.utcMs >= 0 &&
        Number.isFinite(event.uncertaintyMs) &&
        event.uncertaintyMs >= 0 &&
        event.uncertaintyMs <= 10,
    ) ||
    end[0].monotonicMs < start[0].monotonicMs
  )
    return missing;
  const apiOffsets = [start[0], end[0]].map(
    (event) => event.utcMs - event.monotonicMs,
  );
  const hostAnchors = ['started', 'finished'].map((boundary) => ({
    monotonicMs:
      httpWindow[`${boundary}ClockMs`] ?? httpWindow[`${boundary}AtMs`],
    uncertaintyMs: httpWindow[`${boundary}ClockUncertaintyMs`] ?? 0,
  }));
  if (
    !hostAnchors.every(
      (item) =>
        Number.isFinite(item.monotonicMs) &&
        item.monotonicMs >= 0 &&
        Number.isFinite(item.uncertaintyMs) &&
        item.uncertaintyMs >= 0,
    )
  )
    return missing;
  const harnessOffsets = [
    httpWindow.startedAtUtcMs - hostAnchors[0].monotonicMs,
    httpWindow.finishedAtUtcMs - hostAnchors[1].monotonicMs,
  ];
  const apiUncertaintyMs = start[0].uncertaintyMs + end[0].uncertaintyMs + 2;
  const hostUncertaintyMs =
    hostAnchors[0].uncertaintyMs + hostAnchors[1].uncertaintyMs + 2;
  const uncertaintyMs = apiUncertaintyMs + hostUncertaintyMs;
  const retainedAnchors = {
    api: [start[0], end[0]].map(
      ({ boundary, monotonicMs, utcMs, uncertaintyMs }) => ({
        boundary,
        monotonicMs,
        utcMs,
        uncertaintyMs,
      }),
    ),
    harness: hostAnchors.map((value, index) => ({
      boundary: index === 0 ? 'start' : 'end',
      ...value,
      utcMs:
        index === 0 ? httpWindow.startedAtUtcMs : httpWindow.finishedAtUtcMs,
    })),
  };
  const clockJump =
    Math.abs(apiOffsets[1] - apiOffsets[0]) > apiUncertaintyMs ||
    Math.abs(harnessOffsets[1] - harnessOffsets[0]) > hostUncertaintyMs;
  if (clockJump)
    return {
      ...missing,
      status: 'partial',
      clockJump: true,
      uncertaintyMs,
      anchors: retainedAnchors,
    };
  const offset =
    (apiOffsets[0] + apiOffsets[1] - harnessOffsets[0] - harnessOffsets[1]) / 2;
  return {
    status: 'observed',
    clockJump: false,
    uncertaintyMs,
    anchors: retainedAnchors,
    intervals: timings.map(({ source, phase, observedAtMs, durationMs }) => {
      const finishedAtMs = observedAtMs + offset;
      const derived =
        source === 'docker' &&
        ['hostStartAttach', 'containerWall', 'supervisor'].includes(phase);
      return {
        source,
        phase,
        timingSemantics: derived
          ? 'derived-duration-published'
          : 'measured-host-span',
        // Derived runner durations are published later, so do not invent a span.
        startedAtMs: derived ? null : Math.max(0, finishedAtMs - durationMs),
        finishedAtMs,
      };
    }),
  };
}
const phases = {
  docker: new Set([
    'engineResolve',
    'imageResolve',
    'create',
    'preInspect',
    'attachOutput',
    'attachInput',
    'start',
    'send',
    'streams',
    'wait',
    'postInspect',
    'delete',
    'verifyAbsent',
    'hostStartAttach',
    'containerWall',
    'supervisor',
  ]),
  submission: new Set([
    'authorizeInitial',
    'inspect',
    'admit',
    'suite',
    'execute',
    'cleanupFallback',
    'stage',
    'finish',
    'authorizeFinal',
    'total',
  ]),
};

// Parse only the private TEST channel. Never copy API output into a report.
export function submitTimingEvents(output) {
  const events = [];
  let rejected = 0;
  for (const line of output.split(/\r?\n/)) {
    if (!line.includes('TEST_SUBMIT_TIMING')) continue;
    if (line.length > 2048 || events.length >= 10000) {
      rejected++;
      continue;
    }
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      rejected++;
      continue;
    }
    if (
      value?.event !== 'TEST_SUBMIT_TIMING' ||
      value.version !== 2 ||
      !['docker', 'submission'].includes(value.source) ||
      !phases[value.source]?.has(value.phase) ||
      !isUuid(value.requestId) ||
      (value.executionId !== undefined && !isUuid(value.executionId)) ||
      !Number.isFinite(value.durationMs) ||
      value.durationMs < 0 ||
      value.durationMs > 120000 ||
      !Number.isFinite(value.observedAtMs) ||
      value.observedAtMs < 0 ||
      typeof value.completed !== 'boolean' ||
      Object.keys(value).some(
        (key) =>
          ![
            'event',
            'version',
            'source',
            'phase',
            'requestId',
            'executionId',
            'durationMs',
            'observedAtMs',
            'completed',
          ].includes(key),
      )
    ) {
      rejected++;
      continue;
    }
    events.push({
      requestId: value.requestId,
      ...(value.executionId === undefined
        ? {}
        : { executionId: value.executionId }),
      source: value.source,
      phase: value.phase,
      durationMs: value.durationMs,
      observedAtMs: value.observedAtMs,
      completed: value.completed,
    });
  }
  return { events, rejected };
}

export function timingsForSample(events, correlation) {
  if (
    !isUuid(correlation?.requestId) ||
    (correlation.executionId !== undefined && !isUuid(correlation.executionId))
  )
    return [];
  const requestEvents = events.filter(
    (event) => event.requestId === correlation.requestId,
  );
  let executionId = correlation.executionId;
  if (executionId === undefined) {
    const executionIds = new Set(
      requestEvents
        .filter((event) => event.executionId !== undefined)
        .map((event) => event.executionId),
    );
    if (executionIds.size > 1 || [...executionIds].some((id) => !isUuid(id)))
      return [];
    executionId = executionIds.values().next().value;
  }
  return requestEvents
    .filter(
      (event) =>
        event.executionId === undefined || event.executionId === executionId,
    )
    .map(({ source, phase, durationMs, observedAtMs, completed }) => ({
      source,
      phase,
      durationMs,
      observedAtMs,
      completed,
    }));
}

// This channel has no request/container identities. Keep only bounded numbers.
export function submitBackgroundEvents(output) {
  const events = [];
  let rejected = 0;
  for (const line of output.split(/\r?\n/)) {
    if (!line.includes('TEST_SUBMIT_BACKGROUND')) continue;
    if (line.length > 1024 || events.length >= 10000) {
      rejected++;
      continue;
    }
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      rejected++;
      continue;
    }
    if (
      value?.event !== 'TEST_SUBMIT_BACKGROUND' ||
      value.version !== 1 ||
      !['RUN', 'SUBMIT'].includes(value.worker) ||
      !['total', 'sweep', 'purge', 'claim', 'recover'].includes(value.phase) ||
      !Number.isFinite(value.durationMs) ||
      value.durationMs < 0 ||
      value.durationMs > 120000 ||
      !Number.isFinite(value.observedAtMs) ||
      value.observedAtMs < 0 ||
      typeof value.completed !== 'boolean' ||
      (value.count !== undefined &&
        (!Number.isSafeInteger(value.count) ||
          value.count < 0 ||
          value.count > 10000)) ||
      Object.keys(value).some(
        (key) =>
          ![
            'event',
            'version',
            'worker',
            'phase',
            'durationMs',
            'observedAtMs',
            'completed',
            'count',
          ].includes(key),
      )
    ) {
      rejected++;
      continue;
    }
    events.push({
      worker: value.worker,
      phase: value.phase,
      durationMs: value.durationMs,
      observedAtMs: value.observedAtMs,
      completed: value.completed,
      ...(value.count === undefined ? {} : { count: value.count }),
    });
  }
  return { events, rejected };
}

// Shared API monotonic clock gives approximate interval overlap, not causality.
// Total events include their nested phases; report each event separately.
export function backgroundForSample(timings, background) {
  const total = timings.filter(
    (event) => event.source === 'submission' && event.phase === 'total',
  );
  if (total.length !== 1) return [];
  const end = total[0].observedAtMs;
  const start = end - total[0].durationMs;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0) return [];
  return background.flatMap(
    ({ worker, phase, durationMs, observedAtMs, completed, count }) => {
      const overlapMs =
        Math.min(end, observedAtMs) -
        Math.max(start, observedAtMs - durationMs);
      return overlapMs > 0
        ? [
            {
              worker,
              phase,
              durationMs,
              observedAtMs,
              completed,
              ...(count === undefined ? {} : { count }),
              overlapMs,
            },
          ]
        : [];
    },
  );
}

// A successful fixture must retain each service phase and each fresh capsule.
// Resolver phases may be cached, and cleanupFallback belongs to failure paths.
export function hasCompleteSubmitTimings(events, capsuleCount) {
  if (!Number.isSafeInteger(capsuleCount) || capsuleCount < 1) return false;
  const required = {
    submission: [
      'authorizeInitial',
      'inspect',
      'admit',
      'suite',
      'execute',
      'stage',
      'finish',
      'authorizeFinal',
      'total',
    ],
    docker: [
      'create',
      'preInspect',
      'attachOutput',
      'attachInput',
      'start',
      'send',
      'streams',
      'wait',
      'postInspect',
      'delete',
      'verifyAbsent',
      'hostStartAttach',
      'containerWall',
      'supervisor',
    ],
  };
  return Object.entries(required).every(([source, requiredPhases]) =>
    requiredPhases.every((phase) => {
      const matching = events.filter(
        (event) => event.source === source && event.phase === phase,
      );
      return (
        matching.length === (source === 'submission' ? 1 : capsuleCount) &&
        matching.every((event) => event.completed === true)
      );
    }),
  );
}

// /proc is read in the fixed TEST database container, never a student capsule.
// Only numeric CPU/memory/whole-device disk counters cross this boundary.
export function linuxVmCounters(output) {
  const lines = output.split(/\r?\n/);
  const cpu = lines
    .find((line) => /^cpu\s/.test(line))
    ?.trim()
    .split(/\s+/)
    .slice(1, 9)
    .map(Number);
  if (
    !cpu ||
    cpu.length !== 8 ||
    cpu.some((n) => !Number.isSafeInteger(n) || n < 0)
  )
    throw new Error('Invalid VM counters');
  const memory = {};
  for (const name of ['MemTotal', 'MemAvailable', 'SwapTotal', 'SwapFree']) {
    const match = lines
      .find((line) => line.startsWith(`${name}:`))
      ?.match(/^\w+:\s+(\d+)\s+kB$/);
    const bytes = match ? Number(match[1]) * 1024 : NaN;
    if (!Number.isSafeInteger(bytes)) throw new Error('Invalid VM counters');
    memory[name] = bytes;
  }
  const disks = lines.flatMap((line) => {
    const values = line.trim().split(/\s+/);
    if (!/^(sd[a-z]+|vd[a-z]+|nvme\d+n\d+|dm-\d+)$/.test(values[2] ?? ''))
      return [];
    if (values.length < 14) throw new Error('Invalid VM disk counters');
    const counters = values.slice(3, 14).map(Number);
    if (counters.some((n) => !Number.isSafeInteger(n) || n < 0))
      throw new Error('Invalid VM disk counters');
    return [
      {
        device: values[2],
        reads: counters[0],
        sectorsRead: counters[2],
        readMs: counters[3],
        writes: counters[4],
        sectorsWritten: counters[6],
        writeMs: counters[7],
        ioInProgress: counters[8],
        ioMs: counters[9],
        weightedIoMs: counters[10],
      },
    ];
  });
  return {
    logicalCpus: lines.filter((line) => /^cpu\d+\s/.test(line)).length,
    cpuTicks: {
      total: cpu.reduce((sum, n) => sum + n, 0),
      idle: cpu[3],
      ioWait: cpu[4],
    },
    memoryBytes: memory.MemTotal,
    availableMemoryBytes: memory.MemAvailable,
    swapBytes: memory.SwapTotal,
    freeSwapBytes: memory.SwapFree,
    disks,
  };
}

export function workloadCounters(output) {
  const groups = Object.fromEntries(
    ['test', 'laboratory', 'other'].map((group) => [
      group,
      { containers: 0, cpuPercentOfSingleCore: 0 },
    ]),
  );
  for (const line of output.trim().split(/\r?\n/)) {
    const value = JSON.parse(line);
    if (
      typeof value.Name !== 'string' ||
      !/^\d+(?:\.\d+)?%$/.test(value.CPUPerc ?? '')
    )
      throw new Error('Invalid workload counters');
    const group = value.Name.endsWith(`_${testTarget.projectId}`)
      ? 'test'
      : value.Name.endsWith('_alunza-edu-laboratorio')
        ? 'laboratory'
        : 'other';
    groups[group].containers++;
    groups[group].cpuPercentOfSingleCore += Number.parseFloat(value.CPUPerc);
  }
  return { status: 'observed', groups };
}

export async function dockerVmSnapshot(ctx, execute = executeFile) {
  assertLocalTarget(ctx);
  if (ctx.test !== true) throw new Error('VM observation requires TEST');
  const started = performance.now();
  try {
    const result = await execute(
      'docker',
      [
        'exec',
        `supabase_db_${testTarget.projectId}`,
        'cat',
        '/proc/stat',
        '/proc/meminfo',
        '/proc/diskstats',
      ],
      { windowsHide: true, timeout: 5000, maxBuffer: 131072 },
    );
    const counters = linuxVmCounters(result.stdout);
    let workloads;
    try {
      const stats = await execute(
        'docker',
        ['stats', '--no-stream', '--format', '{{json .}}'],
        { windowsHide: true, timeout: 5000, maxBuffer: 131072 },
      );
      workloads = workloadCounters(stats.stdout);
    } catch {
      workloads = { status: 'unavailable' };
    }
    return {
      status: 'observed',
      observedAt: new Date().toISOString(),
      durationMs: performance.now() - started,
      scope: 'docker-linux-vm-counters',
      ...counters,
      workloads,
    };
  } catch {
    return {
      status: 'unavailable',
      observedAt: new Date().toISOString(),
      durationMs: performance.now() - started,
      scope: 'docker-linux-vm-counters',
      errorCode: 'VM_COUNTERS_UNAVAILABLE',
    };
  }
}
