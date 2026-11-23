import { describe, expect, test } from '@jest/globals';
import {
  createPhaseHostObserver,
  readPhaseDiagnosticEvents,
} from '../../scripts/phase-observation.mjs';

describe('bounded local PHASE host observation', () => {
  test('samples at 1 Hz, retains both clocks and stops exactly once', () => {
    let clock = 10;
    let tick;
    let cancellations = 0;
    const observer = createPhaseHostObserver({
      now: () => clock,
      wall: () => 10000 + clock,
      snapshot: () => {
        clock += 2;
        return { freeMemoryBytes: 123 };
      },
      schedule: (callback, interval) => {
        expect(interval).toBe(1000);
        tick = callback;
        return 7;
      },
      cancel: (timer) => {
        expect(timer).toBe(7);
        cancellations++;
      },
    });
    clock = 1010;
    tick();
    clock = 2010;
    const result = observer.stop();
    expect(result.samples.map((sample) => sample.elapsedMs)).toEqual([
      0, 1000, 2000,
    ]);
    expect(result.samples.map((sample) => sample.timestampUnixMs)).toEqual([
      10010, 11010, 12010,
    ]);
    expect(result.totalSelfTimeMs).toBe(6);
    expect(result.failed).toBe(0);
    expect(observer.stop()).toBe(result);
    expect(cancellations).toBe(1);
  });

  test('records failures and overflow without fabricating samples', () => {
    let clock = 0;
    let tick;
    let calls = 0;
    const observer = createPhaseHostObserver({
      now: () => clock++,
      wall: () => 10000,
      snapshot: () => {
        if (++calls === 1) throw new Error('sensor absent');
        return {};
      },
      schedule: (callback) => {
        tick = callback;
      },
      cancel: () => {},
      maxSamples: 1,
    });
    tick();
    tick();
    const result = observer.stop();
    expect(result.failed).toBe(1);
    expect(result.dropped).toBe(2);
    expect(result.samples).toHaveLength(1);
    expect(result.totalSelfTimeMs).toBeGreaterThan(0);
  });

  test('charges all elapsed capture time even when CPU counters do not advance', () => {
    let clock = 0;
    let tick;
    const observer = createPhaseHostObserver({
      now: () => clock,
      wall: () => 10000 + clock,
      snapshot: () => {
        // A stalled capture still consumes elapsed time. CPU counters cannot
        // discount that interval or replace the observer's elapsed-cost gate.
        clock += 125;
        return { cpuTimeMs: { idle: 0, total: 0 } };
      },
      schedule: (callback) => {
        tick = callback;
      },
      cancel: () => {},
    });
    clock = 1000;
    tick();
    clock = 2000;
    const result = observer.stop();
    expect(result.samples.map((sample) => sample.host.cpuTimeMs)).toEqual([
      { idle: 0, total: 0 },
      { idle: 0, total: 0 },
      { idle: 0, total: 0 },
    ]);
    expect(result.samples.map((sample) => sample.observerSelfTimeMs)).toEqual([
      125, 250, 375,
    ]);
    expect(result.totalSelfTimeMs).toBe(375);
    expect(result.elapsedMs).toBe(2125);
    expect(result.failed).toBe(0);
    expect(result.dropped).toBe(0);
  });

  test('retains a delayed callback gap separately from capture self-cost', () => {
    let clock = 0;
    let tick;
    const observer = createPhaseHostObserver({
      now: () => clock,
      wall: () => 10000 + clock,
      snapshot: () => {
        clock += 5;
        return { freeMemoryBytes: 123 };
      },
      schedule: (callback, interval) => {
        expect(interval).toBe(1000);
        tick = callback;
      },
      cancel: () => {},
    });
    // Delivery is late; no synthetic intermediate observations fill the gap.
    clock = 2500;
    tick();
    clock = 3000;
    const result = observer.stop();
    expect(result.samples.map((sample) => sample.elapsedMs)).toEqual([
      0, 2500, 3000,
    ]);
    expect(result.samples.map((sample) => sample.timestampUnixMs)).toEqual([
      10000, 12500, 13000,
    ]);
    expect(result.samples.map((sample) => sample.observerSelfTimeMs)).toEqual([
      5, 10, 15,
    ]);
    expect(result.totalSelfTimeMs).toBe(15);
    expect(result.elapsedMs).toBe(3005);
    expect(result.failed).toBe(0);
    expect(result.dropped).toBe(0);
  });
});

test('event reader excludes unrelated output and reports truncation/malformed records', () => {
  const event = JSON.stringify({
    event: 'PHASE_DIAGNOSTIC_PROCESS',
    schemaVersion: 1,
  });
  const input = [
    'unrelated private log',
    event,
    '{"event":"PHASE_DIAGNOSTIC_REQUEST"',
    event,
  ].join('\n');
  const result = readPhaseDiagnosticEvents(input, { maxRecords: 1 });
  expect(result.events).toHaveLength(1);
  expect(result.malformed).toBe(1);
  expect(result.dropped).toBe(1);
  expect(JSON.stringify(result)).not.toContain('private');
  expect(
    readPhaseDiagnosticEvents(
      '{"event":"PHASE_DIAGNOSTIC_PROCESS","schemaVersion":2}',
    ).malformed,
  ).toBe(1);
  expect(
    readPhaseDiagnosticEvents('PHASE_DIAGNOSTIC_' + 'x'.repeat(32769))
      .malformed,
  ).toBe(1);
});
