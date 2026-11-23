import type { PoolClient } from 'pg';
import type { Response } from 'express';
import { DatabaseService } from '../database/database.service';
import type { ApiRequest } from '../http/errors';
import { ExerciseBankController } from './exercise-bank.controller';
import { ExerciseBankService } from './exercise-bank.service';

const org = '10000000-0000-4000-8000-000000000001';
const exercise = '20000000-0000-4000-8000-000000000001';
const request = {
  actorId: '30000000-0000-4000-8000-000000000001',
  sessionId: '30000000-0000-4000-8000-000000000002',
  requestId: '30000000-0000-4000-8000-000000000003',
} as ApiRequest;
const observedAt = '2026-10-27T02:00:00.123456Z';
const page = { hasMore: false, nextCursor: null, totalFiltered: 0 };
const empty = { organizationId: org, observedAt, items: [], page };
const useCounts = { total: 0, draft: 0, published: 0, closed: 0 };
const entry = {
  id: exercise,
  organizationId: org,
  revision: 2,
  state: 'ACTIVE',
  visibility: 'PRIVATE',
  owner: { id: request.actorId, displayName: 'Autora del ejercicio' },
  currentVersion: {
    id: '40000000-0000-4000-8000-000000000001',
    version: 1,
    title: 'Suma',
    difficulty: 'BEGINNER',
    createdAt: observedAt,
    concepts: [],
  },
  versionCount: 25,
  useCounts,
};

function setup(payload: unknown = empty) {
  const client = {
    query: jest.fn(async () => ({ rows: [{ data: payload }] })),
  };
  const database = {
    readAs: jest.fn(
      async (
        _actor: string,
        action: (client: PoolClient) => Promise<unknown>,
      ) => action(client as unknown as PoolClient),
    ),
    writeAs: jest.fn(),
  };
  const service = new ExerciseBankService(
    database as unknown as DatabaseService,
  );
  return {
    client,
    database,
    controller: new ExerciseBankController(service),
  };
}

describe('consulta administrativa del banco sin efectos ni contenido pedagógico', () => {
  it('normaliza filtros y ejecuta una sola consulta con actor y sesión vigentes', async () => {
    const { controller, database, client } = setup();
    const result = await controller.list(request, org, { search: '  Suma  ' });
    expect(result).toEqual({ data: empty, requestId: request.requestId });
    expect(database.readAs).toHaveBeenCalledWith(
      request.actorId,
      expect.any(Function),
      request.sessionId,
    );
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(client.query).toHaveBeenCalledWith(
      'SELECT app_private.exercise_bank_list($1::uuid,$2::jsonb) AS data',
      [org, JSON.stringify({ limit: 20, search: 'Suma' })],
    );
    expect(database.writeAs).not.toHaveBeenCalled();
  });

  it.each([
    { organizationId: org },
    { ownerId: request.actorId },
    { role: 'ADMIN' },
    { state: 'PUBLISHED' },
    { visibility: 'PUBLIC' },
    { search: 'x'.repeat(161) },
    { limit: 101 },
    { limit: 0 },
    { cursor: 'invalid/cursor' },
  ])('rechaza filtros no permitidos antes de consultar %#', async (query) => {
    const { controller, database } = setup();
    await expect(controller.list(request, org, query)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      status: 422,
    });
    expect(database.readAs).not.toHaveBeenCalled();
  });

  it('consulta la versión vigente directamente aunque no pertenezca a la página histórica', async () => {
    const { controller, client, database } = setup({ ...entry, observedAt });
    const result = await controller.detail(request, exercise, {});
    expect(result.data.currentVersion.version).toBe(1);
    expect(result.data.versionCount).toBe(25);
    expect(client.query).toHaveBeenCalledWith(
      'SELECT app_private.exercise_bank_detail($1::uuid) AS data',
      [exercise],
    );
    expect(database.writeAs).not.toHaveBeenCalled();
  });

  it('rechaza filtros en el detalle y estados de actividad en versiones', async () => {
    const { controller, database } = setup();
    await expect(
      controller.detail(request, exercise, { role: 'ADMIN' }),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      controller.versions(request, exercise, { activityState: 'DRAFT' }),
    ).rejects.toMatchObject({ status: 422 });
    expect(database.readAs).not.toHaveBeenCalled();
  });

  it('versiones y usos se consultan con el recurso solicitado y filtros propios', async () => {
    const { controller, client, database } = setup({
      ...empty,
      exerciseId: exercise,
    });
    await controller.versions(request, exercise, {});
    await controller.uses(request, exercise, {
      versionId: entry.currentVersion.id,
      activityState: 'CLOSED',
      limit: '10',
    });
    expect(client.query).toHaveBeenNthCalledWith(
      1,
      'SELECT app_private.exercise_bank_versions($1::uuid,$2::jsonb) AS data',
      [exercise, JSON.stringify({ limit: 20 })],
    );
    expect(client.query).toHaveBeenNthCalledWith(
      2,
      'SELECT app_private.exercise_bank_uses($1::uuid,$2::jsonb) AS data',
      [
        exercise,
        JSON.stringify({
          limit: 10,
          versionId: entry.currentVersion.id,
          activityState: 'CLOSED',
        }),
      ],
    );
    expect(database.writeAs).not.toHaveBeenCalled();
  });

  it.each([
    { ...entry, owner: { ...entry.owner, email: 'private@alunza.test' } },
    {
      ...entry,
      currentVersion: { ...entry.currentVersion, tests: [] },
    },
    { ...entry, useCounts: { ...useCounts, total: 1 } },
  ])(
    'rechaza proyecciones sensibles o incoherentes aunque provengan de SQL %#',
    async (item) => {
      const { controller } = setup({ ...empty, items: [item] });
      await expect(controller.list(request, org, {})).rejects.toThrow();
    },
  );

  it('no convierte un fallo de lectura en vacío', async () => {
    const { controller, client } = setup();
    client.query.mockRejectedValueOnce(new Error('unavailable'));
    await expect(controller.list(request, org, {})).rejects.toThrow(
      'unavailable',
    );
  });

  it('sin actor y sesión no invoca lectura', async () => {
    const { controller, database } = setup();
    await expect(
      controller.list({ requestId: request.requestId } as ApiRequest, org, {}),
    ).rejects.toMatchObject({ status: 401 });
    expect(database.readAs).not.toHaveBeenCalled();
  });
});

