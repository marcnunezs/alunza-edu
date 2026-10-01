import 'reflect-metadata';
import type { PoolClient } from 'pg';
import { ContentService } from './content.service';
import type { AcademicAccess, Context } from './academic.shared';

describe('exercise concept snapshots', () => {
  it('returns the name and version fixed by the exercise instead of substituting a current concept', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const conceptId = '22222222-2222-4222-8222-222222222222';
    const conceptVersionId = '33333333-3333-4333-8333-333333333333';
    const now = new Date('2026-09-28T12:00:00Z');
    const who = { actorId: id, sessionId: id, requestId: id };
    const version = {
      id,
      exercise_id: id,
      organization_id: id,
      version: 1,
      title: 'Variables',
      statement: 'Devuelve el valor.',
      starter_code: 'function solve(a) { return a; }',
      language: 'javascript',
      difficulty: 'BASIC',
      entrypoint: 'solve',
      execution_limits: {
        memoryBytes: 134217728,
        timeoutMs: 3000,
        outputBytes: 65536,
      },
      created_at: now,
    };
    const client = {
      query: async (sql: string) => {
        if (sql.includes('FROM app.exercises'))
          return {
            rows: [{ id, organization_id: id, current_version_id: id }],
          };
        if (sql.includes('FROM app.exercise_versions'))
          return { rows: [version] };
        if (sql.includes('FROM app.exercise_version_concepts')) {
          // The stored historical concept is v1 even if another version is now current.
          expect(sql).toContain('v.id=ec.concept_version_id');
          expect(sql).not.toContain('current_version_id');
          return {
            rows: [
              {
                concept_id: conceptId,
                concept_version_id: conceptVersionId,
                name: 'Concepto original',
                version: 1,
              },
            ],
          };
        }
        if (sql.includes('FROM app_private.exercise_tests'))
          return {
            rows: [
              {
                id,
                visibility: 'VISIBLE',
                args: [1],
                expected: 1,
                comparator: 'EXACT_DEEP',
              },
            ],
          };
        throw new Error('Unexpected repository query');
      },
    } as unknown as PoolClient;
    const context: Context = {
      client,
      who,
      organizationId: id,
      role: 'TEACHER',
    };
    const access = {
      resource: async (
        _who: unknown,
        _kind: unknown,
        _id: unknown,
        _write: unknown,
        _roles: unknown,
        action: (ctx: Context) => Promise<unknown>,
      ) => action(context),
    } as unknown as AcademicAccess;
    const result = await new ContentService(access).versions(who, id, {
      limit: 20,
    });
    expect(result.data[0]).toMatchObject({
      conceptVersionIds: [conceptVersionId],
      concepts: [
        {
          id: conceptId,
          versionId: conceptVersionId,
          name: 'Concepto original',
          version: 1,
        },
      ],
    });
  });
});
