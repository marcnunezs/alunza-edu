import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { root, run, cli, redactDiagnostics } from './local.mjs';
import {
  withTestEnvironment,
  testApi,
  buildApi,
  report,
} from './test-environment.mjs';
import { seedAcademic } from './academic-fixture.mjs';
import { verifyHelpRecovery } from './help-recovery.mjs';

// Focused diagnostics use the same exclusive TEST owner, real services and
// migrations. This report never substitutes for the complete regression suite.
const recoveryOnly = process.argv.includes('--recovery-only');
try {
  await withTestEnvironment(async ({ ctx, state }) => {
    const api = testApi(ctx, state);
    try {
      await seedAcademic(state);
      await buildApi();
      await api.start(`${ctx.apiUrl}/health/ready`);
      const http = await run(
        process.execPath,
        [
          '--experimental-vm-modules',
          join(root, 'node_modules/jest/bin/jest.js'),
          '--config',
          'tests/jest.integration.cjs',
          '--runInBand',
          '--runTestsByPath',
          'tests/integration/zzzzzzz-help.test.cjs',
          ...(recoveryOnly
            ? ['--testNamePattern', '^explanation uses a confirmed own attempt']
            : []),
        ],
        {
          env: {
            ALUNZA_TEST_STATE: ctx.statePath,
            ALUNZA_TEST_API_URL: ctx.apiUrl,
          },
        },
      );
      console.log(redactDiagnostics(http.stdout + http.stderr));
      await report(
        'help-recovery',
        await verifyHelpRecovery({ ctx, state, api }),
        'imp-04',
      );
      const sql = await cli(ctx, ['test', 'db']);
      console.log(sql.stdout);
      if (api.output.includes('IMP04_HELP_HIDDEN_SENTINEL'))
        throw new Error('Un canario oculto apareció en logs de ayuda.');
      await report(
        recoveryOnly ? 'help-recovery-integration' : 'help-integration',
        {
          status: 'passed',
          infrastructure: 'real-local-auth-api-storage-pgvector',
          providers: 'explicit-test-doubles',
          azureRemote: 'not-tested',
        },
        'imp-04',
      );
    } catch (error) {
      let diagnostic = `${error.output ?? error.message}\n${api.output}`;
      for (const value of [
        state.applicationPassword,
        state.fixturePassword,
        state.authAdminKey,
        state.migrationUrl,
      ])
        if (value) diagnostic = diagnostic.split(value).join('[redacted]');
      await mkdir(join(root, '.local/evidence/imp-04'), { recursive: true });
      await writeFile(
        join(root, '.local/evidence/imp-04/help-integration-error.log'),
        redactDiagnostics(diagnostic),
        { mode: 0o600 },
      );
      // eslint-disable-next-line preserve-caught-error -- Diagnostic causes may contain private SQL or Auth data; only the sanitized file is retained.
      throw new Error(
        'La integración focal de ayuda falló; consultar el diagnóstico local saneado.',
      );
    } finally {
      await api.stop();
    }
  });
} catch (error) {
  if (error.output) {
    await mkdir(join(root, '.local/evidence/imp-04'), { recursive: true });
    await writeFile(
      join(root, '.local/evidence/imp-04/help-infrastructure-error.log'),
      redactDiagnostics(error.output),
      { mode: 0o600 },
    );
  }
  await report(
    recoveryOnly ? 'help-recovery-integration' : 'help-integration',
    { status: 'failed', azureRemote: 'not-tested' },
    'imp-04',
  );
  console.error(error.message);
  process.exitCode = 1;
}