describe('gobierno del banco: contrato y precondiciones', () => {
  const setupMutation = () => {
    const service = {
      govern: jest.fn(async () => ({ ...entry, observedAt })),
      content: jest.fn(),
    };
    const response = { setHeader: jest.fn() };
    return {
      service,
      response,
      controller: new ExerciseBankController(
        service as unknown as ExerciseBankService,
      ),
    };
  };
  it.each([
    {},
    { ownerId: 'bad' },
    { visibility: 'PUBLIC' },
    { visibility: 'PRIVATE', organizationId: org },
    { visibility: 'PRIVATE', role: 'ADMIN' },
  ])('rechaza política inválida antes de mutar %#', async (input) => {
    const { controller, service } = setupMutation();
    await expect(
      controller.govern(request, exercise, input, '"2"', 'bank-governance'),
    ).rejects.toMatchObject({ status: 422 });
    expect(service.govern).not.toHaveBeenCalled();
  });
  it.each([
    [undefined, 'bank-governance', 428],
    ['2', 'bank-governance', 400],
    ['"2"', undefined, 400],
  ])(
    'exige precondiciones sin ejecutar cambios %#',
    async (match, key, status) => {
      const { controller, service } = setupMutation();
      await expect(
        controller.govern(
          request,
          exercise,
          { visibility: 'PRIVATE' },
          match as string | undefined,
          key as string | undefined,
        ),
      ).rejects.toMatchObject({ status });
      expect(service.govern).not.toHaveBeenCalled();
    },
  );
  it('transporta actor, sesión, revisión y clave; devuelve ETag de la transacción', async () => {
    const { controller, service, response } = setupMutation();
    const result = await controller.govern(
      request,
      exercise,
      { visibility: 'PRIVATE' },
      '"2"',
      'bank-governance',
      response as unknown as Response,
    );
    expect(result.data.revision).toBe(2);
    expect(response.setHeader).toHaveBeenCalledWith('ETag', '"2"');
    expect(service.govern).toHaveBeenCalledWith(
      {
        actorId: request.actorId,
        sessionId: request.sessionId,
        requestId: request.requestId,
      },
      exercise,
      { visibility: 'PRIVATE' },
      2,
      'bank-governance',
    );
  });
  it('propaga fallo de persistencia sin inventar confirmación', async () => {
    const { controller, service, response } = setupMutation();
    service.govern.mockRejectedValueOnce(new Error('commit failed'));
    await expect(
      controller.govern(
        request,
        exercise,
        { visibility: 'PRIVATE' },
        '"2"',
        'bank-governance',
        response as unknown as Response,
      ),
    ).rejects.toThrow('commit failed');
    expect(response.setHeader).not.toHaveBeenCalled();
  });
  it('no acepta filtros arbitrarios para recuperar definición administrativa', async () => {
    const { controller, service } = setupMutation();
    await expect(
      controller.content(request, exercise, {
        versionId: entry.currentVersion.id,
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(service.content).not.toHaveBeenCalled();
  });
});
