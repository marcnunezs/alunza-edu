import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { root, run, cli, redactDiagnostics } from './local.mjs';
import { prepareSignalUpgrade } from './signals-upgrade.mjs';
import {
  withTestEnvironment,
  testApi,
  buildApi,
  report,
} from './test-environment.mjs';

// Focused acceptance uses the same exclusive TEST lock and fixed laboratory
// target as CI. The full CI already discovers these tests; this command is for
// implementation diagnostics, without a second complete pipeline.
try {
  await withTestEnvironment(
    async ({ ctx, state, upgrade }) => {
      if (upgrade) await report('signals-upgrade', upgrade, 'imp-05');
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
            'tests/integration/zzzzzzzzzz-signals.test.cjs',
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
          'signals-focused',
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
    },
    [],
    {
      upgradeFromVersion: '20261005233736',
      beforeUpgrade: prepareSignalUpgrade,
    },
  );
} catch (error) {
  await mkdir(join(root, '.local/evidence/imp-05-05'), { recursive: true });
  await writeFile(
    join(root, '.local/evidence/imp-05-05/focused-error.log'),
    redactDiagnostics(error.output ?? error.stack ?? error.message),
    { mode: 0o600 },
  );
  await report('signals-focused', { status: 'failed' }, 'imp-05');
  console.error(
    'La aceptación focal de señales falló; revisar el diagnóstico local saneado.',
  );
  process.exitCode = 1;
}
