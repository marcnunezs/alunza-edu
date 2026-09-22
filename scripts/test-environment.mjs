import { spawn } from 'node:child_process';
import {
  mkdir,
  cp,
  readFile,
  writeFile,
  open,
  unlink,
  rm,
  realpath,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import {
  root,
  context,
  up,
  migrate,
  seed,
  readState,
  down,
  portAvailable,
  apiEnvironment,
  run,
  cli,
} from './local.mjs';

export const testContext = context(
  join(root, '.local/integration-workspace'),
  true,
);
export const reportDirectory = join(root, '.local/reports/imp-00-05');

export async function report(name, summary, group = 'imp-00-05') {
  if (!/^[a-z0-9-]+$/.test(name))
    throw new Error('Nombre de informe inválido.');
  if (!['imp-00-05', 'imp-00-06-08', 'imp-01'].includes(group))
    throw new Error('Grupo de informe inválido.');
  const directory = join(root, '.local/reports', group);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, `${name}.json`),
    JSON.stringify(
      { recordedAt: new Date().toISOString(), ...summary },
      null,
      2,
    ) + '\n',
  );
}

export async function withTestEnvironment(
  action,
  extraPorts = [],
  { upgradeFromFoundation = false } = {},
) {
  const ctx = testContext;
  await mkdir(join(root, '.local'), { recursive: true });
  const lockPath = join(root, '.local/integration.lock');
  // The existing integration lock is also used by E2E: neither suite can mutate
  // the fixture or stop services while the other owns the test environment.
  const lock = await open(lockPath, 'wx');
  let owned = false;
  try {
    await lock.writeFile(String(process.pid));
    for (const port of [ctx.apiPort, ...extraPorts]) {
      if (!(await portAvailable(port)))
        throw new Error(
          `Puerto de prueba ${port} no disponible; no se tocarán procesos existentes.`,
        );
    }
    await mkdir(join(ctx.projectDir, 'supabase'), { recursive: true });
    const config = (await readFile(join(root, 'supabase/config.toml'), 'utf8'))
      .replace(
        'project_id = "alunza-edu-foundation"',
        `project_id = "${ctx.projectId}"`,
      )
      .replaceAll('1542', '1642');
    await writeFile(join(ctx.projectDir, 'supabase/config.toml'), config);
    // Replace only these owned source copies: removed migrations/tests must not
    // survive in the test workspace. Refuse links that escape the fixed path.
    for (const name of ['migrations', 'tests', 'templates']) {
      const target = join(ctx.projectDir, 'supabase', name);
      try {
        if (resolve(await realpath(target)) !== resolve(target))
          throw new Error(
            'La copia de pruebas no puede apuntar fuera de su ruta propia.',
          );
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        if (
          resolve(await realpath(join(ctx.projectDir, 'supabase'))) !==
          resolve(join(ctx.projectDir, 'supabase'))
        )
          throw new Error(
            'El directorio de pruebas no puede ser un enlace externo.',
            { cause: error },
          );
      }
      await rm(target, { recursive: true, force: true });
      await cp(join(root, 'supabase', name), target, { recursive: true });
    }
    owned = true;
    await up(ctx);
    await readState(ctx);
    // Explicit test commands reconstruct only this local fixture database. This
    // is intentionally separate from local:up, which never resets development.
    console.log(
      'Reconstruyendo la BD exclusiva de pruebas desde las migraciones actuales...',
    );
    // CLI 2.101 has both a global and a reset-local --version flag: invoking
    // it can return version text without resetting. Restrict the owned copy to
    // IMP-00 instead, then restore the incremental migration before migrate.
    const incrementalName = '20260911003744_identity_governance.sql';
    const incrementalCopy = join(
      ctx.projectDir,
      'supabase/migrations',
      incrementalName,
    );
    if (upgradeFromFoundation) await unlink(incrementalCopy);
    await cli(ctx, ['db', 'reset', '--local', '--no-seed', '--yes']);
    let foundationSnapshot;
    const snapshot = async () => {
      const currentState = await readState(ctx);
      const database = new pg.Client({
        connectionString: currentState.migrationUrl,
      });
      await database.connect();
      try {
        const records = await database.query(`
          SELECT 'organization' AS kind, id::text AS id, created_at FROM app.organizations
          UNION ALL SELECT 'profile', id::text, created_at FROM app.profiles
          UNION ALL SELECT 'membership', organization_id::text || '/' || user_id::text, created_at FROM app.organization_memberships
          ORDER BY kind,id`);
        return JSON.stringify(records.rows);
      } finally {
        await database.end();
      }
    };
    if (upgradeFromFoundation) {
      await seed(ctx);
      foundationSnapshot = await snapshot();
      if (JSON.parse(foundationSnapshot).length !== 14)
        throw new Error(
          'La base IMP-00 de actualización no contiene exclusivamente el fixture canónico.',
        );
      const foundationDatabase = new pg.Client({
        connectionString: (await readState(ctx)).migrationUrl,
      });
      await foundationDatabase.connect();
      try {
        const structure = await foundationDatabase.query(
          "SELECT count(*)::int count FROM information_schema.tables WHERE table_schema='app' AND table_type='BASE TABLE'",
        );
        if (structure.rows[0].count !== 3)
          throw new Error(
            'La actualización debe comenzar con las tres tablas de IMP-00.',
          );
      } finally {
        await foundationDatabase.end();
      }
      await cp(
        join(root, 'supabase/migrations', incrementalName),
        incrementalCopy,
      );
    }
    await migrate(ctx);
    if (upgradeFromFoundation) {
      if (foundationSnapshot !== (await snapshot()))
        throw new Error(
          'La migración cambió identidades o fechas de fundación existentes.',
        );
      await report(
        'migration-upgrade',
        {
          status: 'passed',
          from: '20260910185307',
          to: '20260911003744',
          preserved:
            'organization-profile-membership-identifiers-and-created-at',
        },
        'imp-01',
      );
    }
    await seed(ctx);
    await seed(ctx);
    return await action({ ctx, state: await readState(ctx) });
  } finally {
    try {
      if (owned) await down(ctx);
    } finally {
      await lock.close();
      await unlink(lockPath);
    }
  }
}

