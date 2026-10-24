const { performance } = require('node:perf_hooks');
const { setImmediate } = require('node:timers');

let timing;
beforeAll(async () => {
  timing = await import('../../infra/runner/timing.mjs');
});

afterEach(() => jest.restoreAllMocks());

function expectObservation(value, phase, completed) {
  expect(Object.keys(value).sort()).toEqual([
    'completed',
    'durationMs',
    'phase',
  ]);
  expect(value).toMatchObject({ phase, completed });
  expect(Number.isFinite(value.durationMs)).toBe(true);
  expect(value.durationMs).toBeGreaterThanOrEqual(0);
}

test('Timing retains the result identity and publishes only a duration and completion flag', async () => {
  const value = { code: 'private student code', args: ['hidden test input'] };
  const observed = [];
  await expect(
    timing.measureTiming(
      (event) => observed.push(event),
      'create',
      () => value,
    ),
  ).resolves.toBe(value);
  expect(observed).toHaveLength(1);
  expectObservation(observed[0], 'create', true);
  expect(JSON.stringify(observed)).not.toContain('private student code');
  expect(JSON.stringify(observed)).not.toContain('hidden test input');
});

test.each(['synchronous', 'asynchronous'])(
  'Timing retains the original %s rejection and records an incomplete phase',
  async (kind) => {
    const failure = new Error('private daemon diagnostic');
    const observed = [];
    const operation = () => {
      if (kind === 'synchronous') throw failure;
      return Promise.reject(failure);
    };
    await expect(
      timing.measureTiming((event) => observed.push(event), 'start', operation),
    ).rejects.toBe(failure);
    expect(observed).toHaveLength(1);
    expectObservation(observed[0], 'start', false);
    expect(JSON.stringify(observed)).not.toContain(failure.message);
  },
);

test('Measurement uses the monotonic clock even when wall time moves backwards', async () => {
  jest
    .spyOn(performance, 'now')
    .mockReturnValueOnce(100)
    .mockReturnValueOnce(140);
  jest.spyOn(Date, 'now').mockReturnValueOnce(2000).mockReturnValueOnce(1);
  const observe = jest.fn();
  await expect(
    timing.measureTiming(observe, 'wait', async () => 'confirmed'),
  ).resolves.toBe('confirmed');
  expect(observe).toHaveBeenCalledWith({
    phase: 'wait',
    durationMs: 40,
    completed: true,
  });
  expect(Date.now).not.toHaveBeenCalled();
});

test('Without an observer the operation executes once without reading the timing clock', async () => {
  const clock = jest.spyOn(performance, 'now');
  const operation = jest.fn(async () => ({ unchanged: true }));
  await expect(
    timing.measureTiming(undefined, 'create', operation),
  ).resolves.toEqual({ unchanged: true });
  expect(operation).toHaveBeenCalledTimes(1);
  expect(clock).not.toHaveBeenCalled();
});

test.each([
  ['initial', 'fulfilled'],
  ['initial', 'rejected'],
  ['final', 'fulfilled'],
  ['final', 'rejected'],
])(
  'A failed %s clock preserves the %s operation and its cleanup',
  async (position, outcome) => {
    const clock = jest.spyOn(performance, 'now');
    if (position === 'final') clock.mockReturnValueOnce(100);
    clock.mockImplementationOnce(() => {
      throw new Error('private clock failure');
    });
    const value = { retained: true };
    const failure = new Error('original operation failure');
    const cleanup = jest.fn();
    const operation = jest.fn(async () => {
      try {
        if (outcome === 'rejected') throw failure;
        return value;
      } finally {
        cleanup();
      }
    });
    const observe = jest.fn();
    const result = timing.measureTiming(observe, 'delete', operation);
    if (outcome === 'rejected') await expect(result).rejects.toBe(failure);
    else await expect(result).resolves.toBe(value);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(observe).not.toHaveBeenCalled();
    expect(clock).toHaveBeenCalledTimes(position === 'initial' ? 1 : 2);
  },
);

test.each([NaN, Infinity, -1])(
  'An invalid clock value %s omits the observation without changing the result',
  async (value) => {
    jest.spyOn(performance, 'now').mockReturnValueOnce(value);
    const observe = jest.fn();
    const operation = jest.fn(async () => true);
    await expect(
      timing.measureTiming(observe, 'verifyAbsent', operation),
    ).resolves.toBe(true);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(observe).not.toHaveBeenCalled();
  },
);

test.each(['throw', 'rejected promise'])(
  'An observer %s changes neither a result nor the operation rejection',
  async (kind) => {
    const observerFailure = new Error('observer failed');
    const observe = jest.fn(() => {
      if (kind === 'throw') throw observerFailure;
      return Promise.reject(observerFailure);
    });
    const value = { retained: true };
    const operationFailure = new Error('operation failed');
    await expect(
      timing.measureTiming(observe, 'create', async () => value),
    ).resolves.toBe(value);
    await expect(
      timing.measureTiming(observe, 'delete', async () => {
        throw operationFailure;
      }),
    ).rejects.toBe(operationFailure);
    // Let asynchronous observer failures reach the unhandled-rejection turn.
    await new Promise((resolve) => setImmediate(resolve));
    expect(observe).toHaveBeenCalledTimes(2);
    expectObservation(observe.mock.calls[0][0], 'create', true);
    expectObservation(observe.mock.calls[1][0], 'delete', false);
  },
);

test('An unfinished asynchronous observer does not delay the operation or cleanup', async () => {
  const observe = () => new Promise(() => {});
  await expect(
    timing.measureTiming(observe, 'verifyAbsent', async () => true),
  ).resolves.toBe(true);
});

test('Direct duration observations use the same restricted event contract', () => {
  const observe = jest.fn();
  timing.observeDuration(observe, 'containerWall', 123.5);
  timing.observeDuration(observe, 'supervisor', 0, false);
  expect(observe.mock.calls).toEqual([
    [{ phase: 'containerWall', durationMs: 123.5, completed: true }],
    [{ phase: 'supervisor', durationMs: 0, completed: false }],
  ]);
});

test('Invalid phases and durations cannot become telemetry or alter an operation', async () => {
  const observe = jest.fn();
  for (const phase of [
    'private student code',
    'hidden-test-expected-value',
    '__proto__',
    '',
    undefined,
  ]) {
    timing.observeDuration(observe, phase, 1);
    await expect(
      timing.measureTiming(observe, phase, async () => 'retained'),
    ).resolves.toBe('retained');
  }
  for (const duration of [-1, NaN, Infinity, -Infinity, '10', null])
    timing.observeDuration(observe, 'create', duration);
  expect(observe).not.toHaveBeenCalled();
});
