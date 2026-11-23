import {
  createSubmitTimingObserver,
  measureSubmitPhase,
  createSubmitBackgroundObserver,
  measureSubmitBackgroundPhase,
} from './submit-observability';
import type { SubmitTimingObservation } from './submit-observability';

const requestId = '10000000-0000-4000-8000-000000000001';
const executionId = '10000000-0000-4000-8000-000000000002';
const timing: SubmitTimingObservation = {
  source: 'docker',
  phase: 'create',
  durationMs: 12.5,
  completed: true,
};
const failingClockCases = [
  [-1, true],
  [-1, false],
  [Number.NaN, true],
  [Number.NaN, false],
  [Number.POSITIVE_INFINITY, true],
  [Number.POSITIVE_INFINITY, false],
  ['throw', true],
  ['throw', false],
] as const;

describe('private TEST SUBMIT timing projection', () => {
  it.each([
    ['local', '1'],
    ['production', '1'],
    ['preproduction', '1'],
    ['evaluation', '1'],
    ['TEST', '1'],
    ['test', '0'],
    ['test', 'true'],
    ['test', ''],
  ])('stays disabled for environment=%s flag=%s', (environment, flag) => {
    const output = jest.fn();
    expect(
      createSubmitTimingObserver(environment, { requestId }, flag, output),
    ).toBeUndefined();
    expect(output).not.toHaveBeenCalled();
  });

  it('projects only allowlisted fields and adds execution correlation once known', () => {
    jest.spyOn(performance, 'now').mockReturnValue(42.5);
    const context = { requestId, executionId: undefined as string | undefined };
    const lines: string[] = [];
    const observe = createSubmitTimingObserver('test', context, '1', (line) => {
      lines.push(line);
    });
    const withPrivateFields = {
      ...timing,
      code: 'SECRET_CODE',
      args: ['SECRET_ARGUMENT'],
      hiddenTestId: 'SECRET_HIDDEN_TEST',
      capsuleName: 'SECRET_CAPSULE',
      error: new Error('SECRET_ERROR'),
      credentials: 'SECRET_CREDENTIAL',
      observedAtMs: 'SECRET_INPUT_TIMESTAMP',
    };
    observe?.(withPrivateFields);
    context.executionId = executionId;
    observe?.({
      source: 'submission',
      phase: 'stage',
      durationMs: 0,
      completed: false,
    });
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      {
        event: 'TEST_SUBMIT_TIMING',
        version: 2,
        observedAtMs: 42.5,
        requestId,
        ...timing,
      },
      {
        event: 'TEST_SUBMIT_TIMING',
        version: 2,
        observedAtMs: 42.5,
        requestId,
        executionId,
        source: 'submission',
        phase: 'stage',
        durationMs: 0,
        completed: false,
      },
    ]);
    expect(lines.join('')).not.toContain('SECRET_');
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    'drops an invalid emission timestamp %p without affecting the caller',
    (observedAtMs) => {
      jest.spyOn(performance, 'now').mockReturnValue(observedAtMs);
      const output = jest.fn();
      const observe = createSubmitTimingObserver(
        'test',
        { requestId },
        '1',
        output,
      );
      expect(() => observe?.(timing)).not.toThrow();
      expect(output).not.toHaveBeenCalled();
    },
  );

  it('does not propagate failure of the emission clock', () => {
    jest.spyOn(performance, 'now').mockImplementation(() => {
      throw new Error('PRIVATE_CLOCK_ERROR');
    });
    const output = jest.fn();
    const observe = createSubmitTimingObserver(
      'test',
      { requestId },
      '1',
      output,
    );
    expect(() => observe?.(timing)).not.toThrow();
    expect(output).not.toHaveBeenCalled();
  });

  it.each([
    { phase: 'unknown-SECRET_PHASE' },
    { phase: 'stage' },
    { source: 'submission', phase: 'create' },
    { source: 'unknown-SECRET_SOURCE' },
    { durationMs: -1 },
    { durationMs: Number.NaN },
    { durationMs: Number.POSITIVE_INFINITY },
    { durationMs: 'SECRET_DURATION' },
    { completed: 'SECRET_COMPLETION' },
  ])('drops an invalid source, phase or primitive %#', (patch) => {
    const output = jest.fn();
    const observe = createSubmitTimingObserver(
      'test',
      { requestId },
      '1',
      output,
    );
    observe?.({ ...timing, ...patch } as SubmitTimingObservation);
    expect(output).not.toHaveBeenCalled();
  });

  it.each([
    { requestId: 'SECRET_REQUEST' },
    { requestId, executionId: 'SECRET_EXECUTION' },
    { requestId: requestId + '\n' },
    { requestId: requestId + '\nSECRET_SUFFIX' },
  ])('drops invalid correlation rather than serializing it %#', (context) => {
    const output = jest.fn();
    createSubmitTimingObserver('test', context, '1', output)?.(timing);
    expect(output).not.toHaveBeenCalled();
  });

  it('tolerates stdout failure and does not expose its error', () => {
    const output = jest.fn(() => {
      throw new Error('SECRET_STDOUT_FAILURE');
    });
    const observe = createSubmitTimingObserver(
      'test',
      { requestId },
      '1',
      output,
    );
    expect(() => observe?.(timing)).not.toThrow();
    expect(output).toHaveBeenCalledTimes(1);
  });

  it('consumes an accidentally asynchronous stdout rejection', async () => {
    const output = jest.fn(async () => {
      throw new Error('PRIVATE_ASYNC_STDOUT_ERROR');
    });
    const observe = createSubmitTimingObserver(
      'test',
      { requestId },
      '1',
      output,
    );
    expect(() => observe?.(timing)).not.toThrow();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(output).toHaveBeenCalledTimes(1);
  });

  it('records rejected phases in finally and preserves the original rejection', async () => {
    jest
      .spyOn(performance, 'now')
      .mockReturnValueOnce(10)
      .mockReturnValueOnce(15);
    const observe = jest.fn();
    const original = new Error('PRIVATE_PROVIDER_ERROR');
    await expect(
      measureSubmitPhase(observe, 'execute', async () => {
        throw original;
      }),
    ).rejects.toBe(original);
    expect(observe).toHaveBeenCalledWith({
      source: 'submission',
      phase: 'execute',
      durationMs: 5,
      completed: false,
    });
  });

  it.each([true, false])(
    'a throwing observer never changes the operation (resolves=%s)',
    async (resolves) => {
      const observe = jest.fn(() => {
        throw new Error('PRIVATE_OBSERVER_ERROR');
      });
      const expected = { preserved: true };
      const original = new Error('PRIVATE_OPERATION_ERROR');
      const operation = measureSubmitPhase(observe, 'finish', async () => {
        if (!resolves) throw original;
        return expected;
      });
      if (resolves) await expect(operation).resolves.toBe(expected);
      else await expect(operation).rejects.toBe(original);
      expect(observe).toHaveBeenCalledWith(
        expect.objectContaining({ completed: resolves }),
      );
    },
  );

  it('does not read an additional clock when disabled', async () => {
    const now = jest.spyOn(performance, 'now');
    const expected = { preserved: true };
    await expect(
      measureSubmitPhase(undefined, 'total', async () => expected),
    ).resolves.toBe(expected);
    expect(now).not.toHaveBeenCalled();
  });

  it.each(failingClockCases)(
    'an invalid initial submission clock %p preserves the operation (resolves=%s)',
    async (clock, resolves) => {
      const now = jest.spyOn(performance, 'now');
      if (clock === 'throw')
        now.mockImplementation(() => {
          throw new Error('PRIVATE_CLOCK_ERROR');
        });
      else now.mockReturnValue(clock);
      const observer = jest.fn();
      const result = { preserved: true };
      const failure = new Error('PRIVATE_OPERATION_ERROR');
      const operation = jest.fn(async () => {
        if (!resolves) throw failure;
        return result;
      });
      const pending = measureSubmitPhase(observer, 'total', operation);
      if (resolves) await expect(pending).resolves.toBe(result);
      else await expect(pending).rejects.toBe(failure);
      expect(operation).toHaveBeenCalledTimes(1);
      expect(observer).not.toHaveBeenCalled();
    },
  );

  it.each(failingClockCases)(
    'an invalid final submission clock %p omits only observation (resolves=%s)',
    async (clock, resolves) => {
      const now = jest.spyOn(performance, 'now').mockReturnValueOnce(10);
      if (clock === 'throw')
        now.mockImplementationOnce(() => {
          throw new Error('PRIVATE_CLOCK_ERROR');
        });
      else now.mockReturnValueOnce(clock);
      const observer = jest.fn();
      const result = { preserved: true };
      const failure = new Error('PRIVATE_OPERATION_ERROR');
      const operation = jest.fn(async () => {
        if (!resolves) throw failure;
        return result;
      });
      const pending = measureSubmitPhase(observer, 'total', operation);
      if (resolves) await expect(pending).resolves.toBe(result);
      else await expect(pending).rejects.toBe(failure);
      expect(operation).toHaveBeenCalledTimes(1);
      expect(now).toHaveBeenCalledTimes(2);
      expect(observer).not.toHaveBeenCalled();
    },
  );

  it('consumes an accidentally asynchronous observer rejection without changing the operation', async () => {
    const observe = jest.fn(async () => {
      throw new Error('PRIVATE_ASYNC_OBSERVER_ERROR');
    });
    const expected = { preserved: true };
    await expect(
      measureSubmitPhase(observe, 'total', async () => expected),
    ).resolves.toBe(expected);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(observe).toHaveBeenCalledWith(
      expect.objectContaining({ completed: true }),
    );
  });
});

