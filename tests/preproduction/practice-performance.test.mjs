import { expect, test, jest } from '@jest/globals';
import { setImmediate } from 'node:timers';
import {
  percentile95,
  summarizeProfiles,
  performancePassed,
  assertPerformanceEnvironment,
  measureProfile,
  measureRequest,
  collectTimingEvents,
} from '../../scripts/practice-performance.mjs';

test('phase diagnostics preserve failed spans and correlation without private log fields', () => {
  const event = {
    event: 'TEST_SUBMIT_TIMING',
    version: 2,
    requestId: '30000000-0000-4000-8000-000000000001',
    executionId: '30000000-0000-4000-8000-000000000002',
    source: 'docker',
    phase: 'attachOutput',
    observedAtMs: 123,
    durationMs: 30,
    completed: false,
    code: 'PRIVATE_SOURCE',
    token: 'PRIVATE_TOKEN',
  };
  const background = {
    event: 'TEST_SUBMIT_BACKGROUND',
    version: 1,
    worker: 'SUBMIT',
    phase: 'sweep',
    observedAtMs: 150,
    durationMs: 10,
    completed: true,
    count: 0,
    message: 'PRIVATE_DETAILS',
  };
  const result = collectTimingEvents(
    [
      'ordinary PRIVATE_LOG',
      JSON.stringify(event),
      JSON.stringify(background),
    ].join('\n'),
    4,
  );
  expect(result).toHaveLength(2);
  expect(result[0]).toMatchObject({
    concurrency: 4,
    requestId: event.requestId,
    executionId: event.executionId,
    completed: false,
  });
  expect(result[1]).toMatchObject({ source: 'background', count: 0 });
  expect(JSON.stringify(result)).not.toContain('PRIVATE');
  for (const invalid of [
    { ...event, phase: 'PRIVATE_SOURCE' },
    { ...event, requestId: 'PRIVATE_TOKEN' },
    { ...event, executionId: 'private' },
    { ...event, durationMs: -1 },
    { ...event, observedAtMs: null },
    { ...event, version: 1 },
    { ...background, worker: 'private' },
    { ...background, count: 10001 },
  ])
    expect(collectTimingEvents(JSON.stringify(invalid), 1)).toEqual([]);
  expect(() => collectTimingEvents('', 2)).toThrow();
});

test('nearest-rank uses all observations without rounding the threshold', () => {
  const values = Array.from({ length: 50 }, (_, index) => index + 1);
  expect(percentile95(values)).toBe(48);
  expect(percentile95([])).toBeNull();
  const samples = values.map((durationMs, index) => ({
    concurrency: 1,
    index,
    durationMs,
    valid: index !== 49,
    temperature: index === 0 ? 'cold-service' : 'warm-service',
  }));
  const result = summarizeProfiles(samples)[0];
  expect(result).toMatchObject({
    count: 50,
    failed: 1,
    p95Ms: 48,
    coldP95Ms: 1,
  });
});

function successfulSummary() {
  return {
    mode: 'SUBMIT',
    cleanupVerified: true,
    runner: { imageUnchanged: true },
    distinctExecutions: 100,
    distinctAttempts: 100,
    profiles: [1, 4].map((concurrency) => ({
      concurrency,
      count: 50,
      failed: 0,
      p95Ms: 4999.999,
    })),
  };
}
test('acceptance requires both complete profiles, no failures, fresh results and cleanup', () => {
  expect(performancePassed(successfulSummary())).toBe(true);
  for (const override of [
    { cleanupVerified: false },
    { runner: { imageUnchanged: false } },
    { distinctExecutions: 99 },
    { distinctAttempts: 99 },
  ])
    expect(performancePassed({ ...successfulSummary(), ...override })).toBe(
      false,
    );
  for (const override of [
    { count: 49 },
    { failed: 1 },
    { p95Ms: 5000 },
    { p95Ms: null },
  ]) {
    const summary = successfulSummary();
    summary.profiles[1] = { ...summary.profiles[1], ...override };
    expect(performancePassed(summary)).toBe(false);
  }
});

test('development and remote contexts are rejected before using credentials', () => {
  const ctx = { test: true, apiPort: 4100 };
  const state = {
    projectId: 'alunza-edu-foundation-test',
    authUrl: 'http://127.0.0.1:16421',
    migrationUrl: 'postgres://fixture@127.0.0.1:16422/postgres',
  };
  expect(() => assertPerformanceEnvironment(ctx, state)).not.toThrow();
  expect(() =>
    assertPerformanceEnvironment({ ...ctx, test: false }, state),
  ).toThrow();
  expect(() =>
    assertPerformanceEnvironment(ctx, {
      ...state,
      projectId: 'alunza-edu-foundation',
    }),
  ).toThrow();
  expect(() =>
    assertPerformanceEnvironment(ctx, {
      ...state,
      migrationUrl: 'postgres://fixture@example.test:16422/postgres',
    }),
  ).toThrow();
});

