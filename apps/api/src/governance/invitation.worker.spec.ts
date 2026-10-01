import 'reflect-metadata';
import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { DatabaseService } from '../database/database.service';
import { loadConfig } from '../config';
import {
  InvitationAuthAdapter,
  InvitationDeliveryError,
} from './invitation-auth.adapter';
import { InvitationWorker } from './invitation.worker';

const job = {
  id: 'job-id',
  organization_id: 'organization-id',
  invitation_id: 'invitation-id',
  requested_by: 'actor-id',
  lease_token: 'lease-id',
  attempt_count: 1,
  correlation_id: 'correlation-id',
};
const config = loadConfig({
  APP_ORIGIN: 'http://localhost:3000',
  DATABASE_URL: 'postgres://alunza_app:unit-only@localhost/postgres',
  SUPABASE_JWKS_URL: 'http://localhost/auth/v1/.well-known/jwks.json',
  SUPABASE_JWT_ISSUER: 'http://localhost/auth/v1',
});

function harness(
  options: {
    inactive?: boolean;
    accepted?: boolean;
    staleLease?: boolean;
    attempts?: number;
    failure?: boolean;
  } = {},
) {
  let transactions = 0;
  let generation = 1;
  let storedDigest: string | undefined;
  const transitions: string[] = [];
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  const currentJob = { ...job, attempt_count: options.attempts ?? 1 };
  const invitation = () => ({
    email_normalized: 'fixture@example.test',
    expires_at: new Date(Date.now() + 3600_000),
    accepted_at: options.accepted ? new Date() : null,
    revoked_at: null,
    generation,
  });
  const client = {
    query: jest.fn(async (sql: string, values: unknown[] = []) => {
      queries.push({ sql, values });
      if (sql.includes('claim_invitation_delivery'))
        return { rows: [currentJob] };
      if (sql.includes('can_admin'))
        return { rows: [{ allowed: !options.inactive }] };
      if (
        sql.includes('SELECT * FROM app.organization_invitations') ||
        sql.includes('SELECT accepted_at,revoked_at')
      )
        return { rows: [invitation()] };
      if (sql.includes('SELECT state,lease_token'))
        return {
          rows: options.staleLease
            ? []
            : [{ state: 'RUNNING', lease_token: job.lease_token }],
        };
      if (sql.includes('UPDATE app.organization_invitations')) {
        storedDigest = values[1] as string;
        generation = values[2] as number;
      }
      if (sql.includes('UPDATE app.invitation_deliveries'))
        transitions.push(values[2] as string);
      return { rows: [{ id: job.organization_id }], rowCount: 1 };
    }),
  };
  const database = {
    internal: async <T>(action: (client: PoolClient) => Promise<T>) => {
      transactions++;
      try {
        return await action(client as unknown as PoolClient);
      } finally {
        transactions--;
      }
    },
  };
  const deliver = jest.fn(
    async (_email: string, _id: string, token: string) => {
      expect(transactions).toBe(0);
      expect(storedDigest).toBe(
        createHash('sha256').update(token).digest('hex'),
      );
      expect(JSON.stringify(queries)).not.toContain(token);
      if (options.failure)
        throw new InvitationDeliveryError(
          'AUTH_DELIVERY_UNCERTAIN',
          true,
          true,
        );
      return 'auth-user';
    },
  );
  const worker = new InvitationWorker(
    database as DatabaseService,
    { deliver } as unknown as InvitationAuthAdapter,
    config,
  );
  return { worker, deliver, transitions, queries };
}

describe('durable invitation orchestration', () => {
  it('persists only a digest before sending outside the database transaction', async () => {
    const test = harness();
    await test.worker.tick();
    expect(test.deliver).toHaveBeenCalledTimes(1);
    expect(test.transitions).toEqual(['SENT']);
  });
  it.each([{ accepted: true }, { inactive: true }])(
    'cancels unavailable invitations without sending %j',
    async (options) => {
      const test = harness(options);
      await test.worker.tick();
      expect(test.deliver).not.toHaveBeenCalled();
      expect(test.transitions).toEqual(['CANCELLED']);
    },
  );
  it('never sends work owned by another lease', async () => {
    const test = harness({ staleLease: true });
    await test.worker.tick();
    expect(test.deliver).not.toHaveBeenCalled();
    expect(test.transitions).toEqual([]);
  });
  it('preserves an uncertain delivery for bounded reconciliation', async () => {
    const test = harness({ failure: true });
    await test.worker.tick();
    expect(test.transitions).toEqual(['UNCERTAIN']);
  });
  it('records terminal failure on the third attempt', async () => {
    const test = harness({ failure: true, attempts: 3 });
    await test.worker.tick();
    expect(test.transitions).toEqual(['FAILED']);
  });
  it('recovers a repeatedly interrupted lease without sending a fourth email', async () => {
    const test = harness({ attempts: 4 });
    await test.worker.tick();
    expect(test.deliver).not.toHaveBeenCalled();
    expect(test.transitions).toEqual(['FAILED']);
  });
});