describe('private TEST SUBMIT clock anchors', () => {
  const submission: SubmitTimingObservation = {
    source: 'submission',
    phase: 'authorizeInitial',
    durationMs: 5,
    completed: true,
  };
  const utcMs = 1_700_000_000_000;

  it.each([
    ['local', '1', '1'],
    ['production', '1', '1'],
    ['preproduction', '1', '1'],
    ['evaluation', '1', '1'],
    ['TEST', '1', '1'],
    ['test', '0', '1'],
    ['test', 'true', '1'],
    ['test', '1', '0'],
    ['test', '1', 'true'],
    ['test', '1', ''],
  ])(
    'requires exact TEST and both opt-ins (%s, %s, %s)',
    (environment, timingFlag, continuousFlag) => {
      const now = jest.spyOn(performance, 'now').mockReturnValue(42);
      const utc = jest.spyOn(Date, 'now');
      const output = jest.fn();
      createSubmitTimingObserver(
        environment,
        { requestId },
        timingFlag,
        output,
        continuousFlag,
      )?.(submission);
      expect(utc).not.toHaveBeenCalled();
      const timingEnabled = environment === 'test' && timingFlag === '1';
      expect(now).toHaveBeenCalledTimes(timingEnabled ? 1 : 0);
      expect(output).toHaveBeenCalledTimes(timingEnabled ? 1 : 0);
      if (timingEnabled)
        expect(JSON.parse(output.mock.calls[0]![0]).event).toBe(
          'TEST_SUBMIT_TIMING',
        );
    },
  );

  it('reads the continuous opt-in from the process environment by default', () => {
    jest.replaceProperty(process, 'env', {
      ...process.env,
      ALUNZA_TEST_SUBMIT_TIMINGS: '1',
      ALUNZA_TEST_SUBMIT_CONTINUOUS_DIAGNOSTICS: '1',
    });
    jest.spyOn(performance, 'now').mockReturnValue(42);
    jest.spyOn(Date, 'now').mockReturnValue(utcMs);
    const output = jest.fn();
    createSubmitTimingObserver(
      'test',
      { requestId },
      undefined,
      output,
    )?.(submission);
    expect(output.mock.calls.map(([line]) => JSON.parse(line).event)).toEqual([
      'TEST_SUBMIT_CLOCK',
      'TEST_SUBMIT_TIMING',
    ]);
  });

  it('emits exact bounded anchors once, before the first submission event and total', () => {
    jest
      .spyOn(performance, 'now')
      .mockReturnValueOnce(10)
      .mockReturnValueOnce(12)
      .mockReturnValueOnce(13)
      .mockReturnValueOnce(14)
      .mockReturnValueOnce(20)
      .mockReturnValueOnce(22)
      .mockReturnValueOnce(23)
      .mockReturnValueOnce(24);
    const utc = jest
      .spyOn(Date, 'now')
      .mockReturnValueOnce(utcMs)
      .mockReturnValueOnce(utcMs + 10);
    const context = { requestId, executionId: undefined as string | undefined };
    const output = jest.fn();
    const observe = createSubmitTimingObserver(
      'test',
      context,
      '1',
      output,
      '1',
    );
    observe?.({
      ...submission,
      code: 'PRIVATE_CODE',
      args: ['PRIVATE_ARGUMENT'],
      utcMs: 'PRIVATE_INPUT_TIMESTAMP',
      uncertaintyMs: 'PRIVATE_UNCERTAINTY',
      endpoint: 'PRIVATE_ENDPOINT',
      credentials: 'PRIVATE_CREDENTIALS',
    } as SubmitTimingObservation);
    context.executionId = executionId;
    observe?.({ ...submission, phase: 'inspect' });
    observe?.({ ...submission, phase: 'total' });
    observe?.({ ...submission, phase: 'total' });
    const events = output.mock.calls.map(([line]) => JSON.parse(line));
    expect(events.map(({ event }) => event)).toEqual([
      'TEST_SUBMIT_CLOCK',
      'TEST_SUBMIT_TIMING',
      'TEST_SUBMIT_TIMING',
      'TEST_SUBMIT_CLOCK',
      'TEST_SUBMIT_TIMING',
      'TEST_SUBMIT_TIMING',
    ]);
    expect(events.filter(({ event }) => event === 'TEST_SUBMIT_CLOCK')).toEqual(
      [
        {
          event: 'TEST_SUBMIT_CLOCK',
          version: 1,
          requestId,
          boundary: 'start',
          monotonicMs: 11,
          utcMs,
          uncertaintyMs: 2,
        },
        {
          event: 'TEST_SUBMIT_CLOCK',
          version: 1,
          requestId,
          boundary: 'end',
          monotonicMs: 21,
          utcMs: utcMs + 10,
          uncertaintyMs: 2,
        },
      ],
    );
    expect(events[1]).toEqual({
      event: 'TEST_SUBMIT_TIMING',
      version: 2,
      requestId,
      observedAtMs: 13,
      ...submission,
    });
    expect(events[4].observedAtMs).toBe(23);
    expect(events[4].executionId).toBe(executionId);
    expect(utc).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(events)).not.toContain('PRIVATE_');
  });

  it('does not emit or sample clock anchors from a separate Docker observer', () => {
    const now = jest.spyOn(performance, 'now').mockReturnValue(42);
    const utc = jest.spyOn(Date, 'now').mockReturnValue(utcMs);
    const output = jest.fn();
    const context = { requestId, executionId };
    const docker = createSubmitTimingObserver(
      'test',
      context,
      '1',
      output,
      '1',
    );
    const submit = createSubmitTimingObserver(
      'test',
      context,
      '1',
      output,
      '1',
    );
    docker?.(timing);
    docker?.({ ...timing, phase: 'wait' });
    expect(utc).not.toHaveBeenCalled();
    expect(now).toHaveBeenCalledTimes(2);
    submit?.(submission);
    submit?.({ ...submission, phase: 'total' });
    expect(
      output.mock.calls
        .map(([line]) => JSON.parse(line))
        .filter(({ event }) => event === 'TEST_SUBMIT_CLOCK')
        .map(({ boundary }) => boundary),
    ).toEqual(['start', 'end']);
  });

  it.each([
    { requestId: 'PRIVATE_REQUEST' },
    { requestId, executionId: 'PRIVATE_EXECUTION' },
    { requestId: requestId + '\n' },
  ])('does not read either clock for invalid context %#', (context) => {
    const now = jest.spyOn(performance, 'now');
    const utc = jest.spyOn(Date, 'now');
    const output = jest.fn();
    createSubmitTimingObserver('test', context, '1', output, '1')?.(submission);
    expect(now).not.toHaveBeenCalled();
    expect(utc).not.toHaveBeenCalled();
    expect(output).not.toHaveBeenCalled();
  });

  it('does not consume the start anchor for a rejected observation', () => {
    const now = jest.spyOn(performance, 'now').mockReturnValue(42);
    const utc = jest.spyOn(Date, 'now').mockReturnValue(utcMs);
    const output = jest.fn();
    const observe = createSubmitTimingObserver(
      'test',
      { requestId },
      '1',
      output,
      '1',
    );
    observe?.({ ...submission, phase: 'PRIVATE_PHASE' });
    expect(now).not.toHaveBeenCalled();
    expect(utc).not.toHaveBeenCalled();
    observe?.(submission);
    expect(output.mock.calls.map(([line]) => JSON.parse(line).event)).toEqual([
      'TEST_SUBMIT_CLOCK',
      'TEST_SUBMIT_TIMING',
    ]);
  });

  it.each([0, 10])(
    'accepts the inclusive uncertainty boundary %s ms',
    (width) => {
      jest
        .spyOn(performance, 'now')
        .mockReturnValueOnce(20)
        .mockReturnValueOnce(20 + width)
        .mockReturnValue(42);
      jest.spyOn(Date, 'now').mockReturnValue(utcMs);
      const output = jest.fn();
      createSubmitTimingObserver(
        'test',
        { requestId },
        '1',
        output,
        '1',
      )?.(submission);
      expect(JSON.parse(output.mock.calls[0]![0])).toEqual({
        event: 'TEST_SUBMIT_CLOCK',
        version: 1,
        requestId,
        boundary: 'start',
        monotonicMs: 20 + width / 2,
        utcMs,
        uncertaintyMs: width,
      });
    },
  );

  it.each([
    { before: -1, after: 2, utc: utcMs },
    { before: Number.NaN, after: 2, utc: utcMs },
    { before: Number.POSITIVE_INFINITY, after: 2, utc: utcMs },
    { before: 2, after: Number.NaN, utc: utcMs },
    { before: 2, after: Number.POSITIVE_INFINITY, utc: utcMs },
    { before: 2, after: 1, utc: utcMs },
    { before: 2, after: 12.001, utc: utcMs },
    { before: 2, after: 3, utc: -1 },
    { before: 2, after: 3, utc: 1.5 },
    { before: 2, after: 3, utc: Number.NaN },
    { before: 2, after: 3, utc: Number.POSITIVE_INFINITY },
    { before: 2, after: 3, utc: Number.MAX_SAFE_INTEGER + 1 },
  ])('drops invalid clock alignment without suppressing TIMING %#', (clock) => {
    jest
      .spyOn(performance, 'now')
      .mockReturnValueOnce(clock.before)
      .mockReturnValueOnce(clock.after)
      .mockReturnValue(42);
    jest.spyOn(Date, 'now').mockReturnValue(clock.utc);
    const output = jest.fn();
    const observe = createSubmitTimingObserver(
      'test',
      { requestId },
      '1',
      output,
      '1',
    );
    expect(() => observe?.(submission)).not.toThrow();
    observe?.({ ...submission, phase: 'inspect' });
    expect(output.mock.calls.map(([line]) => JSON.parse(line).event)).toEqual([
      'TEST_SUBMIT_TIMING',
      'TEST_SUBMIT_TIMING',
    ]);
  });

  it.each(['before', 'utc', 'after'])(
    'tolerates a throwing %s clock and preserves TIMING',
    (clock) => {
      const now = jest.spyOn(performance, 'now').mockReturnValue(42);
      const utc = jest.spyOn(Date, 'now').mockReturnValue(utcMs);
      const fail = () => {
        throw new Error('PRIVATE_CLOCK_FAILURE');
      };
      if (clock === 'before') now.mockImplementationOnce(fail);
      if (clock === 'utc') utc.mockImplementationOnce(fail);
      if (clock === 'after')
        now.mockReturnValueOnce(40).mockImplementationOnce(fail);
      const output = jest.fn();
      const observe = createSubmitTimingObserver(
        'test',
        { requestId },
        '1',
        output,
        '1',
      );
      expect(() => observe?.(submission)).not.toThrow();
      expect(output.mock.calls.map(([line]) => JSON.parse(line).event)).toEqual(
        ['TEST_SUBMIT_TIMING'],
      );
    },
  );

  it.each(['throw', 'reject'])(
    'an anchor output %s does not replace operation results or original failures',
    async (kind) => {
      jest.spyOn(performance, 'now').mockReturnValue(42);
      jest.spyOn(Date, 'now').mockReturnValue(utcMs);
      const output = jest.fn((line: string) => {
        if (JSON.parse(line).event !== 'TEST_SUBMIT_CLOCK') return;
        const failure = new Error('PRIVATE_ANCHOR_OUTPUT_FAILURE');
        if (kind === 'throw') throw failure;
        return Promise.reject(failure);
      });
      const observe = createSubmitTimingObserver(
        'test',
        { requestId },
        '1',
        output,
        '1',
      );
      const result = { preserved: true };
      const failure = new Error('PRIVATE_OPERATION_FAILURE');
      await expect(
        measureSubmitPhase(observe, 'authorizeInitial', async () => result),
      ).resolves.toBe(result);
      await expect(
        measureSubmitPhase(observe, 'total', async () => {
          throw failure;
        }),
      ).rejects.toBe(failure);
      observe?.({ ...submission, phase: 'total' });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(output.mock.calls.map(([line]) => JSON.parse(line).event)).toEqual(
        [
          'TEST_SUBMIT_CLOCK',
          'TEST_SUBMIT_TIMING',
          'TEST_SUBMIT_CLOCK',
          'TEST_SUBMIT_TIMING',
          'TEST_SUBMIT_TIMING',
        ],
      );
      expect(JSON.stringify(output.mock.calls)).not.toContain('PRIVATE_');
    },
  );
});

