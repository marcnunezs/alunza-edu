import {
  submitClockEvents,
  alignSubmitTimings,
  linuxVmCounters,
} from '../../scripts/submit-measurements.mjs';
import { submitEnvironmentManifest } from '../../scripts/submit-environment.mjs';

const requestId = '10000000-0000-4000-8000-000000000001';
const clock = {
  event: 'TEST_SUBMIT_CLOCK',
  version: 1,
  requestId,
  boundary: 'start',
  monotonicMs: 50,
  utcMs: 1000050,
  uncertaintyMs: 0.1,
};
const anchors = [
  clock,
  { ...clock, boundary: 'end', monotonicMs: 100, utcMs: 1000100 },
];
const window = {
  startedAtMs: 1000,
  finishedAtMs: 1070,
  startedAtUtcMs: 1000040,
  finishedAtUtcMs: 1000110,
};
const timings = [
  { source: 'docker', phase: 'start', durationMs: 30, observedAtMs: 90 },
  { source: 'docker', phase: 'supervisor', durationMs: 30, observedAtMs: 100 },
];

test('private clock parser projects only the bounded allowlisted wire', () => {
  const parsed = submitClockEvents(
    `${JSON.stringify(clock)}\nnot a clock\n${JSON.stringify(anchors[1])}`,
  );
  expect(parsed.rejected).toBe(0);
  expect(parsed.events).toEqual(anchors);
});
test.each([
  { code: 'private-code' },
  { token: 'secret' },
  { requestId: 'bad' },
  { boundary: 'private' },
  { utcMs: -1 },
  { utcMs: 1.5 },
  { monotonicMs: -1 },
  { monotonicMs: null },
  { uncertaintyMs: 11 },
  { uncertaintyMs: -1 },
  { version: 2 },
])('rejects invalid or private fields %j without copying them', (change) => {
  expect(submitClockEvents(JSON.stringify({ ...clock, ...change }))).toEqual({
    events: [],
    rejected: 1,
  });
});
test('malformed and oversized clock lines cannot enter report', () => {
  const parsed = submitClockEvents(
    `TEST_SUBMIT_CLOCK invalid\nTEST_SUBMIT_CLOCK ${'x'.repeat(1024)}`,
  );
  expect(parsed).toEqual({ events: [], rejected: 2 });
});
test('different monotonic origins align measured spans with HTTP and retain derived publication semantics', () => {
  const value = alignSubmitTimings(timings, anchors, { requestId }, window);
  expect(value.status).toBe('observed');
  expect(value.intervals[0]).toEqual({
    source: 'docker',
    phase: 'start',
    timingSemantics: 'measured-host-span',
    startedAtMs: 1020,
    finishedAtMs: 1050,
  });
  expect(value.intervals[1]).toEqual({
    source: 'docker',
    phase: 'supervisor',
    timingSemantics: 'derived-duration-published',
    startedAtMs: null,
    finishedAtMs: 1060,
  });
  expect(JSON.stringify(value)).not.toContain(requestId);
  expect(value.anchors.api).toEqual(
    anchors.map(({ boundary, monotonicMs, utcMs, uncertaintyMs }) => ({
      boundary,
      monotonicMs,
      utcMs,
      uncertaintyMs,
    })),
  );
  expect(value.anchors.harness[0]).toEqual({
    boundary: 'start',
    monotonicMs: 1000,
    utcMs: 1000040,
    uncertaintyMs: 0,
  });
});
test.each(
  [
    [],
    [clock],
    [clock, clock, anchors[1]],
    [
      clock,
      { ...anchors[1], requestId: '10000000-0000-4000-8000-000000000002' },
    ],
  ].map((values) => [values]),
)(
  'missing or ambiguous anchors yield unavailable, not a zero interval',
  (values) => {
    expect(
      alignSubmitTimings(timings, values, { requestId }, window).status,
    ).toBe('unavailable');
  },
);
test('wall clock jumps prevent invented cross-process alignment', () => {
  const apiJump = alignSubmitTimings(
    timings,
    [clock, { ...anchors[1], utcMs: 1001100 }],
    { requestId },
    window,
  );
  expect(apiJump).toMatchObject({
    status: 'partial',
    clockJump: true,
    intervals: [],
  });
  expect(apiJump.anchors.api[1].utcMs).toBe(1001100);
  expect(JSON.stringify(apiJump)).not.toContain(requestId);
  const hostJump = alignSubmitTimings(
    timings,
    anchors,
    { requestId },
    { ...window, finishedAtUtcMs: 1001110 },
  );
  expect(hostJump).toMatchObject({
    status: 'partial',
    clockJump: true,
    intervals: [],
  });
});
test('harness clock scheduling delay retains measured uncertainty instead of reporting a UTC jump', () => {
  const value = alignSubmitTimings(
    timings,
    anchors,
    { requestId },
    {
      ...window,
      startedClockMs: 1010,
      startedClockUncertaintyMs: 20,
      finishedClockMs: 1070,
      finishedClockUncertaintyMs: 0,
    },
  );
  expect(value.status).toBe('observed');
  expect(value.clockJump).toBe(false);
  expect(value.uncertaintyMs).toBeGreaterThanOrEqual(20);
});
test('invalid harness uncertainty is unavailable', () => {
  expect(
    alignSubmitTimings(
      timings,
      anchors,
      { requestId },
      { ...window, startedClockUncertaintyMs: -1 },
    ).status,
  ).toBe('unavailable');
});
test.each(['8 0 sdb 1 2 invalid 4 5 6 7 8 0 10 11', '8 0 sdb 1 2 3'])(
  'a malformed recognized disk cannot disappear behind valid counters',
  (disk) => {
    const raw = `cpu 10 0 5 80 5 0 0 0\ncpu0 10 0 5 80 5 0 0 0\nMemTotal: 1000 kB\nMemAvailable: 500 kB\nSwapTotal: 200 kB\nSwapFree: 100 kB\n8 0 sda 1 2 3 4 5 6 7 8 0 10 11\n${disk}\n`;
    expect(() => linuxVmCounters(raw)).toThrow('Invalid VM disk counters');
  },
);
test('invalid correlation and reverse HTTP interval produce unavailable', () => {
  expect(
    alignSubmitTimings(timings, anchors, { requestId: 'invalid' }, window)
      .status,
  ).toBe('unavailable');
  expect(
    alignSubmitTimings(
      timings,
      anchors,
      { requestId },
      { ...window, finishedAtMs: 999 },
    ).status,
  ).toBe('unavailable');
});

