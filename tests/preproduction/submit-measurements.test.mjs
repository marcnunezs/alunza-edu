import { jest } from '@jest/globals';
import {
  submitTimingEvents,
  timingsForSample,
  linuxVmCounters,
  dockerVmSnapshot,
  workloadCounters,
  hasCompleteSubmitTimings,
  submitBackgroundEvents,
  backgroundForSample,
} from '../../scripts/submit-measurements.mjs';
import { testTarget, developmentTarget } from '../../scripts/local-target.mjs';

const requestId = '10000000-0000-4000-8000-000000000001';
const executionId = '10000000-0000-4000-8000-000000000002';
const event = {
  event: 'TEST_SUBMIT_TIMING',
  version: 2,
  requestId,
  executionId,
  source: 'docker',
  phase: 'create',
  durationMs: 42,
  observedAtMs: 100,
  completed: true,
};

test('timing channel excludes extra private data and rejects malformed or unbounded events', () => {
  const input = [
    event,
    { ...event, code: 'secret-code' },
    { ...event, phase: 'secret-hidden-id' },
    { ...event, requestId: 'secret-token' },
    { ...event, durationMs: -1 },
    { ...event, durationMs: 120001 },
    { ...event, completed: 'true' },
  ]
    .map(JSON.stringify)
    .join('\n');
  const parsed = submitTimingEvents(input);
  expect(parsed.events).toHaveLength(1);
  expect(parsed.rejected).toBe(6);
  expect(JSON.stringify(parsed)).not.toContain('secret');
});

test('correlation does not mix concurrent requests and removes ids from the public report', () => {
  const otherId = '10000000-0000-4000-8000-000000000003';
  const events = submitTimingEvents(
    [
      event,
      { ...event, requestId: otherId },
      { ...event, executionId: otherId },
    ]
      .map(JSON.stringify)
      .join('\n'),
  ).events;
  const output = timingsForSample(events, { requestId, executionId });
  expect(output).toEqual([
    {
      source: 'docker',
      phase: 'create',
      durationMs: 42,
      observedAtMs: 100,
      completed: true,
    },
  ]);
  expect(JSON.stringify(output)).not.toContain(requestId);
});

test('a failure before admission retains request phases without requiring an execution id', () => {
  const otherId = '10000000-0000-4000-8000-000000000003';
  const requestEvents = [
    {
      requestId,
      source: 'submission',
      phase: 'authorizeInitial',
      durationMs: 3,
      observedAtMs: 100,
      completed: false,
      privateCode: 'secret-code',
    },
    {
      requestId,
      source: 'submission',
      phase: 'total',
      durationMs: 4,
      observedAtMs: 100,
      completed: false,
    },
    { ...event, requestId: otherId },
  ];
  const projected = timingsForSample(requestEvents, { requestId });
  expect(projected).toEqual([
    {
      source: 'submission',
      phase: 'authorizeInitial',
      durationMs: 3,
      observedAtMs: 100,
      completed: false,
    },
    {
      source: 'submission',
      phase: 'total',
      durationMs: 4,
      observedAtMs: 100,
      completed: false,
    },
  ]);
  expect(JSON.stringify(projected)).not.toContain('secret-code');
  expect(JSON.stringify(projected)).not.toContain(requestId);
});

test('an HTTP failure infers the only execution of its request and preserves failed phases', () => {
  const otherId = '10000000-0000-4000-8000-000000000003';
  const requestPhase = {
    requestId,
    source: 'submission',
    phase: 'admit',
    durationMs: 2,
    observedAtMs: 100,
    completed: true,
  };
  const failed = {
    ...event,
    phase: 'wait',
    completed: false,
    privateError: 'secret-daemon-error',
  };
  const projected = timingsForSample(
    [
      requestPhase,
      event,
      failed,
      { ...event, requestId: otherId, executionId: otherId },
    ],
    { requestId },
  );
  expect(projected).toEqual([
    {
      source: 'submission',
      phase: 'admit',
      durationMs: 2,
      observedAtMs: 100,
      completed: true,
    },
    {
      source: 'docker',
      phase: 'create',
      durationMs: 42,
      observedAtMs: 100,
      completed: true,
    },
    {
      source: 'docker',
      phase: 'wait',
      durationMs: 42,
      observedAtMs: 100,
      completed: false,
    },
  ]);
  expect(JSON.stringify(projected)).not.toContain(requestId);
  expect(JSON.stringify(projected)).not.toContain(executionId);
  expect(JSON.stringify(projected)).not.toContain('secret');
});