test('concurrent profile produces fifty observations with four distinct single-request lanes', async () => {
  const actors = Array.from({ length: 4 }, (_, id) => ({ id }));
  const active = new Set();
  const seen = new Set();
  let maximum = 0;
  const samples = [];
  await measureProfile({
    concurrency: 4,
    actors,
    samples,
    measure: async (actor) => {
      expect(active.has(actor.id)).toBe(false);
      active.add(actor.id);
      seen.add(actor.id);
      maximum = Math.max(maximum, active.size);
      await new Promise((done) => setImmediate(done));
      active.delete(actor.id);
      return { valid: true, durationMs: 100 };
    },
  });
  expect(samples).toHaveLength(50);
  expect(new Set(samples.map((sample) => sample.index)).size).toBe(50);
  expect(
    samples.filter((sample) => sample.temperature === 'cold-service'),
  ).toHaveLength(4);
  expect(seen.size).toBe(4);
  expect(maximum).toBe(4);
  await expect(
    measureProfile({
      concurrency: 4,
      actors: actors.map(() => ({ id: 1 })),
      samples: [],
      measure: jest.fn(),
    }),
  ).rejects.toThrow();
});

const actor = {
  id: 'student',
  token: 'PRIVATE_TOKEN',
  path: '/api/v1/fixture',
  body: { code: 'PRIVATE_SOURCE', exerciseVersionId: 'version' },
  runnerVersion: 'runner',
};
const schema = { safeParse: () => ({ success: false }) };
test.each([
  [429, { error: { code: 'RATE_LIMITED' } }, 'RATE_LIMITED'],
  [
    500,
    { error: { code: 'PRIVATE_TOKEN https://secret.test' } },
    'INVALID_HTTP_RESPONSE',
  ],
])(
  'failed HTTP %i remains a measured, sanitized sample',
  async (status, body, code) => {
    let tick = 0;
    const sample = await measureRequest({
      baseUrl: 'http://127.0.0.1',
      actor,
      mode: 'RUN',
      schema,
      clock: () => (tick += 125),
      fetcher: async () => new Response(JSON.stringify(body), { status }),
    });
    expect(sample).toMatchObject({
      status,
      valid: false,
      durationMs: 125,
      errorCode: code,
    });
    expect(JSON.stringify(sample)).not.toContain('PRIVATE');
  },
);
test('a client deadline is counted and each intentional request gets a fresh key', async () => {
  const keys = new Set();
  for (let i = 0; i < 2; i++) {
    const sample = await measureRequest({
      baseUrl: 'http://127.0.0.1',
      actor,
      mode: 'RUN',
      schema,
      fetcher: async (_url, options) => {
        keys.add(options.headers['Idempotency-Key']);
        expect(options.redirect).toBe('error');
        throw Object.assign(new Error('PRIVATE_TOKEN'), {
          name: 'TimeoutError',
        });
      },
    });
    expect(sample).toMatchObject({
      status: 0,
      valid: false,
      errorCode: 'CLIENT_DEADLINE',
    });
    expect(sample.durationMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(sample)).not.toContain('PRIVATE');
  }
  expect(keys.size).toBe(2);
});

test('SUBMIT counts success only for persisted scope, version, code and hidden checks', async () => {
  const submitActor = {
    ...actor,
    activityId: 'activity',
    assignmentId: 'assignment',
  };
  const record = {
    activityId: 'activity',
    assignmentId: 'assignment',
    exerciseVersionId: 'version',
    code: actor.body.code,
    executionId: 'execution',
    attemptId: 'attempt',
    technicalResult: {
      diagnosisCode: 'SUCCESS',
      runnerVersion: 'runner',
      infrastructureStatus: 'OK',
      terminationReason: 'COMPLETED',
      visibleTotal: 1,
      visiblePassed: 1,
      allRequiredPassed: true,
      hiddenChecksPassed: true,
      runtimeMs: 12,
      lifecycleMs: 30,
    },
  };
  async function measure(value, cacheControl = 'no-store') {
    return measureRequest({
      baseUrl: 'http://127.0.0.1',
      actor: submitActor,
      mode: 'SUBMIT',
      schema: { safeParse: () => ({ success: true, data: { data: value } }) },
      fetcher: async () =>
        new Response('{}', {
          status: 201,
          headers: { 'cache-control': cacheControl },
        }),
    });
  }
  expect((await measure(record)).valid).toBe(true);
  expect((await measure({ ...record, code: 'different code' })).valid).toBe(
    false,
  );
  expect(
    (await measure({ ...record, assignmentId: 'other assignment' })).valid,
  ).toBe(false);
  expect(
    (
      await measure({
        ...record,
        technicalResult: {
          ...record.technicalResult,
          hiddenChecksPassed: false,
        },
      })
    ).valid,
  ).toBe(false);
  expect((await measure(record, 'public')).valid).toBe(false);
});