type BackgroundObservation = Parameters<
  NonNullable<ReturnType<typeof createSubmitBackgroundObserver>>
>[0];

const background: BackgroundObservation = {
  phase: 'sweep',
  durationMs: 12.5,
  completed: true,
  count: 2,
};

describe('private TEST SUBMIT background timing projection', () => {
  it.each([
    ['local', '1'],
    ['production', '1'],
    ['preproduction', '1'],
    ['evaluation', '1'],
    ['TEST', '1'],
    ['test', '0'],
    ['test', 'true'],
    ['test', ''],
  ])('stays disabled for environment=%s flag=%s', (environment, flag) => {
    const output = jest.fn();
    expect(
      createSubmitBackgroundObserver(environment, 'SUBMIT', flag, output),
    ).toBeUndefined();
    expect(output).not.toHaveBeenCalled();
  });

  it.each(['RUN', 'SUBMIT'] as const)(
    'projects only counters and a monotonic emission timestamp for worker=%s',
    (worker) => {
      jest.spyOn(performance, 'now').mockReturnValue(0);
      const output = jest.fn();
      const observe = createSubmitBackgroundObserver(
        'test',
        worker,
        '1',
        output,
      );
      observe?.({
        ...background,
        requestId: 'SECRET_REQUEST',
        executionId: 'SECRET_EXECUTION',
        code: 'SECRET_CODE',
        hiddenTestId: 'SECRET_HIDDEN_TEST',
        credential: 'SECRET_CREDENTIAL',
        observedAtMs: 'SECRET_INPUT_TIMESTAMP',
      } as BackgroundObservation);
      expect(output).toHaveBeenCalledWith(
        JSON.stringify({
          event: 'TEST_SUBMIT_BACKGROUND',
          version: 1,
          worker,
          phase: 'sweep',
          observedAtMs: 0,
          durationMs: 12.5,
          completed: true,
          count: 2,
        }),
      );
      expect(output.mock.calls[0][0]).not.toContain('SECRET_');
    },
  );

  it.each(['total', 'sweep', 'purge', 'claim', 'recover'] as const)(
    'accepts the bounded background phase %s without an optional count',
    (phase) => {
      jest.spyOn(performance, 'now').mockReturnValue(20);
      const output = jest.fn();
      const observe = createSubmitBackgroundObserver(
        'test',
        'SUBMIT',
        '1',
        output,
      );
      observe?.({ phase, durationMs: 0, completed: false });
      expect(JSON.parse(output.mock.calls[0][0])).toEqual({
        event: 'TEST_SUBMIT_BACKGROUND',
        version: 1,
        worker: 'SUBMIT',
        phase,
        observedAtMs: 20,
        durationMs: 0,
        completed: false,
      });
    },
  );

  it.each([0, 10000])('accepts count at the inclusive boundary %i', (count) => {
    const output = jest.fn();
    createSubmitBackgroundObserver(
      'test',
      'RUN',
      '1',
      output,
    )?.({
      ...background,
      count,
    });
    expect(JSON.parse(output.mock.calls[0][0]).count).toBe(count);
  });

  it.each([
    { phase: 'SECRET_PHASE' },
    { phase: 'create' },
    { phase: ['total'] },
    { durationMs: -1 },
    { durationMs: Number.NaN },
    { durationMs: Number.POSITIVE_INFINITY },
    { durationMs: 'SECRET_DURATION' },
    { completed: 'SECRET_COMPLETION' },
    { count: -1 },
    { count: 10001 },
    { count: 1.5 },
    { count: Number.NaN },
    { count: Number.POSITIVE_INFINITY },
    { count: 'SECRET_COUNT' },
    { count: null },
  ])('drops invalid background primitives %#', (patch) => {
    const output = jest.fn();
    createSubmitBackgroundObserver(
      'test',
      'SUBMIT',
      '1',
      output,
    )?.({
      ...background,
      ...patch,
    } as BackgroundObservation);
    expect(output).not.toHaveBeenCalled();
  });

  it.each(['PRIVATE_WORKER', 'submit', 'RUN\n', '__proto__'])(
    'an invalid worker %s cannot appear in output',
    (worker) => {
      const output = jest.fn();
      createSubmitBackgroundObserver(
        'test',
        worker as 'RUN',
        '1',
        output,
      )?.(background);
      expect(output).not.toHaveBeenCalled();
    },
  );

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    'drops an invalid background emission timestamp %p without affecting the caller',
    (observedAtMs) => {
      jest.spyOn(performance, 'now').mockReturnValue(observedAtMs);
      const output = jest.fn();
      const observe = createSubmitBackgroundObserver(
        'test',
        'SUBMIT',
        '1',
        output,
      );
      expect(() => observe?.(background)).not.toThrow();
      expect(output).not.toHaveBeenCalled();
    },
  );

  it.each(['throw', 'rejected promise'])(
    'background output %s is isolated from the caller',
    async (kind) => {
      const output = jest.fn(() => {
        if (kind === 'throw') throw new Error('PRIVATE_STDOUT_ERROR');
        return Promise.reject(new Error('PRIVATE_STDOUT_ERROR'));
      });
      const observe = createSubmitBackgroundObserver(
        'test',
        'SUBMIT',
        '1',
        output,
      );
      expect(() => observe?.(background)).not.toThrow();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(output).toHaveBeenCalledTimes(1);
    },
  );

  it('measures a completed operation with its optional result count while preserving result identity', async () => {
    jest
      .spyOn(performance, 'now')
      .mockReturnValueOnce(10)
      .mockReturnValueOnce(15);
    const observer = jest.fn();
    const result = ['private-item-a', 'private-item-b'];
    const countOf = jest.fn((value: typeof result) => value.length);
    await expect(
      measureSubmitBackgroundPhase(
        observer,
        'claim',
        async () => result,
        countOf,
      ),
    ).resolves.toBe(result);
    expect(countOf).toHaveBeenCalledWith(result);
    expect(observer).toHaveBeenCalledWith({
      phase: 'claim',
      durationMs: 5,
      completed: true,
      count: 2,
    });
    expect(JSON.stringify(observer.mock.calls)).not.toContain('private-item');
  });

  it.each(['synchronous', 'asynchronous'])(
    'records an incomplete phase without a count and preserves the %s operation rejection',
    async (kind) => {
      const observer = jest.fn();
      const countOf = jest.fn(() => 1);
      const failure = new Error('PRIVATE_OPERATION_ERROR');
      const operation = () => {
        if (kind === 'synchronous') throw failure;
        return Promise.reject(failure);
      };
      await expect(
        measureSubmitBackgroundPhase(observer, 'recover', operation, countOf),
      ).rejects.toBe(failure);
      expect(countOf).not.toHaveBeenCalled();
      expect(observer).toHaveBeenCalledWith({
        phase: 'recover',
        durationMs: expect.any(Number),
        completed: false,
      });
      expect(JSON.stringify(observer.mock.calls)).not.toContain(
        failure.message,
      );
    },
  );

  it('a failing count projection omits only the count and preserves a successful operation', async () => {
    const observer = jest.fn();
    const result = { preserved: true };
    await expect(
      measureSubmitBackgroundPhase(
        observer,
        'purge',
        async () => result,
        () => {
          throw new Error('PRIVATE_COUNT_ERROR');
        },
      ),
    ).resolves.toBe(result);
    expect(observer).toHaveBeenCalledWith({
      phase: 'purge',
      durationMs: expect.any(Number),
      completed: true,
    });
  });

  it('an accidentally asynchronous count rejection is consumed without awaiting or changing the result', async () => {
    const observer = jest.fn();
    const result = { preserved: true };
    const countOf = jest.fn(async () => {
      throw new Error('PRIVATE_ASYNC_COUNT_ERROR');
    });
    await expect(
      measureSubmitBackgroundPhase(
        observer,
        'purge',
        async () => result,
        countOf as unknown as () => number,
      ),
    ).resolves.toBe(result);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(countOf).toHaveBeenCalledWith(result);
    expect(observer).toHaveBeenCalledWith({
      phase: 'purge',
      durationMs: expect.any(Number),
      completed: true,
    });
  });

  it.each([
    -1,
    10001,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    'PRIVATE_COUNT',
    null,
  ])(
    'an invalid derived count %p is omitted while the operation succeeds',
    async (count) => {
      const observer = jest.fn();
      const result = { preserved: true };
      await expect(
        measureSubmitBackgroundPhase(
          observer,
          'purge',
          async () => result,
          () => count as number,
        ),
      ).resolves.toBe(result);
      expect(observer).toHaveBeenCalledWith({
        phase: 'purge',
        durationMs: expect.any(Number),
        completed: true,
      });
    },
  );

  it.each(['throw', 'rejected promise'])(
    'background observer %s preserves successful results and original failures',
    async (kind) => {
      const observer = jest.fn((_observation: BackgroundObservation) => {
        if (kind === 'throw') throw new Error('PRIVATE_OBSERVER_ERROR');
        return Promise.reject(new Error('PRIVATE_OBSERVER_ERROR'));
      });
      const result = { preserved: true };
      const failure = new Error('PRIVATE_OPERATION_ERROR');
      await expect(
        measureSubmitBackgroundPhase(observer, 'total', async () => result),
      ).resolves.toBe(result);
      await expect(
        measureSubmitBackgroundPhase(observer, 'total', async () => {
          throw failure;
        }),
      ).rejects.toBe(failure);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(
        observer.mock.calls.map(([observation]) => observation.completed),
      ).toEqual([true, false]);
    },
  );

  it('disabled background timing does not read the clock or derive a count', async () => {
    const now = jest.spyOn(performance, 'now');
    const countOf = jest.fn(() => 1);
    const result = { preserved: true };
    await expect(
      measureSubmitBackgroundPhase(
        undefined,
        'claim',
        async () => result,
        countOf,
      ),
    ).resolves.toBe(result);
    expect(now).not.toHaveBeenCalled();
    expect(countOf).not.toHaveBeenCalled();
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    'an invalid initial clock %p disables diagnostics while the operation still succeeds',
    async (initialClock) => {
      jest.spyOn(performance, 'now').mockReturnValue(initialClock);
      const observer = jest.fn();
      const countOf = jest.fn(() => 1);
      const result = { preserved: true };
      await expect(
        measureSubmitBackgroundPhase(
          observer,
          'claim',
          async () => result,
          countOf,
        ),
      ).resolves.toBe(result);
      expect(observer).not.toHaveBeenCalled();
      expect(countOf).not.toHaveBeenCalled();
    },
  );

  it('a failing initial clock does not replace the operation rejection', async () => {
    jest.spyOn(performance, 'now').mockImplementation(() => {
      throw new Error('PRIVATE_CLOCK_ERROR');
    });
    const observer = jest.fn();
    const countOf = jest.fn(() => 1);
    const failure = new Error('PRIVATE_OPERATION_ERROR');
    await expect(
      measureSubmitBackgroundPhase(
        observer,
        'claim',
        async () => {
          throw failure;
        },
        countOf,
      ),
    ).rejects.toBe(failure);
    expect(observer).not.toHaveBeenCalled();
    expect(countOf).not.toHaveBeenCalled();
  });
});
