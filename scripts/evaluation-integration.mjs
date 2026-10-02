import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import pg from 'pg';
import { root, apiEnvironment, redactDiagnostics, run } from './local.mjs';
import {
  withTestEnvironment,
  buildApi,
  nodeService,
  report,
} from './test-environment.mjs';
import { seedAcademic } from './academic-fixture.mjs';
import { privateJson } from './evaluation-client.mjs';
import { candidateFingerprint } from './evaluation-manifest.mjs';
import { prepareEvaluation } from './evaluation-prepare.mjs';
import { authorizeEvaluation } from './evaluation-cli.mjs';
import { runEvaluation } from './evaluation-run.mjs';
import { verifyEvaluationLedger } from './evaluation-ledger-checks.mjs';
import { hostSnapshot, startupPhaseTimings } from './lab-observability.mjs';
import { assertEvaluationCompleteness } from './evaluation-completeness.mjs';

const require = createRequire(import.meta.url);
const runId = randomUUID();
const directory = join(root, '.local/eval-runs', runId);
let phase = 'prepare',
  api,
  diagnostics = '';
let privateValues = [];
const startupServices = [];
const hostObservations = [{ phase, ...hostSnapshot() }];
function startupHistory() {
  return startupServices.flatMap(({ phase: startupPhase, service }) =>
    service.startupMeasurements.map((measurement) => ({
      phase: startupPhase,
      ...measurement,
      phases: startupPhaseTimings(service.output),
    })),
  );
}
async function preservePublicMeasurements() {
  let value;
  try {
    value = JSON.parse(await readFile(join(directory, 'report.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  if (value.runId !== runId || value.provider !== 'TEST')
    throw new Error('EVALUATION_REPORT_IDENTITY_MISMATCH');
  const serialized = JSON.stringify(value);
  if (
    [...privateValues, 'EVAL_HIDDEN_CANARY'].some((canary) =>
      serialized.includes(canary),
    )
  )
    throw new Error('PRIVATE_DATA_IN_REPORT');
  // This projection excludes review snapshots, sessions and private checkpoints.
  // Keep all timing samples and receipt metadata in CI, including failed runs.
  await report('evaluation-measurements', value, 'imp-04');
}
async function preserveEvidence(state) {
  const db = new pg.Client({ connectionString: state.migrationUrl });
  await db.connect();
  try {
    const tables = {
      evaluation_runs: 't.id=$1',
      evaluation_stages: 't.run_id=$1',
      evaluation_bindings: 't.run_id=$1',
      evaluation_owners: 't.run_id=$1',
      ai_call_receipts: 't.run_id=$1',
      evaluation_calibrations:
        'exists(select 1 from app_private.evaluation_bindings b where b.id=t.id and b.run_id=$1)',
    };
    const snapshot = {};
    for (const [table, predicate] of Object.entries(tables)) {
      const exists = await db.query('SELECT to_regclass($1) present', [
        `app_private.${table}`,
      ]);
      if (exists.rows[0].present)
        snapshot[table] = (
          await db.query(
            `SELECT to_jsonb(t)-'capability_hash'-'dispatch_token'-'lease_token' AS record FROM app_private.${table} t WHERE ${predicate}`,
            [runId],
          )
        ).rows.map((row) => row.record);
    }
    await privateJson(join(directory, 'private-evidence.json'), snapshot);
  } finally {
    await db.end();
  }
}
try {
  await withTestEnvironment(
    async ({ ctx, state }) => {
      privateValues = [
        state.applicationPassword,
        state.fixturePassword,
        state.authAdminKey,
        state.migrationUrl,
      ].filter(Boolean);
      try {
        await seedAcademic(state);
        await buildApi();
        phase = 'deterministic-operational-case';
        const localEvidencePath = join(
          directory,
          'operational-local-tests.json',
        );
        await mkdir(directory, { recursive: true });
        await run(process.execPath, [
          '--experimental-vm-modules',
          join(root, 'node_modules/jest/bin/jest.js'),
          '--config',
          'apps/api/jest.config.cjs',
          '--runInBand',
          '--testPathPatterns',
          'help.worker.spec.ts',
          '--testNamePattern',
          'operational UNKNOWN explains deterministically without configuration or providers',
          '--json',
          '--outputFile',
          localEvidencePath,
        ]);
        const localEvidenceRaw = await readFile(localEvidencePath, 'utf8');
        if (
          [...privateValues, 'EVAL_HIDDEN_CANARY'].some((value) =>
            localEvidenceRaw.includes(value),
          )
        )
          throw new Error('PRIVATE_DATA_IN_LOCAL_EVIDENCE');
        const publicEvidencePath = `.local/reports/imp-04/history/evaluation-operational-${runId}.json`;
        await mkdir(join(root, '.local/reports/imp-04/history'), {
          recursive: true,
        });
        // Keep the exact passing Jest bytes so the published hash is verifiable.
        await writeFile(join(root, publicEvidencePath), localEvidenceRaw, {
          flag: 'wx',
          mode: 0o600,
        });
        const localEvidence = {
          raw: localEvidenceRaw,
          sha256: createHash('sha256').update(localEvidenceRaw).digest('hex'),
          path: publicEvidencePath,
        };
        phase = 'durable-ledger';
        await report(
          'evaluation-ledger',
          await verifyEvaluationLedger({ ctx, state }),
          'imp-04',
        );
        const controlsPath = join(directory, 'controls.json');
        await privateJson(controlsPath, { attempts: {} });
        const environment = {
          ...apiEnvironment(ctx, state),
          EVALUATION_ENABLED: 'true',
          EVALUATION_OPERATIONS_PORT: '4401',
          ALUNZA_EVALUATION_CONTROLS: controlsPath,
        };
        const createApi = (extra = {}) => {
          const service = nodeService(
            [join(root, 'tests/evaluation-api.cjs')],
            {
              ...environment,
              ...extra,
            },
          );
          startupServices.push({ phase, service });
          hostObservations.push({ phase, ...hostSnapshot() });
          return service;
        };
        phase = 'initial-api-start';
        api = createApi();
        await api.start(`${ctx.apiUrl}/health/ready`);
        const { loadConfig } = require('../apps/api/dist/config.js');
        const {
          evaluationProviderProfile,
        } = require('../apps/api/dist/evaluation-profiles.js');
        const config = loadConfig(environment);
        const plan = JSON.parse(
          await readFile(
            join(root, 'infra/preproduction/help-evaluation.example.json'),
            'utf8',
          ),
        );
        Object.assign(plan, {
          environment: 'TEST',
          provider: 'TEST',
          candidateFingerprint: await candidateFingerprint(),
          destination: {
            apiOrigin: ctx.apiUrl,
            authOrigin: ctx.authUrl,
            operationsOrigin: 'http://127.0.0.1:4401',
            projectId: ctx.projectId,
          },
          authorization: {
            approvedBy: 'Automated TEST fixture',
            reference: 'IMP-04.07-authorized-local-tests-no-Azure',
            expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
          },
          priceVersion: 'SYNTHETIC-TEST-ONLY-NOT-AZURE-PRICES-v1',
          profiles: Object.fromEntries(
            ['EMBEDDING', 'GENERATION', 'REVIEW'].map((phase) => [
              phase,
              {
                ...evaluationProviderProfile(
                  config,
                  phase,
                  phase === 'EMBEDDING'
                    ? {
                        id: 'materials-fixture-3d-v1',
                        model: 'test-fixture-only',
                        dimensions: 3,
                      }
                    : { id: 'help-fixture-v1', model: 'test-fixture-only' },
                ),
                inputMicroUsdPerMillion: '1000000',
                outputMicroUsdPerMillion: '1000000',
              },
            ]),
          ),
          budgets: {
            INGESTION: {
              maxCalls: 200,
              maxInputTokens: 100000,
              maxOutputTokens: 0,
              maxCostMicroUsd: '100000',
            },
            CALIBRATION: {
              maxCalls: 4,
              maxInputTokens: 2000,
              maxOutputTokens: 0,
              maxCostMicroUsd: '2000',
            },
            FUNCTIONAL: {
              maxCalls: 12,
              maxInputTokens: 66000,
              maxOutputTokens: 10240,
              maxCostMicroUsd: '76240',
            },
            EVALUATION: {
              maxCalls: 1000,
              maxInputTokens: 5000000,
              maxOutputTokens: 1000000,
              maxCostMicroUsd: '6000000',
            },
            global: {
              maxCalls: 1216,
              maxInputTokens: 5168000,
              maxOutputTokens: 1010240,
              maxCostMicroUsd: '6178240',
            },
          },
        });
        await privateJson(join(directory, 'plan.json'), plan);
        phase = 'prepare-product-attempts';
        console.log(
          'EVAL TEST: preparando intentos confirmados mediante producto.',
        );
        const prepared = await prepareEvaluation({
          plan,
          state,
          directory,
          runId,
        });
        const controls = {
          attempts: Object.fromEntries(
            prepared.cases.flatMap((entry) => {
              if (entry.binding.reviewCase)
                return [
                  [
                    entry.binding.attemptId,
                    {
                      review: entry.binding.reviewCase.expected,
                      reason:
                        entry.oracle.expected.reason ?? 'UNSUPPORTED_CLAIM',
                    },
                  ],
                ];
              if (entry.oracle?.caseId === 'contradictory-material')
                return [[entry.binding.attemptId, { scenario: 'ambiguous' }]];
              if (entry.oracle?.caseId === 'near-irrelevant')
                return [[entry.binding.attemptId, { scenario: 'ambiguous' }]];
              return [];
            }),
          ),
        };
        await privateJson(controlsPath, controls);
        phase = 'authorize';
        await authorizeEvaluation({ plan, prepared, state, directory });
        phase = 'ingestion';
        await runEvaluation({
          plan,
          prepared,
          directory,
          stages: ['INGESTION'],
        });
        diagnostics += api.output;
        await api.stop();
        phase = 'restart-after-ingestion';
        api = createApi();
        await api.start(`${ctx.apiUrl}/health/ready`);
        phase = 'calibration';
        let calibratedEnvironment;
        await runEvaluation({
          plan,
          prepared,
          directory,
          stages: ['CALIBRATION'],
          activateCalibration: async (artifact) => {
            calibratedEnvironment = {
              HELP_CALIBRATION_JSON: JSON.stringify(artifact),
              HELP_CALIBRATION_CORPUS_SHA256: prepared.corpusHash,
            };
            diagnostics += api.output;
            await api.stop();
            phase = 'activate-calibration-restart';
            api = createApi(calibratedEnvironment);
            await api.start(`${ctx.apiUrl}/health/ready`);
          },
        });
        phase = 'functional';
        await runEvaluation({
          plan,
          prepared,
          directory,
          stages: ['FUNCTIONAL'],
        });
        diagnostics += api.output;
        await api.stop();
        phase = 'restart-after-functional';
        api = createApi(calibratedEnvironment);
        await api.start(`${ctx.apiUrl}/health/ready`);
        phase = 'evaluation';
        console.log(
          'EVAL TEST: evaluación y 100+100 ayudas, con cuotas de producto vigentes.',
        );
        const result = await runEvaluation({
          plan,
          prepared,
          directory,
          stages: ['EVALUATION'],
        });
        phase = 'resume-completed';
        const again = await runEvaluation({ plan, prepared, directory });
        if (
          again.receipts.length !== result.receipts.length ||
          again.samples.length !== result.samples.length
        )
          throw new Error('RESUME_DUPLICATED_WORK');
        if (
          result.profiles.some(
            (profile) => profile.count !== 100 || profile.success !== 100,
          )
        )
          throw new Error('EVALUATION_INCOMPLETE');
        const coverage = assertEvaluationCompleteness(result, localEvidence);
        if (coverage.status !== 'COMPLETE')
          throw new Error('ADVERSARIAL_COVERAGE_INCOMPLETE');
        diagnostics += api.output;
        if (
          [
            'EVAL_HIDDEN_CANARY',
            state.authAdminKey,
            state.fixturePassword,
            state.applicationPassword,
          ].some((canary) => diagnostics.includes(canary))
        )
          throw new Error('PRIVATE_DATA_IN_LOG');
        await report(
          'evaluation-test',
          {
            status: 'passed',
            runId,
            provider: 'TEST',
            externalCalls: 0,
            resumptions: 3,
            profiles: result.profiles,
            receipts: result.receipts.length,
            samples: result.samples.length,
            coverage,
            azureRemote: 'pending',
            academicAcceptance: 'pending',
            startupHistory: startupHistory(),
            hostObservations: [
              ...hostObservations,
              { phase: 'completed', ...hostSnapshot() },
            ],
          },
          'imp-04',
        );
        await api.stop();
        api = undefined;
      } finally {
        diagnostics += api?.output ?? '';
        await api?.stop();
        api = undefined;
        // Preserve even a failed run before another TEST reconstruction. The
        // isolated LAB-EVAL database itself is never reset by this harness.
        await preserveEvidence(state);
        await preservePublicMeasurements();
      }
    },
    [4401],
  );
} catch (error) {
  diagnostics += api?.output ?? '';
  await api?.stop();
  await mkdir(join(root, '.local/evidence/imp-04'), { recursive: true });
  let safeDiagnostic = `${phase}\n${error.output ?? error.stack ?? error.message}\n${diagnostics}`;
  for (const value of privateValues)
    safeDiagnostic = safeDiagnostic.split(value).join('[redacted]');
  await writeFile(
    join(root, '.local/evidence/imp-04/evaluation-error.log'),
    redactDiagnostics(safeDiagnostic),
    { mode: 0o600 },
  );
  await report(
    'evaluation-test',
    {
      status: 'failed',
      runId,
      phase,
      externalCalls: 0,
      azureRemote: 'not-tested',
      startupHistory: startupHistory(),
      hostObservations: [...hostObservations, { phase, ...hostSnapshot() }],
    },
    'imp-04',
  );
  console.error(`EVAL TEST falló en ${phase}; diagnóstico local saneado.`);
  process.exitCode = 1;
}
