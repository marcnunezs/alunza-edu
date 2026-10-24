import { PracticeReconciler } from './practice.reconciler';
import { PracticeRepository } from './practice.repository';
import { ExecutionPort } from './execution.port';
import type { AppConfig } from '../config';

describe('RUN reconciliation', () => {
  it.each([true, false])(
    'claims lease, cleans and terminalizes without reexecuting (cleaned=%s)',
    async (cleaned) => {
      const reservation = {
        executionId: '10000000-0000-4000-8000-000000000001',
        leaseToken: '10000000-0000-4000-8000-000000000002',
        runnerVersion: 'unit',
        visibleTotal: 2,
      };
      const repository = {
        purgeExpired: jest.fn(),
        claimExpired: jest
          .fn()
          .mockResolvedValueOnce(reservation)
          .mockResolvedValue(null),
        finish: jest.fn(),
      };
      const execution = {
        sweepExpired: jest
          .fn()
          .mockResolvedValue({ cleanupVerified: true, removed: 1 }),
        cleanup: jest.fn().mockResolvedValue(cleaned),
        execute: jest.fn(),
      };
      const worker = new PracticeReconciler(
        repository as unknown as PracticeRepository,
        execution as unknown as ExecutionPort,
        { practiceRunnerEnabled: true } as AppConfig,
      );
      await worker.tick();
      expect(execution.sweepExpired.mock.invocationCallOrder[0]).toBeLessThan(
        repository.claimExpired.mock.invocationCallOrder[0]!,
      );
      expect(execution.cleanup).toHaveBeenCalledWith(reservation.executionId);
      expect(repository.finish).toHaveBeenCalledWith(
        reservation,
        expect.objectContaining({
          diagnosisCode: 'UNKNOWN',
          infrastructureStatus: 'FAILED',
          visibleTotal: 2,
        }),
        cleaned,
      );
      expect(execution.execute).not.toHaveBeenCalled();
    },
  );
  it('continues retention and recovery while new admissions are disabled', async () => {
    const repository = {
      purgeExpired: jest.fn(),
      claimExpired: jest.fn().mockResolvedValue(null),
    };
    const execution = {
      sweepExpired: jest
        .fn()
        .mockResolvedValue({ cleanupVerified: true, removed: 1 }),
    };
    const worker = new PracticeReconciler(
      repository as unknown as PracticeRepository,
      execution as unknown as ExecutionPort,
      { practiceRunnerEnabled: false } as AppConfig,
    );
    await worker.tick();
    expect(repository.purgeExpired).toHaveBeenCalledTimes(1);
    expect(execution.sweepExpired).toHaveBeenCalledTimes(1);
    expect(repository.claimExpired).toHaveBeenCalledTimes(1);
  });
  it('sweeps late capsules even while database retention fails', async () => {
    const repository = {
      purgeExpired: jest
        .fn()
        .mockRejectedValue(new Error('database unavailable')),
      claimExpired: jest.fn(),
    };
    const execution = {
      sweepExpired: jest
        .fn()
        .mockResolvedValue({ cleanupVerified: true, removed: 1 }),
    };
    const worker = new PracticeReconciler(
      repository as unknown as PracticeRepository,
      execution as unknown as ExecutionPort,
      { environment: 'test', practiceRunnerEnabled: false } as AppConfig,
    );
    await expect(worker.tick()).rejects.toThrow('database unavailable');
    expect(execution.sweepExpired).toHaveBeenCalledTimes(1);
    expect(repository.claimExpired).not.toHaveBeenCalled();
  });
  it('retains leases when an orphan sweep cannot confirm cleanup', async () => {
    const repository = { purgeExpired: jest.fn(), claimExpired: jest.fn() };
    const execution = {
      sweepExpired: jest
        .fn()
        .mockResolvedValue({ cleanupVerified: false, removed: 0 }),
    };
    const worker = new PracticeReconciler(
      repository as unknown as PracticeRepository,
      execution as unknown as ExecutionPort,
      { environment: 'local' } as AppConfig,
    );
    await worker.tick();
    expect(repository.purgeExpired).toHaveBeenCalledTimes(1);
    expect(repository.claimExpired).not.toHaveBeenCalled();
  });
  it.each(['production', 'preproduction'] as const)(
    'does not touch local Docker in %s',
    async (environment) => {
      const repository = { purgeExpired: jest.fn(), claimExpired: jest.fn() };
      const execution = { sweepExpired: jest.fn() };
      const worker = new PracticeReconciler(
        repository as unknown as PracticeRepository,
        execution as unknown as ExecutionPort,
        { environment } as AppConfig,
      );
      await worker.tick();
      expect(repository.purgeExpired).toHaveBeenCalledTimes(1);
      expect(execution.sweepExpired).not.toHaveBeenCalled();
      expect(repository.claimExpired).not.toHaveBeenCalled();
    },
  );
});

