import 'reflect-metadata';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { loadConfig } from '../config';
import { InvitationAuthAdapter } from './invitation-auth.adapter';

describe('Auth invitation adapter against HTTP boundary', () => {
  let server: Server;
  let adapter: InvitationAuthAdapter;
  let failure: { status: number; code: string } | undefined;
  let requests: Array<{ path: string; body: Record<string, unknown> }>;
  beforeAll(async () => {
    server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      requests.push({
        path: request.url!,
        body: JSON.parse(Buffer.concat(chunks).toString() || '{}'),
      });
      response.setHeader('content-type', 'application/json');
      response.setHeader('x-supabase-api-version', '2024-01-01');
      if (request.url?.startsWith('/auth/v1/invite') && failure) {
        response.writeHead(failure.status).end(
          JSON.stringify({
            code: failure.code,
            msg: 'Provider details that must remain private',
          }),
        );
      } else if (request.url?.startsWith('/auth/v1/invite')) {
        response.end(
          JSON.stringify({
            id: '12345678-1234-4234-8234-123456789abc',
            email: 'fixture@example.test',
          }),
        );
      } else response.end('{}');
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    adapter = new InvitationAuthAdapter(
      loadConfig({
        APP_ORIGIN: 'http://localhost:3000',
        DATABASE_URL: 'postgres://alunza_app:unit-only@localhost/postgres',
        SUPABASE_JWKS_URL: `${url}/auth/v1/.well-known/jwks.json`,
        SUPABASE_JWT_ISSUER: `${url}/auth/v1`,
        SUPABASE_URL: url,
        SUPABASE_SECRET_KEY: 'unit-only-secret',
        SUPABASE_PUBLISHABLE_KEY: 'unit-only-public',
        INVITATION_WORKER_ENABLED: 'true',
      }),
    );
  });
  beforeEach(() => {
    requests = [];
    failure = undefined;
  });
  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  it('sends a new invitation with an allowlisted fragment callback', async () => {
    expect(
      await adapter.deliver(
        'fixture@example.test',
        'invitation-id',
        'proof-token',
        2,
      ),
    ).toBe('12345678-1234-4234-8234-123456789abc');
    expect(requests).toHaveLength(1);
    const requestUrl = new URL(requests[0]!.path, 'http://localhost');
    const callback = new URL(requestUrl.searchParams.get('redirect_to')!);
    expect(callback.pathname).toBe('/acceso/invitacion');
    expect(
      new URLSearchParams(callback.hash.slice(1)).get('invitationToken'),
    ).toBe('proof-token');
  });
  it.each(['email_exists', 'user_already_exists'])(
    'uses OTP without account creation only for %s',
    async (code) => {
      failure = { status: 422, code };
      await expect(
        adapter.deliver('fixture@example.test', 'id', 'token', 1),
      ).resolves.toBeNull();
      expect(requests).toHaveLength(2);
      expect(requests[1]!.path).toContain('/auth/v1/otp');
      expect(requests[1]!.body.create_user).toBe(false);
    },
  );
  it('does not convert a quota rejection into a second email request', async () => {
    failure = { status: 429, code: 'over_email_send_rate_limit' };
    await expect(
      adapter.deliver('fixture@example.test', 'id', 'token', 1),
    ).rejects.toMatchObject({
      code: 'AUTH_RATE_LIMITED',
      retryable: true,
      uncertain: false,
    });
    expect(requests).toHaveLength(1);
  });
  it('keeps an upstream failure uncertain and strips provider details', async () => {
    failure = { status: 503, code: 'unexpected_failure' };
    await expect(
      adapter.deliver('fixture@example.test', 'id', 'token', 1),
    ).rejects.toMatchObject({
      code: 'AUTH_UNAVAILABLE',
      uncertain: true,
      retryable: true,
      message: 'AUTH_UNAVAILABLE',
    });
    expect(requests).toHaveLength(1);
  });
});
