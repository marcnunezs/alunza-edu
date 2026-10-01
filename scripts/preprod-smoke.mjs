import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadManifest,
  assertRemoteAuthorization,
  requestBudget,
} from './preprod-manifest.mjs';
import { writeReport } from './preprod.mjs';

const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
function ensure(condition) {
  if (!condition) throw new Error('Smoke remoto no cumplió el contrato.');
}
export function smokeConfiguration(manifest, environment) {
  assertRemoteAuthorization(manifest, 'smoke:web-api');
  const value = {
    publishableKey: environment.PREPROD_SUPABASE_PUBLISHABLE_KEY,
    accounts: ['ADMIN', 'TEACHER', 'STUDENT'].map((role) => ({
      role,
      email: environment[`PREPROD_SMOKE_${role}_EMAIL`],
    })),
    password: environment.PREPROD_SMOKE_PASSWORD,
    disabledEmail: environment.PREPROD_DISABLED_EMAIL,
    disabledPassword: environment.PREPROD_DISABLED_PASSWORD,
    ownOrganization: environment.PREPROD_OWN_ORGANIZATION_ID,
    otherOrganization: environment.PREPROD_OTHER_ORGANIZATION_ID,
  };
  ensure(/^sb_publishable_[\w-]+$/.test(value.publishableKey ?? ''));
  ensure(
    value.accounts.every(
      (account) =>
        typeof account.email === 'string' &&
        account.email.endsWith('@alunza.test'),
    ) &&
      typeof value.password === 'string' &&
      value.password.length >= 12,
  );
  if (value.disabledEmail || value.disabledPassword)
    ensure(
      typeof value.disabledEmail === 'string' &&
        value.disabledEmail.endsWith('@alunza.test') &&
        typeof value.disabledPassword === 'string' &&
        value.disabledPassword.length >= 12,
    );
  // Five anonymous checks and eight requests for each active role, with logout.
  // Refuse an incomplete assay before opening any remote session.
  ensure(manifest.budget.maxHttpRequests >= 29 + (value.disabledEmail ? 3 : 0));
  ensure(
    uuid.test(value.ownOrganization) &&
      uuid.test(value.otherOrganization) &&
      value.ownOrganization !== value.otherOrganization,
  );
  return value;
}
export async function runSmoke(
  manifest,
  environment = process.env,
  fetcher = fetch,
) {
  const config = smokeConfiguration(manifest, environment);
  const budget = requestBudget(manifest, 'smoke:web-api');
  const { apiOrigin } = manifest.targets.azure;
  const { webOrigin } = manifest.targets.vercel;
  const authOrigin = manifest.targets.supabase.authUrl;
  const permitted = new Set([apiOrigin, webOrigin, authOrigin]);
  const secrets = [config.password, config.disabledPassword].filter(Boolean);
  const checks = [];
  const cleanupTickets = new Set();
  const cleanupDeadline =
    Math.min(
      Date.parse(manifest.remote.expiresAt),
      Date.now() + manifest.budget.maxDurationSeconds * 1000,
    ) + 35000;
  function reserveLogout() {
    budget.consume();
    const ticket = {};
    cleanupTickets.add(ticket);
    return ticket;
  }
  async function request(
    id,
    origin,
    path,
    expected,
    options = {},
    cleanupTicket,
  ) {
    ensure(permitted.has(origin));
    let timeout;
    if (cleanupTicket) {
      ensure(
        cleanupTickets.delete(cleanupTicket) &&
          origin === authOrigin &&
          path === '/auth/v1/logout?scope=local' &&
          options.method === 'POST' &&
          Date.now() < cleanupDeadline,
      );
      timeout = Math.min(10000, cleanupDeadline - Date.now());
    } else timeout = budget.consume();
    const started = performance.now();
    const response = await fetcher(new URL(path, origin), {
      ...options,
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(timeout),
    });
    ensure(
      Array.isArray(expected)
        ? expected.includes(response.status)
        : response.status === expected,
    );
    if (origin === apiOrigin && options.method !== 'OPTIONS') {
      ensure(response.headers.get('x-release-id') === manifest.release.sha);
      ensure(response.headers.get('cache-control')?.includes('no-store'));
    }
    checks.push({
      id,
      status: 'passed',
      httpStatus: response.status,
      durationMs: Math.round(performance.now() - started),
    });
    return response;
  }
  async function json(response, allowAuthToken = false) {
    const reader = response.body?.getReader();
    ensure(reader);
    let size = 0;
    const chunks = [];
    try {
      while (true) {
        const item = await reader.read();
        if (item.done) break;
        size += item.value.byteLength;
        if (size > 65536) {
          await reader.cancel();
          throw new Error('Respuesta excedió límite.');
        }
        chunks.push(Buffer.from(item.value));
      }
    } finally {
      reader.releaseLock();
    }
    const content = Buffer.concat(chunks).toString('utf8');
    if (!allowAuthToken)
      ensure(!secrets.some((secret) => content.includes(secret)));
    return JSON.parse(content);
  }
  const page = await request('web', webOrigin, '/', 200);
  ensure(page.headers.get('content-type')?.includes('text/html'));
  await page.body?.cancel();
  for (const name of ['live', 'ready']) {
    const body = await json(
      await request(`health-${name}`, apiOrigin, `/health/${name}`, 200),
    );
    ensure(body.data?.status === 'ok' && uuid.test(body.requestId));
  }
  for (const [id, headers] of [
    ['missing-token', {}],
    ['invalid-token', { Authorization: 'Bearer invalid-smoke-token' }],
  ]) {
    const body = await json(
      await request(id, apiOrigin, '/api/v1/me', 401, { headers }),
    );
    ensure(body.error?.code === 'UNAUTHENTICATED' && uuid.test(body.requestId));
  }
  async function login(email, password, id) {
    const cleanupTicket = reserveLogout();
    const response = await request(
      id,
      authOrigin,
      '/auth/v1/token?grant_type=password',
      200,
      {
        method: 'POST',
        headers: {
          apikey: config.publishableKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      },
    );
    const body = await json(response, true);
    ensure(typeof body.access_token === 'string' && uuid.test(body.user?.id));
    secrets.push(body.access_token);
    return { token: body.access_token, userId: body.user.id, cleanupTicket };
  }
  for (const account of config.accounts) {
    const active = await login(
      account.email,
      config.password,
      `login-${account.role}`,
    );
    const headers = {
      Authorization: `Bearer ${active.token}`,
      Origin: webOrigin,
    };
    try {
      const meResponse = await request(
        `me-${account.role}`,
        apiOrigin,
        '/api/v1/me',
        200,
        { headers },
      );
      ensure(
        meResponse.headers.get('access-control-allow-origin') === webOrigin,
      );
      const me = await json(meResponse);
      ensure(
        me.data?.id === active.userId &&
          me.data?.accountState === 'ACTIVE' &&
          me.data.memberships.some(
            (m) =>
              m.organizationId === config.ownOrganization &&
              m.role === account.role &&
              m.state === 'ACTIVE',
          ),
      );
      const own = await json(
        await request(
          `organization-own-${account.role}`,
          apiOrigin,
          `/api/v1/organizations/${config.ownOrganization}`,
          200,
          { headers },
        ),
      );
      ensure(own.data?.id === config.ownOrganization);
      for (const [id, organization] of [
        ['organization-foreign', config.otherOrganization],
        ['organization-missing', 'ffffffff-ffff-4fff-8fff-ffffffffffff'],
      ]) {
        const body = await json(
          await request(
            `${id}-${account.role}`,
            apiOrigin,
            `/api/v1/organizations/${organization}`,
            404,
            { headers },
          ),
        );
        ensure(body.error?.code === 'RESOURCE_NOT_FOUND');
      }
      const cors = await request(
        `cors-foreign-${account.role}`,
        apiOrigin,
        '/api/v1/me',
        200,
        { headers: { ...headers, Origin: 'https://unauthorized.invalid' } },
      );
      ensure(
        cors.headers.get('access-control-allow-origin') !==
          'https://unauthorized.invalid',
      );
      await json(cors);
      const direct = await request(
        `data-api-denied-${account.role}`,
        authOrigin,
        '/rest/v1/profiles?select=id&limit=1',
        [401, 403, 404, 406],
        {
          headers: {
            apikey: config.publishableKey,
            Authorization: `Bearer ${active.token}`,
            'Accept-Profile': 'app',
          },
        },
      );
      await json(direct);
    } finally {
      const logout = await request(
        `logout-${account.role}`,
        authOrigin,
        '/auth/v1/logout?scope=local',
        204,
        {
          method: 'POST',
          headers: {
            apikey: config.publishableKey,
            Authorization: `Bearer ${active.token}`,
          },
        },
        active.cleanupTicket,
      );
      await logout.body?.cancel();
    }
  }
  if (config.disabledEmail) {
    const disabled = await login(
      config.disabledEmail,
      config.disabledPassword,
      'login-disabled',
    );
    try {
      const denied = await json(
        await request('account-disabled', apiOrigin, '/api/v1/me', 403, {
          headers: { Authorization: `Bearer ${disabled.token}` },
        }),
      );
      ensure(denied.error?.code === 'ACCOUNT_INACTIVE');
    } finally {
      await request(
        'logout-disabled',
        authOrigin,
        '/auth/v1/logout?scope=local',
        204,
        {
          method: 'POST',
          headers: {
            apikey: config.publishableKey,
            Authorization: `Bearer ${disabled.token}`,
          },
        },
        disabled.cleanupTicket,
      );
    }
  }
  return {
    status: 'passed',
    scope: 'http-web-api-auth-data',
    browserFlow: 'pending',
    remoteExecuted: true,
    release: manifest.release.sha,
    requests: budget.requests,
    monetaryHardLimit: false,
    observedCost: null,
    checks,
  };
}
async function main() {
  let authorized = false;
  try {
    const manifest = await loadManifest(
      process.argv[2] ?? 'infra/preproduction/manifest.example.json',
    );
    smokeConfiguration(manifest, process.env);
    authorized = true;
    const result = await runSmoke(manifest);
    await writeReport('preprod-smoke', result);
    console.log(
      'Smoke remoto aprobado; informe público sin credenciales generado.',
    );
  } catch {
    await writeReport('preprod-smoke', {
      status: authorized ? 'failed' : 'pending-configuration',
      remoteExecuted: authorized,
    });
    console.error(
      authorized
        ? 'Smoke remoto fallido; no se confirma la integración.'
        : 'Smoke pendiente: destino, autorización o credenciales de fixture incompletos. No hubo red.',
    );
    process.exitCode = authorized ? 1 : 2;
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
