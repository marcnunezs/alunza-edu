import type { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import { ApiError } from '../http/errors';
import type { ApiRequest } from '../http/errors';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { auditQueryObservation, auditRoute } from './audit-observability';

const org = '10000000-0000-4000-8000-000000000001';
const actorId = '10000000-0000-4000-8000-000000000002';
const requestId = '10000000-0000-4000-8000-000000000003';
const sessionId = '10000000-0000-4000-8000-000000000004';
const empty = {
  organizationId: org,
  asOf: '2026-11-02T15:00:00.123456Z',
  items: [],
  page: { nextCursor: null, hasMore: false, totalFiltered: 0 },
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
  const request = {
    actorId,
    requestId,
    sessionId,
    method: 'GET',
  } as ApiRequest;
  return {
    client,
    database,
    request,
    controller: new AuditController(
      new AuditService(database as unknown as DatabaseService),
    ),
  };
}
test('authorized audit uses one read-only query and verified identity', async () => {
  const { controller, request, database, client } = setup();
  expect(await controller.list(request, org, {})).toEqual({
    data: empty,
    requestId,
  });
  expect(database.readAs).toHaveBeenCalledWith(
    actorId,
    expect.any(Function),
    sessionId,
  );
  expect(client.query).toHaveBeenCalledTimes(1);
  expect(client.query).toHaveBeenCalledWith(
    'SELECT app_private.audit_events_list($1::uuid,$2::jsonb) AS data',
    [org, '{"limit":20}'],
  );
  expect(database.writeAs).not.toHaveBeenCalled();
  expect(request.auditOrganizationId).toBe(org);
});
test('invalid query and invalid projection never tag an organization as authorized', async () => {
  const { controller, request, database } = setup();
  await expect(
    controller.list(request, org, { include: 'safe_changes' }),
  ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  expect(database.readAs).not.toHaveBeenCalled();
  expect(request.auditOrganizationId).toBeUndefined();
  const invalid = setup({ ...empty, private: 'SECRET' });
  await expect(
    invalid.controller.list(invalid.request, org, {}),
  ).rejects.toThrow();
  expect(invalid.request.auditOrganizationId).toBeUndefined();
});
test('persistence failure is not an empty successful response', async () => {
  const { controller, request, database } = setup();
  database.readAs.mockRejectedValueOnce(
    new ApiError('PERSISTENCE_UNAVAILABLE', 'No disponible.', 503, true),
  );
  await expect(controller.list(request, org, {})).rejects.toMatchObject({
    code: 'PERSISTENCE_UNAVAILABLE',
    status: 503,
  });
  expect(request.auditOrganizationId).toBeUndefined();
});
test('future cutoff is a field validation error without changing other readers', async () => {
  const { controller, request, client } = setup();
  client.query.mockRejectedValueOnce(
    Object.assign(new Error('INVALID_PROGRESS_CUTOFF'), { code: 'P0001' }),
  );
  await expect(
    controller.list(request, org, { asOf: '2099-01-01T00:00:00Z' }),
  ).rejects.toMatchObject({
    code: 'VALIDATION_FAILED',
    status: 422,
    fields: [{ field: 'asOf', message: expect.any(String) }],
  });
  expect(request.auditOrganizationId).toBeUndefined();
});
test.each([
  [200, 'SUCCEEDED'],
  [401, 'DENIED'],
  [403, 'DENIED'],
  [404, 'DENIED'],
  [422, 'INVALID'],
  [503, 'FAILED'],
])('audit observation %s has only safe context', (status, outcome) => {
  const { request } = setup();
  Object.assign(request, {
    query: { actorId: 'FOREIGN', cursor: 'SECRET' },
    headers: { authorization: 'SECRET' },
  });
  expect(auditQueryObservation(request, auditRoute, Number(status))).toEqual({
    event: 'audit.query',
    outcome,
    actorId,
  });
  expect(
    auditQueryObservation(
      { ...request, actorId: undefined } as ApiRequest,
      auditRoute,
      401,
    ),
  ).toEqual({ event: 'audit.query', outcome: 'DENIED' });
  expect(auditQueryObservation(request, '/api/v1/me', 200)).toEqual({});
});
