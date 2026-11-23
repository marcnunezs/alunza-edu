import type { PoolClient } from 'pg';
import { ApiError } from '../http/errors';
import { DatabaseService } from '../database/database.service';
import { RuleVersionsService } from './rule-versions.service';
import type { SignalRuleCreate } from '@alunza/contracts';

const who = {
  actorId: '10000000-0000-4000-8000-000000000001',
  sessionId: '10000000-0000-4000-8000-000000000002',
  requestId: '10000000-0000-4000-8000-000000000003',
};
const organizationId = '20000000-0000-4000-8000-000000000001';
const id = '20000000-0000-4000-8000-000000000002';
const input: SignalRuleCreate = {
  type: 'INACTIVITY',
  schemaVersion: 1,
  algorithmVersion: 'DEC005_V1',
  parameters: { inactivityDays: 7 },
};
const rule = {
  ...input,
  id,
  organizationId,
  version: 1,
  state: 'DRAFT',
  createdBy: who.actorId,
  createdAt: '2026-10-05T12:00:00.123456Z',
  activatedBy: null,
  validFrom: null,
  validTo: null,
};

function setup(
  options: { inactive?: boolean; foreign?: boolean; forbidden?: boolean } = {},
) {
  const client = {
    query: jest.fn(async (sql: string) => {
      if (sql.includes('FROM app.profiles'))
        return {
          rows: [{ account_state: options.inactive ? 'DISABLED' : 'ACTIVE' }],
        };
      if (sql.includes('signal_rule_organization'))
        return {
          rows: [{ organization_id: options.foreign ? null : organizationId }],
        };
      if (sql.includes('FROM app.organizations'))
        return {
          rows: options.foreign
            ? []
            : [{ id: organizationId, archived_at: null }],
        };
      if (sql.includes('can_admin'))
        return { rows: [{ allowed: !options.forbidden }] };
      if (sql.includes('effective_signal_rules'))
        return {
          rows: [
            {
              result: {
                organizationId,
                observedAt: '2026-10-25T23:59:59.123456Z',
                rules: ['INACTIVITY', 'REPEATED_ERROR', 'STAGNATION'].map(
                  (type) => ({ type, ruleVersion: null }),
                ),
              },
            },
          ],
        };
      if (sql.includes('list_rule_versions'))
        return {
          rows: [
            {
              result: {
                data: [rule],
                page: { hasMore: false, nextCursor: null },
              },
            },
          ],
        };
      return { rows: [{ result: rule }] };
    }),
  };
  const transaction = async (
    _actor: string,
    action: (client: PoolClient) => Promise<unknown>,
  ) => action(client as unknown as PoolClient);
  const database = {
    readAs: jest.fn(transaction),
    writeAs: jest.fn(transaction),
  };
  return {
    client,
    database,
    service: new RuleVersionsService(database as unknown as DatabaseService),
  };
}

