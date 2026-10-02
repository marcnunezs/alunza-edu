import { MaterialsRepository } from './materials.repository';
import type { DatabaseService } from '../database/database.service';
const who = {
  actorId: '10000000-0000-4000-8000-000000000001',
  sessionId: '10000000-0000-4000-8000-000000000002',
  requestId: '10000000-0000-4000-8000-000000000003',
};
const config = { id: 'fixture-3d', model: 'synthetic', dimensions: 3 };
test('invalid retrieval vector is rejected before opening a database transaction', async () => {
  const database = { readAs: jest.fn() };
  const repository = new MaterialsRepository(
    database as unknown as DatabaseService,
  );
  await expect(
    repository.retrieve(who, 'class', 'activity', config, [1, Number.NaN, 0]),
  ).rejects.toMatchObject({ reason: 'INVALID_VECTOR' });
  expect(database.readAs).not.toHaveBeenCalled();
});
test('product retrieval preserves verified session and parameters for the authorized SQL function', async () => {
  const row = {
    source_id: 'source',
    source_version_id: 'version',
    chunk_id: 'chunk',
    locator: 'Página 1',
    text: 'Texto autorizado',
    distance: 0.2,
  };
  const client = { query: jest.fn().mockResolvedValue({ rows: [row] }) };
  const database = {
    readAs: jest
      .fn()
      .mockImplementation(
        async (_actor: string, run: (client: unknown) => Promise<unknown>) =>
          run(client),
      ),
  };
  const repository = new MaterialsRepository(
    database as unknown as DatabaseService,
  );
  await expect(
    repository.retrieve(who, 'class', 'activity', config, [1, 0, 0]),
  ).resolves.toEqual([row]);
  expect(database.readAs).toHaveBeenCalledWith(
    who.actorId,
    expect.any(Function),
    who.sessionId,
  );
  expect(client.query).toHaveBeenCalledWith(
    'SELECT * FROM app_private.material_retrieve($1::uuid,$2::uuid,$3,$4,$5::extensions.vector)',
    ['class', 'activity', 'fixture-3d', 3, '[1,0,0]'],
  );
});
