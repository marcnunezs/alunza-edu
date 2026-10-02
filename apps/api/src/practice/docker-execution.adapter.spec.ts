import { DockerExecutionAdapter } from './docker-execution.adapter';
import { PracticeReconciler } from './practice.reconciler';
import { SubmissionReconciler } from './submission.reconciler';
import type { PracticeRepository } from './practice.repository';
import type { SubmissionRepository } from './submission.repository';
import type { AppConfig } from '../config';

class ProbeAdapter extends DockerExecutionAdapter {
  readonly probe = jest.fn<
    Promise<{ available: boolean; runnerVersion: string }>,
    []
  >();
  protected override inspectDocker() {
    return this.probe();
  }
}

describe('shared Docker capability probe', () => {
  it('shares only a probe in flight and checks availability again after settlement', async () => {
    const adapter = new ProbeAdapter();
    let finish:
      | ((result: { available: boolean; runnerVersion: string }) => void)
      | undefined;
    adapter.probe.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = [
      adapter.inspect(),
      adapter.inspect(),
      adapter.inspect(),
      adapter.inspect(),
    ];
    expect(adapter.probe).toHaveBeenCalledTimes(1);
    finish!({ available: true, runnerVersion: 'unit' });
    expect(await Promise.all(pending)).toEqual(
      Array(4).fill({ available: true, runnerVersion: 'unit' }),
    );
    adapter.probe.mockResolvedValueOnce({
      available: false,
      runnerVersion: 'unit',
    });
    await expect(adapter.inspect()).resolves.toEqual({
      available: false,
      runnerVersion: 'unit',
    });
    expect(adapter.probe).toHaveBeenCalledTimes(2);
  });
  it('does not cache a failed probe or share another adapter instance state', async () => {
    const adapter = new ProbeAdapter();
    adapter.probe.mockRejectedValueOnce(new Error('probe failed'));
    await expect(adapter.inspect()).rejects.toThrow('probe failed');
    adapter.probe.mockResolvedValueOnce({
      available: true,
      runnerVersion: 'unit',
    });
    await expect(adapter.inspect()).resolves.toEqual({
      available: true,
      runnerVersion: 'unit',
    });
    const other = new ProbeAdapter();
    other.probe.mockResolvedValueOnce({
      available: false,
      runnerVersion: 'other',
    });
    await expect(other.inspect()).resolves.toEqual({
      available: false,
      runnerVersion: 'other',
    });
    expect(adapter.probe).toHaveBeenCalledTimes(2);
    expect(other.probe).toHaveBeenCalledTimes(1);
  });
});

class SweepAdapter extends DockerExecutionAdapter {
  readonly sweep = jest.fn<
    Promise<{ cleanupVerified: boolean; removed: number }>,
    []
  >();
  protected override sweepDocker() {
    return this.sweep();
  }
}

describe('shared Docker orphan sweep', () => {
  it('RUN and SUBMIT reconcilers share one pending sweep and the next tick starts a fresh one', async () => {
    const adapter = new SweepAdapter();
    let finish:
      | ((value: { cleanupVerified: boolean; removed: number }) => void)
      | undefined;
    adapter.sweep.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const runRepository = {
      purgeExpired: jest.fn().mockResolvedValue(undefined),
      claimExpired: jest.fn().mockResolvedValue(null),
    };
    const submitRepository = {
      purgeExpired: jest.fn().mockResolvedValue(undefined),
      claimExpired: jest.fn().mockResolvedValue(null),
    };
    const config = { environment: 'test' } as AppConfig;
    const run = new PracticeReconciler(
      runRepository as unknown as PracticeRepository,
      adapter,
      config,
    );
    const submit = new SubmissionReconciler(
      submitRepository as unknown as SubmissionRepository,
      adapter,
      config,
    );
    const pending = [run.tick(), submit.tick()];
    expect(adapter.sweep).toHaveBeenCalledTimes(1);
    expect(runRepository.purgeExpired).not.toHaveBeenCalled();
    expect(submitRepository.purgeExpired).not.toHaveBeenCalled();
    finish!({ cleanupVerified: true, removed: 2 });
    await Promise.all(pending);
    expect(runRepository.claimExpired).toHaveBeenCalledTimes(1);
    expect(submitRepository.claimExpired).toHaveBeenCalledTimes(1);

    adapter.sweep.mockResolvedValueOnce({ cleanupVerified: false, removed: 0 });
    await run.tick();
    expect(adapter.sweep).toHaveBeenCalledTimes(2);
    expect(runRepository.purgeExpired).toHaveBeenCalledTimes(2);
    // A fresh unsuccessful sweep must still fence reservation cleanup.
    expect(runRepository.claimExpired).toHaveBeenCalledTimes(1);
  });

  it('shares the exact result only while pending and retains partial failed-cleanup evidence', async () => {
    const adapter = new SweepAdapter();
    adapter.sweep.mockResolvedValueOnce({ cleanupVerified: false, removed: 2 });
    const run = adapter.sweepExpired();
    const submit = adapter.sweepExpired();
    expect(run).toBe(submit);
    expect(await run).toEqual({ cleanupVerified: false, removed: 2 });
    adapter.sweep.mockResolvedValueOnce({ cleanupVerified: true, removed: 0 });
    await expect(adapter.sweepExpired()).resolves.toEqual({
      cleanupVerified: true,
      removed: 0,
    });
    expect(adapter.sweep).toHaveBeenCalledTimes(2);
  });

  it('an unexpected rejected sweep releases the in-flight slot and does not affect another adapter', async () => {
    const adapter = new SweepAdapter();
    adapter.sweep.mockRejectedValueOnce(new Error('sweep unavailable'));
    const pending = [adapter.sweepExpired(), adapter.sweepExpired()];
    expect(adapter.sweep).toHaveBeenCalledTimes(1);
    const results = await Promise.allSettled(pending);
    expect(results.every((result) => result.status === 'rejected')).toBe(true);
    adapter.sweep.mockResolvedValueOnce({ cleanupVerified: true, removed: 0 });
    await expect(adapter.sweepExpired()).resolves.toEqual({
      cleanupVerified: true,
      removed: 0,
    });
    const other = new SweepAdapter();
    other.sweep.mockResolvedValueOnce({ cleanupVerified: false, removed: 0 });
    await expect(other.sweepExpired()).resolves.toEqual({
      cleanupVerified: false,
      removed: 0,
    });
    expect(adapter.sweep).toHaveBeenCalledTimes(2);
    expect(other.sweep).toHaveBeenCalledTimes(1);
  });
});
