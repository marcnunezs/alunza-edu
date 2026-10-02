import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import { verifyIdentityRecovery } from './identity-recovery.mjs';
import { verifyMaterialsRecovery } from './materials-recovery.mjs';
import {
  verifyHelpRecovery,
  verifyHelpAdmissionOutage,
} from './help-recovery.mjs';
import {
  installIdentityFaultFixture,
  removeIdentityFaultFixture,
} from './identity-fault-fixture.mjs';
import { root, run, cli, redactDiagnostics } from './local.mjs';
import {
  withTestEnvironment,
  testApi,
  buildApi,
  report,
} from './test-environment.mjs';

const checks = {};

async function waitForDatabase(state) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const client = new pg.Client({
      connectionString: state.migrationUrl,
      connectionTimeoutMillis: 2000,
      query_timeout: 2000,
    });
    client.on('error', () => undefined);
    try {
      await client.connect();
      await client.query('SELECT 1');
      return;
    } catch {
      // Starting the container does not mean PostgreSQL accepts connections yet.
    } finally {
      await client.end();
    }
    await delay(500);
  }
  throw new Error('La BD de pruebas no se recuperó para retirar el fixture.');
}

async function main({ ctx, state }) {
  const databaseContainer = `supabase_db_${ctx.projectId}`;
  const api = testApi(ctx, state);
  let dbStopped = false;
  let faultsInstalled = false;
  let failure;
  try {
    await installIdentityFaultFixture(state);
    faultsInstalled = true;
    await buildApi();
    await api.start(`http://127.0.0.1:${ctx.apiPort}/health/ready`);
    const baseUrl = `http://127.0.0.1:${ctx.apiPort}`;
    await api.wait(`${baseUrl}/health/ready`, 200);
    const httpTests = await run(
      process.execPath,
      [
        '--experimental-vm-modules',
        join(root, 'node_modules/jest/bin/jest.js'),
        '--config',
        'tests/jest.integration.cjs',
        '--runInBand',
      ],
      {
        env: { ALUNZA_TEST_STATE: ctx.statePath, ALUNZA_TEST_API_URL: baseUrl },
      },
    );
    console.log(redactDiagnostics(httpTests.stdout + httpTests.stderr));
    const httpSummary = (httpTests.stdout + httpTests.stderr).match(
      /^Tests:\s+(\d+) passed,\s+(\d+) total\s*$/m,
    );
    checks.http = httpSummary
      ? { passed: Number(httpSummary[1]), total: Number(httpSummary[2]) }
      : null;
    await report(
      'recovery',
      await verifyMaterialsRecovery({ ctx, state, api }),
      'imp-04',
    );
    await report(
      'help-recovery',
      await verifyHelpRecovery({ ctx, state, api }),
      'imp-04',
    );
    const sqlTests = await cli(ctx, ['test', 'db']);
    console.log(sqlTests.stdout);
    const sqlSummary = (sqlTests.stdout + sqlTests.stderr).match(
      /Files=(\d+),\s*Tests=(\d+)/,
    );
    checks.sql = sqlSummary
      ? { files: Number(sqlSummary[1]), assertions: Number(sqlSummary[2]) }
      : null;
    const advisors = await cli(ctx, [
      'db',
      'advisors',
      '--local',
      '--type',
      'security',
      '--level',
      'warn',
      '--fail-on',
      'error',
    ]);
    await report(
      'security-advisors',
      {
        status: 'passed',
        environment: 'isolated-local',
        output: redactDiagnostics(advisors.stdout + advisors.stderr),
      },
      'imp-02',
    );
    await report(
      'recovery',
      await verifyIdentityRecovery({ ctx, state, api }),
      'imp-01',
    );
    const fixture = JSON.parse(
      await readFile(join(root, 'fixtures/foundation/identity.json'), 'utf8'),
    );
    const auth = createClient(state.authUrl, state.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const login = await auth.auth.signInWithPassword({
      email: fixture.users[0].email,
      password: state.fixturePassword,
    });
    if (login.error || !login.data.session)
      throw new Error('No se obtuvo sesión para prueba de caída de BD.');
    const accessToken = login.data.session.access_token;
    console.log('Probando caída real de la BD exclusiva de pruebas...');
    await run('docker', ['stop', databaseContainer]);
    dbStopped = true;
    await api.wait(`${baseUrl}/health/ready`, 503);
    await api.wait(`${baseUrl}/health/live`, 200);
    const unavailable = await fetch(`${baseUrl}/api/v1/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(8000),
    });
    if (
      unavailable.status !== 503 ||
      (await unavailable.json()).error?.code !== 'PERSISTENCE_UNAVAILABLE'
    )
      throw new Error(
        'La consulta protegida no informó correctamente la caída de BD.',
      );
    await run('docker', ['start', databaseContainer]);
    dbStopped = false;
    await api.wait(`${baseUrl}/health/ready`, 200, 60_000);
    const recovered = await fetch(`${baseUrl}/api/v1/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(8000),
    });
    if (recovered.status !== 200)
      throw new Error('Consulta protegida no se recuperó tras restaurar BD.');
    await report(
      'help-postgres-outage',
      await verifyHelpAdmissionOutage({
        state,
        stopDatabase: async () => {
          await run('docker', ['stop', databaseContainer]);
          dbStopped = true;
        },
        startDatabase: async () => {
          await run('docker', ['start', databaseContainer]);
          dbStopped = false;
          await waitForDatabase(state);
        },
      }),
      'imp-04',
    );
    for (const secret of [
      state.applicationPassword,
      state.fixturePassword,
      state.authAdminKey,
      state.migrationUrl,
      accessToken,
      'IMP02_PRIVATE_EXPECTATION_DO_NOT_EXPOSE',
      'IMP03_HIDDEN_SENTINEL',
      'IMP04_HELP_HIDDEN_SENTINEL',
      'hidden-value-7-8',
    ]) {
      if (api.output.includes(secret))
        throw new Error('Un secreto apareció en logs de la API.');
    }
    const requestLogs = api.output.split(/\r?\n/).flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
    if (
      !requestLogs.some(
        (entry) =>
          entry.path === '/api/v1/me' &&
          entry.status === 403 &&
          typeof entry.requestId === 'string',
      )
    )
      throw new Error(
        'No se encontró el registro seguro del acceso rechazado a una cuenta inactiva.',
      );
    await mkdir(join(root, '.local/evidence'), { recursive: true });
    await writeFile(
      join(root, '.local/evidence/integration-api.log'),
      api.output,
    );
    console.log(
      'Integración real, RLS, fallos de BD y recuperación comprobados.',
    );
  } catch (error) {
    let output = `${error.output ?? error.message}\n${api.output}`;
    for (const value of [
      state.applicationPassword,
      state.fixturePassword,
      state.authAdminKey,
      state.migrationUrl,
    ])
      if (value) output = output.split(value).join('[redacted]');
    error.output = redactDiagnostics(output);
    failure = error;
  } finally {
    const cleanup = [
      async () => {
        if (dbStopped) await run('docker', ['start', databaseContainer]);
      },
      () => api.stop(),
      async () => {
        if (faultsInstalled) {
          await waitForDatabase(state);
          await removeIdentityFaultFixture(state);
        }
      },
    ];
    for (const action of cleanup) {
      try {
        await action();
      } catch (error) {
        const diagnostic = redactDiagnostics(error.message);
        if (failure)
          failure.output = `${failure.output ?? failure.message}\nFallo adicional durante limpieza: ${diagnostic}`;
        else failure = new Error(`Falló la limpieza: ${diagnostic}`);
      }
    }
  }
  if (failure) throw failure;
}
try {
  await withTestEnvironment(main, [], { upgradeFromFoundation: true });
  await report(
    'integration',
    {
      status: 'passed',
      infrastructure: 'real-local-supabase',
      cleanup: 'completed',
    },
    'imp-01',
  );
  await report(
    'integration',
    {
      status: 'passed',
      infrastructure: 'real-local-supabase',
      coverage: 'foundation, identity, academic, adversarial, pgTAP, recovery',
      cleanup: 'completed',
    },
    'imp-02',
  );
  await report(
    'integration',
    {
      status: 'passed',
      infrastructure: 'real-local-supabase-and-docker',
      coverage:
        'foundation, identity, academic, RUN, SUBMIT, history, progress, adversarial, pgTAP, recovery',
      checks,
      cleanup: 'completed',
    },
    'imp-03-submissions',
  );
} catch (error) {
  await report(
    'integration',
    { status: 'failed', azureRemote: 'not-tested' },
    'imp-04',
  );
  await report('integration', { status: 'failed' }, 'imp-03-submissions');
  await report('integration', { status: 'failed' }, 'imp-01');
  await report('integration', { status: 'failed' }, 'imp-02');
  console.error('Integración fallida; consultar diagnóstico local saneado.');
  await mkdir(join(root, '.local'), { recursive: true });
  await writeFile(
    join(root, '.local/integration-error.log'),
    redactDiagnostics(error.output ?? error.message),
    { mode: 0o600 },
  );
  process.exitCode = 1;
}
if (process.exitCode !== 1)
  await report(
    'integration',
    {
      status: 'passed',
      infrastructure: 'real-local-auth-api-storage-pgvector',
      embeddings: 'explicit-test-double',
      azureRemote: 'not-tested',
      checks,
      cleanup: 'completed',
    },
    'imp-04',
  );
