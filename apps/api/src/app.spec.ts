import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { errorResponseSchema, healthResponseSchema } from '@alunza/contracts';
import { createApp, loadConfig } from './app';

// Both createApp calls start the real reconciliation lifecycle. These HTTP-only
// tests must never let its background sweep contact the host Docker daemon.
// A module mock survives restoreMocks between tests while the first app is live.
jest.mock('./practice/docker-execution.adapter', () => {
  const actual = jest.requireActual<
    typeof import('./practice/docker-execution.adapter')
  >('./practice/docker-execution.adapter');
  actual.DockerExecutionAdapter.prototype.sweepExpired = jest
    .fn()
    .mockResolvedValue({ cleanupVerified: false, removed: 0 });
  return actual;
});

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

  it.each([
    ['GET', '/api/v1'],
    ['GET', '/API/v1'],
    ['HEAD', '/api/v1'],
  ])(
    'records rejected audit %s %s once without echoing scope or query',
    async (method, prefix) => {
      const captured: string[] = [];
      jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
        captured.push(String(chunk));
        return true;
      });
      const response = await fetch(
        `${baseUrl}${prefix}/organizations/10000000-0000-4000-8000-000000000001/audit-events?action=AUDIT_PRIVATE_SENTINEL`,
        { method },
      );
      expect(response.status).toBe(401);
      const responseRequestId = response.headers.get('x-request-id');
      if (method === 'GET')
        expect(errorResponseSchema.parse(await response.json()).requestId).toBe(
          responseRequestId,
        );
      const entries = captured
        .flatMap((line) => line.trim().split('\n'))
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .filter(
          (entry) =>
            entry.requestId === responseRequestId &&
            entry.event === 'audit.query',
        );
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        outcome: 'DENIED',
        status: 401,
        path: '/api/v1/organizations/:orgId/audit-events',
      });
      expect(entries[0]).not.toHaveProperty('actorId');
      expect(entries[0]).not.toHaveProperty('organizationId');
      expect(JSON.stringify(entries)).not.toContain('AUDIT_PRIVATE_SENTINEL');
      expect(JSON.stringify(entries)).not.toContain(
        '10000000-0000-4000-8000-000000000001',
      );
    },
  );

  it('correlates opt-in TEST diagnostics without exposing input or adding HTTP fields', async () => {
    const captured: string[] = [];
    const spy = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk) => {
        captured.push(String(chunk));
        return true;
      });
    const diagnosticApp = await createApp(
      loadConfig({
        ENVIRONMENT: 'test',
        ALUNZA_TEST_DASHBOARD_TIMINGS: '1',
        APP_ORIGIN: 'http://localhost:3000',
        DATABASE_URL:
          'postgresql://alunza_app:private-db-secret@127.0.0.1:1/postgres',
        SUPABASE_JWKS_URL: 'http://127.0.0.1:1/auth/v1/.well-known/jwks.json',
        SUPABASE_JWT_ISSUER: 'http://127.0.0.1:1/auth/v1',
      }),
    );
    try {
      await diagnosticApp.listen(0, '127.0.0.1');
      const response = await fetch(
        `${await diagnosticApp.getUrl()}/api/v1/classes/private-class/dashboard?token=private-query`,
        {
          headers: {
            Authorization: 'Bearer private-token',
            'X-Request-Id': 'private-client-id',
          },
        },
      );
      expect(response.status).toBe(401);
      expect(response.headers.get('server-timing')).toBeNull();
      const body = errorResponseSchema.parse(await response.json());
      expect(response.headers.get('x-request-id')).toBe(body.requestId);
      const records = captured.flatMap((line) => {
        try {
          return [JSON.parse(line) as { event?: string; requestId?: string }];
        } catch {
          return [];
        }
      });
      expect(
        records.filter((record) => record.event === 'PHASE_DIAGNOSTIC_REQUEST'),
      ).toEqual([
        expect.objectContaining({
          schemaVersion: 1,
          requestId: body.requestId,
          path: '/api/v1/classes/:id/dashboard',
          method: 'GET',
          status: 401,
          spans: [
            expect.objectContaining({ name: 'auth.jwt', outcome: 'error' }),
          ],
          pool: { before: null, after: null },
          dropped: 0,
        }),
      ]);
      expect(captured.join('')).not.toMatch(
        /private-class|private-query|private-token|private-client-id|private-db-secret/,
      );
    } finally {
      await diagnosticApp.close();
      spy.mockRestore();
    }
    expect(captured.join('')).toContain('PHASE_DIAGNOSTIC_PROCESS');
  });

  it('protects PUT review before data access and logs only its route template', async () => {
    const captured: string[] = [];
    const spy = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk) => {
        captured.push(String(chunk));
        return true;
      });
    try {
      const response = await fetch(
        `${baseUrl}/api/v1/signals/private-signal/review?asOf=private-cut`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        },
      );
      expect(response.status).toBe(401);
      expect(response.headers.get('cache-control')).toBe('no-store');
      const output = captured.join('');
      expect(output).toContain('/api/v1/signals/:id/review');
      expect(output).not.toContain('private-signal');
      expect(output).not.toContain('private-cut');
    } finally {
      spy.mockRestore();
    }
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

  it('logs dashboard route templates without student, class, signal or query identifiers', async () => {
    const captured: string[] = [];
    const spy = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk) => {
        captured.push(String(chunk));
        return true;
      });
    try {
      const response = await fetch(
        `${baseUrl}/api/v1/classes/private-class/signals/private-signal?asOf=private-date`,
      );
      expect(response.status).toBe(401);
      const text = captured.join('');
      expect(text).toContain('/api/v1/classes/:id/signals/:signalId');
      for (const secret of ['private-class', 'private-signal', 'private-date'])
        expect(text).not.toContain(secret);
    } finally {
      spy.mockRestore();
    }
  });

  it.each([
    [
      '/api/v1/organizations/private-org/exercise-bank',
      '/api/v1/organizations/:orgId/exercise-bank',
    ],
    [
      '/api/v1/exercises/private-exercise/governance',
      '/api/v1/exercises/:id/governance',
    ],
    [
      '/api/v1/exercises/private-exercise/governance/versions',
      '/api/v1/exercises/:id/governance/versions',
    ],
    [
      '/api/v1/exercises/private-exercise/governance/uses',
      '/api/v1/exercises/:id/governance/uses',
    ],
    [
      '/api/v1/exercises/private-exercise/governance/content',
      '/api/v1/exercises/:id/governance/content',
    ],
    [
      '/api/v1/classes/private-class/students/private-student/progress',
      '/api/v1/classes/:classId/students/:studentId/progress',
    ],
    [
      '/api/v1/classes/private-class/students/private-student/feedback/private-feedback/sources/private-chunk/content',
      '/api/v1/classes/:classId/students/:studentId/feedback/:feedbackId/sources/:chunkId/content',
    ],
    [
      '/api/v1/classes/private-class/students/private-student/signals/private-signal',
      '/api/v1/classes/:classId/students/:studentId/signals/:signalId',
    ],
  ])(
    'logs private route %s without identifiers or filters',
    async (path, template) => {
      const captured: string[] = [];
      const spy = jest
        .spyOn(process.stdout, 'write')
        .mockImplementation((chunk) => {
          captured.push(String(chunk));
          return true;
        });
      try {
        expect(
          (await fetch(`${baseUrl}${path}?search=private-filter`)).status,
        ).toBe(401);
        expect(captured.join('')).toContain(template);
        for (const value of [
          'private-org',
          'private-exercise',
          'private-class',
          'private-student',
          'private-feedback',
          'private-chunk',
          'private-signal',
          'private-filter',
        ])
          expect(captured.join('')).not.toContain(value);
      } finally {
        spy.mockRestore();
      }
    },
  );

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
