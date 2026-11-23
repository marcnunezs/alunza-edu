import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { withTestEnvironment } from './test-environment.mjs';
import { cli, root, redactDiagnostics } from './local.mjs';
import { readCoverageCandidate } from './quality-coverage.mjs';
import {
  prepareSandboxLegacyUpgrade,
  runSandboxLifecycleConcurrency,
} from '../tests/integration/sandbox-lifecycle-sql.mjs';

const upgrade = process.argv.includes('--upgrade');
if (process.argv.slice(2).some((value) => value !== '--upgrade'))
  throw new Error('Unsupported argument');
const directory = join(root, '.local/reports/imp-03-07');
const candidate = await readCoverageCandidate();
const report = {
  schemaVersion: 1,
  candidate,
  environment: 'LAB TEST',
  remote: 'NOT_RUN',
  status: 'FAILED',
  recordedAt: new Date().toISOString(),
};
await mkdir(directory, { recursive: true });
try {
  if (upgrade) {
    await withTestEnvironment(
      async ({ upgrade: evidence }) => {
        report.upgrade = evidence;
      },
      [],
      {
        upgradeFromVersion: '20261103005407',
        beforeUpgrade: prepareSandboxLegacyUpgrade,
      },
    );
  } else {
    await withTestEnvironment(async ({ ctx, state }) => {
      const checked = await cli(ctx, [
        'test',
        'db',
        ...[
          '006_practice_runs',
          '007_practice_submissions',
          '023_practice_sandbox',
        ].map((name) => resolve(root, `supabase/tests/${name}.test.sql`)),
        '--local',
      ]);
      report.sql = redactDiagnostics(checked.stdout + checked.stderr);
      report.concurrency = await runSandboxLifecycleConcurrency({ ctx, state });
    });
  }
  report.status = 'PASSED';
} catch (error) {
  report.error = redactDiagnostics(error.output ?? error.message);
  process.exitCode = 1;
} finally {
  await writeFile(
    join(directory, upgrade ? 'upgrade.json' : 'database.json'),
    JSON.stringify(report, null, 2) + '\n',
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      status: report.status,
      environment: report.environment,
      remote: report.remote,
      report: upgrade ? 'upgrade.json' : 'database.json',
    }),
  );
}
