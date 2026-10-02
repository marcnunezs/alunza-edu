import { SubmissionService } from './submission.service';
import { SubmissionRepository } from './submission.repository';
import {
  SubmissionExecutionPort,
  failedSubmission,
} from './submission-execution.port';
import { ExecutionPort } from './execution.port';
import { ApiError } from '../http/errors';
import { loadConfig } from '../config';
import type { Attempt } from '@alunza/contracts';

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
  testsVersion: 'a'.repeat(64),
  attemptNumber: 1,
} as const;
const canonical = failedSubmission('unit', 1);
const response: Attempt = {
  attemptId: '80000000-0000-4000-8000-000000000001',
  executionId: reservation.executionId,
  activityId: activity,
  assignmentId: assignment,
  exerciseVersionId: input.exerciseVersionId,
  testsVersion: reservation.testsVersion,
  attemptNumber: 1,
  previousAttemptId: null,
  admittedAt: reservation.admittedAt,
  submittedAt: '2026-09-26T12:00:01.000Z',
  code: input.code,
  technicalResult: canonical.technicalResult,
};
const suite = {
  testsVersion: reservation.testsVersion,
  tests: [
    { id: 'visible', visibility: 'visible', args: [2], expected: 4 },
    { id: 'hidden', visibility: 'hidden', args: [9], expected: 18 },
  ],
};
function setup(enabled = true) {
  const events: string[] = [];
  const repository = {
    authorize: jest.fn(async () => {
      events.push('authorize');
    }),
    admit: jest.fn(async () => {
      events.push('admit-committed');
      return reservation;
    }),
    suite: jest.fn(async () => {
      events.push('suite');
      return suite;
    }),
    stage: jest.fn(async () => {
      events.push('result-committed');
      return true;
    }),
    finish: jest.fn(async () => {
      events.push('attempt-committed');
      return response;
    }),
  };
  const execution = {
    execute: jest.fn(async () => {
      events.push('execute');
      return { ...canonical, cleanupVerified: true };
    }),
  };
  const lifecycle = {
    inspect: jest.fn(async () => ({ available: true, runnerVersion: 'unit' })),
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
  const service = new SubmissionService(
    repository as unknown as SubmissionRepository,
    execution as unknown as SubmissionExecutionPort,
    lifecycle as unknown as ExecutionPort,
    config,
  );
  return { service, repository, execution, lifecycle, events };
}
describe('SUBMIT durability and current access', () => {
  it('reserves before full suite execution, stores evidence and commits before delivery', async () => {
    const { service, execution, repository, events } = setup();
    await expect(
      service.submit(who, activity, assignment, input, 'submit-key-1'),
    ).resolves.toEqual(response);
    expect(events).toEqual([
      'authorize',
      'admit-committed',
      'suite',
      'execute',
      'result-committed',
      'attempt-committed',
      'authorize',
    ]);
    expect(execution.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'SUBMIT',
        code: input.code,
        tests: suite.tests,
      }),
    );
    expect(repository.admit.mock.calls[0]?.at(-1)).toEqual(
      expect.objectContaining({
        actorConcurrency: 1,
        submitActorConcurrency: 2,
        organizationConcurrency: 4,
        actorRequestsPerMinute: 10,
      }),
    );
  });
  it('denies before provider inspection or admission', async () => {
    const { service, repository, lifecycle, execution } = setup();
    repository.authorize.mockRejectedValueOnce(
      new ApiError('FORBIDDEN', 'Revocado.', 403),
    );
    await expect(
      service.submit(who, activity, assignment, input, 'submit-key-1'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(lifecycle.inspect).not.toHaveBeenCalled();
    expect(execution.execute).not.toHaveBeenCalled();
    expect(repository.admit).not.toHaveBeenCalled();
  });
  it('recovers committed response while runner disabled without loading suite or reexecuting', async () => {
    const { service, repository, execution, lifecycle, events } = setup(false);
    repository.admit.mockResolvedValueOnce({
      kind: 'replay',
      response,
    } as never);
    await expect(
      service.submit(who, activity, assignment, input, 'submit-key-1'),
    ).resolves.toEqual(response);
    expect(events).toEqual(['authorize', 'authorize']);
    expect(repository.suite).not.toHaveBeenCalled();
    expect(execution.execute).not.toHaveBeenCalled();
    expect(lifecycle.inspect).not.toHaveBeenCalled();
  });
  it('revalidates permissions even on replay', async () => {
    const { service, repository } = setup(false);
    repository.admit.mockResolvedValueOnce({
      kind: 'replay',
      response,
    } as never);
    repository.authorize
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new ApiError('FORBIDDEN', 'Revocado.', 403));
    await expect(
      service.submit(who, activity, assignment, input, 'submit-key-1'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('normalizes provider failure with no private text and verifies cleanup', async () => {
    const { service, repository, execution, lifecycle } = setup();
    execution.execute.mockRejectedValueOnce(
      new Error('secret hidden arguments'),
    );
    await service.submit(who, activity, assignment, input, 'submit-key-1');
    expect(repository.stage).toHaveBeenCalledWith(
      reservation,
      expect.objectContaining({
        technicalResult: expect.objectContaining({
          diagnosisCode: 'UNKNOWN',
          infrastructureStatus: 'FAILED',
          allRequiredPassed: false,
          hiddenChecksPassed: null,
        }),
        privateTestResults: [],
      }),
    );
    expect(lifecycle.cleanup).toHaveBeenCalledTimes(1);
    expect(repository.finish).toHaveBeenCalledWith(reservation, true);
  });
  it('never announces an attempt after staged evidence commit fails', async () => {
    const { service, repository } = setup();
    repository.stage.mockRejectedValueOnce(
      new ApiError('PERSISTENCE_UNAVAILABLE', 'No persistido.', 503, true),
    );
    await expect(
      service.submit(who, activity, assignment, input, 'submit-key-1'),
    ).rejects.toMatchObject({ code: 'PERSISTENCE_UNAVAILABLE' });
    expect(repository.finish).not.toHaveBeenCalled();
    expect(repository.authorize).toHaveBeenCalledTimes(1);
  });
  it('preserves staged evidence when attempt commit fails', async () => {
    const { service, repository, events } = setup();
    repository.finish.mockRejectedValueOnce(
      new ApiError('PERSISTENCE_UNAVAILABLE', 'No persistido.', 503, true),
    );
    await expect(
      service.submit(who, activity, assignment, input, 'submit-key-1'),
    ).rejects.toMatchObject({ code: 'PERSISTENCE_UNAVAILABLE' });
    expect(events).toContain('result-committed');
    expect(repository.authorize).toHaveBeenCalledTimes(1);
  });
  it('fences a stale worker whose lease no longer permits staging', async () => {
    const { service, repository } = setup();
    repository.stage.mockResolvedValueOnce(false);
    await expect(
      service.submit(who, activity, assignment, input, 'submit-key-1'),
    ).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
    expect(repository.finish).not.toHaveBeenCalled();
  });
  it('does not deliver persisted evidence after permission revocation', async () => {
    const { service, repository } = setup();
    repository.authorize
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new ApiError('FORBIDDEN', 'Revocado.', 403));
    await expect(
      service.submit(who, activity, assignment, input, 'submit-key-1'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(repository.finish).toHaveBeenCalledTimes(1);
  });
  it('retains slot and rejects delivery until cleanup is verified', async () => {
    const { service, repository, execution, lifecycle } = setup();
    execution.execute.mockResolvedValueOnce({
      ...canonical,
      cleanupVerified: false,
    });
    lifecycle.cleanup.mockResolvedValueOnce(false);
    repository.finish.mockResolvedValueOnce(null as never);
    await expect(
      service.submit(who, activity, assignment, input, 'submit-key-1'),
    ).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
    expect(repository.finish).toHaveBeenCalledWith(reservation, false);
  });
  it.each([true, false])(
    'preserves valid evidence while retrying cleanup (cleaned=%s)',
    async (cleaned) => {
      const { service, repository, execution, lifecycle } = setup();
      const completed = {
        technicalResult: {
          ...canonical.technicalResult,
          diagnosisCode: 'SUCCESS' as const,
          terminationReason: 'COMPLETED' as const,
          infrastructureStatus: 'OK' as const,
          visibleTestResults: [
            { id: 'visible', passed: true, stdout: '', stderr: '' },
          ],
          visiblePassed: 1,
          hiddenChecksPassed: true,
          allRequiredPassed: true,
        },
        privateTestResults: [{ id: 'hidden', passed: true }],
      };
      execution.execute.mockResolvedValueOnce({
        ...completed,
        cleanupVerified: false,
      });
      lifecycle.cleanup.mockResolvedValueOnce(cleaned);
      if (!cleaned) repository.finish.mockResolvedValueOnce(null as never);
      const operation = service.submit(
        who,
        activity,
        assignment,
        input,
        'submit-key-1',
      );
      if (cleaned) await expect(operation).resolves.toEqual(response);
      else
        await expect(operation).rejects.toMatchObject({
          code: 'DEPENDENCY_UNAVAILABLE',
        });
      expect(repository.stage).toHaveBeenCalledWith(reservation, completed);
      expect(repository.finish).toHaveBeenCalledWith(reservation, cleaned);
    },
  );
  it('keeps cleanup inside the shared forty second operation envelope', async () => {
    const { service, repository, execution, lifecycle } = setup();
    execution.execute.mockResolvedValueOnce({
      ...canonical,
      cleanupVerified: false,
    });
    repository.finish.mockResolvedValueOnce(null as never);
    jest
      .spyOn(performance, 'now')
      .mockReturnValueOnce(0)
      .mockReturnValue(40_001);
    await expect(
      service.submit(who, activity, assignment, input, 'submit-key-1'),
    ).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
    expect(lifecycle.cleanup).not.toHaveBeenCalled();
  });
});
