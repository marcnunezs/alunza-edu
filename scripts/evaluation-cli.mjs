import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { evaluationManifestSchema } from '@alunza/contracts';
import {
  root,
  readState,
  assertLocalDatabase,
  redactDiagnostics,
} from './local.mjs';
import { testContext } from './test-environment.mjs';
import { evaluationContext } from './evaluation-environment.mjs';
import {
  evaluationPlanSchema,
  assertEvaluationReady,
  planEvaluation,
} from './evaluation-manifest.mjs';
import {
  EvaluationClient,
  EvaluationSessions,
  EvaluationError,
  privateJson,
  sha256,
} from './evaluation-client.mjs';
import { prepareEvaluation } from './evaluation-prepare.mjs';
import { runEvaluation, evaluationReport } from './evaluation-run.mjs';

export async function authorizeEvaluation({
  plan,
  prepared,
  state,
  directory,
}) {
  const { manifest } = await assertEvaluationReady(plan, prepared);
  const ctx = plan.environment === 'TEST' ? testContext : evaluationContext;
  if (state.projectId !== ctx.projectId)
    throw new EvaluationError('MAINTENANCE_DESTINATION_MISMATCH');
  assertLocalDatabase(state.migrationUrl, ctx.dbPort);
  let credential;
  try {
    credential = JSON.parse(
      await readFile(join(directory, 'capability.json'), 'utf8'),
    );
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (!credential) {
    credential = {
      runId: manifest.runId,
      capability: randomBytes(32).toString('base64url'),
    };
    // Save before admission: a lost database response retries the same capability.
    await privateJson(join(directory, 'capability.json'), credential);
  }
  if (credential.runId !== manifest.runId)
    throw new EvaluationError('CAPABILITY_RUN_MISMATCH');
  const db = new pg.Client({
    connectionString: state.migrationUrl,
    connectionTimeoutMillis: 3000,
    statement_timeout: 10000,
  });
  await db.connect();
  try {
    const result = await db.query(
      'SELECT app_private.evaluation_authorize($1::jsonb,$2) AS run',
      [JSON.stringify(manifest), sha256(credential.capability)],
    );
    await privateJson(join(directory, 'authorized-manifest.json'), manifest);
    return {
      runId: manifest.runId,
      authorization: 'durable',
      reference: plan.authorization.reference,
      databaseResult:
        typeof result.rows[0].run === 'string'
          ? result.rows[0].run
          : 'confirmed',
      providerCalls: 0,
    };
  } finally {
    await db.end();
  }
}
export async function evaluationMain(args) {
  const options = {
    mode: 'plan',
    manifest: join(root, 'infra/preproduction/help-evaluation.example.json'),
  };
  for (let i = 0; i < args.length; i++) {
    if (
      !['--mode', '--manifest', '--directory', '--stage', '--run-id'].includes(
        args[i],
      ) ||
      !args[i + 1] ||
      args[i + 1].startsWith('--')
    )
      throw new EvaluationError('INVALID_ARGUMENTS');
    options[args[i].slice(2)] = args[++i];
  }
  if (
    ![
      'prepare',
      'plan',
      'check',
      'authorize',
      'run',
      'resume',
      'status',
      'stop',
      'report',
    ].includes(options.mode)
  )
    throw new EvaluationError('INVALID_MODE');
  const plan = evaluationPlanSchema.parse(
    JSON.parse(await readFile(resolve(options.manifest), 'utf8')),
  );
  if (options.mode === 'plan') return planEvaluation(plan);
  let runId = options['run-id'];
  if (!runId && options.directory) {
    try {
      const saved = JSON.parse(
        await readFile(
          join(resolve(options.directory), 'prepare-journal.json'),
          'utf8',
        ),
      );
      runId = saved.runId;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  runId ??= randomUUID();
  const directory = resolve(
    options.directory ?? join(root, '.local/eval-runs', runId),
  );
  if (options.mode === 'prepare') {
    const state = await readState(
      plan.environment === 'TEST' ? testContext : evaluationContext,
    );
    const prepared = await prepareEvaluation({ plan, state, directory, runId });
    return {
      runId: prepared.runId,
      status: 'prepared',
      materials: prepared.materials.length,
      attempts: prepared.cases.length,
      providerCalls: 0,
    };
  }
  const prepared = JSON.parse(
    await readFile(join(directory, 'prepared.json'), 'utf8'),
  );
  if (options.mode === 'check') {
    await assertEvaluationReady(plan, prepared);
    return {
      ...planEvaluation(plan),
      status: 'checked-local-no-provider-calls',
      runId: prepared.runId,
    };
  }
  if (options.mode === 'authorize')
    return authorizeEvaluation({
      plan,
      prepared,
      directory,
      state: await readState(
        plan.environment === 'TEST' ? testContext : evaluationContext,
      ),
    });
  if (['status', 'stop', 'report'].includes(options.mode)) {
    const credential = JSON.parse(
      await readFile(join(directory, 'capability.json'), 'utf8'),
    );
    const authorized = evaluationManifestSchema.parse(
      JSON.parse(
        await readFile(join(directory, 'authorized-manifest.json'), 'utf8'),
      ),
    );
    if (
      credential.runId !== prepared.runId ||
      authorized.runId !== prepared.runId ||
      authorized.corpusHash !== prepared.corpusHash ||
      authorized.environmentHash !== sha256(JSON.stringify(plan.destination))
    )
      throw new EvaluationError('CAPABILITY_RUN_MISMATCH');
    const client = new EvaluationClient({
      ...plan.destination,
      runId: prepared.runId,
      capability: credential.capability,
      sessions: await EvaluationSessions.load(join(directory, 'sessions.json')),
    });
    if (options.mode === 'status') return client.operations();
    if (options.mode === 'stop') return client.operations('/stop', {});
    return evaluationReport({
      plan: {
        ...plan,
        provider: authorized.provider,
        candidateFingerprint: authorized.releaseSha,
        profiles: authorized.profiles,
      },
      prepared: { ...prepared, corpusHash: authorized.corpusHash },
      directory,
      client,
    });
  }
  const { manifest } = await assertEvaluationReady(plan, prepared);
  const authorized = JSON.parse(
    await readFile(join(directory, 'authorized-manifest.json'), 'utf8'),
  );
  if (JSON.stringify(manifest) !== JSON.stringify(authorized))
    throw new EvaluationError('AUTHORIZED_MANIFEST_CHANGED');
  if (['run', 'resume'].includes(options.mode)) {
    const stages = options.stage ? [options.stage.toUpperCase()] : undefined;
    if (
      stages?.some(
        (stage) =>
          !['INGESTION', 'CALIBRATION', 'FUNCTIONAL', 'EVALUATION'].includes(
            stage,
          ),
      )
    )
      throw new EvaluationError('INVALID_STAGE');
    const report = await runEvaluation({ plan, prepared, directory, stages });
    return {
      runId: prepared.runId,
      stages: report.stages,
      profiles: report.profiles,
      azureEvidence: report.azureEvidence,
    };
  }
  throw new EvaluationError('INVALID_MODE');
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    console.log(
      JSON.stringify(await evaluationMain(process.argv.slice(2)), null, 2),
    );
  } catch (error) {
    console.error(
      error instanceof EvaluationError
        ? error.code
        : redactDiagnostics('EVALUATION_FAILED'),
    );
    process.exitCode = 1;
  }
}
