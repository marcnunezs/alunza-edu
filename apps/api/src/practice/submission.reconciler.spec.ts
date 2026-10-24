import { SubmissionReconciler } from './submission.reconciler';
import { SubmissionRepository } from './submission.repository';
import { ExecutionPort } from './execution.port';
import type { AppConfig } from '../config';

function setup(stagedResult = true, cleaned = true, environment = 'test') {
  const reservation = {
    executionId: 'execution',
    leaseToken: 'token',
    runnerVersion: 'unit',
    visibleTotal: 1,
    stagedResult,
  };
  const repository = {
    purgeExpired: jest.fn(),
    claimExpired: jest
      .fn()
      .mockResolvedValueOnce(reservation)
      .mockResolvedValue(null),
    stage: jest.fn().mockResolvedValue(true),
    finish: jest.fn(),
  };
  const execution = {
    sweepExpired: jest
      .fn()
      .mockResolvedValue({ cleanupVerified: true, removed: 0 }),
    cleanup: jest.fn().mockResolvedValue(cleaned),
    execute: jest.fn(),
  };
  const worker = new SubmissionReconciler(
    repository as unknown as SubmissionRepository,
    execution as unknown as ExecutionPort,
    { environment, practiceRunnerEnabled: false } as AppConfig,
  );
  return { reservation, repository, execution, worker };
}
describe('SUBMIT durable recovery', () => {
  it('finishes existing normalized evidence without replacing it or rerunning code', async () => {
    const { worker, repository, execution, reservation } = setup();
    await worker.tick();
    expect(repository.stage).not.toHaveBeenCalled();
    expect(repository.finish).toHaveBeenCalledWith(reservation, true);
    expect(execution.execute).not.toHaveBeenCalled();
  });
  it('records UNKNOWN only when no durable result exists', async () => {
    const { worker, repository, reservation } = setup(false);
    await worker.tick();
    expect(repository.stage).toHaveBeenCalledWith(
      reservation,
      expect.objectContaining({
        technicalResult: expect.objectContaining({
          diagnosisCode: 'UNKNOWN',
          allRequiredPassed: false,
        }),
        privateTestResults: [],
      }),
    );
    expect(repository.finish).toHaveBeenCalledWith(reservation, true);
  });
  it('cannot finish with another workers rotated lease', async () => {
    const { worker, repository } = setup(false);
    repository.stage.mockResolvedValueOnce(false);
    await worker.tick();
    expect(repository.finish).not.toHaveBeenCalled();
  });
  it('retains reservations whose capsule cleanup is uncertain', async () => {
    const { worker, repository, reservation } = setup(true, false);
    await worker.tick();
    expect(repository.finish).toHaveBeenCalledWith(reservation, false);
    expect(repository.stage).not.toHaveBeenCalled();
  });
  it('sweeps capsules even if database retention is temporarily unavailable', async () => {
    const { worker, repository, execution } = setup();
    repository.purgeExpired.mockRejectedValueOnce(new Error('unavailable'));
    await expect(worker.tick()).rejects.toThrow('unavailable');
    expect(execution.sweepExpired).toHaveBeenCalled();
    expect(repository.claimExpired).not.toHaveBeenCalled();
  });
  it.each(['production', 'preproduction'])(
    'never uses Docker recovery in %s',
    async (environment) => {
      const { worker, repository, execution } = setup(true, true, environment);
      await worker.tick();
      expect(repository.purgeExpired).toHaveBeenCalled();
      expect(repository.claimExpired).not.toHaveBeenCalled();
      expect(execution.sweepExpired).not.toHaveBeenCalled();
    },
  );
});

