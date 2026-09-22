import 'reflect-metadata';
import type { PoolClient } from 'pg';
import type { DatabaseService } from '../database/database.service';
import { InvitationService } from './invitation.service';
import { digest, idempotent } from './governance.shared';

const who = {
  actorId: '11111111-1111-4111-8111-111111111111',
  sessionId: '22222222-2222-4222-8222-222222222222',
  requestId: '33333333-3333-4333-8333-333333333333',
};
const invitationId = '44444444-4444-4444-8444-444444444444';
const organizationId = '55555555-5555-4555-8555-555555555555';
const token = 'a'.repeat(43);

function acceptedInvitation() {
  const original = {
    id: invitationId,
    generation: 1,
    tokenHash: digest(token),
    displayName: 'Nombre original',
  };
  const statements: string[] = [];
  const query = async (sql: string) => {
    statements.push(sql);
    if (sql.includes('invitation_context'))
      return {
        rows: [
          {
            organization_id: organizationId,
            email_normalized: 'fixture@example.test',
            accepted_at: new Date(),
            accepted_by: who.actorId,
            revoked_at: null,
            expires_at: new Date(1),
            role: 'STUDENT',
            generation: 1,
          },
        ],
      };
    if (sql.includes('current_auth_email'))
      return { rows: [{ email: 'fixture@example.test' }] };
    if (sql.includes('lock_invitation_organization'))
      return { rows: [{ id: organizationId, archived_at: null }] };
    if (sql.includes('FROM app.profiles'))
      return { rows: [{ id: who.actorId, account_state: 'ACTIVE' }] };
    if (sql.includes('SELECT role,state FROM app.organization_memberships'))
      return { rows: [{ role: 'STUDENT', state: 'DISABLED' }] };
    if (sql.includes('FROM app.operation_keys'))
      return {
        rows: [
          {
            payload_hash: digest(JSON.stringify(original)),
            expires_at: new Date(1),
            state: 'COMPLETED',
            response_body: {
              organizationId,
              userId: who.actorId,
              role: 'STUDENT',
              state: 'ACTIVE',
            },
          },
        ],
      };
    return { rows: [] };
  };
  const database = {
    writeAs: async <T>(
      _actor: string,
      action: (client: PoolClient) => Promise<T>,
    ) => action({ query } as unknown as PoolClient),
  };
  return {
    service: new InvitationService(database as DatabaseService),
    statements,
  };
}

describe('consumed invitation transport replay', () => {
  it('reports the current disabled membership instead of replaying ACTIVE', async () => {
    const test = acceptedInvitation();
    const result = await test.service.accept(
      who,
      invitationId,
      { token, generation: 1, displayName: 'Nombre original' },
      'same-transport-key',
    );
    expect(result.state).toBe('DISABLED');
    expect(
      test.statements.some((sql) =>
        /(?:UPDATE|INSERT INTO) app\.(?:organization_memberships|profiles|organization_invitations)/.test(
          sql,
        ),
      ),
    ).toBe(false);
  });
  it('still rejects a changed payload under the consumed idempotency key', async () => {
    const test = acceptedInvitation();
    await expect(
      test.service.accept(
        who,
        invitationId,
        { token, generation: 1, displayName: 'Nombre distinto' },
        'same-transport-key',
      ),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('never replays a cached mutation or executes it again after 24 hours', async () => {
    const operation = jest.fn();
    const query = jest.fn(async (sql: string) => ({
      rows: sql.includes('FROM app.operation_keys')
        ? [
            {
              payload_hash: digest(JSON.stringify({ name: 'original' })),
              state: 'COMPLETED',
              expires_at: new Date(1),
              response_body: { private: 'stale' },
            },
          ]
        : [],
    }));
    await expect(
      idempotent(
        { query } as unknown as PoolClient,
        who,
        organizationId,
        'organization.create',
        'expired-key',
        { name: 'original' },
        201,
        operation,
      ),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(operation).not.toHaveBeenCalled();
    expect(
      query.mock.calls.every(([sql]) => !/^\s*(INSERT|UPDATE)\b/.test(sql)),
    ).toBe(true);
  });
});
