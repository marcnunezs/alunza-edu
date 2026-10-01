import 'reflect-metadata';
import { DatabaseService } from './database.service';
import { ApiError } from '../http/errors';

describe('database transaction error boundary', () => {
  function database() {
    const statements: string[] = [];
    const release = jest.fn();
    const client = {
      query: async (sql: string) => {
        statements.push(sql);
        return {
          rows: sql.includes('current_user') ? [{ allowed: true }] : [],
        };
      },
      release,
    };
    // Only the transport is replaced: writeAs still performs its transaction,
    // role check, context handling, rollback, classification and release.
    const service = Object.create(DatabaseService.prototype) as DatabaseService;
    Object.defineProperty(service, 'pool', {
      value: { connect: async () => client },
    });
    return { service, statements, release };
  }

  it.each([
    ['RESOURCE_ARCHIVED', 'RESOURCE_ARCHIVED', 409],
    ['COURSE_UNAVAILABLE', 'RESOURCE_ARCHIVED', 409],
    ['CLASS_UNAVAILABLE', 'RESOURCE_ARCHIVED', 409],
    ['TEACHER_UNAVAILABLE', 'VALIDATION_FAILED', 422],
    ['JOIN_CODE_INVALID', 'VALIDATION_FAILED', 422],
  ])(
    'rolls back %s as a domain rejection rather than a service outage',
    async (trigger, publicCode, status) => {
      const { service, statements, release } = database();
      let result: unknown;
      try {
        await service.writeAs(
          '11111111-1111-4111-8111-111111111111',
          async () => {
            throw Object.assign(new Error(trigger), {
              code: 'P0001',
              detail: 'private fixture value',
            });
          },
        );
      } catch (error) {
        result = error;
      }
      expect(result).toBeInstanceOf(ApiError);
      expect(result).toMatchObject({ code: publicCode, retryable: false });
      expect((result as ApiError).getStatus()).toBe(status);
      expect((result as ApiError).publicMessage).not.toContain(
        'private fixture value',
      );
      expect(statements.at(-1)).toBe('ROLLBACK');
      expect(statements).not.toContain('COMMIT');
      expect(release).toHaveBeenCalledWith(false);
    },
  );

  it('never exposes an unknown database exception or its SQL detail', async () => {
    const { service, release } = database();
    await expect(
      service.writeAs('11111111-1111-4111-8111-111111111111', async () => {
        throw Object.assign(new Error('private SQL detail'), { code: 'P0001' });
      }),
    ).rejects.toMatchObject({
      code: 'PERSISTENCE_UNAVAILABLE',
      publicMessage: 'Los datos no están disponibles.',
    });
    expect(release).toHaveBeenCalledTimes(1);
  });
});
