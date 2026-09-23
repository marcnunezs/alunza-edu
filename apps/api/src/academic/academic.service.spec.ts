import type { PoolClient } from 'pg';
import { AcademicService } from './academic.service';
import type { DatabaseService } from '../database/database.service';
import * as academic from './academic.shared';
import { digest } from '../governance/governance.shared';

describe('collective join code transport', () => {
  const who = {
    actorId: '11111111-1111-4111-8111-111111111111',
    sessionId: '22222222-2222-4222-8222-222222222222',
    requestId: '33333333-3333-4333-8333-333333333333',
  };
  const org = '44444444-4444-4444-8444-444444444444',
    cls = '55555555-5555-4555-8555-555555555555';
  afterEach(() => jest.restoreAllMocks());
  it('replays a committed enrollment after code revocation only after reauthorizing its membership', async () => {
    const context = jest
      .spyOn(academic, 'academicContext')
      .mockResolvedValue({ role: 'STUDENT', timezone: 'America/Santiago' });
    const response = {
      organizationId: org,
      classId: cls,
      className: 'Programación I',
      alreadyEnrolled: false,
    };
    const tokenDigest = digest('previous-collective-code');
    const operation = {
      organization_id: org,
      class_id: cls,
      payload_hash: digest(JSON.stringify({ digest: tokenDigest })),
      state: 'COMPLETED',
      expires_at: new Date(Date.now() + 86400000),
      response_body: response,
    };
    const query = jest.fn(async (sql: string) => ({
      rows:
        sql.includes('enrollment_replay') ||
        sql.includes('FROM app.operation_keys')
          ? [operation]
          : [],
    }));
    const db = {
      writeAs: (_id: string, action: (client: PoolClient) => unknown) =>
        action({ query } as unknown as PoolClient),
    };
    const service = new AcademicService(db as unknown as DatabaseService);
    await expect(
      service.enrollment(who, 'previous-collective-code', 'enrollment-key'),
    ).resolves.toEqual(response);
    expect(context).toHaveBeenCalledWith(expect.anything(), who, org, true, [
      'STUDENT',
    ]);
    expect(
      query.mock.calls.filter(([sql]) => sql.includes('enrollment_replay')),
    ).toHaveLength(2);
    expect(
      query.mock.calls.some(
        ([sql]) =>
          sql.includes('resolve_join_code') ||
          sql.includes('INSERT INTO app.class_memberships'),
      ),
    ).toBe(false);
  });
  it('returns the secret once while persisting only digest and metadata, including idempotent response', async () => {
    jest.spyOn(academic, 'classAccess').mockResolvedValue({
      role: 'TEACHER',
      timezone: 'America/Santiago',
      row: { organization_id: org, revision: 1 },
    });
    let operation: Record<string, unknown> | undefined;
    let storedDigest: string | undefined;
    const query = jest.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('FROM app.operation_keys'))
        return { rows: operation ? [operation] : [] };
      if (sql.includes('INSERT INTO app.operation_keys')) {
        operation = {
          payload_hash: params[5],
          state: 'RUNNING',
          expires_at: new Date(Date.now() + 86400000),
        };
        return { rows: [] };
      }
      if (sql.includes('clock_timestamp()'))
        return { rows: [{ now: new Date() }] };
      if (sql.includes('INSERT INTO app.class_join_codes')) {
        storedDigest = String(params[3]);
        return {
          rows: [
            {
              id: params[0],
              class_id: cls,
              expires_at: params[4],
              revoked_at: null,
              revision: 1,
            },
          ],
        };
      }
      if (sql.includes('UPDATE app.operation_keys')) {
        operation = {
          ...operation,
          state: 'COMPLETED',
          response_body: JSON.parse(String(params[4])),
        };
        return { rows: [] };
      }
      return { rows: [] };
    });
    const db = {
      writeAs: (_id: string, action: (client: PoolClient) => unknown) =>
        action({ query } as unknown as PoolClient),
    };
    const service = new AcademicService(db as unknown as DatabaseService);
    const first = await service.issueCode(
      who,
      cls,
      undefined,
      1,
      'code-test-key',
    );
    expect('code' in first).toBe(true);
    const secret = 'code' in first ? String(first.code) : '';
    expect(secret.length).toBeGreaterThanOrEqual(32);
    expect(storedDigest).toBe(digest(secret));
    expect(JSON.stringify(operation)).not.toContain(secret);
    const replay = await service.issueCode(
      who,
      cls,
      undefined,
      1,
      'code-test-key',
    );
    expect(replay).not.toHaveProperty('code');
    expect(replay.id).toBe(first.id);
    expect(
      query.mock.calls.filter(([sql]) =>
        sql.includes('INSERT INTO app.class_join_codes'),
      ),
    ).toHaveLength(1);
  });
});