const dockerInfo = {
  NCPU: 12,
  MemTotal: 16520810496,
  ServerVersion: '29.7.2',
  Driver: 'overlayfs',
  KernelVersion: 'wsl2',
  HTTPProxy: 'private-proxy',
};
const inventory = [
  {
    ID: 'a',
    Names: 'db_alunza-edu-laboratorio',
    Image: 'db:v1',
    State: 'running',
  },
  {
    ID: 'b',
    Names: 'db_alunza-edu-laboratorio-test',
    Image: 'db:v1',
    State: 'running',
  },
  { ID: 'c', Names: 'private-other', Image: 'private-image', State: 'running' },
];
function execute(info = dockerInfo, containers = inventory) {
  return async (_command, args) => ({
    stdout:
      args[0] === 'info'
        ? JSON.stringify(info)
        : containers.map(JSON.stringify).join('\n'),
  });
}
test('environment report retains effective VM and opaque workload identity, excludes private names and config', async () => {
  const value = await submitEnvironmentManifest(execute());
  expect(value.docker).toEqual({
    cpus: 12,
    memoryBytes: 16520810496,
    serverVersion: '29.7.2',
    driver: 'overlayfs',
    kernelVersion: 'wsl2',
  });
  expect(value.workloadCounts).toEqual({ test: 1, laboratory: 1, other: 1 });
  expect(value.workloadFingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(value)).not.toMatch(/private|db:v1|proxy/);
});
test('TEST reconstruction and inventory order do not alter unrelated workload fingerprint', async () => {
  const before = await submitEnvironmentManifest(execute());
  const after = await submitEnvironmentManifest(
    execute(dockerInfo, [
      inventory[2],
      { ...inventory[1], ID: 'new-test' },
      inventory[0],
    ]),
  );
  expect(before.workloadFingerprint).toBe(after.workloadFingerprint);
});
test('change to unrelated image or container identity is detected', async () => {
  const before = await submitEnvironmentManifest(execute());
  const after = await submitEnvironmentManifest(
    execute(dockerInfo, [
      ...inventory.slice(0, 2),
      { ...inventory[2], Image: 'new-image' },
    ]),
  );
  expect(before.workloadFingerprint).not.toBe(after.workloadFingerprint);
});
test.each([
  { State: 'exited' },
  { State: 'running', Status: 'Up (Paused)' },
  { State: 'restarting' },
])('change to unrelated workload state is detected %j', async (change) => {
  const before = await submitEnvironmentManifest(execute());
  const after = await submitEnvironmentManifest(
    execute(dockerInfo, [
      ...inventory.slice(0, 2),
      { ...inventory[2], ...change },
    ]),
  );
  expect(before.workloadFingerprint).not.toBe(after.workloadFingerprint);
});
test('unknown workload state fails observation', async () => {
  await expect(
    submitEnvironmentManifest(
      execute(dockerInfo, [{ ...inventory[0], State: 'private-state' }]),
    ),
  ).rejects.toThrow('Invalid Docker environment');
});
test.each([
  { NCPU: 0 },
  { MemTotal: null },
  { ServerVersion: 'x'.repeat(201) },
  { Driver: null },
])('invalid effective Docker facts fail preparation', async (change) => {
  await expect(
    submitEnvironmentManifest(execute({ ...dockerInfo, ...change })),
  ).rejects.toThrow('Invalid Docker environment');
});