test('ambiguous execution inference fails closed but an explicit execution remains isolated', () => {
  const otherId = '10000000-0000-4000-8000-000000000003';
  const requestPhase = {
    requestId,
    source: 'submission',
    phase: 'authorizeInitial',
    durationMs: 1,
    observedAtMs: 100,
    completed: true,
  };
  const events = [requestPhase, event, { ...event, executionId: otherId }];
  expect(timingsForSample(events, { requestId })).toEqual([]);
  expect(timingsForSample(events, { requestId, executionId })).toEqual([
    {
      source: 'submission',
      phase: 'authorizeInitial',
      durationMs: 1,
      observedAtMs: 100,
      completed: true,
    },
    {
      source: 'docker',
      phase: 'create',
      durationMs: 42,
      observedAtMs: 100,
      completed: true,
    },
  ]);
});

test.each([undefined, null, '', 'private-id', [requestId], requestId + '\n'])(
  'invalid request correlation %p returns no timings',
  (invalid) => {
    expect(
      timingsForSample([event], { requestId: invalid, executionId }),
    ).toEqual([]);
  },
);

test.each([null, '', 'private-id', [executionId], executionId + '\n'])(
  'an explicitly invalid execution correlation %p cannot fall back to inference',
  (invalid) => {
    expect(
      timingsForSample([event], { requestId, executionId: invalid }),
    ).toEqual([]);
  },
);

const submissionPhases = [
  'authorizeInitial',
  'inspect',
  'admit',
  'suite',
  'execute',
  'stage',
  'finish',
  'authorizeFinal',
  'total',
];
const dockerPhases = [
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
];
const requiredPhases = [
  ...submissionPhases.map((phase) => ['submission', phase]),
  ...dockerPhases.map((phase) => ['docker', phase]),
];

function completeTimings(capsuleCount) {
  return [
    ...submissionPhases.map((phase) => ({
      source: 'submission',
      phase,
      durationMs: 1,
      observedAtMs: 100,
      completed: true,
    })),
    ...Array.from({ length: capsuleCount }, () =>
      dockerPhases.map((phase) => ({
        source: 'docker',
        phase,
        durationMs: 1,
        observedAtMs: 100,
        completed: true,
      })),
    ).flat(),
  ];
}

test('complete timing coverage requires a successful submission and every phase of each capsule', () => {
  expect(hasCompleteSubmitTimings(completeTimings(1), 1)).toBe(true);
  expect(hasCompleteSubmitTimings(completeTimings(2), 2)).toBe(true);
  expect(hasCompleteSubmitTimings([], 2)).toBe(false);
});

test('resolution caches and fallback cleanup do not impose a fixed phase count', () => {
  const events = completeTimings(2);
  expect(hasCompleteSubmitTimings(events, 2)).toBe(true);
  for (const [source, phase] of [
    ['docker', 'engineResolve'],
    ['docker', 'imageResolve'],
    ['submission', 'cleanupFallback'],
  ])
    events.push(
      { source, phase, durationMs: 1, observedAtMs: 100, completed: true },
      { source, phase, durationMs: 1, observedAtMs: 100, completed: true },
    );
  expect(hasCompleteSubmitTimings(events, 2)).toBe(true);
});

test.each(requiredPhases)(
  'omitting one %s.%s phase leaves capsule timing coverage incomplete',
  (source, phase) => {
    const events = completeTimings(2);
    events.splice(
      events.findIndex(
        (item) => item.source === source && item.phase === phase,
      ),
      1,
    );
    expect(hasCompleteSubmitTimings(events, 2)).toBe(false);
  },
);

