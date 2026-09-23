import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { verifyIdentityRecovery } from './identity-recovery.mjs';
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

async function main({ ctx, state }) {
  const databaseContainer = `supabase_db_${ctx.projectId}`;
  const api = testApi(ctx, state);
  let dbStopped = false;
  let faultsInstalled = false;
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
    const sqlTests = await cli(ctx, ['test', 'db']);
    console.log(sqlTests.stdout);
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
    for (const secret of [
      state.applicationPassword,
      state.fixturePassword,
      state.authAdminKey,
      state.migrationUrl,
      accessToken,
      'IMP02_PRIVATE_EXPECTATION_DO_NOT_EXPOSE',
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
    throw error;
  } finally {
    try {
      if (dbStopped) await run('docker', ['start', databaseContainer]);
    } finally {
      try {
        await api.stop();
      } finally {
        if (faultsInstalled) await removeIdentityFaultFixture(state);
      }
    }
  }
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
} catch (error) {
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
