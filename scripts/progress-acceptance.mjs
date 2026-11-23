import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { root, run, cli, redactDiagnostics } from './local.mjs';
import {
  withTestEnvironment,
  testApi,
  buildApi,
  report,
} from './test-environment.mjs';
import { runProgressSqlDiagnostics } from './progress-sql-diagnostics.mjs';

// Reusable only inside the caller's exclusive TEST reservation. The direct
// entrypoint reserves TEST itself; neither mode touches development or remote DB.
export async function runProgressAcceptance({ ctx, state }) {
  await buildApi();
  const api = testApi(ctx, state, ctx.webPort, {
    SIGNALS_WORKER_ENABLED: 'false',
  });
  const baseUrl = `http://127.0.0.1:${ctx.apiPort}`;
  try {
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
        'tests/integration/zzzzzzzzzzzz-progress-phase.test.cjs',
      ],
      {
        env: { ALUNZA_TEST_STATE: ctx.statePath, ALUNZA_TEST_API_URL: baseUrl },
      },
    );
    console.log(redactDiagnostics(result.stdout + result.stderr));
    const sql = await cli(ctx, ['test', 'db']);
    console.log(redactDiagnostics(sql.stdout + sql.stderr));
    const diagnostics = await runProgressSqlDiagnostics({ ctx });
    const summary = {
      status: 'passed',
      environment: ctx.projectId,
      integration: (result.stdout + result.stderr).match(/^Tests:.*$/m)?.[0],
      sql: (sql.stdout + sql.stderr).match(/Files=\d+,\s*Tests=\d+/)?.[0],
      sqlDiagnosticIterations: diagnostics.iterations,
      remoteProvidersUsed: false,
    };
    await report('progress-acceptance', summary, 'imp-05');
    return summary;
  } catch (error) {
    let diagnostic = `${error.output ?? error.stack ?? error.message}\n${api.output}`;
    for (const field of [
      'applicationPassword',
      'fixturePassword',
      'authAdminKey',
      'migrationUrl',
    ])
      if (state[field])
        diagnostic = diagnostic.split(state[field]).join('[redacted]');
    const directory = join(root, '.local/evidence/imp-05-08');
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, 'acceptance-error.log'),
      redactDiagnostics(diagnostic),
      { mode: 0o600 },
    );
    await report(
      'progress-acceptance',
      { status: 'failed', environment: ctx.projectId },
      'imp-05',
    );
    throw new Error('PROGRESS_ACCEPTANCE_FAILED', { cause: error });
  } finally {
    await api.stop();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    await withTestEnvironment(runProgressAcceptance);
  } catch {
    console.error(
      'La aceptación transversal falló; revisar el informe local saneado.',
    );
    process.exitCode = 1;
  }
}