describe('RUN private TEST background timing', () => {
  beforeEach(() => {
    jest.replaceProperty(process, 'env', {
      ...process.env,
      ALUNZA_TEST_SUBMIT_TIMINGS: '1',
    });
  });

  function setup(environment = 'test') {
    const order: string[] = [];
    const reservation = {
      executionId: 'PRIVATE_EXECUTION',
      leaseToken: 'PRIVATE_LEASE',
      runnerVersion: 'PRIVATE_VERSION',
      visibleTotal: 1,
    };
    const repository = {
      purgeExpired: jest.fn(async () => {
        order.push('purge');
      }),
      claimExpired: jest.fn(async () => {
        order.push('claim');
        return null as typeof reservation | null;
      }),
      finish: jest.fn(async () => {
        order.push('finish');
      }),
    };
    const execution = {
      sweepExpired: jest.fn(async () => {
        order.push('sweep');
        return { cleanupVerified: true, removed: 3 };
      }),
      cleanup: jest.fn(async () => {
        order.push('cleanup');
        return true;
      }),
    };
    const worker = new PracticeReconciler(
      repository as unknown as PracticeRepository,
      execution as unknown as ExecutionPort,
      { environment, practiceRunnerEnabled: false } as AppConfig,
    );
    return { worker, repository, execution, reservation, order };
  }

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

  it('keeps recovery order and publishes only durations and actual sweep/claim counts', async () => {
    const events = capture();
    const { worker, repository, reservation, order } = setup();
    repository.claimExpired.mockImplementationOnce(async () => {
      order.push('claim');
      return reservation;
    });
    await worker.tick();
    expect(order).toEqual([
      'sweep',
      'purge',
      'claim',
      'cleanup',
      'finish',
      'claim',
    ]);
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
    ).toEqual([3, 1, 0]);
    for (const event of events()) {
      expect(event).toMatchObject({
        event: 'TEST_SUBMIT_BACKGROUND',
        version: 1,
        worker: 'RUN',
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

  it.each(['sweep', 'purge', 'claim', 'cleanup', 'finish'])(
    'preserves the %s rejection and records incomplete phase and total',
    async (stage) => {
      const events = capture();
      const { worker, repository, execution, reservation } = setup();
      const original = new Error('PRIVATE_RECONCILIATION_FAILURE');
      if (stage === 'sweep')
        execution.sweepExpired.mockRejectedValueOnce(original);
      if (stage === 'purge')
        repository.purgeExpired.mockRejectedValueOnce(original);
      if (stage === 'claim')
        repository.claimExpired.mockRejectedValueOnce(original);
      if (stage === 'cleanup' || stage === 'finish') {
        repository.claimExpired.mockResolvedValueOnce(reservation);
        if (stage === 'cleanup')
          execution.cleanup.mockRejectedValueOnce(original);
        else repository.finish.mockRejectedValueOnce(original);
      }
      await expect(worker.tick()).rejects.toBe(original);
      expect(
        events().find(
          ({ phase }) =>
            phase ===
            (['cleanup', 'finish'].includes(stage) ? 'recover' : stage),
        ),
      ).toMatchObject({ completed: false });
      expect(events().at(-1)).toMatchObject({
        phase: 'total',
        completed: false,
      });
      expect(JSON.stringify(events())).not.toContain('PRIVATE_');
    },
  );

  it('retains the four-reservation batch bound', async () => {
    capture();
    const { worker, repository, execution, reservation } = setup();
    repository.claimExpired.mockResolvedValue(reservation);
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
    expect(repository.claimExpired).toHaveBeenCalledTimes(1);
    expect(output).not.toHaveBeenCalled();
    expect(now).not.toHaveBeenCalled();
  });

  it('keeps recovery when stdout throws', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {
      throw new Error('PRIVATE_STDOUT_FAILURE');
    });
    const { worker, repository, reservation } = setup();
    repository.claimExpired.mockResolvedValueOnce(reservation);
    await expect(worker.tick()).resolves.toBeUndefined();
    expect(repository.finish).toHaveBeenCalledTimes(1);
  });
});
