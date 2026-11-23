import { PracticeService } from './practice.service';
import { PracticeRepository } from './practice.repository';
import { ExecutionPort, failedRun } from './execution.port';
import { ApiError } from '../http/errors';
import { loadConfig } from '../config';
import type { RunExecution } from '@alunza/contracts';

const who = {
  actorId: '10000000-0000-4000-8000-000000000001',
  sessionId: '10000000-0000-4000-8000-000000000002',
  requestId: '10000000-0000-4000-8000-000000000003',
};
const activity = '20000000-0000-4000-8000-000000000001';
const assignment = '30000000-0000-4000-8000-000000000001';
const input = {
  code: 'module.exports.solve=n=>n*2;',
  exerciseVersionId: '40000000-0000-4000-8000-000000000001',
};
const reservation = {
  kind: 'reserved',
  executionId: '50000000-0000-4000-8000-000000000001',
  exerciseVersionId: input.exerciseVersionId,
  organizationId: '60000000-0000-4000-8000-000000000001',
  studentId: who.actorId,
  admittedAt: '2026-09-26T12:00:00.000Z',
  leaseToken: '70000000-0000-4000-8000-000000000001',
  visibleTotal: 1,
  runnerVersion: 'unit',
} as const;
const technical = failedRun('unit', 1);
const response: RunExecution = {
  executionId: reservation.executionId,
  exerciseVersionId: input.exerciseVersionId,
  mode: 'RUN',
  admittedAt: reservation.admittedAt,
  finishedAt: '2026-09-26T12:00:01.000Z',
  technicalResult: technical,
};
const context = {
  organizationId: reservation.organizationId,
  suiteHash: 'a'.repeat(64),
  tests: [{ id: 'visible', visibility: 'visible', args: [2], expected: 4 }],
};
function setup(enabled = true) {
  const events: string[] = [];
  const repository = {
    authorize: jest.fn(async () => {
      events.push('authorize');
      return context;
    }),
    admit: jest.fn(async () => {
      events.push('admit-committed');
      return { admission: reservation, context };
    }),
    finish: jest.fn(async () => {
      events.push('finish-committed');
      return response;
    }),
  };
  const execution = {
    requestClosed: jest.fn(),
    inspect: jest.fn(async () => ({ available: true, runnerVersion: 'unit' })),
    execute: jest.fn(async () => {
      events.push('execute');
      return { technicalResult: technical, cleanupVerified: true };
    }),
    cleanup: jest.fn(async () => {
      events.push('cleanup');
      return true;
    }),
  };
  const config = loadConfig({
    APP_ORIGIN: 'http://localhost:3000',
    DATABASE_URL: 'postgresql://alunza_app:unit@localhost/test',
    SUPABASE_JWKS_URL: 'http://localhost/auth/v1/.well-known/jwks.json',
    SUPABASE_JWT_ISSUER: 'http://localhost/auth/v1',
    PRACTICE_RUNNER_ENABLED: String(enabled),
  });
  const service = new PracticeService(
    repository as unknown as PracticeRepository,
    execution as unknown as ExecutionPort,
    config,
  );
  return { repository, execution, service, events };
}
describe('RUN orchestration', () => {
  it('propagates pre-admission capacity rejection without execution, cleanup or a false UNKNOWN result', async () => {
    const { service, execution, repository } = setup();
    repository.admit.mockRejectedValue(
      new ApiError('RUNNER_BUSY', 'Ocupado.', 503, true),
    );
    await expect(
      service.run(who, activity, assignment, input, 'run-key-busy'),
    ).rejects.toMatchObject({
      code: 'RUNNER_BUSY',
      retryable: true,
    });
    expect(execution.execute).not.toHaveBeenCalled();
    expect(execution.cleanup).not.toHaveBeenCalled();
    expect(repository.finish).not.toHaveBeenCalled();
  });
  it('commits admission before external execution and reauthorizes only after terminal commit', async () => {
    const { service, execution, events } = setup();
    await expect(
      service.run(who, activity, assignment, input, 'run-key-1'),
    ).resolves.toEqual(response);
    expect(events).toEqual([
      'authorize',
      'admit-committed',
      'execute',
      'finish-committed',
      'authorize',
    ]);
    expect(execution.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'RUN',
        entrypoint: 'solve',
        code: input.code,
        tests: context.tests,
      }),
    );
  });
  it('rejects access before touching Docker', async () => {
    const { service, execution, repository } = setup();
    repository.authorize.mockRejectedValueOnce(
      new ApiError('FORBIDDEN', 'No autorizado.', 403),
    );
    await expect(
      service.run(who, activity, assignment, input, 'run-key-1'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(execution.inspect).not.toHaveBeenCalled();
    expect(execution.execute).not.toHaveBeenCalled();
    expect(repository.admit).not.toHaveBeenCalled();
  });
  it('never dispatches or consumes another lease on completed replay, even disabled', async () => {
    const { service, execution, repository } = setup(false);
    repository.admit.mockResolvedValueOnce({
      admission: { kind: 'replay', response },
      context,
    } as never);
    await expect(
      service.run(who, activity, assignment, input, 'run-key-1'),
    ).resolves.toEqual(response);
    expect(execution.inspect).not.toHaveBeenCalled();
    expect(execution.execute).not.toHaveBeenCalled();
    expect(execution.cleanup).not.toHaveBeenCalled();
    expect(repository.authorize).toHaveBeenCalledTimes(2);
  });
  it('conserves an operational UNKNOWN after an exception and verified cleanup', async () => {
    const { service, execution, repository } = setup();
    execution.execute.mockRejectedValueOnce(
      new Error('private provider detail'),
    );
    await service.run(who, activity, assignment, input, 'run-key-1');
    expect(repository.finish).toHaveBeenCalledWith(
      reservation,
      expect.objectContaining({
        diagnosisCode: 'UNKNOWN',
        infrastructureStatus: 'FAILED',
        visibleTestResults: [],
      }),
      true,
    );
  });
  it('retains reservation for reconciliation when cleanup cannot be confirmed', async () => {
    const { service, execution, repository } = setup();
    execution.execute.mockResolvedValueOnce({
      technicalResult: technical,
      cleanupVerified: false,
    });
    execution.cleanup.mockResolvedValueOnce(false);
    repository.finish.mockResolvedValueOnce(null as never);
    await expect(
      service.run(who, activity, assignment, input, 'run-key-1'),
    ).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
    expect(repository.finish).toHaveBeenCalledWith(
      reservation,
      expect.objectContaining({
        diagnosisCode: 'UNKNOWN',
        infrastructureStatus: 'FAILED',
      }),
      false,
    );
  });
  it('does not add another cleanup deadline after the 40 second envelope elapsed', async () => {
    const { service, execution, repository } = setup();
    execution.execute.mockResolvedValueOnce({
      technicalResult: technical,
      cleanupVerified: false,
    });
    repository.finish.mockResolvedValueOnce(null as never);
    jest
      .spyOn(performance, 'now')
      .mockReturnValueOnce(0)
      .mockReturnValue(40_001);
    await expect(
      service.run(who, activity, assignment, input, 'run-key-1'),
    ).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
    expect(execution.cleanup).not.toHaveBeenCalled();
    expect(repository.finish).toHaveBeenCalledWith(
      reservation,
      expect.anything(),
      false,
    );
  });
  it('never confirms a result after failed persistence', async () => {
    const { service, repository } = setup();
    repository.finish.mockRejectedValueOnce(
      new ApiError('PERSISTENCE_UNAVAILABLE', 'No persistido.', 503, true),
    );
    await expect(
      service.run(who, activity, assignment, input, 'run-key-1'),
    ).rejects.toMatchObject({ code: 'PERSISTENCE_UNAVAILABLE' });
    expect(repository.authorize).toHaveBeenCalledTimes(1);
  });
  it('conserves terminal evidence but withholds response after permission revocation', async () => {
    const { service, repository } = setup();
    repository.authorize
      .mockResolvedValueOnce(context)
      .mockRejectedValueOnce(new ApiError('FORBIDDEN', 'Revocado.', 403));
    await expect(
      service.run(who, activity, assignment, input, 'run-key-1'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(repository.finish).toHaveBeenCalledTimes(1);
  });
});

describe('RUN configured Docker request closure', () => {
  const admitted = {
    provider: 'docker' as const,
    image: `sha256:${'a'.repeat(64)}`,
    runnerVersion: 'unit',
    engineId: 'engine-unit',
    runtimeName: 'alunza-crun',
    runtimeVersion: '1.31',
    runtimeSha256: 'b'.repeat(64),
    strategy: 'prepared-pair-v1' as const,
  };
  function configured() {
    const f = setup();
    f.execution.inspect.mockResolvedValue({
      available: true,
      runnerVersion: 'unit',
      context: admitted,
    } as never);
    f.repository.admit.mockResolvedValue({
      admission: { ...reservation, executionContext: admitted },
      context,
    } as never);
    return f;
  }
  it('passes admitted deadlines and notifies closure after persistence and final authorization', async () => {
    const f = configured();
    const responseClosed = new Promise<boolean>(() => undefined);
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);
    f.execution.requestClosed.mockImplementation(() => {
      expect(f.events.at(-1)).toBe('authorize');
      expect(f.repository.finish).toHaveBeenCalledTimes(1);
    });
    await expect(
      f.service.run(
        who,
        activity,
        assignment,
        input,
        'configured',
        responseClosed,
      ),
    ).resolves.toEqual(response);
    expect(f.execution.execute).toHaveBeenCalledWith(
      expect.anything(),
      admitted,
      {
        leaseToken: reservation.leaseToken,
        normalDeadlineMs: now + 30_000,
        cleanupDeadlineMs: now + 40_000,
      },
    );
    expect(f.execution.requestClosed).toHaveBeenCalledWith(
      reservation.executionId,
      admitted,
      { committed: true, cleanupVerified: true, responseClosed },
    );
  });
  it('uses the durable context for cleanup after execution failure', async () => {
    const f = configured();
    f.execution.execute.mockRejectedValueOnce(new Error('execution refused'));
    await f.service.run(who, activity, assignment, input, 'configured');
    expect(f.execution.cleanup).toHaveBeenCalledWith(
      reservation.executionId,
      expect.any(Number),
      admitted,
    );
  });
  it('does not permit replenishment after a failed commit', async () => {
    const f = configured();
    f.repository.finish.mockRejectedValueOnce(new Error('commit lost'));
    await expect(
      f.service.run(who, activity, assignment, input, 'configured'),
    ).rejects.toThrow('commit lost');
    expect(f.execution.requestClosed).toHaveBeenCalledWith(
      reservation.executionId,
      admitted,
      expect.objectContaining({ committed: false, cleanupVerified: true }),
    );
  });
});
