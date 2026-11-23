import { ExecutionRouterAdapter } from './execution-router.adapter';
import type { DockerExecutionAdapter } from './docker-execution.adapter';
import type { VercelExecutionAdapter } from './vercel-execution.adapter';
import type { LocalVmExecutionAdapter } from './local-vm-execution.adapter';
import type { SandboxResourceRepository } from './sandbox-resource.repository';
import type { AppConfig } from '../config';
import type {
  ExecutionContext,
  PracticeExecutionInput,
} from './execution.port';

describe('provider routing from durable admission', () => {
  const context: ExecutionContext = {
    provider: 'docker',
    image: `sha256:${'a'.repeat(64)}`,
    runnerVersion: 'unit',
  };
  function setup() {
    const docker = {
      cleanup: jest.fn().mockResolvedValue(true),
      inspect: jest.fn(),
      execute: jest.fn(),
      sweepExpired: jest.fn(),
    };
    const vercel = {
      cleanup: jest.fn().mockResolvedValue(false),
      inspect: jest.fn(),
      execute: jest.fn(),
      sweepExpired: jest.fn(),
    };
    const resources = { loadContext: jest.fn().mockResolvedValue(undefined) };
    const adapter = new ExecutionRouterAdapter(
      { practiceRunnerProvider: 'vercel' } as AppConfig,
      docker as unknown as DockerExecutionAdapter,
      vercel as unknown as VercelExecutionAdapter,
      resources as unknown as SandboxResourceRepository,
    );
    return { adapter, docker, vercel, resources };
  }
  it('cleans historical Docker reservations using their provider even when new admissions use Vercel', async () => {
    const { adapter, docker, vercel, resources } = setup();
    expect(await adapter.cleanup('execution', 1000, context)).toBe(true);
    expect(docker.cleanup).toHaveBeenCalledWith('execution', 1000, context);
    expect(vercel.cleanup).not.toHaveBeenCalled();
    expect(resources.loadContext).not.toHaveBeenCalled();
  });
  it('reads the durable provider for service fallback and never switches after Vercel cleanup fails', async () => {
    const { adapter, docker, vercel, resources } = setup();
    resources.loadContext.mockResolvedValue({ provider: 'vercel' });
    expect(await adapter.cleanup('execution')).toBe(false);
    expect(vercel.cleanup).toHaveBeenCalledTimes(1);
    expect(docker.cleanup).not.toHaveBeenCalled();
  });
  it('keeps absent context compatible with legacy Docker', async () => {
    const { adapter, docker } = setup();
    expect(await adapter.cleanup('legacy')).toBe(true);
    expect(docker.cleanup).toHaveBeenCalledTimes(1);
  });
  it('rejects a changed provider for new execution', () => {
    const { adapter, docker, vercel } = setup();
    expect(() =>
      adapter.execute({} as PracticeExecutionInput, context),
    ).toThrow('provider changed');
    expect(docker.execute).not.toHaveBeenCalled();
    expect(vercel.execute).not.toHaveBeenCalled();
  });
  it('uses the durable VM provider during recovery without Docker fallback', async () => {
    const { docker, vercel, resources } = setup();
    const localVm = {
      cleanup: jest.fn().mockResolvedValue(false),
      inspect: jest.fn(),
    };
    const adapter = new ExecutionRouterAdapter(
      { practiceRunnerProvider: 'docker' } as AppConfig,
      docker as unknown as DockerExecutionAdapter,
      vercel as unknown as VercelExecutionAdapter,
      resources as unknown as SandboxResourceRepository,
      localVm as unknown as LocalVmExecutionAdapter,
    );
    const saved = {
      provider: 'local-vm',
      runnerVersion: 'imp-03-quickjs.13',
    } as ExecutionContext;
    resources.loadContext.mockResolvedValue(saved);
    expect(await adapter.cleanup('execution', 5000)).toBe(false);
    expect(localVm.cleanup).toHaveBeenCalledWith('execution', 5000, saved);
    expect(docker.cleanup).not.toHaveBeenCalled();
    expect(vercel.cleanup).not.toHaveBeenCalled();
  });
});