describe('SUBMIT private TEST background timing', () => {
  beforeEach(() => {
    jest.replaceProperty(process, 'env', {
      ...process.env,
      ALUNZA_TEST_SUBMIT_TIMINGS: '1',
    });
  });

  function capture() {
    const output = jest
      .spyOn(console, 'log')
      .mockImplementation(() => undefined);
    return () =>
      output.mock.calls.map(([line]) => JSON.parse(line as string)) as Array<{
        event: string;
        version: number;
        worker: string;
        phase: string;
        observedAtMs: number;
        durationMs: number;
        completed: boolean;
        count?: number;
      }>;
  }

  it('keeps durable recovery order without exposing reservation or staged data', async () => {
    const events = capture();
    const { worker, repository, execution, reservation } = setup();
    execution.sweepExpired.mockResolvedValueOnce({
      cleanupVerified: true,
      removed: 2,
    });
    repository.claimExpired
      .mockReset()
      .mockResolvedValueOnce({
        ...reservation,
        executionId: 'PRIVATE_EXECUTION',
        leaseToken: 'PRIVATE_LEASE',
        stagedResult: true,
        code: 'PRIVATE_CODE',
        hiddenTestId: 'PRIVATE_HIDDEN',
      })
      .mockResolvedValue(null);
    await worker.tick();
    expect(events().map(({ phase }) => phase)).toEqual([
      'sweep',
      'purge',
      'claim',
      'recover',
      'claim',
      'total',
    ]);
    expect(
      events()
        .filter(({ count }) => count !== undefined)
        .map(({ count }) => count),
    ).toEqual([2, 1, 0]);
    expect(execution.sweepExpired.mock.invocationCallOrder[0]).toBeLessThan(
      repository.purgeExpired.mock.invocationCallOrder[0]!,
    );
    expect(repository.purgeExpired.mock.invocationCallOrder[0]).toBeLessThan(
      repository.claimExpired.mock.invocationCallOrder[0]!,
    );
    expect(repository.claimExpired.mock.invocationCallOrder[0]).toBeLessThan(
      execution.cleanup.mock.invocationCallOrder[0]!,
    );
    expect(execution.cleanup.mock.invocationCallOrder[0]).toBeLessThan(
      repository.finish.mock.invocationCallOrder[0]!,
    );
    expect(repository.finish.mock.invocationCallOrder[0]).toBeLessThan(
      repository.claimExpired.mock.invocationCallOrder[1]!,
    );
    expect(repository.stage).not.toHaveBeenCalled();
    for (const event of events()) {
      expect(event).toMatchObject({
        event: 'TEST_SUBMIT_BACKGROUND',
        version: 1,
        worker: 'SUBMIT',
        completed: true,
      });
      expect(Number.isFinite(event.observedAtMs)).toBe(true);
      expect(event.durationMs).toBeGreaterThanOrEqual(0);
      expect(Object.keys(event).sort()).toEqual(
        [
          'completed',
          ...(event.count === undefined ? [] : ['count']),
          'durationMs',
          'event',
          'observedAtMs',
          'phase',
          'version',
          'worker',
        ].sort(),
      );
    }
    expect(JSON.stringify(events())).not.toContain('PRIVATE_');
  });

  it.each(['sweep', 'purge', 'claim', 'cleanup', 'stage', 'finish'])(
    'preserves the %s rejection and records incomplete phase and total',
    async (stage) => {
      const events = capture();
      const { worker, repository, execution } = setup(false);
      const original = new Error('PRIVATE_RECONCILIATION_FAILURE');
      if (stage === 'sweep')
        execution.sweepExpired.mockRejectedValueOnce(original);
      if (stage === 'purge')
        repository.purgeExpired.mockRejectedValueOnce(original);
      if (stage === 'claim')
        repository.claimExpired.mockReset().mockRejectedValueOnce(original);
      if (stage === 'cleanup')
        execution.cleanup.mockRejectedValueOnce(original);
      if (stage === 'stage') repository.stage.mockRejectedValueOnce(original);
      if (stage === 'finish') repository.finish.mockRejectedValueOnce(original);
      await expect(worker.tick()).rejects.toBe(original);
      expect(
        events().find(
          ({ phase }) =>
            phase ===
            (['cleanup', 'stage', 'finish'].includes(stage)
              ? 'recover'
              : stage),
        ),
      ).toMatchObject({ completed: false });
      expect(events().at(-1)).toMatchObject({
        phase: 'total',
        completed: false,
      });
      expect(JSON.stringify(events())).not.toContain('PRIVATE_');
    },
  );

  it('advances after fenced staging and recovers the next reservation without reexecuting', async () => {
    const events = capture();
    const { worker, repository, execution, reservation } = setup(false);
    const next = { ...reservation, executionId: 'PRIVATE_NEXT' };
    repository.claimExpired
      .mockReset()
      .mockResolvedValueOnce(reservation)
      .mockResolvedValueOnce(next)
      .mockResolvedValue(null);
    repository.stage.mockResolvedValueOnce(false);
    await worker.tick();
    expect(repository.claimExpired).toHaveBeenCalledTimes(3);
    expect(repository.stage).toHaveBeenCalledTimes(2);
    expect(repository.finish).toHaveBeenCalledTimes(1);
    expect(repository.finish).toHaveBeenCalledWith(next, true);
    expect(execution.execute).not.toHaveBeenCalled();
    expect(events().filter(({ phase }) => phase === 'recover')).toHaveLength(2);
    expect(
      events()
        .filter(({ phase }) => phase === 'recover')
        .every(({ count }) => count === undefined),
    ).toBe(true);
    expect(events().at(-1)).toMatchObject({ phase: 'total', completed: true });
  });

  it('retains the four-reservation batch bound', async () => {
    capture();
    const { worker, repository, execution, reservation } = setup();
    repository.claimExpired.mockReset().mockResolvedValue(reservation);
    await worker.tick();
    expect(repository.claimExpired).toHaveBeenCalledTimes(4);
    expect(execution.cleanup).toHaveBeenCalledTimes(4);
    expect(repository.finish).toHaveBeenCalledTimes(4);
  });

  it('keeps the running guard and shutdown while the sweep is pending', async () => {
    jest.useFakeTimers();
    try {
      capture();
      const { worker, repository, execution } = setup();
      let resolveSweep!: (result: {
        cleanupVerified: boolean;
        removed: number;
      }) => void;
      execution.sweepExpired.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSweep = resolve;
          }),
      );
      worker.onModuleInit();
      jest.advanceTimersByTime(45_000);
      expect(execution.sweepExpired).toHaveBeenCalledTimes(1);
      expect(repository.purgeExpired).not.toHaveBeenCalled();
      const stopping = worker.onModuleDestroy();
      resolveSweep({ cleanupVerified: true, removed: 0 });
      await stopping;
      jest.advanceTimersByTime(45_000);
      expect(execution.sweepExpired).toHaveBeenCalledTimes(1);
      expect(repository.purgeExpired).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('uses no timing clocks or output with the flag disabled', async () => {
    jest.replaceProperty(process, 'env', {
      ...process.env,
      ALUNZA_TEST_SUBMIT_TIMINGS: '0',
    });
    const output = jest
      .spyOn(console, 'log')
      .mockImplementation(() => undefined);
    const now = jest.spyOn(performance, 'now');
    const { worker, repository, execution } = setup();
    await worker.tick();
    expect(execution.sweepExpired).toHaveBeenCalledTimes(1);
    expect(repository.finish).toHaveBeenCalledTimes(1);
    expect(output).not.toHaveBeenCalled();
    expect(now).not.toHaveBeenCalled();
  });

  it('keeps recovery when stdout throws', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {
      throw new Error('PRIVATE_STDOUT_FAILURE');
    });
    const { worker, repository } = setup();
    await expect(worker.tick()).resolves.toBeUndefined();
    expect(repository.finish).toHaveBeenCalledTimes(1);
  });
});
