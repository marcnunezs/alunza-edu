import { Logger } from '@nestjs/common';
import { SignalsWorker } from './signals.worker';
import { SignalsRepository } from './signals.repository';
import { processSignalSnapshot } from './signal-processing';
import type { AppConfig } from '../config';

jest.mock('./signal-processing', () => ({ processSignalSnapshot: jest.fn() }));

describe('durable signal worker lifecycle', () => {
  const job = { laneId: 'lane', leaseToken: 'token' };
  const snapshot = { snapshot: { id: 'snapshot' } };
  const batch = { evaluations: [], checkpoint: { throughTime: 'cut' } };
  const repository = () => ({
    claim: jest.fn().mockResolvedValue(job),
    capture: jest.fn().mockResolvedValue(snapshot),
    renew: jest.fn().mockResolvedValue(true),
    finalize: jest
      .fn()
      .mockResolvedValue({ status: 'COMMITTED', evaluations: 2, signals: 1 }),
    fail: jest.fn().mockResolvedValue(undefined),
  });
  let repo: ReturnType<typeof repository>;
  let worker: SignalsWorker;
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    jest.mocked(processSignalSnapshot).mockReturnValue(batch as never);
    repo = repository();
    worker = new SignalsWorker(
      repo as unknown as SignalsRepository,
      { signalsWorkerEnabled: false } as AppConfig,
    );
  });
  afterEach(async () => {
    await worker.onModuleDestroy();
    jest.useRealTimers();
  });
  test('disabled default never claims a job', async () => {
    worker.onModuleInit();
    await jest.advanceTimersByTimeAsync(30_000);
    expect(repo.claim).not.toHaveBeenCalled();
  });
  test('commits the captured snapshot once with its original token', async () => {
    await worker.tick();
    expect(processSignalSnapshot).toHaveBeenCalledWith(snapshot, 100);
    expect(repo.finalize).toHaveBeenCalledTimes(1);
    expect(repo.finalize).toHaveBeenCalledWith(job, 'snapshot', batch);
    expect(worker.metrics()).toMatchObject({
      committed: 1,
      evaluations: 2,
      signals: 1,
    });
    expect(repo.fail).not.toHaveBeenCalled();
  });
  test('a stale snapshot is left to durable rescheduling', async () => {
    repo.finalize.mockResolvedValue({
      status: 'STALE',
      evaluations: 0,
      signals: 0,
    });
    await worker.tick();
    expect(worker.metrics().stale).toBe(1);
    expect(repo.fail).not.toHaveBeenCalled();
  });
  test('lost lease cannot publish computed results', async () => {
    repo.renew.mockResolvedValue(false);
    await worker.tick();
    expect(repo.finalize).not.toHaveBeenCalled();
    expect(worker.metrics().leaseLost).toBe(1);
  });
  test('uncertain commit never creates a new key or retries finalize in memory', async () => {
    repo.finalize.mockRejectedValue(new Error('private database diagnostic'));
    await worker.tick();
    expect(repo.finalize).toHaveBeenCalledTimes(1);
    expect(repo.claim).toHaveBeenCalledTimes(1);
    expect(repo.fail).toHaveBeenCalledWith(job, 'PROCESSING_FAILED');
    expect(Logger.prototype.warn).toHaveBeenCalledWith({
      event: 'SIGNALS_PROCESSING_FAILED',
      code: 'PROCESSING_FAILED',
    });
  });
  test('clock regression is reported without changing evidence', async () => {
    jest.mocked(processSignalSnapshot).mockImplementation(() => {
      throw new Error('SIGNAL_CLOCK_REGRESSION');
    });
    await worker.tick();
    expect(repo.fail).toHaveBeenCalledWith(job, 'CLOCK_REGRESSION');
    expect(repo.finalize).not.toHaveBeenCalled();
  });
  test('heartbeat failure fences a pending capture', async () => {
    let release!: (value: unknown) => void;
    repo.capture.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    repo.renew.mockResolvedValue(false);
    const running = worker.tick();
    await jest.advanceTimersByTimeAsync(10_000);
    release(snapshot);
    await running;
    expect(repo.finalize).not.toHaveBeenCalled();
    expect(worker.metrics().leaseLost).toBe(1);
  });
  test('enabled worker polls and shutdown stops further claims', async () => {
    repo.claim.mockResolvedValue(null);
    worker = new SignalsWorker(
      repo as unknown as SignalsRepository,
      { signalsWorkerEnabled: true } as AppConfig,
    );
    worker.onModuleInit();
    await jest.advanceTimersByTimeAsync(1000);
    expect(repo.claim).toHaveBeenCalledTimes(1);
    await worker.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(10_000);
    expect(repo.claim).toHaveBeenCalledTimes(1);
  });
});
