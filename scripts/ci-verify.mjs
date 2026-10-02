import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { root, run, doctor, redactDiagnostics } from './local.mjs';
import { summarizeUnitFailures } from './ci-unit-failures.mjs';
import {
  publicTestEnvironment,
  report,
  testContext,
} from './test-environment.mjs';

const npm = process.env.npm_execpath;
if (!npm) throw new Error('Ejecuta npm run ci:verify desde la raíz Git.');
const staticEnvironment = publicTestEnvironment({
  authUrl: testContext.authUrl,
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
    ['run', 'test:practice:performance'],
    ['run', 'test:practice:performance', '--', '--submit'],
    // Three consecutive identical profiles retain every sample and the same
    // p95 gate; a failure stops CI instead of selecting a favorable rerun.
    ['run', 'test:practice:performance', '--', '--submit'],
    ['run', 'test:practice:performance', '--', '--submit'],
    ['run', 'test:ai:integration'],
    ['run', 'test:e2e'],
    ['run', 'test:help:evaluation'],
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
      if (args.length === 1 && args[0] === 'test') {
        try {
          const tracked = await run('git', ['ls-files', '-z']);
          entry.unitFailures = summarizeUnitFailures(
            diagnostic,
            tracked.stdout.split('\0').filter(Boolean),
          );
        } catch {
          entry.unitFailures = { failedTestFiles: [] };
        }
        // Only source paths from the tracked test inventory may be public.
        // Assertions, test data and the complete log remain private.
        console.error(
          JSON.stringify({ event: 'CI_UNIT_FAILURES', ...entry.unitFailures }),
        );
      }
      try {
        const state = JSON.parse(await readFile(testContext.statePath, 'utf8'));
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
      await mkdir(join(root, '.local/evidence/imp-03-submissions'), {
        recursive: true,
      });
      await writeFile(
        join(root, '.local/evidence/imp-03-submissions/ci-error.log'),
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
    'imp-03-submissions',
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
    'imp-03-submissions',
  );
  console.error(error.message);
  process.exitCode = 1;
}
await report(
  'ci',
  {
    status: process.exitCode === 1 ? 'failed' : 'passed',
    execution:
      process.env.GITHUB_ACTIONS === 'true' ? 'github-actions' : 'local',
    embeddings: 'explicit-test-double',
    azureRemote: 'not-tested',
    academicAcceptance: 'pending',
    steps,
  },
  'imp-04',
);
