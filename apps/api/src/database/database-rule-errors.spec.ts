import type { Pool, PoolClient } from 'pg';
import { DatabaseService } from './database.service';
import type { AppConfig } from '../config';
import { ApiError } from '../http/errors';

describe('errores transaccionales seguros de reglas y consultas', () => {
  let service: DatabaseService;
  let client: PoolClient;

  beforeEach(() => {
    service = new DatabaseService({
      databaseUrl: 'postgresql://alunza_app:fixture@127.0.0.1:1/fixture',
      databaseSsl: false,
    } as AppConfig);
    client = {
      on: jest.fn(),
      removeListener: jest.fn(),
      release: jest.fn(),
      query: jest.fn(async (sql: string) => ({
        rows: sql.includes('current_user') ? [{ allowed: true }] : [],
      })),
    } as unknown as PoolClient;
    const pool = (service as unknown as { pool: Pool }).pool;
    jest.spyOn(pool, 'connect').mockResolvedValue(client as never);
  });

  afterEach(async () => {
    await service.onApplicationShutdown();
  });

  it('normaliza rechazo de propietario en persistencia y revierte sin exponer detalles', async () => {
    await expect(
      service.writeAs('fixture-actor', async () => {
        throw Object.assign(new Error('EXERCISE_OWNER_INVALID'), {
          code: '23514',
          detail: 'private state',
        });
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      status: 422,
      fields: [{ field: 'ownerId', message: expect.any(String) }],
    });
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.query).not.toHaveBeenCalledWith('COMMIT');
  });

  it.each([
    ['RULE_VERSION_CONFLICT', 409, 'RULE_VERSION_CONFLICT', null],
    [
      'RULE_VERSION_ALREADY_ACTIVATED',
      409,
      'RULE_VERSION_ALREADY_ACTIVATED',
      null,
    ],
    ['RULE_PARAMETERS_INVALID', 422, 'VALIDATION_FAILED', 'parameters'],
    ['RULE_CURSOR_INVALID', 422, 'VALIDATION_FAILED', 'cursor'],
    ['DASHBOARD_CURSOR_INVALID', 422, 'VALIDATION_FAILED', 'cursor'],
    ['DASHBOARD_PERIOD_INVALID', 422, 'VALIDATION_FAILED', 'from'],
    ['DASHBOARD_FILTER_INVALID', 422, 'VALIDATION_FAILED', 'filters'],
    ['EXERCISE_BANK_CURSOR_INVALID', 422, 'VALIDATION_FAILED', 'cursor'],
    ['EXERCISE_BANK_FILTER_INVALID', 422, 'VALIDATION_FAILED', 'filters'],
    ['AUDIT_CURSOR_INVALID', 422, 'VALIDATION_FAILED', 'cursor'],
    ['AUDIT_FILTER_INVALID', 422, 'VALIDATION_FAILED', 'filters'],
    ['AUDIT_PERIOD_INVALID', 422, 'VALIDATION_FAILED', 'from'],
  ])(
    'revierte %s y entrega el código y campo públicos esperados',
    async (message, status, code, field) => {
      const failure: unknown = await service
        .writeAs('fixture-actor', async () => {
          throw Object.assign(new Error(message), {
            code: 'P0001',
            detail: 'private database state',
          });
        })
        .catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(ApiError);
      if (!(failure instanceof ApiError))
        throw new Error('Expected a safe API error.');
      expect(failure.getStatus()).toBe(status);
      expect(failure.code).toBe(code);
      expect(failure.retryable).toBe(false);
      expect(failure.fields.map((item) => item.field)).toEqual(
        field ? [field] : [],
      );
      expect(failure.publicMessage).not.toContain('private database');
      expect(client.query).toHaveBeenCalledWith('ROLLBACK');
      expect(client.query).not.toHaveBeenCalledWith('COMMIT');
      expect(client.release).toHaveBeenCalledWith(false);
    },
  );
});
