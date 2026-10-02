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
