import type { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import { SandboxResourceRepository } from './sandbox-resource.repository';

const executionId = '10000000-0000-4000-8000-000000000001';
const creationId = '10000000-0000-4000-8000-000000000002';
const leaseToken = '10000000-0000-4000-8000-000000000003';
const resource = {
  executionId,
  creationId,
  sandboxName: `alunza-practice-${executionId}`,
  providerResourceId: null,
  creationState: 'UNKNOWN',
  cleanupState: 'PENDING',
  cleanupProof: null,
  context: {
    provider: 'vercel',
    image: `alunza/runner@sha256:${'a'.repeat(64)}`,
    runnerVersion: 'test',
    teamId: 'team_test',
    projectId: 'prj_test',
    region: 'iad1',
    campaignId: '10000000-0000-4000-8000-000000000004',
    expiresAt: '2026-12-01T00:00:00Z',
    maxCreations: 1,
    maxRequests: 10,
  },
};
function setup() {
  const query = jest.fn().mockResolvedValue({ rows: [{ resource }] });
  const internal = jest.fn(
    async (action: (client: PoolClient) => Promise<unknown>) =>
      action({ query } as unknown as PoolClient),
  );
  return {
    repository: new SandboxResourceRepository({
      internal,
    } as unknown as DatabaseService),
    query,
    internal,
  };
}

describe('Sandbox durable resource boundary', () => {
  it('loads either admitted provider and treats absent context as legacy', async () => {
    const { repository, query } = setup();
    const docker = {
      provider: 'docker',
      image: `sha256:${'b'.repeat(64)}`,
      runnerVersion: 'test',
    };
    query.mockResolvedValueOnce({ rows: [{ context: docker }] });
    await expect(repository.loadContext(executionId)).resolves.toEqual(docker);
    query.mockResolvedValueOnce({ rows: [{ context: resource.context }] });
    await expect(repository.loadContext(executionId)).resolves.toEqual(
      resource.context,
    );
    query.mockResolvedValueOnce({ rows: [{ context: null }] });
    await expect(repository.loadContext(executionId)).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('read_practice_execution_context'),
      [executionId],
    );
  });

  it('returns creation authority only after the internal transaction commits', async () => {
    let release!: () => void;
    const committed = new Promise<void>((resolve) => {
      release = resolve;
    });
    const database = {
      internal: jest.fn(
        async (action: (client: PoolClient) => Promise<unknown>) => {
          const result = await action({
            query: jest.fn().mockResolvedValue({ rows: [{ resource }] }),
          } as unknown as PoolClient);
          await committed;
          return result;
        },
      ),
    };
    const repository = new SandboxResourceRepository(
      database as unknown as DatabaseService,
    );
    let completed = false;
    const pending = repository
      .beginCreation(executionId, leaseToken)
      .then((value) => {
        completed = true;
        return value;
      });
    await Promise.resolve();
    expect(completed).toBe(false);
    release();
    await expect(pending).resolves.toEqual(resource);
  });

  it('does not return a dispatch receipt when commit fails', async () => {
    const database = {
      internal: jest.fn().mockRejectedValue(new Error('commit lost')),
    };
    const repository = new SandboxResourceRepository(
      database as unknown as DatabaseService,
    );
    await expect(
      repository.beginCreation(executionId, leaseToken),
    ).rejects.toThrow('commit lost');
  });

  it('uses immutable creation identity for late receipts, not an expired lease', async () => {
    const { repository, query } = setup();
    query.mockResolvedValue({
      rows: [
        {
          resource: {
            ...resource,
            creationState: 'CONFIRMED',
            providerResourceId: 'sbx-1',
          },
        },
      ],
    });
    await repository.confirmResource(executionId, creationId, 'sbx-1');
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('confirm_sandbox_resource'),
      [executionId, creationId, 'sbx-1'],
    );
  });

  it('rejects TTL or incomplete absence evidence before touching the database', async () => {
    const { repository, internal } = setup();
    expect(() =>
      repository.verifyCleanup(executionId, {
        creationId,
        kind: 'TTL_EXPIRED',
      } as never),
    ).toThrow();
    expect(() =>
      repository.verifyCleanup(executionId, {
        creationId,
        kind: 'ABSENT_AND_ZERO_SNAPSHOTS',
        sandboxId: 'sbx-1',
        lookupAbsent: true,
      } as never),
    ).toThrow();
    expect(internal).not.toHaveBeenCalled();
  });

  it('awaits and propagates durable campaign budget exhaustion', async () => {
    const { repository, query } = setup();
    query.mockRejectedValue(new Error('budget exhausted'));
    await expect(
      repository.consumeRequest(executionId, creationId, true),
    ).rejects.toThrow('budget exhausted');
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('consume_sandbox_request'),
      [executionId, creationId, true],
    );
  });

  it('does not replace a malformed persisted provider context with current settings', async () => {
    const { repository, query } = setup();
    query.mockResolvedValue({
      rows: [
        {
          resource: {
            ...resource,
            context: { ...resource.context, image: 'latest' },
          },
        },
      ],
    });
    await expect(repository.load(executionId)).rejects.toThrow();
  });
});