describe('autorización vigente y transacciones de versiones', () => {
  it('efectivas usa una RPC de lectura y conserva precisión y sesión', async () => {
    const { service, client, database } = setup();
    const result = await service.effective(who, organizationId);
    expect(result.observedAt).toBe('2026-10-25T23:59:59.123456Z');
    expect(database.readAs).toHaveBeenCalledWith(
      who.actorId,
      expect.any(Function),
      who.sessionId,
    );
    expect(database.writeAs).not.toHaveBeenCalled();
    expect(client.query).toHaveBeenCalledWith(
      'SELECT app_private.effective_signal_rules($1::uuid) AS result',
      [organizationId],
    );
    expect(
      client.query.mock.calls.filter(([sql]) =>
        sql.includes('effective_signal_rules'),
      ),
    ).toHaveLength(1);
  });

  it.each([
    [{ inactive: true }, 'ACCOUNT_INACTIVE'],
    [{ foreign: true }, 'RESOURCE_NOT_FOUND'],
    [{ forbidden: true }, 'FORBIDDEN'],
  ])(
    'efectivas rechaza permisos actuales antes de obtener parámetros %#',
    async (options, code) => {
      const { service, client } = setup(options);
      await expect(
        service.effective(who, organizationId),
      ).rejects.toMatchObject({ code });
      expect(
        client.query.mock.calls.some(([sql]) =>
          sql.includes('effective_signal_rules'),
        ),
      ).toBe(false);
    },
  );

  it('deriva organización autorizada de recurso antes de activar y conserva la sesión', async () => {
    const { service, client, database } = setup();
    await service.activate(
      who,
      id,
      { expectedCurrentVersionId: null },
      'activate-rule-key',
    );
    expect(database.writeAs).toHaveBeenCalledWith(
      who.actorId,
      expect.any(Function),
      who.sessionId,
    );
    expect(database.readAs).not.toHaveBeenCalled();
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('activate_rule_version'),
      [organizationId, id, null, 'activate-rule-key'],
    );
    expect(client.query).toHaveBeenCalledWith(
      "SELECT set_config('app.request_id',$1,true)",
      [who.requestId],
    );
    const queries = client.query.mock.calls.map(([sql]) => sql);
    expect(queries.findIndex((sql) => sql.includes('can_admin'))).toBeLessThan(
      queries.findIndex((sql) => sql.includes('activate_rule_version')),
    );
    expect(queries.some((sql) => sql.includes('FOR UPDATE'))).toBe(false);
  });

  it.each(['get', 'activate'] as const)(
    'oculta IDs de organización ajena en %s',
    async (method) => {
      const { service, client } = setup({ foreign: true });
      const action =
        method === 'get'
          ? service.get(who, id)
          : service.activate(
              who,
              id,
              { expectedCurrentVersionId: null },
              'activate-rule-key',
            );
      await expect(action).rejects.toMatchObject({
        code: 'RESOURCE_NOT_FOUND',
        status: 404,
      });
      expect(
        client.query.mock.calls.some(([sql]) =>
          sql.includes(`${method === 'get' ? 'get' : 'activate'}_rule_version`),
        ),
      ).toBe(false);
    },
  );

  it('un rol perdido impide incluso obtener la respuesta de una clave previa', async () => {
    const { service, client } = setup({ forbidden: true });
    await expect(
      service.create(who, organizationId, input, 'create-rule-key'),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    });
    expect(
      client.query.mock.calls.some(([sql]) =>
        sql.includes('create_rule_version'),
      ),
    ).toBe(false);
  });

  it('una cuenta inactiva no llega a reglas ni idempotencia', async () => {
    const { service, client } = setup({ inactive: true });
    await expect(
      service.list(who, organizationId, { limit: 50 }),
    ).rejects.toMatchObject({
      code: 'ACCOUNT_INACTIVE',
      status: 403,
    });
    expect(client.query).toHaveBeenCalledTimes(1);
  });

  it('el detalle de lectura conserva microsegundos y nunca abre una transacción de escritura', async () => {
    const { service, database } = setup();
    await expect(service.get(who, id)).resolves.toEqual(rule);
    expect(database.readAs).toHaveBeenCalledWith(
      who.actorId,
      expect.any(Function),
      who.sessionId,
    );
    expect(database.writeAs).not.toHaveBeenCalled();
  });

  it('propaga conflicto o fallo atómico sin inventar una versión confirmada', async () => {
    const { service, database } = setup();
    database.writeAs.mockRejectedValueOnce(
      new ApiError('RULE_VERSION_CONFLICT', 'La versión vigente cambió.', 409),
    );
    await expect(
      service.activate(
        who,
        id,
        { expectedCurrentVersionId: null },
        'activate-rule-key',
      ),
    ).rejects.toMatchObject({ code: 'RULE_VERSION_CONFLICT', status: 409 });
    database.writeAs.mockRejectedValueOnce(new Error('commit failed'));
    await expect(
      service.create(who, organizationId, input, 'create-rule-key'),
    ).rejects.toThrow('commit failed');
  });
});