test.each(requiredPhases)(
  'a duplicate %s.%s phase cannot hide missing capsule evidence',
  (source, phase) => {
    const events = completeTimings(2);
    events.push({
      ...events.find((item) => item.source === source && item.phase === phase),
    });
    expect(hasCompleteSubmitTimings(events, 2)).toBe(false);
  },
);

test.each(requiredPhases)(
  'an incomplete %s.%s phase cannot count toward complete timing coverage',
  (source, phase) => {
    const events = completeTimings(2);
    events.find(
      (item) => item.source === source && item.phase === phase,
    ).completed = false;
    expect(hasCompleteSubmitTimings(events, 2)).toBe(false);
  },
);

test.each([1, 3])(
  'coverage rejects an incorrect expected capsule count of %i',
  (capsuleCount) => {
    expect(hasCompleteSubmitTimings(completeTimings(2), capsuleCount)).toBe(
      false,
    );
  },
);

test.each([undefined, null, 0, -1, 1.5, NaN, Infinity, '2'])(
  'coverage rejects an invalid capsule count of %p',
  (capsuleCount) => {
    expect(hasCompleteSubmitTimings(completeTimings(2), capsuleCount)).toBe(
      false,
    );
  },
);

test('unknown sources and JSON arrays cannot bypass the timing allowlist', () => {
  const input = [
    { ...event, source: '__proto__' },
    { ...event, source: 'constructor' },
    { ...event, requestId: [requestId] },
    { ...event, executionId: [executionId] },
    { ...event, requestId: requestId + '\n' },
  ]
    .map((value) => JSON.stringify(value))
    .join('\n');
  expect(submitTimingEvents(input)).toEqual({ events: [], rejected: 5 });
});

const counters = `cpu 10 0 5 80 5 0 0 0 9 0\ncpu0 10 0 5 80 5 0 0 0\nMemTotal: 1000 kB\nMemAvailable: 500 kB\nSwapTotal: 200 kB\nSwapFree: 100 kB\n8 0 sda 1 2 3 4 5 6 7 8 0 10 11\n8 1 sda1 1 2 3 4 5 6 7 8 0 10 11\nPRIVATE_VALUE=secret\n`;

test.each([undefined, null, -1, '100', [100]])(
  'request channel rejects invalid monotonic timestamp %p',
  (observedAtMs) => {
    expect(
      submitTimingEvents(JSON.stringify({ ...event, observedAtMs })),
    ).toEqual({ events: [], rejected: 1 });
  },
);

const backgroundEvent = {
  event: 'TEST_SUBMIT_BACKGROUND',
  version: 1,
  worker: 'SUBMIT',
  phase: 'sweep',
  durationMs: 15,
  observedAtMs: 100,
  completed: true,
  count: 0,
};
test('background channel excludes identities, payloads and malformed fields', () => {
  const input = [
    backgroundEvent,
    { ...backgroundEvent, requestId },
    { ...backgroundEvent, code: 'private-code' },
    { ...backgroundEvent, worker: 'constructor' },
    { ...backgroundEvent, phase: 'private-phase' },
    { ...backgroundEvent, count: -1 },
    { ...backgroundEvent, count: 0.5 },
    { ...backgroundEvent, count: 10001 },
    { ...backgroundEvent, count: '0' },
    { ...backgroundEvent, durationMs: 120001 },
    { ...backgroundEvent, durationMs: -1 },
    { ...backgroundEvent, observedAtMs: null },
    { ...backgroundEvent, observedAtMs: -1 },
    { ...backgroundEvent, completed: 'true' },
    { ...backgroundEvent, version: 2 },
  ]
    .map(JSON.stringify)
    .join('\n');
  expect(submitBackgroundEvents(input)).toEqual({
    events: [
      {
        worker: 'SUBMIT',
        phase: 'sweep',
        durationMs: 15,
        observedAtMs: 100,
        completed: true,
        count: 0,
      },
    ],
    rejected: 14,
  });
});

