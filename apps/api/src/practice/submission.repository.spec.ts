import type { PoolClient } from 'pg';
import { SubmissionRepository } from './submission.repository';
import { DatabaseService } from '../database/database.service';
import { ApiError } from '../http/errors';

const who = {
  actorId: '10000000-0000-4000-8000-000000000001',
  sessionId: '10000000-0000-4000-8000-000000000002',
  requestId: '10000000-0000-4000-8000-000000000003',
};
const version = '10000000-0000-4000-8000-000000000004';
const admission = {
  kind: 'reserved',
  executionId: '10000000-0000-4000-8000-000000000005',
  exerciseVersionId: version,
  organizationId: '10000000-0000-4000-8000-000000000006',
  studentId: who.actorId,
  admittedAt: '2026-09-26T12:00:00Z',
  leaseToken: '10000000-0000-4000-8000-000000000007',
  visibleTotal: 1,
  runnerVersion: 'unit',
  testsVersion: 'a'.repeat(64),
  attemptNumber: 1,
};

describe('SUBMIT transaction identity', () => {
  function setup() {
    const scopedClients = new WeakSet<object>();
    const clients: PoolClient[] = [];
    const queries: string[] = [];
    const access = { allowed: true, version };
    const transaction = async (
      _actor: string,
      action: (client: PoolClient) => Promise<unknown>,
    ) => {
      const client = {
        query: jest.fn(async (sql: string, values: unknown[]) => {
          queries.push(sql);
          if (sql.includes("set_config('app.organization_id'")) {
            if (values[0] !== admission.organizationId)
              throw new Error(
                'Organization must be derived from current database access.',
              );
            scopedClients.add(client);
            return { rows: [] };
          }
          if (sql.includes('admit_practice_submit')) {
            if (!scopedClients.has(client))
              throw new ApiError(
                'FORBIDDEN',
                'Missing transaction organization.',
                403,
              );
            return { rows: [{ admission }] };
          }
          return {
            rows: access.allowed
              ? [
                  {
                    organization_id: admission.organizationId,
                    exercise_version_id: access.version,
                  },
                ]
              : [],
          };
        }),
      } as unknown as PoolClient;
      clients.push(client);
      return action(client);
    };
    const database = {
      readAs: jest.fn(transaction),
      writeAs: jest.fn(transaction),
    };
    const repository = new SubmissionRepository(
      database as unknown as DatabaseService,
    );
    return { repository, database, clients, queries, access };
  }

  it('resolves organization again inside admission instead of relying on expired read context', async () => {
    const { repository, clients, database } = setup();
    await repository.authorize(who, 'activity', 'assignment', version);
    await expect(
      repository.admit(
        who,
        'activity',
        'assignment',
        { exerciseVersionId: version, code: 'code' },
        'submit-key-1',
        { available: true, runnerVersion: 'unit' },
        {
          actorConcurrency: 1,
          submitActorConcurrency: 2,
          organizationConcurrency: 4,
          actorRequestsPerMinute: 10,
        },
      ),
    ).resolves.toEqual(admission);
    expect(clients).toHaveLength(2);
    expect(clients[0]).not.toBe(clients[1]);
    expect(clients[1]!.query).toHaveBeenCalledWith(
      "SELECT set_config('app.organization_id',$1,true)",
      [admission.organizationId],
    );
    expect(database.writeAs).toHaveBeenCalledWith(
      who.actorId,
      expect.any(Function),
      who.sessionId,
    );
  });

  it('rejects a changed role in the admission transaction before invoking internal SQL', async () => {
    const { repository, access, queries } = setup();
    await repository.authorize(who, 'activity', 'assignment', version);
    access.allowed = false;
    await expect(
      repository.admit(
        who,
        'activity',
        'assignment',
        { exerciseVersionId: version, code: 'code' },
        'submit-key-1',
        { available: true, runnerVersion: 'unit' },
        {
          actorConcurrency: 1,
          submitActorConcurrency: 2,
          organizationConcurrency: 4,
          actorRequestsPerMinute: 10,
        },
      ),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    expect(queries.some((sql) => sql.includes('admit_practice_submit'))).toBe(
      false,
    );
    expect(queries.some((sql) => sql.includes('set_config'))).toBe(false);
  });
  it('retains VERSION_CONFLICT for an accessible assignment with a different version', async () => {
    const { repository, access } = setup();
    access.version = '10000000-0000-4000-8000-000000000099';
    await expect(
      repository.authorize(who, 'activity', 'assignment', version),
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
  });
});
