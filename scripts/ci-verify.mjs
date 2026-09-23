import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { root, run, doctor, redactDiagnostics } from './local.mjs';
import { publicTestEnvironment, report } from './test-environment.mjs';

const npm = process.env.npm_execpath;
if (!npm) throw new Error('Ejecuta npm run ci:verify desde la raíz Git.');
const staticEnvironment = publicTestEnvironment({
  authUrl: 'http://127.0.0.1:16421',
  publishableKey: 'sb_publishable_static_configuration_only',
});
const steps = [];
try {
  await doctor();
  for (const args of [
    ['run', 'format:check'],
    ['run', 'lint'],
    ['run', 'typecheck'],
    ['test'],
    ['run', 'runner:prepare'],
    ['run', 'runner:doctor'],
    ['run', 'runner:probe', '--', '--adapter', 'docker'],
    ['run', 'test:academic:fixtures'],
    ['run', 'cypress:install'],
    ['run', 'test:integration'],
    ['run', 'test:ai:integration'],
    ['run', 'test:e2e'],
  ]) {
    const command = `npm ${args.join(' ')}`;
    console.log(`Verificando: ${command}`);
    const started = Date.now();
    const entry = { command, status: 'running', durationMs: 0 };
    steps.push(entry);
    try {
      const completed = await run(process.execPath, [npm, ...args], {
        env: staticEnvironment,
      });
      if (args.length === 1 && args[0] === 'test') {
        const summaries = [
          ...(completed.stdout + completed.stderr).matchAll(
            /^Tests:\s+(\d+) passed,\s+(\d+) total\s*$/gm,
          ),
        ];
        entry.passedTests = summaries.reduce(
          (total, match) => total + Number(match[1]),
          0,
        );
        entry.testGroups = summaries.length;
      }
      entry.status = 'passed';
    } catch (error) {
      entry.status = 'failed';
      let diagnostic = error.output ?? error.message;
      try {
        const state = JSON.parse(
          await readFile(
            join(root, '.local/integration-workspace/.local/runtime.json'),
            'utf8',
          ),
        );
        for (const field of [
          'fixturePassword',
          'applicationPassword',
          'authAdminKey',
          'migrationUrl',
        ]) {
          if (state[field])
            diagnostic = diagnostic.split(state[field]).join('[redacted]');
        }
      } catch {
        /* State may not exist before infrastructure starts. */
      }
      await mkdir(join(root, '.local/evidence/imp-00-06-08'), {
        recursive: true,
      });
      await writeFile(
        join(root, '.local/evidence/imp-00-06-08/ci-error.log'),
        redactDiagnostics(diagnostic),
        { mode: 0o600 },
      );
      throw new Error(
        'Una comprobación falló; consultar el diagnóstico local saneado.',
        { cause: error },
      );
    } finally {
      entry.durationMs = Date.now() - started;
    }
    console.log(`Aprobado: ${command}`);
  }
  await report(
    'ci',
    {
      status: 'passed',
      execution:
        process.env.GITHUB_ACTIONS === 'true' ? 'github-actions' : 'local',
      steps,
    },
    'imp-00-06-08',
  );
} catch (error) {
  await report(
    'ci',
    {
      status: 'failed',
      execution:
        process.env.GITHUB_ACTIONS === 'true' ? 'github-actions' : 'local',
      steps,
    },
    'imp-00-06-08',
  );
  console.error(error.message);
  process.exitCode = 1;
}
