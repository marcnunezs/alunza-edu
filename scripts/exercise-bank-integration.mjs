import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { root, run, cli, redactDiagnostics } from './local.mjs';
import {
  withTestEnvironment,
  testApi,
  buildApi,
  report,
} from './test-environment.mjs';

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
          'tests/integration/zzzzzzzzzzzzz-exercise-bank.test.cjs',
          'tests/integration/zzzzzzzzzzzzzz-exercise-bank-governance.test.cjs',
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
        'bank-integration',
        {
          status: 'passed',
          environment: ctx.projectId,
          integration: (result.stdout + result.stderr).match(
            /^Tests:.*$/m,
          )?.[0],
          sql: (sql.stdout + sql.stderr).match(/Files=\d+,\s*Tests=\d+/)?.[0],
        },
        'imp-06',
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
  const directory = join(root, '.local/evidence/imp-06');
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, 'bank-integration-error.log'),
    redactDiagnostics(error.output ?? error.stack ?? error.message),
    { mode: 0o600 },
  );
  await report('bank-integration', { status: 'failed' }, 'imp-06');
  console.error(
    'La integración del banco falló; revisar .local/evidence/imp-06/bank-integration-error.log.',
  );
  process.exitCode = 1;
}
