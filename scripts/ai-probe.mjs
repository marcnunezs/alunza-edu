import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import {
  AzureAiAdapter,
  azureConfigurationFromEnv,
  SCHEMA_VERSION,
  PROMPT_VERSION,
  runProviderProbe,
  PgvectorAssayRepository,
} from '@alunza/ai';
import {
  loadManifest,
  assertRemoteAuthorization,
  requestBudget,
} from './preprod-manifest.mjs';
import {
  sources,
  query,
  corpusVersion,
  scope,
} from '../fixtures/ai/corpus.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const reportPath = join(root, '.local/reports/imp-00-06-08/ai-probe.json');
let configured = false;
let report = {
  status: 'blocked',
  provider: 'azure',
  remoteCalls: 0,
  semanticReview: 'pending',
};
try {
  const args = process.argv.slice(2),
    values = { mode: 'rag-local' };
  let doctor = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--doctor') {
      doctor = true;
      continue;
    }
    if (
      !['--manifest', '--provider', '--mode'].includes(arg) ||
      !args[index + 1] ||
      args[index + 1].startsWith('--')
    )
      throw new Error('Invalid arguments');
    values[arg.slice(2)] = args[++index];
  }
  if (!['connectivity', 'rag-local'].includes(values.mode))
    throw new Error('Invalid mode');
  report.mode = values.mode;
  report.retrieval =
    values.mode === 'connectivity'
      ? 'not-executed-connectivity-only'
      : 'not-executed';
  const manifest = await loadManifest(
    values.manifest
      ? resolve(values.manifest)
      : join(root, 'infra/preproduction/manifest.example.json'),
  );
  assertRemoteAuthorization(manifest, 'probe:ai');
  if (manifest.budget.maxAiRequests < 2)
    throw new Error('Fixed probe requires budget for two requests');
  if (!doctor && (values.provider !== 'azure' || !values.manifest))
    throw new Error('Explicit Azure provider and manifest required');
  const target = manifest.targets.azureOpenAi;
  const config = azureConfigurationFromEnv({
    ...process.env,
    AI_AZURE_BASE_URL: `${target.endpoint}/openai/v1/`,
    AI_EMBEDDING_DEPLOYMENT: target.embeddingDeployment,
    AI_GENERATION_DEPLOYMENT: target.generationDeployment,
    AI_EMBEDDING_DIMENSIONS: String(target.embeddingDimensions),
  });
  const maxCosineDistance = Number(process.env.AI_MAX_COSINE_DISTANCE);
  if (
    values.mode === 'rag-local' &&
    (!process.env.AI_MAX_COSINE_DISTANCE ||
      !Number.isFinite(maxCosineDistance) ||
      maxCosineDistance < 0 ||
      maxCosineDistance > 2 ||
      config.configurationId === 'synthetic-3d-v1')
  )
    throw new Error(
      'Explicit provisional relevance threshold and separate configuration required',
    );
  configured = true;
  if (doctor) {
    report.status = 'configuration-valid-remote-not-tested';
    console.log('AI doctor: authorized configuration valid; no remote calls.');
  } else {
    const budget = requestBudget(manifest, 'probe:ai');
    let calls = 0;
    const transport = async (url, options) => {
      assertRemoteAuthorization(manifest, 'probe:ai');
      if (++calls > Math.min(2, manifest.budget.maxAiRequests))
        throw new Error('AI request budget exhausted');
      report.remoteCalls = calls;
      const timeoutMs = budget.consume(),
        parsed = new URL(String(url));
      if (
        parsed.origin !== target.endpoint ||
        !['/openai/v1/embeddings', '/openai/v1/chat/completions'].includes(
          parsed.pathname,
        )
      )
        throw new Error('Unexpected inference destination');
      return fetch(url, {
        ...options,
        redirect: 'error',
        signal: AbortSignal.any([
          options.signal,
          AbortSignal.timeout(timeoutMs),
        ]),
      });
    };
    const adapter = new AzureAiAdapter(
      config,
      transport,
      Math.min(512, manifest.budget.maxAiTokens),
    );
    const chunks = sources.flatMap((source) =>
      source.chunks.map((chunk) => ({
        source_id: source.id,
        source_version_id: source.sourceVersionId,
        chunk_id: chunk.id,
        locator: chunk.locator,
        text: chunk.text,
      })),
    );
    const makeInput = () => ({
      mode: values.mode,
      embeddings: adapter,
      generation: adapter,
      chunks,
      query,
      signal: AbortSignal.timeout(
        Math.min(15000, manifest.budget.maxDurationSeconds * 1000),
      ),
    });
    let result;
    const started = performance.now();
    if (values.mode === 'connectivity')
      result = await runProviderProbe(makeInput());
    else {
      // Lazy imports keep the ACA connectivity job independent of local Docker,
      // Supabase CLI, administrative credentials and loopback database services.
      const [
        { withTestEnvironment },
        { installAiFixture, restoreAiFixture },
        { applicationUrl },
        { default: pg },
      ] = await Promise.all([
        import('./test-environment.mjs'),
        import('./ai-fixture.mjs'),
        import('./local.mjs'),
        import('pg'),
      ]);
      await withTestEnvironment(async ({ ctx, state }) => {
        const admin = new pg.Client({ connectionString: state.migrationUrl });
        await admin.connect();
        const priorUsage = (
          await admin.query(
            "SELECT has_schema_privilege('alunza_app','extensions','USAGE') AS allowed",
          )
        ).rows[0].allowed;
        const repository = new PgvectorAssayRepository(
          applicationUrl(ctx, state),
        );
        let installed = false;
        try {
          result = await runProviderProbe({
            ...makeInput(),
            local: {
              scope,
              repository,
              maxCosineDistance,
              publish: async (vectors) => {
                await installAiFixture(admin, ctx, {
                  configuration: adapter.configuration,
                  vectors,
                });
                installed = true;
              },
            },
          });
          report.retrieval = 'real-local-pgvector-with-azure-embeddings';
          report.relevanceThreshold = {
            maxCosineDistance,
            status: 'provisional-not-pedagogically-validated',
          };
        } finally {
          await repository.close();
          try {
            await restoreAiFixture(admin, ctx, priorUsage, installed);
          } finally {
            await admin.end();
          }
        }
      });
    }
    report = {
      ...report,
      status: 'transport-contract-scope-passed',
      configurationId: config.configurationId,
      corpusVersion,
      corpusHash: createHash('sha256')
        .update(JSON.stringify(sources))
        .digest('hex'),
      embeddingDimensions: result.dimension,
      ragStatus: result.help.status,
      retrievedCount: result.retrievedCount,
      referenceCount: result.help.source_refs.length,
      promptVersion: PROMPT_VERSION,
      schemaVersion: SCHEMA_VERSION,
      durationMs: Math.round(performance.now() - started),
      usage: adapter.usage.map(
        ({ operation, inputTokens, outputTokens, model }) => ({
          operation,
          inputTokens,
          outputTokens,
          model,
        }),
      ),
      cost: 'not-measured',
    };
    console.log('Azure probe completed; semantic acceptance remains pending.');
  }
} catch {
  report.status = configured
    ? 'failed'
    : 'pending-configuration-or-authorization';
  process.exitCode = configured ? 1 : 2;
  console.error(
    configured
      ? 'AI probe failed. No provider payload is printed.'
      : 'AI probe pending authorized configuration; no remote calls.',
  );
} finally {
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(
    reportPath,
    JSON.stringify(
      { recordedAt: new Date().toISOString(), ...report },
      null,
      2,
    ) + '\n',
  );
}
