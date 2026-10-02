import type { Pool, PoolClient } from 'pg';
import { DatabaseService } from './database.service';
import type { AppConfig } from '../config';
import { ApiError } from '../http/errors';

describe('transaction failure classification', () => {
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
    // No socket or TEST database is opened in these normalization tests.
    jest.spyOn(pool, 'connect').mockResolvedValue(client as never);
  });

  afterEach(async () => {
    await service.onModuleDestroy();
  });

  it.each([
    ['40001', 409, 'REQUEST_IN_PROGRESS'],
    ['40P01', 409, 'REQUEST_IN_PROGRESS'],
    ['57014', 503, 'PERSISTENCE_UNAVAILABLE'],
  ])(
    'normalizes SQLSTATE %s without committing or exposing the PostgreSQL message',
    async (sqlstate, status, code) => {
      const failure: unknown = await service
        .writeAs('fixture-actor', async () => {
          throw Object.assign(new Error('private statement details'), {
            code: sqlstate,
          });
        })
        .catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(ApiError);
      if (!(failure instanceof ApiError))
        throw new Error('Expected a normalized API error');
      expect(failure.getStatus()).toBe(status);
      expect(failure.code).toBe(code);
      expect(failure.retryable).toBe(true);
      expect(failure.message).not.toContain('private statement');
      expect(client.query).toHaveBeenCalledWith('ROLLBACK');
      expect(client.query).not.toHaveBeenCalledWith('COMMIT');
      expect(client.release).toHaveBeenCalledWith(false);
    },
  );
});
