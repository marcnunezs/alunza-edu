import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { root, run, cli, redactDiagnostics } from './local.mjs';
import {
  withTestEnvironment,
  testApi,
  buildApi,
  report,
} from './test-environment.mjs';

// Focus only: the full CI discovers the same HTTP and pgTAP cases. Owns the
// shared TEST reservation and never touches development or remote databases.
try {
  await withTestEnvironment(async ({ ctx, state }) => {
    const api = testApi(ctx, state);
    try {
      await buildApi();
      const baseUrl = `http://127.0.0.1:${ctx.apiPort}`;
      await api.start(`${baseUrl}/health/ready`);
      const result = await run(
        process.execPath,
        [
          '--experimental-vm-modules',
          join(root, 'node_modules/jest/bin/jest.js'),
          '--config',
          'tests/jest.integration.cjs',
          '--runInBand',
          '--runTestsByPath',
          'tests/integration/zzzzzzzz-progress.test.cjs',
          'tests/integration/zzzzzzzzzzz-dashboard.test.cjs',
        ],
        {
          env: {
            ALUNZA_TEST_STATE: ctx.statePath,
            ALUNZA_TEST_API_URL: baseUrl,
          },
        },
      );
      console.log(redactDiagnostics(result.stdout + result.stderr));
      const sql = await cli(ctx, ['test', 'db']);
      console.log(redactDiagnostics(sql.stdout + sql.stderr));
      await report(
        'dashboard-focused',
        {
          status: 'passed',
          environment: ctx.projectId,
          integration: (result.stdout + result.stderr).match(
            /^Tests:.*$/m,
          )?.[0],
          sql: (sql.stdout + sql.stderr).match(/Files=\d+,\s*Tests=\d+/)?.[0],
        },
        'imp-05',
      );
    } catch (error) {
      let diagnostic = `${error.output ?? error.message}\n${api.output}`;
      for (const field of [
        'applicationPassword',
        'fixturePassword',
        'authAdminKey',
        'migrationUrl',
      ])
        if (state[field])
          diagnostic = diagnostic.split(state[field]).join('[redacted]');
      error.output = redactDiagnostics(diagnostic);
      throw error;
    } finally {
      await api.stop();
    }
  });
} catch (error) {
  await mkdir(join(root, '.local/evidence/imp-05-07'), { recursive: true });
  await writeFile(
    join(root, '.local/evidence/imp-05-07/focused-error.log'),
    redactDiagnostics(error.output ?? error.stack ?? error.message),
    { mode: 0o600 },
  );
  await report('dashboard-focused', { status: 'failed' }, 'imp-05');
  console.error(
    'La aceptación focal del tablero falló; revisar el diagnóstico local saneado.',
  );
  process.exitCode = 1;
}
