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
