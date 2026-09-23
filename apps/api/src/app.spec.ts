import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { errorResponseSchema, healthResponseSchema } from '@alunza/contracts';
import { createApp, loadConfig } from './app';

describe('real Nest HTTP boundary without data infrastructure', () => {
  let app: INestApplication;
  let baseUrl: string;
  let logs: string[];

  beforeAll(async () => {
    const reservation = createServer();
    await new Promise<void>((resolve) =>
      reservation.listen(0, '127.0.0.1', resolve),
    );
    const unavailablePort = (reservation.address() as AddressInfo).port;
    await new Promise<void>((resolve, reject) =>
      reservation.close((error) => (error ? reject(error) : resolve())),
    );
    logs = [];
    jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      logs.push(String(chunk));
      return true;
    });
    app = await createApp(
      loadConfig({
        APP_ORIGIN: 'http://localhost:3000',
        DATABASE_URL: `postgresql://alunza_app:private-db-secret@127.0.0.1:${unavailablePort}/postgres`,
        SUPABASE_JWKS_URL: `http://127.0.0.1:${unavailablePort}/auth/v1/.well-known/jwks.json`,
        SUPABASE_JWT_ISSUER: `http://127.0.0.1:${unavailablePort}/auth/v1`,
      }),
    );
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app?.close();
    jest.restoreAllMocks();
  });

  it('serves liveness independently of database readiness', async () => {
    const ready = await fetch(`${baseUrl}/health/ready`);
    expect(ready.status).toBe(503);
    expect(errorResponseSchema.parse(await ready.json()).error.code).toBe(
      'PERSISTENCE_UNAVAILABLE',
    );
    const live = await fetch(`${baseUrl}/health/live`);
    expect(live.status).toBe(200);
    expect(healthResponseSchema.parse(await live.json()).data.status).toBe(
      'ok',
    );
  });

  it('rejects missing JWT before consulting the unavailable database', async () => {
    const response = await fetch(`${baseUrl}/api/v1/me`);
    expect(response.status).toBe(401);
    const body = errorResponseSchema.parse(await response.json());
    expect(body.error.code).toBe('UNAUTHENTICATED');
    expect(response.headers.get('x-request-id')).toBe(body.requestId);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-release-id')).toBe('foundation-local');
  });

  it('exposes CORS only for the configured origin and never cookie credentials', async () => {
    const allowed = await fetch(`${baseUrl}/health/live`, {
      headers: { Origin: 'http://localhost:3000' },
    });
    expect(allowed.headers.get('access-control-allow-origin')).toBe(
      'http://localhost:3000',
    );
    expect(allowed.headers.get('access-control-allow-credentials')).toBeNull();
    const denied = await fetch(`${baseUrl}/health/live`, {
      headers: { Origin: 'https://foreign.example' },
    });
    expect(denied.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('advertises mutation preconditions only to an allowed origin', async () => {
    const response = await fetch(`${baseUrl}/api/v1/organizations`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:3000',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers':
          'authorization,content-type,idempotency-key,if-match',
      },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-methods')).toContain(
      'PATCH',
    );
    expect(response.headers.get('access-control-allow-methods')).toContain(
      'PUT',
    );
    expect(response.headers.get('access-control-allow-headers')).toContain(
      'If-Match',
    );
    expect(response.headers.get('access-control-allow-headers')).toContain(
      'Idempotency-Key',
    );
  });

  it.each([
    { body: '{"name":', status: 400 },
    { body: JSON.stringify({ name: 'x'.repeat(40_000) }), status: 413 },
  ])(
    'rejects malformed or excessive JSON without echoing the body ($status)',
    async ({ body, status }) => {
      const response = await fetch(`${baseUrl}/api/v1/organizations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      expect(response.status).toBe(status);
      const payload = errorResponseSchema.parse(await response.json());
      expect(payload.error.message).not.toContain(body);
      expect(response.headers.get('x-powered-by')).toBeNull();
    },
  );

  it('increases JSON capacity only on exercise authoring routes', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const body = JSON.stringify({ statement: 'x'.repeat(40000) });
    for (const path of [
      `organizations/${id}/exercises`,
      `exercises/${id}/versions`,
    ]) {
      const response = await fetch(`${baseUrl}/api/v1/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      expect(response.status).toBe(401);
      expect(errorResponseSchema.parse(await response.json()).error.code).toBe(
        'UNAUTHENTICATED',
      );
    }
    const ordinary = await fetch(
      `${baseUrl}/api/v1/organizations/${id}/classes`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      },
    );
    expect(ordinary.status).toBe(413);
    const excessive = await fetch(
      `${baseUrl}/api/v1/exercises/${id}/versions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ statement: 'x'.repeat(2097152) }),
      },
    );
    expect(excessive.status).toBe(413);
  });

  it('does not reflect untrusted paths, authorization or database credentials in errors and logs', async () => {
    const captured: string[] = [];
    const spy = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk) => {
        captured.push(String(chunk));
        return true;
      });
    const response = await fetch(
      `${baseUrl}/unknown/path-secret?token=query-secret`,
      {
        headers: {
          Authorization: 'Bearer header-secret',
          'X-Request-Id': 'injected-request-id',
        },
      },
    );
    expect(response.status).toBe(404);
    const body = errorResponseSchema.parse(await response.json());
    expect(body.error.code).toBe('RESOURCE_NOT_FOUND');
    const observable = JSON.stringify(body) + captured.join('');
    for (const secret of [
      'path-secret',
      'query-secret',
      'header-secret',
      'private-db-secret',
      'injected-request-id',
    ]) {
      expect(observable).not.toContain(secret);
    }
    expect(captured.join('')).toContain('<unmatched>');
    const record = JSON.parse(captured.join('').trim());
    expect(record.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T.+Z$/);
    expect(record.environment).toBe('local');
    expect(record.release).toBe('foundation-local');
    spy.mockRestore();
  });
});