export function publicTestEnvironment(state) {
  return {
    ALUNZA_E2E_BUILD: '1',
    NEXT_PUBLIC_API_BASE_URL: 'http://127.0.0.1:4100',
    NEXT_PUBLIC_SUPABASE_URL: state.authUrl,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: state.publishableKey,
    NEXT_TELEMETRY_DISABLED: '1',
  };
}

export function nodeService(args, environment, cwd = root) {
  let child;
  let spawnError;
  let output = '';
  return {
    get output() {
      return output;
    },
    get running() {
      return (
        !!child &&
        !spawnError &&
        child.exitCode === null &&
        child.signalCode === null
      );
    },
    async start(url) {
      if (!this.running) {
        spawnError = undefined;
        child = spawn(process.execPath, args, {
          cwd,
          windowsHide: true,
          env: {
            PATH: process.env.PATH,
            SystemRoot: process.env.SystemRoot,
            TEMP: process.env.TEMP,
            TMP: process.env.TMP,
            ...environment,
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        child.stdout.on('data', (chunk) => {
          output += chunk;
        });
        child.stderr.on('data', (chunk) => {
          output += chunk;
        });
        child.on('error', (error) => {
          spawnError = error;
        });
      }
      await this.wait(url, 200);
    },
    async wait(url, expectedStatus, timeout = 30_000) {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        if (!this.running)
          throw new Error('El proceso de prueba terminó antes de responder.');
        try {
          const response = await fetch(url, {
            signal: AbortSignal.timeout(2500),
          });
          if (response.status === expectedStatus) return;
        } catch {
          /* Wait only for the owned process and bounded dependency startup. */
        }
        await delay(200);
      }
      throw new Error(
        `No se obtuvo HTTP ${expectedStatus} en ${new URL(url).pathname}.`,
      );
    },
    async stop() {
      if (!this.running) return;
      const stopped = new Promise((resolveExit) =>
        child.once('exit', resolveExit),
      );
      child.kill('SIGTERM');
      await Promise.race([stopped, delay(5000)]);
      if (this.running) {
        child.kill('SIGKILL');
        await Promise.race([stopped, delay(2000)]);
      }
      if (this.running)
        throw new Error('No se pudo detener el proceso de prueba propio.');
    },
  };
}

export function testApi(ctx, state, webPort = 3000) {
  return nodeService([join(root, 'apps/api/dist/main.js')], {
    ...apiEnvironment(ctx, state),
    APP_ORIGIN: `http://127.0.0.1:${webPort}`,
    ALLOWED_ORIGINS: `http://127.0.0.1:${webPort}`,
    INVITATION_CALLBACK_URL: `http://127.0.0.1:${webPort}/acceso/invitacion`,
  });
}

export async function buildApi() {
  for (const configuration of [
    'packages/contracts/tsconfig.json',
    'apps/api/tsconfig.build.json',
  ]) {
    await run(
      process.execPath,
      [join(root, 'node_modules/typescript/bin/tsc'), '-p', configuration],
      { inherit: true },
    );
  }
}
