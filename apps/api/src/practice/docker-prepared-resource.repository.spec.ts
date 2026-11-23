import type { DatabaseService } from '../database/database.service';
import { DockerPreparedResourceRepository } from './docker-prepared-resource.repository';
import type { PreparedDockerContext } from '@alunza/runner';

const id = (n: number) =>
  `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const context: PreparedDockerContext = {
  provider: 'docker',
  image: `sha256:${'a'.repeat(64)}`,
  runnerVersion: 'unit',
  engineId: 'engine-unit',
  runtimeName: 'alunza-crun',
  runtimeVersion: '1.31',
  runtimeSha256: 'b'.repeat(64),
  strategy: 'prepared-pair-v1',
};
const pair = {
  pairId: id(1),
  context,
  ownerToken: id(2),
  creatorToken: id(2),
  recoveryOnly: false,
  leaseExpiresAt: '2070-01-01T00:01:00Z',
  expiresAt: '2070-01-01T00:01:00Z',
  state: 'PREPARING',
  executionId: null,
  slots: [3, 4].map((n) => ({
    resourceId: id(n),
    name: `alunza-laboratorio-runner-${id(n)}`,
    containerId: null,
    creationState: 'PREPARED',
    cleanupState: 'PENDING',
  })),
};
function setup(value: unknown = null) {
  const query = jest.fn().mockResolvedValue({ rows: [{ value }] });
  let committed = false;
  const database = {
    internal: jest.fn(
      async (
        operation: (client: { query: typeof query }) => Promise<unknown>,
      ) => {
        const output = await operation({ query });
        committed = true;
        return output;
      },
    ),
  };
  return {
    repository: new DockerPreparedResourceRepository(
      database as unknown as DatabaseService,
    ),
    query,
    database,
    committed: () => committed,
  };
}

describe('private durable Docker resource repository', () => {
  it('returns a reserve only after the private transaction commits and preserves exact context', async () => {
    const f = setup(pair);
    expect(await f.repository.reservePair(context, id(2))).toEqual(pair);
    expect(f.committed()).toBe(true);
    expect(f.query).toHaveBeenCalledWith(
      'SELECT app_private.docker_reserve_pair($1::jsonb,$2::uuid) AS value',
      [JSON.stringify(context), id(2)],
    );
  });

  it('retains a busy engine as null and never manufactures a reserve', async () => {
    expect(await setup().repository.reservePair(context, id(2))).toBeNull();
  });

  it.each([
    { context: { ...context, engineId: 'foreign-engine' } },
    { ownerToken: id(9) },
    { creatorToken: id(9) },
    { recoveryOnly: true },
    { slots: [pair.slots[0], pair.slots[0]] },
    { slots: [{ ...pair.slots[0], name: 'other-container' }, pair.slots[1]] },
  ])('rejects mismatched or untrusted reserve identity %j', async (patch) => {
    await expect(
      setup({ ...pair, ...patch }).repository.reservePair(context, id(2)),
    ).rejects.toThrow();
  });

  it('confirms a late identity without granting execution authority or requiring an expired owner token', async () => {
    const f = setup();
    await f.repository.confirmCreated(id(1), id(3), 'c'.repeat(64));
    expect(f.query).toHaveBeenCalledWith(
      'SELECT app_private.docker_confirm_created($1::uuid,$2::uuid,$3) AS value',
      [id(1), id(3), 'c'.repeat(64)],
    );
  });

  it('binds assignment to its exact execution and owner and rejects recovery-only ownership', async () => {
    const assigned = { ...pair, state: 'ASSIGNED', executionId: id(5) };
    const f = setup(assigned);
    expect(await f.repository.assignPair(id(1), id(2), id(5), id(6))).toEqual(
      assigned,
    );
    expect(f.query).toHaveBeenCalledWith(
      'SELECT app_private.docker_assign_pair($1::uuid,$2::uuid,$3::uuid,$4::uuid) AS value',
      [id(1), id(2), id(5), id(6)],
    );
    for (const patch of [
      { executionId: id(9) },
      { recoveryOnly: true },
      { state: 'READY' },
    ])
      await expect(
        setup({ ...assigned, ...patch }).repository.assignPair(
          id(1),
          id(2),
          id(5),
          id(6),
        ),
      ).rejects.toThrow();
  });

  it('accepts only named absence evidence and validates inputs before database access', async () => {
    const f = setup();
    await f.repository.markClean(id(1), id(3), {
      kind: 'ABSENT',
      containerId: 'c'.repeat(64),
    });
    expect(f.query).toHaveBeenCalledWith(
      'SELECT app_private.docker_mark_clean($1::uuid,$2::uuid,$3::jsonb) AS value',
      [
        id(1),
        id(3),
        JSON.stringify({ kind: 'ABSENT', containerId: 'c'.repeat(64) }),
      ],
    );
    f.query.mockClear();
    await expect(
      f.repository.markClean(id(1), id(3), {
        kind: 'ABSENT',
        containerId: 'short',
      }),
    ).rejects.toThrow();
    await expect(
      f.repository.confirmCreated(id(1), 'malformed', 'c'.repeat(64)),
    ).rejects.toThrow();
    expect(f.query).not.toHaveBeenCalled();
  });

  it('recovers earlier image/runtime settings only on the same engine with rotated cleanup-only ownership', async () => {
    const recovered = {
      ...pair,
      ownerToken: id(9),
      recoveryOnly: true,
      context: {
        ...context,
        runtimeName: 'earlier-runtime',
        image: `sha256:${'d'.repeat(64)}`,
      },
    };
    expect(
      await setup([recovered]).repository.claimRecovery(context, id(9)),
    ).toEqual([recovered]);
    for (const patch of [
      { recoveryOnly: false },
      { ownerToken: id(2) },
      { context: { ...context, engineId: 'other' } },
    ])
      await expect(
        setup([{ ...recovered, ...patch }]).repository.claimRecovery(
          context,
          id(9),
        ),
      ).rejects.toThrow();
  });

  it('never substitutes current configuration when listing the execution resources', async () => {
    const assigned = { ...pair, state: 'ASSIGNED', executionId: id(5) };
    expect(
      await setup([assigned]).repository.listExecutionPairs(id(5), context),
    ).toEqual([assigned]);
    await expect(
      setup([assigned]).repository.listExecutionPairs(id(5), {
        ...context,
        runtimeName: 'changed',
      }),
    ).rejects.toThrow();
  });

  it('discovers unassigned reserve context from the current engine without runtime configuration', async () => {
    const f = setup([context]);
    expect(await f.repository.recoveryContexts(context.engineId)).toEqual([
      context,
    ]);
    expect(f.query).toHaveBeenCalledWith(
      'SELECT app_private.docker_recovery_contexts($1) AS value',
      [context.engineId],
    );
    await expect(
      setup([{ ...context, engineId: 'foreign' }]).repository.recoveryContexts(
        context.engineId,
      ),
    ).rejects.toThrow();
  });
});
