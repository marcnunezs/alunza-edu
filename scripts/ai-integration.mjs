import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { PgvectorAssayRepository, runRagAssay } from '@alunza/ai';
import { root, run, applicationUrl } from './local.mjs';
import { withTestEnvironment } from './test-environment.mjs';
import { installAiFixture, restoreAiFixture } from './ai-fixture.mjs';
import * as fixture from '../fixtures/ai/corpus.mjs';
const directory = join(root, '.local/reports/imp-00-06-08');
let summary = {
  status: 'failed',
  infrastructure: 'real-local-pgvector',
  provider: 'explicit-synthetic-double',
  azure: 'not-executed',
};
try {
  await withTestEnvironment(async ({ ctx, state }) => {
    const admin = new pg.Client({ connectionString: state.migrationUrl });
    let repository,
      installed = false,
      stopped = false;
    await admin.connect();
    const priorExtensionsUsage = (
      await admin.query(
        "SELECT has_schema_privilege('alunza_app','extensions','USAGE') AS allowed",
      )
    ).rows[0].allowed;
    const before = await admin.query(
      'SELECT (SELECT count(*) FROM app.profiles)::int AS profiles,(SELECT count(*) FROM app.organizations)::int AS organizations,(SELECT count(*) FROM app.organization_memberships)::int AS memberships',
    );
    try {
      await installAiFixture(admin, ctx);
      installed = true;
      const versions = await admin.query(
        "SELECT current_setting('server_version') AS postgres,(SELECT extversion FROM pg_extension WHERE extname='vector') AS pgvector",
      );
      const privateReport = join(root, '.local/ai-jest-private.json');
      await run(
        process.execPath,
        [
          '--experimental-vm-modules',
          join(root, 'node_modules/jest/bin/jest.js'),
          '--config',
          'tests/ai/jest.integration.cjs',
          '--runInBand',
          '--json',
          '--outputFile',
          privateReport,
        ],
        { env: { ALUNZA_TEST_STATE: ctx.statePath } },
      );
      const results = JSON.parse(await readFile(privateReport, 'utf8'));
      repository = new PgvectorAssayRepository(applicationUrl(ctx, state));
      const makeInput = () => ({
        diagnosis: 'FAILED_TEST',
        query: fixture.query,
        scope: fixture.scope,
        embeddings: fixture.embeddingDouble,
        retrieval: repository,
        generation: fixture.generationDouble,
        evidence: fixture.fixturePolicy,
      });
      await admin.end();
      await run('docker', ['stop', `supabase_db_${ctx.projectId}`]);
      stopped = true;
      const unavailable = await runRagAssay(makeInput());
      if (
        unavailable.help.status !== 'PROVIDER_UNAVAILABLE' ||
        unavailable.reason !== 'DATABASE_UNAVAILABLE'
      )
        throw new Error('Database outage classification failed');
      await run('docker', ['start', `supabase_db_${ctx.projectId}`]);
      stopped = false;
      const deadline = Date.now() + 60000;
      let recovered = false;
      while (Date.now() < deadline) {
        try {
          await repository.authorize(fixture.scope);
          recovered = true;
          break;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      }
      if (
        !recovered ||
        (await runRagAssay(makeInput())).help.status !== 'SUPPORTED'
      )
        throw new Error('Database recovery failed');
      const check = new pg.Client({ connectionString: state.migrationUrl });
      await check.connect();
      try {
        const after = await check.query(
          'SELECT (SELECT count(*) FROM app.profiles)::int AS profiles,(SELECT count(*) FROM app.organizations)::int AS organizations,(SELECT count(*) FROM app.organization_memberships)::int AS memberships',
        );
        if (JSON.stringify(before.rows) !== JSON.stringify(after.rows))
          throw new Error('Foundation fixture counts changed');
      } finally {
        await check.end();
      }
      summary = {
        ...summary,
        status: 'passed',
        versions: versions.rows[0],
        passed: results.numPassedTests,
        failed: results.numFailedTests,
        databaseOutage: 'passed',
        databaseRecovery: 'passed',
        foundationCounts: before.rows[0],
        corpusVersion: fixture.corpusVersion,
        corpusHash: createHash('sha256')
          .update(JSON.stringify(fixture.sources))
          .digest('hex'),
        documents: fixture.sources.length,
        dimensions: 3,
        semanticValidation: 'explicit-fixture-oracle-only',
      };
    } finally {
      if (stopped)
        await run('docker', ['start', `supabase_db_${ctx.projectId}`]);
      await repository?.close();
      await admin.end().catch(() => undefined);
      if (installed) {
        const cleanup = new pg.Client({ connectionString: state.migrationUrl });
        await cleanup.connect();
        try {
          await restoreAiFixture(cleanup, ctx, priorExtensionsUsage, installed);
          summary.extensionUsageRestored = true;
        } finally {
          await cleanup.end();
        }
      }
    }
  });
  console.log(
    'AI integration: real pgvector, authorization, outage and recovery passed; Azure not executed.',
  );
} catch {
  summary.status = 'failed';
  console.error('AI integration failed. No remote inference was attempted.');
  process.exitCode = 1;
} finally {
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, 'ai-integration.json'),
    JSON.stringify(
      { recordedAt: new Date().toISOString(), ...summary },
      null,
      2,
    ) + '\n',
  );
}
