import { describe, test, expect, jest } from '@jest/globals';
import { ReadableStream } from 'node:stream/web';
import { runSmoke } from '../../scripts/preprod-smoke.mjs';
import { preparedManifest, smokeEnv } from './fixture.mjs';
const userId = '20000000-0000-4000-8000-000000000003';
const requestId = '30000000-0000-4000-8000-000000000001';
function transport(manifest, change = {}) {
  return async (url, options) => {
    const path = url.pathname;
    let status = 200,
      body;
    const headers = {
      'content-type': 'application/json',
      'x-release-id': manifest.release.sha,
      'cache-control': 'no-store',
    };
    expect(options.redirect).toBe('error');
    if (path === '/')
      return new Response('<html></html>', {
        headers: { 'content-type': 'text/html' },
      });
    if (path.startsWith('/health/'))
      body = { data: { status: 'ok' }, requestId };
    else if (path === '/auth/v1/token')
      body = {
        access_token: `${JSON.parse(options.body).email.split('.')[0]}-fixture-token`,
        user: { id: userId },
      };
    else if (path === '/auth/v1/logout')
      return new Response(null, { status: 204 });
    else if (path.startsWith('/rest/v1/')) {
      status = 406;
      body = { code: 'PGRST106' };
    } else if (
      !options.headers?.Authorization ||
      options.headers.Authorization.includes('invalid')
    ) {
      status = 401;
      body = { error: { code: 'UNAUTHENTICATED' }, requestId };
    } else if (options.headers.Authorization.includes('disabled')) {
      status = 403;
      body = { error: { code: 'ACCOUNT_INACTIVE' }, requestId };
    } else if (path === '/api/v1/me') {
      if (options.headers.Origin === manifest.targets.vercel.webOrigin)
        headers['access-control-allow-origin'] = options.headers.Origin;
      const role = options.headers.Authorization.includes('admin')
        ? 'ADMIN'
        : options.headers.Authorization.includes('teacher')
          ? 'TEACHER'
          : 'STUDENT';
      body = {
        data: {
          id: userId,
          accountState: 'ACTIVE',
          memberships: [
            {
              organizationId: smokeEnv.PREPROD_OWN_ORGANIZATION_ID,
              role,
              state: 'ACTIVE',
            },
          ],
        },
        requestId,
      };
    } else if (path.endsWith(smokeEnv.PREPROD_OWN_ORGANIZATION_ID))
      body = { data: { id: smokeEnv.PREPROD_OWN_ORGANIZATION_ID }, requestId };
    else {
      status = 404;
      body = { error: { code: 'RESOURCE_NOT_FOUND' }, requestId };
    }
    if (change.wrongRelease) headers['x-release-id'] = 'b'.repeat(40);
    return new Response(JSON.stringify(body), { status, headers });
  };
}
describe('remote smoke contract with an explicit test transport', () => {
  test('checks health, access, isolation, inactive account and CORS without exposing fixture credentials', async () => {
    const manifest = await preparedManifest();
    const result = await runSmoke(manifest, smokeEnv, transport(manifest));
    expect(result.status).toBe('passed');
    expect(result.checks.map((c) => c.id)).toContain(
      'organization-foreign-ADMIN',
    );
    expect(result.checks.map((c) => c.id)).toContain('account-disabled');
    const serialized = JSON.stringify(result);
    for (const value of Object.values(smokeEnv))
      expect(serialized).not.toContain(value);
    expect(serialized).not.toContain('fixture-token');
  });
  test('fails if the API is not the approved release', async () => {
    const manifest = await preparedManifest();
    await expect(
      runSmoke(manifest, smokeEnv, transport(manifest, { wrongRelease: true })),
    ).rejects.toThrow();
  });
  test('six request slots cannot open a session that cannot be closed', async () => {
    const manifest = await preparedManifest();
    manifest.budget.maxHttpRequests = 6;
    const fetcher = jest.fn(transport(manifest));
    await expect(runSmoke(manifest, smokeEnv, fetcher)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  test('expiry after login denies new work but still performs reserved logout', async () => {
    const manifest = await preparedManifest();
    let now = Date.now();
    const time = jest.spyOn(Date, 'now').mockImplementation(() => now);
    const delegate = transport(manifest);
    const paths = [];
    try {
      const fetcher = async (url, options) => {
        paths.push(url.pathname);
        const result = await delegate(url, options);
        if (url.pathname === '/auth/v1/token')
          now = Date.parse(manifest.remote.expiresAt) + 1;
        return result;
      };
      await expect(runSmoke(manifest, smokeEnv, fetcher)).rejects.toThrow();
      expect(paths.filter((path) => path === '/auth/v1/token')).toHaveLength(1);
      expect(paths.filter((path) => path === '/auth/v1/logout')).toHaveLength(
        1,
      );
      expect(paths.filter((path) => path === '/api/v1/me')).toHaveLength(2);
    } finally {
      time.mockRestore();
    }
  });
  test('never reports success after a network failure', async () => {
    const manifest = await preparedManifest();
    await expect(
      runSmoke(manifest, smokeEnv, async () => {
        throw new Error('network');
      }),
    ).rejects.toThrow();
  });
  test('cancels an oversized streamed response before parsing or reporting it', async () => {
    const manifest = await preparedManifest();
    let cancelled = false;
    const delegate = transport(manifest);
    const oversized = async (url, options) =>
      url.pathname === '/health/live'
        ? new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new Uint8Array(65537));
              },
              cancel() {
                cancelled = true;
              },
            }),
            {
              headers: {
                'x-release-id': manifest.release.sha,
                'cache-control': 'no-store',
              },
            },
          )
        : delegate(url, options);
    await expect(runSmoke(manifest, smokeEnv, oversized)).rejects.toThrow();
    expect(cancelled).toBe(true);
  });
  test('rejects a password echoed by the API without placing it in the error', async () => {
    const manifest = await preparedManifest();
    const delegate = transport(manifest);
    const leaking = async (url, options) =>
      url.pathname === '/health/live'
        ? new Response(
            JSON.stringify({
              data: { status: 'ok' },
              requestId,
              leak: smokeEnv.PREPROD_SMOKE_PASSWORD,
            }),
            {
              headers: {
                'x-release-id': manifest.release.sha,
                'cache-control': 'no-store',
              },
            },
          )
        : delegate(url, options);
    await expect(runSmoke(manifest, smokeEnv, leaking)).rejects.toThrow(
      'Smoke remoto no cumplió el contrato.',
    );
  });
});
