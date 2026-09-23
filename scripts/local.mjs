import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import { seedAcademic } from './academic-fixture.mjs';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const cliPath = join(
  dirname(require.resolve('supabase/package.json')),
  'dist/supabase.js',
);
export function context(projectDir = root, test = false) {
  return {
    projectDir,
    test,
    statePath: join(projectDir, '.local/runtime.json'),
    apiPort: test ? 4100 : 4000,
    authPort: test ? 16421 : 15421,
    dbPort: test ? 16422 : 15422,
    projectId: test ? 'alunza-edu-foundation-test' : 'alunza-edu-foundation',
    networkName: test
      ? 'alunza-foundation-test-local'
      : 'alunza-foundation-local',
  };
}

export function run(command, args, options = {}) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? root,
      env: { ...process.env, ...options.env },
      windowsHide: true,
      stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '',
      stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== 0 && !options.allowFailure) {
        const error = new Error(
          `Fallo de ${options.label ?? command} (salida ${code}).`,
        );
        error.output = stdout + stderr;
        reject(error);
      } else resolveResult({ code, stdout, stderr });
    });
  });
}
export function redactDiagnostics(text) {
  return text
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[database connection redacted]')
    .replace(
      /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
      '[JWT redacted]',
    )
    .replace(/\bsb_secret_[A-Za-z0-9_-]+\b/g, '[secret key redacted]')
    .replace(
      /(password|secret_key|service_role_key|jwt_secret)(["'\s:=]+)[^\r\n]+/gi,
      '$1$2[redacted]',
    );
}
export async function cli(ctx, args, options = {}) {
  return run(
    process.execPath,
    [
      cliPath,
      ...args,
      '--workdir',
      ctx.projectDir,
      '--network-id',
      ctx.networkName,
    ],
    { label: `Supabase ${args[0]}`, ...options },
  );
}
export async function readState(ctx) {
  const state = JSON.parse(await readFile(ctx.statePath, 'utf8'));
  if (
    state.projectId !== ctx.projectId ||
    state.authUrl !== `http://127.0.0.1:${ctx.authPort}`
  ) {
    throw new Error(
      'El estado local no corresponde al proyecto y destino esperado.',
    );
  }
  assertLocalDatabase(state.migrationUrl, ctx.dbPort);
  return state;
}
export function assertLocalDatabase(url, expectedPort) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:')
    throw new Error('Protocolo de BD inesperado.');
  if (
    !['127.0.0.1', 'localhost'].includes(parsed.hostname) ||
    Number(parsed.port) !== expectedPort ||
    parsed.pathname !== '/postgres'
  ) {
    throw new Error(
      'Operacion rechazada: destino fuera de la BD local de Alunza.',
    );
  }
}
export async function doctor() {
  if (process.version !== 'v24.21.0')
    throw new Error('Se requiere Node 24.21.0. Ejecuta scripts/use-node.ps1.');
  const version = await cli(context(), ['--version']);
  if (version.stdout.trim() !== '2.101.0')
    throw new Error('Supabase CLI debe ser 2.101.0.');
  const docker = await run('docker', [
    'version',
    '--format',
    '{{json .Server}}',
  ]);
  const server = JSON.parse(docker.stdout);
  if (!server || server.Os !== 'linux')
    throw new Error('Docker requiere motor Linux disponible.');
  const compose = await run('docker', ['compose', 'version', '--short']);
  console.log(
    `Node ${process.version}; Supabase 2.101.0; Docker ${server.Version}; Compose ${compose.stdout.trim()}.`,
  );
}
export async function portAvailable(port) {
  return new Promise((resolvePort) => {
    const server = net.createServer();
    server.once('error', () => resolvePort(false));
    server.listen(port, '127.0.0.1', () =>
      server.close(() => resolvePort(true)),
    );
  });
}
async function saveJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
}
export async function up(ctx) {
  await doctor();
  const config = await readFile(
    join(ctx.projectDir, 'supabase/config.toml'),
    'utf8',
  );
  if (!config.includes(`project_id = "${ctx.projectId}"`))
    throw new Error('project_id local inesperado.');
  const network = await run('docker', ['network', 'inspect', ctx.networkName], {
    allowFailure: true,
  });
  if (network.code !== 0) {
    await run('docker', [
      'network',
      'create',
      '--driver',
      'bridge',
      '--label',
      `alunza.project=${ctx.projectId}`,
      '--opt',
      'com.docker.network.bridge.host_binding_ipv4=127.0.0.1',
      ctx.networkName,
    ]);
  } else {
    const found = JSON.parse(network.stdout)[0];
    if (
      found.Labels?.['alunza.project'] !== ctx.projectId ||
      found.Options?.['com.docker.network.bridge.host_binding_ipv4'] !==
        '127.0.0.1'
    )
      throw new Error('Red existente sin identidad o binding local esperado.');
  }
  const current = await run('docker', ['ps', '-a', '--format', '{{.Names}}']);
  if (!current.stdout.split(/\r?\n/).includes(`supabase_db_${ctx.projectId}`)) {
    for (const port of [
      ctx.authPort,
      ctx.dbPort,
      ctx.authPort + 2,
      ctx.authPort + 3,
    ]) {
      if (!(await portAvailable(port)))
        throw new Error(
          `Puerto ${port} ocupado. No se detendran servicios ajenos.`,
        );
    }
  }
  const signingFile = join(ctx.projectDir, 'supabase/signing_keys.json');
  if (!existsSync(signingFile)) {
    await writeFile(signingFile, '[]\n', { mode: 0o600 });
  }
  const initialKeys = JSON.parse(await readFile(signingFile, 'utf8'));
  if (Array.isArray(initialKeys) && initialKeys.length === 0) {
    await cli(ctx, ['gen', 'signing-key', '--algorithm', 'ES256', '--append']);
  }
  const signingKeys = JSON.parse(await readFile(signingFile, 'utf8'));
  if (
    !Array.isArray(signingKeys) ||
    !signingKeys.some((key) => key.alg === 'ES256' && key.d && key.kid)
  ) {
    throw new Error(
      'Falta clave ES256 privada valida en el archivo local de firma.',
    );
  }
  console.log(`Iniciando Supabase local (${ctx.projectId})...`);
  await cli(ctx, ['start']);
  const bindings = await run('docker', [
    'inspect',
    `supabase_kong_${ctx.projectId}`,
    `supabase_db_${ctx.projectId}`,
    `supabase_studio_${ctx.projectId}`,
    `supabase_inbucket_${ctx.projectId}`,
  ]);
  const observedBindings = new Set();
  for (const container of JSON.parse(bindings.stdout)) {
    for (const ports of Object.values(container.NetworkSettings.Ports)) {
      for (const binding of ports ?? []) observedBindings.add(binding.HostIp);
    }
  }
  console.log(
    `Binding observado de Supabase: ${[...observedBindings].join(', ')}. El binding de la CLI no acredita aislamiento de red productivo.`,
  );
  const result = await cli(ctx, ['status', '--output', 'json']);
  const status = JSON.parse(result.stdout);
  const migrationUrl = status.DB_URL;
  assertLocalDatabase(migrationUrl, ctx.dbPort);
  const previous = existsSync(ctx.statePath) ? await readState(ctx) : null;
  const state = {
    projectId: ctx.projectId,
    authUrl: `http://127.0.0.1:${ctx.authPort}`,
    publishableKey: status.PUBLISHABLE_KEY ?? status.ANON_KEY,
    authAdminKey: status.SECRET_KEY ?? status.SERVICE_ROLE_KEY,
    migrationUrl,
    applicationPassword:
      previous?.applicationPassword ?? randomBytes(32).toString('hex'),
    fixturePassword:
      previous?.fixturePassword ?? randomBytes(24).toString('base64url'),
  };
  if (!state.publishableKey || !state.authAdminKey)
    throw new Error('Supabase status no entrego claves Auth requeridas.');
  await saveJson(ctx.statePath, state);
  console.log(
    'Supabase iniciado. Configuracion privilegiada guardada solo en .local; no se imprime.',
  );
}
export function applicationUrl(ctx, state, hostname = '127.0.0.1') {
  const url = new URL(state.migrationUrl);
  url.hostname = hostname;
  url.username = 'alunza_app';
  url.password = state.applicationPassword;
  return url.href;
}
export function apiEnvironment(ctx, state, hostname = '127.0.0.1') {
  return {
    PORT: String(ctx.apiPort),
    HOST: hostname === '127.0.0.1' ? '127.0.0.1' : '0.0.0.0',
    APP_ORIGIN: 'http://localhost:3000',
    ALLOWED_ORIGINS: 'http://localhost:3000,http://127.0.0.1:3000',
    DATABASE_URL: applicationUrl(ctx, state, hostname),
    SUPABASE_JWKS_URL: `http://${hostname}:${ctx.authPort}/auth/v1/.well-known/jwks.json`,
    SUPABASE_JWT_ISSUER: `${state.authUrl}/auth/v1`,
    SUPABASE_JWT_AUDIENCE: 'authenticated',
    SUPABASE_URL: `http://${hostname}:${ctx.authPort}`,
    SUPABASE_PUBLISHABLE_KEY: state.publishableKey,
    SUPABASE_SECRET_KEY: state.authAdminKey,
    INVITATION_WORKER_ENABLED: 'true',
    INVITATION_CALLBACK_URL: 'http://localhost:3000/acceso/invitacion',
    ENVIRONMENT: ctx.test ? 'test' : 'local',
  };
}
async function writeEnv(path, values) {
  await mkdir(dirname(path), { recursive: true });
  const content =
    Object.entries(values)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join('\n') + '\n';
  await writeFile(path, content, { mode: 0o600 });
}
export async function migrate(ctx) {
  const state = await readState(ctx);
  await cli(ctx, ['migration', 'up', '--local']);
  // Supabase owns auth and the normal migration login cannot grant its ACLs.
  // This local-only bootstrap uses the container owner for narrow grants/policies;
  // alunza_app still has neither auth schema access nor direct Auth table reads.
  await run('docker', [
    'exec',
    `supabase_db_${ctx.projectId}`,
    'sh',
    '-c',
    'export PGPASSWORD="$POSTGRES_PASSWORD"; exec psql --username supabase_admin --dbname postgres --set ON_ERROR_STOP=1 --command "$1"',
    'alunza-auth-grants',
    `BEGIN;
     GRANT USAGE ON SCHEMA auth TO alunza_identity;
     GRANT SELECT (id,user_id) ON auth.sessions TO alunza_identity;
     GRANT SELECT (id,email,email_confirmed_at) ON auth.users TO alunza_identity;
     DROP POLICY IF EXISTS alunza_current_session ON auth.sessions;
     CREATE POLICY alunza_current_session ON auth.sessions FOR SELECT TO alunza_identity
       USING (id = nullif(current_setting('app.session_id',true),'')::uuid
         AND user_id = nullif(current_setting('app.actor_id',true),'')::uuid);
     DROP POLICY IF EXISTS alunza_current_identity ON auth.users;
     CREATE POLICY alunza_current_identity ON auth.users FOR SELECT TO alunza_identity
       USING (id = nullif(current_setting('app.actor_id',true),'')::uuid);
     COMMIT;`,
  ]);
  const client = new pg.Client({ connectionString: state.migrationUrl });
  await client.connect();
  try {
    if (!/^[a-f0-9]{64}$/.test(state.applicationPassword))
      throw new Error('Formato de credencial local invalido.');
    // Generated hex only: PostgreSQL ALTER ROLE cannot bind a password parameter.
    await client.query(
      `ALTER ROLE alunza_app PASSWORD '${state.applicationPassword}'`,
    );
  } finally {
    await client.end();
  }
  if (!ctx.test) {
    await writeEnv(
      join(root, 'apps/api/.env.local'),
      apiEnvironment(ctx, state),
    );
    await writeEnv(join(root, 'apps/web/.env.local'), {
      NEXT_PUBLIC_API_BASE_URL: `http://127.0.0.1:${ctx.apiPort}`,
      NEXT_PUBLIC_SUPABASE_URL: state.authUrl,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: state.publishableKey,
    });
    await writeEnv(join(root, '.local/compose.env'), {
      ...apiEnvironment(ctx, state, 'host.docker.internal'),
      NEXT_PUBLIC_API_BASE_URL: `http://127.0.0.1:${ctx.apiPort}`,
      NEXT_PUBLIC_SUPABASE_URL: state.authUrl,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: state.publishableKey,
    });
  }
  console.log(
    'Migraciones aplicadas. Rol de aplicación limitado y configuración por consumidor preparados.',
  );
}
export async function seed(ctx, { academic = true } = {}) {
  const state = await readState(ctx);
  const fixture = JSON.parse(
    await readFile(join(root, 'fixtures/foundation/identity.json'), 'utf8'),
  );
  const auth = createClient(state.authUrl, state.authAdminKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  for (const user of fixture.users) {
    const existing = await auth.auth.admin.getUserById(user.id);
    if (!existing.data?.user) {
      if (
        existing.error &&
        ![404, 'user_not_found'].includes(existing.error.status) &&
        existing.error.code !== 'user_not_found'
      ) {
        throw new Error('No fue posible consultar identidad local de fixture.');
      }
      const created = await auth.auth.admin.createUser({
        id: user.id,
        email: user.email,
        password: state.fixturePassword,
        email_confirm: true,
      });
      if (created.error || created.data.user?.id !== user.id)
        throw new Error('No fue posible crear identidad ficticia estable.');
    } else {
      if (existing.data.user.email !== user.email)
        throw new Error('Identidad local existente no corresponde al fixture.');
      const updated = await auth.auth.admin.updateUserById(user.id, {
        password: state.fixturePassword,
        email_confirm: true,
      });
      if (updated.error)
        throw new Error(
          'No fue posible sincronizar la credencial ficticia local.',
        );
    }
  }
  const client = new pg.Client({ connectionString: state.migrationUrl });
  await client.connect();
  try {
    await client.query('BEGIN');
    for (const org of fixture.organizations) {
      await client.query(
        'INSERT INTO app.organizations(id,code,name,timezone) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET code=EXCLUDED.code,name=EXCLUDED.name,timezone=EXCLUDED.timezone,archived_at=NULL',
        [org.id, org.code, org.name, org.timezone],
      );
    }
    for (const user of fixture.users) {
      await client.query(
        'INSERT INTO app.profiles(id,display_name,email_normalized,account_state) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET display_name=EXCLUDED.display_name,email_normalized=EXCLUDED.email_normalized,account_state=EXCLUDED.account_state',
        [user.id, user.displayName, user.email, user.accountState],
      );
      await client.query(
        'INSERT INTO app.organization_memberships(organization_id,user_id,role,state,joined_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(organization_id,user_id) DO UPDATE SET role=EXCLUDED.role,state=EXCLUDED.state,joined_at=EXCLUDED.joined_at,disabled_at=NULL',
        [
          user.organizationId,
          user.id,
          user.role,
          user.membershipState,
          fixture.createdAt,
        ],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
  console.log(
    'Fixture incremental preparado: 2 organizaciones, 6 usuarios, 6 membresias.',
  );
  if (academic) await seedAcademic(state);
}
export async function down(ctx) {
  await cli(ctx, ['stop']);
  console.log(`Servicios ${ctx.projectId} detenidos; datos conservados.`);
}
async function main() {
  const ctx = context();
  switch (process.argv[2]) {
    case 'doctor':
      await doctor();
      break;
    case 'up':
      await up(ctx);
      break;
    case 'migrate':
      await migrate(ctx);
      break;
    case 'seed':
      await seed(ctx);
      break;
    case 'down':
      await down(ctx);
      break;
    case 'credentials': {
      // Explicit local-only user command; never called by setup, tests or logs.
      if (!process.stdout.isTTY)
        throw new Error(
          'Credenciales disponibles solo en terminal interactiva local; consulta .local/runtime.json.',
        );
      const state = await readState(ctx);
      console.log('Password ficticio local:', state.fixturePassword);
      break;
    }
    case 'compose-up':
      await readState(ctx);
      await run(
        'docker',
        [
          'compose',
          '--env-file',
          '.local/compose.env',
          '-f',
          'infra/compose.yaml',
          'up',
          '--build',
          '-d',
        ],
        { inherit: true },
      );
      break;
    default:
      throw new Error('Comando local desconocido.');
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(error.message);
    // CLI diagnostics may contain credentials. Keep them private and do not echo.
    if (error.output) {
      mkdir(join(root, '.local'), { recursive: true })
        .then(() =>
          writeFile(
            join(root, '.local/last-setup-error.log'),
            redactDiagnostics(error.output),
            { mode: 0o600 },
          ),
        )
        .catch(() => {});
      console.error('Detalle tecnico saneado: .local/last-setup-error.log.');
    }
    process.exitCode = 1;
  });
}
