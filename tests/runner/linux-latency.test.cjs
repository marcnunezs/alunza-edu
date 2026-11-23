const assert = require('node:assert/strict');
const {
  breakdown,
  unionDuration,
  capsuleTimings,
  capsuleStartPercentiles,
  qemuReceiptId,
} = require('./linux-latency.cjs');

function event(phase, start, end, completed = true) {
  return { phase, end, durationMs: end - start, completed };
}

test('overlapping and disjoint wait/stream intervals use elapsed time once', () => {
  const streams = event('streams', 8, 13);
  const wait = event('wait', 10, 17);
  const laterCase = event('wait', 22, 26);
  assert.equal(unionDuration([laterCase, wait, streams]), 13);
  assert.equal(unionDuration([]), 0);
});

test('the wall-time partition excludes nested clocks and accounts for JS overhead', () => {
  const samples = [
    event('imageResolve', 0, 1),
    event('engineResolve', 1, 2),
    event('create', 2, 3),
    event('preInspect', 3, 4),
    event('attachOutput', 4, 5),
    event('attachInput', 5, 6),
    event('start', 6, 7),
    event('send', 7, 8),
    event('streams', 8, 13),
    event('wait', 10, 17),
    event('hostStartAttach', 6, 17),
    event('containerWall', 7, 16),
    event('supervisor', 9, 11),
    event('postInspect', 17, 18),
    event('delete', 18, 19),
    event('verifyAbsent', 19, 20),
  ];
  const result = breakdown(samples, 23, 1);
  assert.equal(result.complete, true);
  assert.equal(result.phaseMs.streamsWaitUnion, 9);
  assert.equal(result.phaseMs.unattributed, 3);
  assert.equal(result.overlayMs.supervisor, 2);
  assert.equal(
    Object.values(result.phaseMs).reduce((sum, s) => sum + s, 0),
    23,
  );
  assert.equal(breakdown(samples, 23, 2).complete, false);
  assert.equal(breakdown(samples.slice(1), 23, 1).complete, false);
  samples[3].completed = false;
  assert.equal(breakdown(samples, 23, 1).complete, false);
});

const cases = [{ visibility: 'visible' }, { visibility: 'hidden' }];
test('reports each capsule POST create and start independently including failed attempts', () => {
  const events = [
    event('engineResolve', 0, 1),
    event('create', 1, 3),
    event('start', 4, 10),
    event('verifyAbsent', 10, 11),
    event('engineResolve', 12, 13),
    event('create', 13, 16),
    event('start', 17, 29, false),
  ];
  const timings = capsuleTimings(events, cases);
  assert.deepEqual(timings, [
    {
      ordinal: 1,
      visibility: 'visible',
      attempted: true,
      createMs: 2,
      created: true,
      startMs: 6,
      started: true,
    },
    {
      ordinal: 2,
      visibility: 'hidden',
      attempted: true,
      createMs: 3,
      created: true,
      startMs: 12,
      started: false,
    },
  ]);
  const skipped = capsuleTimings(events.slice(0, 4), cases);
  assert.deepEqual(skipped[1], {
    ordinal: 2,
    visibility: 'hidden',
    attempted: false,
    createMs: null,
    created: false,
    startMs: null,
    started: false,
  });
  assert.throws(() => capsuleTimings([event('start', 1, 2)], cases));
  assert.throws(() =>
    capsuleTimings([...events, event('start', 30, 31)], cases),
  );
  const summaries = capsuleStartPercentiles([
    { caseTimings: timings },
    { caseTimings: skipped },
  ]);
  assert.deepEqual(summaries[1], {
    ordinal: 2,
    visibility: 'hidden',
    observed: 1,
    missing: 1,
    failed: 1,
    p50Ms: 12,
    p95Ms: 12,
  });
});

test('enforces QEMU manufacturer and correlates the canonical per-boot UUID', () => {
  const uuid = 'A704B217-8EE8-4B62-9261-DF15628C34BE';
  assert.equal(qemuReceiptId('QEMU\n', uuid + '\n'), uuid.toLowerCase());
  assert.throws(() => qemuReceiptId('VirtualBox', uuid));
  assert.throws(() =>
    qemuReceiptId('QEMU', '00000000-0000-0000-0000-000000000000'),
  );
});
