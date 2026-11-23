import type { PoolClient } from 'pg';
import { classAccess, dateOnly } from './academic.shared';
import { types } from 'pg';
import '../database/database.service';

describe('academic authorization after transactional lock', () => {
  it('preserves civil academic dates without converting to timestamps', () => {
    const parsed = types.getTypeParser(1082)('2026-09-23');
    expect(parsed).toBe('2026-09-23');
    expect(dateOnly(parsed)).toBe('2026-09-23');
    expect(dateOnly(null)).toBeNull();
  });
  const actor = {
    actorId: '11111111-1111-4111-8111-111111111111',
    sessionId: '22222222-2222-4222-8222-222222222222',
    requestId: '33333333-3333-4333-8333-333333333333',
  };
  const org = '44444444-4444-4444-8444-444444444444';
  const cls = '55555555-5555-4555-8555-555555555555';
  function client(options: { reassigned?: boolean; disabled?: boolean }) {
    let locked = false;
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('lock_academic_organization')) {
        locked = true;
        return { rows: [] };
      }
      if (sql.includes('FROM app.profiles'))
        return { rows: [{ id: actor.actorId, account_state: 'ACTIVE' }] };
      if (sql.includes('FROM app.organizations'))
        return {
          rows: [{ id: org, archived_at: null, timezone: 'America/Santiago' }],
        };
      if (sql.includes('FROM app.organization_memberships'))
        return {
          rows: [
            {
              role: 'TEACHER',
              state: locked && options.disabled ? 'DISABLED' : 'ACTIVE',
            },
          ],
        };
      if (sql.includes('FROM app.classes'))
        return {
          rows: [
            {
              id: cls,
              organization_id: org,
              teacher_id:
                locked && options.reassigned
                  ? '66666666-6666-4666-8666-666666666666'
                  : actor.actorId,
              archived_at: null,
            },
          ],
        };
      return { rows: [] };
    });
    return { query };
  }
  it('denies an old JWT teacher whose class was reassigned while waiting', async () => {
    const db = client({ reassigned: true });
    await expect(
      classAccess(db as unknown as PoolClient, actor, cls, true),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    expect(
      db.query.mock.calls.some(([sql]) =>
        sql.includes('lock_academic_organization'),
      ),
    ).toBe(true);
  });
  it('denies a membership disabled before the lock is acquired', async () => {
    await expect(
      classAccess(
        client({ disabled: true }) as unknown as PoolClient,
        actor,
        cls,
        true,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('authorizes the still assigned active teacher without an institutional UPDATE', async () => {
    const db = client({});
    await expect(
      classAccess(db as unknown as PoolClient, actor, cls, true),
    ).resolves.toMatchObject({ role: 'TEACHER' });
    expect(
      db.query.mock.calls.some(([sql]) =>
        /FROM app\.organizations.+FOR UPDATE/.test(sql),
      ),
    ).toBe(false);
  });
});
