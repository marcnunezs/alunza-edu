import { jest as esmJest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import type { AppConfig } from '../config';
import type { DockerPreparedResourceRepository } from './docker-prepared-resource.repository';
import { DockerRunnerService } from './docker-runner.service';
import type {
  ConfiguredDockerExecutionContext,
  ExecutionAuthority,
  PracticeExecutionInput,
} from './execution.port';

const context: ConfiguredDockerExecutionContext = {
  provider: 'docker',
  image: `sha256:${'a'.repeat(64)}`,
  runnerVersion: 'unit',
  engineId: 'engine-unit',
  runtimeName: 'alunza-crun',
  runtimeVersion: '1.31',
  runtimeSha256: 'b'.repeat(64),
  strategy: 'prepared-pair-v1',
};
const input: PracticeExecutionInput = {
  executionId: '10000000-0000-4000-8000-000000000001',
  requestId: 'unit-request',
  exerciseVersionId: '10000000-0000-4000-8000-000000000002',
  testsVersion: 'a'.repeat(64),
  mode: 'RUN',
  entrypoint: 'solve',
  code: 'module.exports.solve=n=>n;',
  tests: [{ id: 'visible', visibility: 'visible', args: [1], expected: 1 }],
};
const output = {
  diagnosisCode: 'SUCCESS',
  privateTestResults: [],
  evidence: { cleanupVerified: true },
};
const mockInspect = jest.fn();
const mockExecute = jest.fn();
const mockPool = jest.fn();
const mockEngineId = jest.fn();
esmJest.unstable_mockModule('@alunza/runner', () => ({
  RUNNER_VERSION: 'unit',
  inspectDockerRunner: mockInspect,
  execute: mockExecute,
  DockerPreparedPool: mockPool,
  executionSchema: { parse: (value: unknown) => value },
  getDockerEngineId: mockEngineId,
}));

function setup(configured = true) {
  const config = {
    environment: 'local',
    practiceRunnerEnabled: true,
    dockerConfiguration: {
      runtime: 'crun',
      runtimeName: context.runtimeName,
      runtimeVersion: context.runtimeVersion,
      runtimeSha256: context.runtimeSha256,
      strategy: context.strategy,
    },
  } as AppConfig;
  if (!configured) delete config.dockerConfiguration;
  const resources = {
    recoveryContexts: jest.fn().mockResolvedValue([]),
    assertActive: jest.fn().mockResolvedValue(undefined),
    listExecutionPairs: jest
      .fn()
      .mockResolvedValue([
        { slots: [{ cleanupState: 'VERIFIED' }, { cleanupState: 'VERIFIED' }] },
      ]),
  };
  const adapter = { provider: 'docker', execute: jest.fn(), close: jest.fn() };
  const pool = {
    prepare: jest.fn(),
    adapterFor: jest.fn().mockResolvedValue(adapter),
    afterRequestClosed: jest.fn().mockResolvedValue(undefined),
    cleanup: jest.fn().mockResolvedValue(true),
    sweep: jest.fn().mockResolvedValue({ cleanupVerified: true, removed: 0 }),
    drain: jest.fn().mockResolvedValue(undefined),
  };
  mockInspect.mockResolvedValue({ available: true, context });
  mockEngineId.mockResolvedValue(context.engineId);
  mockExecute.mockResolvedValue(output);
  mockPool.mockImplementation(() => pool);
  const service = new DockerRunnerService(
    config,
    resources as unknown as DockerPreparedResourceRepository,
  );
  const authority: ExecutionAuthority = {
    leaseToken: '10000000-0000-4000-8000-000000000003',
    normalDeadlineMs: Date.now() + 30_000,
    cleanupDeadlineMs: Date.now() + 40_000,
  };
  return { service, resources, pool, adapter, authority };
}
const flush = async () => {
  for (let index = 0; index < 8; index++) await Promise.resolve();
};

describe('configured Docker execution and post-HTTP reserve lifecycle', () => {
  beforeEach(() => {
    mockInspect.mockReset();
    mockExecute.mockReset();
    mockPool.mockReset();
    mockEngineId.mockReset();
  });

  it('inspects fresh pinned identity without creating or preparing a pool', async () => {
    const { service, pool } = setup();
    const inspection = await service.inspect();
    expect(inspection).toEqual({
      available: true,
      runnerVersion: 'unit',
      context,
    });
    expect(Object.isFrozen(inspection.context)).toBe(true);
    expect(mockPool).not.toHaveBeenCalled();
    expect(pool.prepare).not.toHaveBeenCalled();
    await service.inspect();
    expect(mockInspect).toHaveBeenCalledTimes(2);
  });

  it('pins admission and revalidates the durable lease before and after pool acquisition', async () => {
    const f = setup();
    expect(await f.service.execute(input, context, f.authority)).toEqual({
      result: output,
      cleanupVerified: true,
    });
    expect(f.resources.assertActive).toHaveBeenCalledTimes(2);
    expect(f.resources.assertActive).toHaveBeenCalledWith(
      input.executionId,
      f.authority.leaseToken,
      context,
    );
    const received = f.pool.adapterFor.mock.calls[0]![2];
    expect(received).toEqual({
      ...f.authority,
      assertActive: expect.any(Function),
    });
    await received.assertActive();
    expect(f.resources.assertActive).toHaveBeenCalledTimes(3);
    expect(mockExecute).toHaveBeenCalledWith(
      input,
      f.adapter,
      expect.any(AbortSignal),
    );
    expect(mockPool).toHaveBeenCalledTimes(1);
  });

  it('shares a single pool for RUN and SUBMIT rather than allocating one per request', async () => {
    const f = setup();
    await Promise.all([
      f.service.execute(input, context, f.authority),
      f.service.execute({ ...input, mode: 'SUBMIT' }, context, f.authority),
    ]);
    expect(mockPool).toHaveBeenCalledTimes(1);
    expect(f.pool.adapterFor).toHaveBeenCalledTimes(2);
  });

  it('does not dispatch without authority, after a lease refusal, or with a changed runtime', async () => {
    const f = setup();
    await expect(f.service.execute(input, context)).rejects.toThrow(
      'authority',
    );
    await expect(
      f.service.execute(
        input,
        { ...context, runtimeSha256: 'c'.repeat(64) },
        f.authority,
      ),
    ).rejects.toThrow('configuration');
    f.resources.assertActive.mockRejectedValueOnce(new Error('lease expired'));
    await expect(
      f.service.execute(input, context, f.authority),
    ).rejects.toThrow('lease expired');
    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockPool).not.toHaveBeenCalled();
  });

  it('refuses a late pool reply before runner execution', async () => {
    const f = setup();
    f.resources.assertActive
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('token rotated'));
    await expect(
      f.service.execute(input, context, f.authority),
    ).rejects.toThrow('token rotated');
    expect(f.pool.adapterFor).toHaveBeenCalledTimes(1);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it.each(['pending', 'missing', 'database'])(
    'keeps a valid result but withholds cleanup confirmation for %s durable evidence',
    async (failure) => {
      const f = setup();
      if (failure === 'database')
        f.resources.listExecutionPairs.mockRejectedValueOnce(
          new Error('database unavailable'),
        );
      else
        f.resources.listExecutionPairs.mockResolvedValueOnce(
          failure === 'missing'
            ? []
            : [{ slots: [{ cleanupState: 'PENDING' }] }],
        );
      expect(await f.service.execute(input, context, f.authority)).toEqual({
        result: output,
        cleanupVerified: false,
      });
    },
  );

  it('waits for both durable service closure and HTTP finish without delaying the HTTP response', async () => {
    const f = setup();
    await f.service.execute(input, context, f.authority);
    let finish!: (delivered: boolean) => void;
    const responseClosed = new Promise<boolean>((resolve) => {
      finish = resolve;
    });
    expect(
      f.service.requestClosed(input.executionId, context, {
        committed: true,
        cleanupVerified: true,
        responseClosed,
      }),
    ).toBeUndefined();
    await flush();
    expect(f.pool.afterRequestClosed).not.toHaveBeenCalled();
    finish(true);
    await flush();
    expect(f.pool.afterRequestClosed).toHaveBeenCalledWith(
      input.executionId,
      context,
      { replenish: true },
    );
  });

  it.each([
    { committed: false, cleanupVerified: true, delivered: true },
    { committed: true, cleanupVerified: false, delivered: true },
    { committed: true, cleanupVerified: true, delivered: false },
  ])(
    'releases without replenishing on incomplete closure %j',
    async (closure) => {
      const f = setup();
      await f.service.execute(input, context, f.authority);
      f.service.requestClosed(input.executionId, context, {
        ...closure,
        responseClosed: Promise.resolve(closure.delivered),
      });
      await flush();
      expect(f.pool.afterRequestClosed).toHaveBeenCalledWith(
        input.executionId,
        context,
        { replenish: false },
      );
    },
  );

  it('uses persisted cleanup identity even after the current runtime configuration differs', async () => {
    const f = setup();
    const previous = { ...context, runtimeName: 'earlier-runtime' };
    expect(await f.service.cleanup(input.executionId, previous, 2000)).toBe(
      true,
    );
    expect(f.pool.cleanup).toHaveBeenCalledWith(
      input.executionId,
      previous,
      expect.any(AbortSignal),
    );
    expect(mockInspect).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('recovers assigned and unassigned resources with admissions and runtime configuration disabled', async () => {
    const f = setup(false);
    expect(f.service.configured).toBe(false);
    expect(await f.service.cleanup(input.executionId, context)).toBe(true);
    expect(mockPool).toHaveBeenCalledWith(
      expect.objectContaining({ runtime: undefined }),
    );
    f.resources.recoveryContexts.mockResolvedValueOnce([context]);
    expect(await f.service.sweepExpired()).toEqual({
      cleanupVerified: true,
      removed: 0,
    });
    expect(f.resources.recoveryContexts).toHaveBeenCalledWith(context.engineId);
    expect(f.pool.sweep).toHaveBeenCalledWith(context, expect.any(AbortSignal));
    expect(mockInspect).not.toHaveBeenCalled();
    expect(f.pool.prepare).not.toHaveBeenCalled();
    expect(f.pool.adapterFor).not.toHaveBeenCalled();
  });

  it('keeps SQL available until the service completes staging and authorization, independently of HTTP delivery', async () => {
    const f = setup();
    await f.service.execute(input, context, f.authority);
    const stopped = f.service.onModuleDestroy();
    await flush();
    expect(f.pool.drain).not.toHaveBeenCalled();
    f.service.requestClosed(input.executionId, context, {
      committed: true,
      cleanupVerified: true,
      responseClosed: new Promise(() => undefined),
    });
    await stopped;
    expect(f.pool.drain).toHaveBeenCalledTimes(1);
  });

  it('drains active work, blocks new execution and never waits for an unsent HTTP response', async () => {
    const f = setup();
    let complete!: (value: typeof output) => void;
    mockExecute.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const running = f.service.execute(input, context, f.authority);
    while (!complete) await flush();
    f.service.requestClosed(input.executionId, context, {
      committed: true,
      cleanupVerified: true,
      responseClosed: new Promise(() => undefined),
    });
    const stopped = f.service.onModuleDestroy();
    await flush();
    expect(f.pool.drain).not.toHaveBeenCalled();
    await expect(
      f.service.execute(input, context, f.authority),
    ).rejects.toThrow('authority');
    complete(output);
    await running;
    await stopped;
    expect(f.pool.drain).toHaveBeenCalledTimes(1);
    expect((await f.service.inspect()).available).toBe(false);
  });

  it('does not let asynchronous cleanup or logging failure reject the sent response', async () => {
    const f = setup();
    await f.service.execute(input, context, f.authority);
    f.pool.afterRequestClosed.mockRejectedValueOnce(
      new Error('database unavailable'),
    );
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {
      throw new Error('logger failed');
    });
    expect(() =>
      f.service.requestClosed(input.executionId, context, {
        committed: true,
        cleanupVerified: true,
      }),
    ).not.toThrow();
    await flush();
  });
});
