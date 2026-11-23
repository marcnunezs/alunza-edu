import { jest as esmJest } from '@jest/globals';
import type {
  VercelOptions,
  VercelEvidence,
  ExecutionResult,
} from '@alunza/runner';
import { VercelRunnerService } from './vercel-runner.service';
import type {
  SandboxResourceRepository,
  SandboxResource,
} from './sandbox-resource.repository';
import type { AppConfig } from '../config';
import type { ExecutionAuthority } from './execution.port';

let options: VercelOptions;
const evidence = {
  cleanupVerified: true,
  sandboxId: 'sbx_unit',
  cleanupCheck: 'ABSENT_AND_ZERO_SNAPSHOTS',
};
const executeMock = jest.fn();
const recoverMock = jest.fn();
esmJest.unstable_mockModule('@alunza/runner', () => ({
  RUNNER_VERSION: 'unit',
  VercelAdapter: class {
    evidence = evidence;
    constructor(value: VercelOptions) {
      options = value;
    }
  },
  execute: executeMock,
  recoverVercelSandbox: recoverMock,
}));
const context = {
  provider: 'vercel' as const,
  image: `vcr.vercel.com/unit/runner@sha256:${'a'.repeat(64)}`,
  runnerVersion: 'unit',
  teamId: 'team_unit',
  projectId: 'prj_unit',
  region: 'iad1',
  campaignId: '10000000-0000-4000-8000-000000000001',
  expiresAt: '2070-01-01T00:00:00Z',
  maxCreations: 2,
  maxRequests: 100,
};
const resource: SandboxResource = {
  executionId: '20000000-0000-4000-8000-000000000001',
  creationId: '30000000-0000-4000-8000-000000000001',
  sandboxName: 'alunza-practice-20000000-0000-4000-8000-000000000001',
  providerResourceId: null,
  creationState: 'PREPARED',
  cleanupState: 'PENDING',
  context,
  cleanupProof: null,
};
const input = {
  executionId: resource.executionId,
  requestId: 'unit',
  exerciseVersionId: 'unit',
  testsVersion: 'unit',
  mode: 'RUN' as const,
  entrypoint: 'solve' as const,
  code: 'module.exports.solve = () => 1',
  tests: [{ id: 'v1', visibility: 'visible' as const, args: [], expected: 1 }],
};
const result = {
  executionId: input.executionId,
  runnerVersion: 'unit',
  lifecycleMs: 1,
} as ExecutionResult;
const authority = (): ExecutionAuthority => ({
  leaseToken: 'lease-unit',
  normalDeadlineMs: Date.now() + 30_000,
  cleanupDeadlineMs: Date.now() + 40_000,
});
function setup(patch: Partial<SandboxResource> = {}) {
  const stored = { ...resource, ...patch };
  const resources = {
    load: jest.fn().mockResolvedValue(stored),
    beginCreation: jest.fn().mockResolvedValue(stored),
    confirmResource: jest.fn().mockResolvedValue(stored),
    assertActive: jest.fn().mockResolvedValue(undefined),
    consumeRequest: jest.fn().mockResolvedValue(undefined),
    verifyCleanup: jest.fn().mockResolvedValue(undefined),
  };
  const config = {
    sandboxConfiguration: { token: 'unit-private', context },
  } as AppConfig;
  return {
    resources,
    service: new VercelRunnerService(
      config,
      resources as unknown as SandboxResourceRepository,
    ),
  };
}
describe('durable Vercel execution orchestration', () => {
  beforeEach(() => {
    executeMock.mockReset().mockResolvedValue(result);
    recoverMock.mockReset().mockResolvedValue(evidence);
  });
  it('inspects without creating a resource or contacting the provider', async () => {
    const { service, resources } = setup();
    expect(await service.inspect()).toMatchObject({ available: true, context });
    expect(resources.load).not.toHaveBeenCalled();
    expect(executeMock).not.toHaveBeenCalled();
  });
  it('wires durable creation, receipt, fencing and request budgets before execution', async () => {
    const { service, resources } = setup();
    executeMock.mockImplementation(async () => {
      await options.recordCorrelation(
        {} as Parameters<VercelOptions['recordCorrelation']>[0],
      );
      await options.recordResource!({ sandboxId: 'sbx_unit' } as Parameters<
        NonNullable<VercelOptions['recordResource']>
      >[0]);
      await options.assertActive!();
      await options.allowRequest(false);
      return result;
    });
    const permit = authority();
    expect(await service.execute(input, context, permit)).toEqual({
      result,
      cleanupVerified: true,
    });
    expect(resources.beginCreation).toHaveBeenCalledWith(
      input.executionId,
      permit.leaseToken,
    );
    expect(resources.confirmResource).toHaveBeenCalledWith(
      input.executionId,
      resource.creationId,
      'sbx_unit',
    );
    expect(resources.consumeRequest).toHaveBeenCalledWith(
      input.executionId,
      resource.creationId,
      false,
    );
    expect(resources.verifyCleanup).toHaveBeenCalledWith(
      input.executionId,
      expect.objectContaining({
        kind: 'ABSENT_AND_ZERO_SNAPSHOTS',
        sandboxId: 'sbx_unit',
      }),
    );
    expect(options.normalDeadlineMs).toBe(permit.normalDeadlineMs);
    expect(options.cleanupDeadlineMs).toBe(permit.cleanupDeadlineMs);
  });
  it('rejects substituted admission context without creating', async () => {
    const { service } = setup();
    await expect(
      service.execute(input, { ...context, region: 'sfo1' }, authority()),
    ).rejects.toThrow('context mismatch');
    expect(executeMock).not.toHaveBeenCalled();
  });
  it('does not release a slot merely because cleanup completed in memory', async () => {
    const { service, resources } = setup();
    resources.verifyCleanup.mockRejectedValue(
      new Error('DB commit unavailable'),
    );
    await expect(service.execute(input, context, authority())).rejects.toThrow(
      'DB commit unavailable',
    );
  });
  it('preserves unresolved creation on 404 and never invokes execution during recovery', async () => {
    const { service, resources } = setup({ creationState: 'UNKNOWN' });
    recoverMock.mockResolvedValue({
      cleanupVerified: false,
      cleanupCheck: 'CREATION_UNRESOLVED',
    } as VercelEvidence);
    expect(await service.cleanup(input.executionId)).toBe(false);
    expect(resources.verifyCleanup).not.toHaveBeenCalled();
    expect(executeMock).not.toHaveBeenCalled();
  });
  it('closes a never dispatched reservation using only durable proof', async () => {
    const { service, resources } = setup();
    expect(await service.cleanup(input.executionId)).toBe(true);
    expect(recoverMock).not.toHaveBeenCalled();
    expect(resources.verifyCleanup).toHaveBeenCalledWith(input.executionId, {
      creationId: resource.creationId,
      kind: 'NOT_DISPATCHED',
    });
  });
  it('persists discovery of a late ID before accepting its absence proof', async () => {
    const { service, resources } = setup({ creationState: 'UNKNOWN' });
    recoverMock.mockImplementation(async (value) => {
      await value.recordResource({ sandboxId: 'sbx_unit' });
      return evidence;
    });
    expect(await service.cleanup(input.executionId)).toBe(true);
    expect(resources.confirmResource.mock.invocationCallOrder[0]).toBeLessThan(
      resources.verifyCleanup.mock.invocationCallOrder[0]!,
    );
  });
  it('drains active execution and blocks new execution without blocking cleanup', async () => {
    const { service } = setup();
    await service.onModuleDestroy();
    expect((await service.inspect()).available).toBe(false);
    await expect(service.execute(input, context, authority())).rejects.toThrow(
      'authority',
    );
    expect(await service.cleanup(input.executionId)).toBe(true);
  });
});