test('background overlap retains only intersecting intervals and preserves nested phases separately', () => {
  const total = {
    source: 'submission',
    phase: 'total',
    durationMs: 30,
    observedAtMs: 100,
    completed: true,
  };
  const background = submitBackgroundEvents(
    [
      backgroundEvent,
      {
        ...backgroundEvent,
        worker: 'RUN',
        phase: 'total',
        durationMs: 40,
        observedAtMs: 80,
      },
      { ...backgroundEvent, observedAtMs: 70 },
      { ...backgroundEvent, observedAtMs: 115 },
    ]
      .map(JSON.stringify)
      .join('\n'),
  ).events;
  expect(backgroundForSample([total], background)).toEqual([
    {
      worker: 'SUBMIT',
      phase: 'sweep',
      durationMs: 15,
      observedAtMs: 100,
      completed: true,
      count: 0,
      overlapMs: 15,
    },
    {
      worker: 'RUN',
      phase: 'total',
      durationMs: 40,
      observedAtMs: 80,
      completed: true,
      count: 0,
      overlapMs: 10,
    },
  ]);
  expect(backgroundForSample([], background)).toEqual([]);
  expect(backgroundForSample([total, total], background)).toEqual([]);
  expect(
    backgroundForSample([{ ...total, observedAtMs: undefined }], background),
  ).toEqual([]);
});

test('channels bound event volume and reject oversized lines and non JSON', () => {
  for (const [parser, value] of [
    [submitTimingEvents, event],
    [submitBackgroundEvents, backgroundEvent],
  ]) {
    const line = JSON.stringify(value);
    const parsed = parser(
      [line.repeat(40), value.event, ...Array(10001).fill(line)].join('\n'),
    );
    expect(parsed.events).toHaveLength(10000);
    expect(parsed.rejected).toBe(3);
  }
});
test('VM projection keeps numeric counters without double counting guest CPU or disk partitions', () => {
  const projected = linuxVmCounters(counters);
  expect(projected.cpuTicks).toEqual({ total: 100, idle: 80, ioWait: 5 });
  expect(projected.availableMemoryBytes).toBe(512000);
  expect(projected.disks).toHaveLength(1);
  expect(JSON.stringify(projected)).not.toContain('secret');
  expect(() => linuxVmCounters('private invalid output')).toThrow(
    'Invalid VM counters',
  );
});

test('workload projection keeps counts and CPU without publishing unrelated container identities', () => {
  const output = [
    { Name: 'supabase_db_alunza-edu-laboratorio-test', CPUPerc: '25.0%' },
    { Name: 'supabase_db_alunza-edu-laboratorio', CPUPerc: '2.5%' },
    { Name: 'private-other-project', CPUPerc: '7.5%', ID: 'private-id' },
  ]
    .map((value) => JSON.stringify(value))
    .join('\n');
  const projected = workloadCounters(output);
  expect(projected.groups.test).toEqual({
    containers: 1,
    cpuPercentOfSingleCore: 25,
  });
  expect(projected.groups.other).toEqual({
    containers: 1,
    cpuPercentOfSingleCore: 7.5,
  });
  expect(JSON.stringify(projected)).not.toContain('private');
});

test('VM observer refuses development, uses only fixed kernel paths and bounds failures', async () => {
  const execute = jest.fn(async () => ({ stdout: counters }));
  await expect(dockerVmSnapshot(developmentTarget, execute)).rejects.toThrow(
    'TEST',
  );
  expect(execute).not.toHaveBeenCalled();
  const snapshot = await dockerVmSnapshot(testTarget, execute);
  expect(snapshot.status).toBe('observed');
  expect(execute).toHaveBeenCalledWith(
    'docker',
    [
      'exec',
      'supabase_db_alunza-edu-laboratorio-test',
      'cat',
      '/proc/stat',
      '/proc/meminfo',
      '/proc/diskstats',
    ],
    expect.objectContaining({ timeout: 5000, maxBuffer: 131072 }),
  );
  execute.mockRejectedValue(new Error('private secret connection'));
  const unavailable = await dockerVmSnapshot(testTarget, execute);
  expect(unavailable.status).toBe('unavailable');
  expect(JSON.stringify(unavailable)).not.toContain('secret');
});
