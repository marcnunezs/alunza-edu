// Additive TEST campaign. Database preparation and builds belong to the operator;
// this entrypoint never resets, seeds, migrates or stops shared infrastructure.
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  unlink,
} from 'node:fs/promises';
import { dirname, join, resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import {
  root,
  readState,
  apiEnvironment,
  portAvailable,
  run,
} from './local.mjs';
import { assertRuntimeTarget, testTarget } from './local-target.mjs';
import {
  testContext,
  nodeService,
  publicTestEnvironment,
} from './test-environment.mjs';
import {
  additionalStudents,
  classes,
  concepts,
} from '../fixtures/demo/academic.mjs';
import { EvaluationError, privateJson, sha256 } from './evaluation-client.mjs';
import {
  candidateFingerprint,
  evaluationPlanSchema,
} from './evaluation-manifest.mjs';
import { prepareEvaluation } from './evaluation-prepare.mjs';
import { authorizeEvaluation } from './evaluation-cli.mjs';
import { runEvaluation } from './evaluation-run.mjs';
import { assertEvaluationCompleteness } from './evaluation-completeness.mjs';

const require = createRequire(import.meta.url);
const fail = (code) => {
  throw new EvaluationError(code);
};
const requireCondition = (value, code) => {
  if (!value) fail(code);
};
const durableTables = [
  'app.attempts',
  'app_private.attempt_results',
  'app_private.attempt_events',
  'app.feedback_requests',
  'app.feedbacks',
  'app.feedback_source_refs',
  'app.sources',
  'app.source_versions',
  'app.source_index_generations',
  'app.source_chunks',
  'app_private.evaluation_runs',
  'app_private.ai_call_receipts',
];
const historicalFiles = [
  'plan.json',
  'prepared.json',
  'authorized-manifest.json',
  'calibration.json',
  'run-journal.json',
  'report.json',
  'teacher-review.json',
  'private-evidence.json',
];
const samePath = (left, right) =>
  process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;

export function buildBrowserEvaluationPlan({
  template,
  config,
  fingerprint,
  now = Date.now(),
  profileFactory,
}) {
  requireCondition(
    config.environment === 'test' &&
      config.evaluation?.enabled === true &&
      config.practiceRunnerProvider === 'docker' &&
      config.practiceRunnerEnabled === true &&
      config.jwtIssuer === `${testTarget.authUrl}/auth/v1` &&
      new URL(config.databaseUrl).hostname === '127.0.0.1' &&
      new URL(config.databaseUrl).port === String(testTarget.dbPort),
    'BROWSER_EVALUATION_TEST_CONFIGURATION',
  );
  return evaluationPlanSchema.parse({
    ...template,
    environment: 'TEST',
    provider: 'TEST',
    azure: null,
    candidateFingerprint: fingerprint,
    destination: {
      apiOrigin: testTarget.apiUrl,
      authOrigin: testTarget.authUrl,
      operationsOrigin: 'http://127.0.0.1:4401',
      projectId: testTarget.projectId,
    },
    authorization: {
      approvedBy: 'Automated TEST fixture',
      reference: 'IMP-04-browser-authorized-local-tests-no-Azure',
      expiresAt: new Date(now + 2 * 60 * 60 * 1000).toISOString(),
    },
    priceVersion: 'SYNTHETIC-TEST-ONLY-NOT-AZURE-PRICES-v1',
    profiles: Object.fromEntries(
      ['EMBEDDING', 'GENERATION', 'REVIEW'].map((phase) => [
        phase,
        {
          ...profileFactory(
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
}

async function readOnlyDatabase(state, action) {
  assertRuntimeTarget(state, testTarget);
  const db = new pg.Client({
    connectionString: state.migrationUrl,
    connectionTimeoutMillis: 3000,
    statement_timeout: 10000,
    options: '-c default_transaction_read_only=on -c timezone=UTC',
  });
  await db.connect();
  try {
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    requireCondition(
      (await db.query('SHOW transaction_read_only')).rows[0]
        .transaction_read_only === 'on',
      'BROWSER_EVALUATION_READ_ONLY_REQUIRED',
    );
    return await action(db);
  } finally {
    await db.query('ROLLBACK').catch(() => undefined);
    await db.end();
  }
}

export async function assertBrowserEvaluationFixture(
  db,
  { actors, migrations },
) {
  const installed = new Set(
    (
      await db.query(
        'SELECT version FROM supabase_migrations.schema_migrations',
      )
    ).rows.map((row) => row.version),
  );
  requireCondition(
    migrations.every((version) => installed.has(version)),
    'BROWSER_EVALUATION_MIGRATIONS_PENDING',
  );
  const people = await db.query(
    `SELECT count(*)::int AS count
    FROM jsonb_to_recordset($1::jsonb) AS x(id uuid, "organizationId" uuid, role text, email text)
    JOIN app.profiles p ON p.id=x.id AND p.account_state='ACTIVE'
    JOIN auth.users u ON u.id=x.id AND lower(u.email)=lower(x.email)
    JOIN app.organization_memberships m ON m.user_id=x.id AND m.organization_id=x."organizationId"
      AND m.state='ACTIVE' AND m.role=x.role
    JOIN app.organizations o ON o.id=m.organization_id AND o.archived_at IS NULL`,
    [JSON.stringify(actors)],
  );
  requireCondition(
    people.rows[0].count === actors.length,
    'BROWSER_EVALUATION_ACTORS_NOT_READY',
  );
  const scopes = await db.query(
    `SELECT count(*)::int AS count
    FROM jsonb_to_recordset($1::jsonb) AS x(id uuid, "organizationId" uuid, "courseId" uuid, "teacherId" uuid)
    JOIN app.classes c ON c.id=x.id AND c.organization_id=x."organizationId"
      AND c.course_id=x."courseId" AND c.teacher_id=x."teacherId" AND c.archived_at IS NULL
    JOIN app.courses k ON k.id=c.course_id AND k.archived_at IS NULL
    JOIN app.course_teacher_grants g ON g.course_id=k.id AND g.teacher_id=c.teacher_id
      AND g.organization_id=c.organization_id AND g.revoked_at IS NULL`,
    [JSON.stringify(classes)],
  );
  requireCondition(
    scopes.rows[0].count === classes.length,
    'BROWSER_EVALUATION_CLASSES_NOT_READY',
  );
  const memberships = classes.flatMap((item) =>
    item.studentIds.map((studentId) => ({
      classId: item.id,
      organizationId: item.organizationId,
      studentId,
    })),
  );
  const enrolled = await db.query(
    `SELECT count(*)::int AS count
    FROM jsonb_to_recordset($1::jsonb) AS x("classId" uuid, "organizationId" uuid, "studentId" uuid)
    JOIN app.class_memberships m ON m.class_id=x."classId" AND m.organization_id=x."organizationId"
      AND m.user_id=x."studentId" AND m.ended_at IS NULL`,
    [JSON.stringify(memberships)],
  );
  requireCondition(
    enrolled.rows[0].count === memberships.length,
    'BROWSER_EVALUATION_MEMBERSHIPS_NOT_READY',
  );
  const tags = await db.query(
    `SELECT count(*)::int AS count
    FROM jsonb_to_recordset($1::jsonb) AS x(id uuid, "organizationId" uuid, "versionId" uuid)
    JOIN app.concept_tags t ON t.id=x.id AND t.organization_id=x."organizationId" AND t.archived_at IS NULL
      AND t.current_version_id=x."versionId"
    JOIN app.concept_versions v ON v.id=t.current_version_id AND v.concept_id=t.id`,
    [JSON.stringify(concepts)],
  );
  requireCondition(
    tags.rows[0].count === concepts.length,
    'BROWSER_EVALUATION_CONCEPTS_NOT_READY',
  );
  const vector =
    await db.query(`SELECT t.typname AS type,a.atttypmod AS dimensions
    FROM pg_attribute a JOIN pg_type t ON t.oid=a.atttypid
    WHERE a.attrelid='app.source_chunks'::regclass AND a.attname='embedding' AND NOT a.attisdropped`);
  requireCondition(
    vector.rows[0]?.type === 'vector' &&
      [-1, 3].includes(vector.rows[0]?.dimensions),
    'BROWSER_EVALUATION_VECTOR_PROFILE_MISMATCH',
  );
  // The migration declares extensions.vector without a typmod. Compatibility
  // is enforced by the singleton profile, generation metadata and actual vector
  // dimensions; an empty, unconfigured corpus is valid for this TEST profile.
  const embedding = await db.query(
    `SELECT
    (SELECT count(*)::int FROM app_private.material_embedding_profile) AS profiles,
    (SELECT count(*)::int FROM app_private.material_embedding_profile
      WHERE configuration_id IS DISTINCT FROM $1 OR model IS DISTINCT FROM $2
        OR dimensions IS DISTINCT FROM $3::integer) AS incompatible_profiles,
    (SELECT count(*)::int FROM app.source_index_generations
      WHERE configuration_id IS NOT NULL OR embedding_model IS NOT NULL
        OR embedding_dimension IS NOT NULL OR index_status='READY') AS configured_generations,
    (SELECT count(*)::int FROM app.source_index_generations
      WHERE (configuration_id IS NOT NULL OR embedding_model IS NOT NULL
        OR embedding_dimension IS NOT NULL OR index_status='READY')
        AND (configuration_id IS DISTINCT FROM $1 OR embedding_model IS DISTINCT FROM $2
          OR embedding_dimension IS DISTINCT FROM $3::integer)) AS incompatible_generations,
    (SELECT count(*)::int FROM app.source_chunks) AS chunks,
    (SELECT count(*)::int FROM app.source_chunks c
      LEFT JOIN app.source_index_generations g ON g.id=c.generation_id
        AND g.organization_id=c.organization_id AND g.source_id=c.source_id
        AND g.source_version_id=c.source_version_id
      WHERE extensions.vector_dims(c.embedding) IS DISTINCT FROM $3::integer
        OR g.configuration_id IS DISTINCT FROM $1 OR g.embedding_model IS DISTINCT FROM $2
        OR g.embedding_dimension IS DISTINCT FROM $3::integer) AS incompatible_chunks`,
    ['materials-fixture-3d-v1', 'test-fixture-only', 3],
  );
  const compatibility = embedding.rows[0];
  requireCondition(
    compatibility.profiles <= 1 &&
      compatibility.incompatible_profiles === 0 &&
      compatibility.incompatible_generations === 0 &&
      compatibility.incompatible_chunks === 0 &&
      ((compatibility.chunks === 0 &&
        compatibility.configured_generations === 0) ||
        compatibility.profiles === 1),
    'BROWSER_EVALUATION_VECTOR_PROFILE_MISMATCH',
  );
  const pending = await db.query(`SELECT
    (SELECT count(*)::int FROM app.material_jobs WHERE lifecycle_status IN ('UPLOADING','QUEUED','RUNNING')) AS materials,
    (SELECT count(*)::int FROM app.feedback_requests WHERE lifecycle_status IN ('QUEUED','RUNNING')) AS help,
    (SELECT count(*)::int FROM app.executions WHERE lifecycle_status IN ('RUNNING','RECOVERING')) AS executions,
    (SELECT count(*)::int FROM app_private.submission_reservations WHERE lifecycle_status<>'COMPLETED') AS submissions`);
  requireCondition(
    Object.values(pending.rows[0]).every((count) => count === 0),
    'BROWSER_EVALUATION_PENDING_WORK',
  );
  // evaluation_authorize reconciles expired AUTHORIZED/RUNNING rows globally.
  // Require their explicit prior resolution instead of changing old evidence as
  // a side effect of admitting this new campaign.
  const priorRuns = await db.query(`SELECT count(*)::int AS count
    FROM app_private.evaluation_runs WHERE state IN ('AUTHORIZED','RUNNING')`);
  requireCondition(
    priorRuns.rows[0].count === 0,
    'BROWSER_EVALUATION_PRIOR_RUN_ACTIVE',
  );
  return {
    migrations: migrations.length,
    actors: actors.length,
    classes: classes.length,
    memberships: memberships.length,
    concepts: concepts.length,
    vector: vector.rows[0].dimensions === -1 ? 'vector' : 'vector(3)',
    embeddingCompatibility: compatibility,
    pending: pending.rows[0],
  };
}

async function durableSnapshot(db) {
  const snapshot = {};
  for (const table of durableTables) {
    // Table identifiers come exclusively from the constant above. Only hashes
    // leave PostgreSQL: no source code, test results, credentials or documents.
    const rows = await db.query(
      `SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS digest FROM ${table} t ORDER BY digest`,
    );
    snapshot[table] = rows.rows.map((row) => row.digest);
  }
  return snapshot;
}

export function assertHistoricalRowsPreserved(before, after) {
  for (const table of durableTables) {
    const available = new Map();
    for (const hash of after[table] ?? [])
      available.set(hash, (available.get(hash) ?? 0) + 1);
    for (const hash of before[table] ?? []) {
      requireCondition(
        (available.get(hash) ?? 0) > 0,
        'BROWSER_EVALUATION_HISTORICAL_ROW_CHANGED',
      );
      available.set(hash, available.get(hash) - 1);
    }
  }
}

async function historicalEvidence(directory) {
  const paths = [
    join(root, '.local/reports/imp-04/evaluation-test.json'),
    join(root, '.local/reports/imp-04/evaluation-measurements.json'),
  ];
  for (const item of await readdir(join(root, '.local/eval-runs'), {
    withFileTypes: true,
  })) {
    if (!item.isDirectory()) continue;
    const candidate = join(root, '.local/eval-runs', item.name);
    if (samePath(candidate, directory)) continue;
    for (const name of historicalFiles) paths.push(join(candidate, name));
  }
  const result = [];
  for (const path of paths) {
    try {
      requireCondition(
        (await lstat(path)).isFile(),
        'BROWSER_EVALUATION_EVIDENCE_NOT_FILE',
      );
      const bytes = await readFile(path);
      result.push({
        path: relative(root, path).replaceAll('\\', '/'),
        bytes: bytes.length,
        sha256: sha256(bytes),
      });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return result;
}

async function verifyHistoricalEvidence(before) {
  for (const item of before) {
    const bytes = await readFile(join(root, item.path));
    requireCondition(
      bytes.length === item.bytes && sha256(bytes) === item.sha256,
      'BROWSER_EVALUATION_HISTORICAL_FILE_CHANGED',
    );
  }
}

async function createRunDirectory(runId, requested) {
  const parent = join(root, '.local/eval-runs');
  await mkdir(parent, { recursive: true });
  requireCondition(
    samePath(await realpath(parent), parent),
    'BROWSER_EVALUATION_DIRECTORY_LINK',
  );
  const directory = resolve(requested ?? join(parent, runId));
  requireCondition(
    samePath(dirname(directory), parent),
    'BROWSER_EVALUATION_DIRECTORY_SCOPE',
  );
  await mkdir(directory, { mode: 0o700 }); // An existing run is never resumed here.
  return directory;
}

async function operationalEvidence(directory) {
  const path = join(directory, 'operational-local-tests.json');
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
    path,
  ]);
  const raw = await readFile(path, 'utf8');
  return {
    raw,
    sha256: sha256(raw),
    path: relative(root, path).replaceAll('\\', '/'),
  };
}

export async function runBrowserEvaluation({
  createBrowserDriver,
  directory: requestedDirectory,
  runEvaluationFn = runEvaluation,
} = {}) {
  requireCondition(
    typeof createBrowserDriver === 'function',
    'BROWSER_EVALUATION_DRIVER_REQUIRED',
  );
  const state = await readState(testContext);
  assertRuntimeTarget(state, testTarget);
  requireCondition(
    samePath(await realpath(join(root, '.local')), join(root, '.local')),
    'BROWSER_EVALUATION_DIRECTORY_LINK',
  );
  for (const port of [testTarget.apiPort, testTarget.webPort, 4401])
    requireCondition(
      await portAvailable(port),
      'BROWSER_EVALUATION_CONSUMER_PORT_BUSY',
    );
  const lockPath = join(root, '.local/integration.lock');
  const lock = await open(lockPath, 'wx', 0o600);
  const runId = randomUUID();
  let directory,
    api,
    web,
    browserDriver,
    originalRows,
    originalEvidence,
    plan,
    prepared;
  let phase = 'preflight',
    failure,
    interrupted = false;
  const summary = {
    schemaVersion: 1,
    profile: 'LOCAL_BROWSER_EVALUATION_TEST',
    runId,
    provider: 'TEST',
    externalCalls: 0,
    status: 'RUNNING',
    academicAcceptance: 'PENDING',
    azureEvidence: 'NOT_PROMOTABLE',
  };
  const closures = new Map();
  const closeConsumers = async () => {
    // Capture new owners again in finally: a signal may arrive while a factory
    // is resolving. Each individual child is closed once, including that child.
    for (const service of [browserDriver, web, api].filter(Boolean)) {
      if (closures.has(service)) continue;
      const close =
        service === browserDriver
          ? () => service.close()
          : () => service.stop();
      closures.set(
        service,
        Promise.resolve()
          .then(close)
          .then(
            () => null,
            () => 'OWN_CONSUMER_STOP_FAILED',
          ),
      );
    }
    return (await Promise.all(closures.values())).filter(Boolean);
  };
  const markPhase = (value) => {
    phase = value;
    console.log(JSON.stringify({ runId, phase }));
  };
  const checkInterrupted = () =>
    requireCondition(!interrupted, 'BROWSER_EVALUATION_INTERRUPTED');
  const onSignal = () => {
    interrupted = true;
    void closeConsumers();
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, runId }));
    directory = await createRunDirectory(runId, requestedDirectory);
    console.log(
      JSON.stringify({ status: 'PREPARING_TEST_BROWSER', runId, directory }),
    );
    originalEvidence = await historicalEvidence(directory);
    await privateJson(
      join(directory, 'historical-files-before.json'),
      originalEvidence,
    );
    const fixture = JSON.parse(
      await readFile(join(root, 'fixtures/foundation/identity.json'), 'utf8'),
    );
    const actors = [...fixture.users, ...additionalStudents].filter(
      (actor) => actor.accountState === 'ACTIVE',
    );
    const migrations = (await readdir(join(root, 'supabase/migrations')))
      .filter((name) => /^\d{14}_.+\.sql$/u.test(name))
      .map((name) => name.slice(0, 14));
    summary.preflight = await readOnlyDatabase(state, async (db) => {
      const checks = await assertBrowserEvaluationFixture(db, {
        actors,
        migrations,
      });
      originalRows = await durableSnapshot(db);
      return checks;
    });
    await privateJson(
      join(directory, 'historical-rows-before.json'),
      originalRows,
    );
    checkInterrupted();
    const { loadConfig } = require('../apps/api/dist/config.js');
    const {
      evaluationProviderProfile,
    } = require('../apps/api/dist/evaluation-profiles.js');
    const controlsPath = join(directory, 'controls.json');
    await privateJson(controlsPath, { attempts: {} });
    const environment = {
      ...apiEnvironment(testContext, state),
      INVITATION_WORKER_ENABLED: 'false',
      SIGNALS_WORKER_ENABLED: 'false',
      PRACTICE_RUNNER_PROVIDER: 'docker',
      EVALUATION_ENABLED: 'true',
      EVALUATION_OPERATIONS_PORT: '4401',
      ALUNZA_EVALUATION_CONTROLS: controlsPath,
    };
    const template = JSON.parse(
      await readFile(
        join(root, 'infra/preproduction/help-evaluation.example.json'),
        'utf8',
      ),
    );
    plan = buildBrowserEvaluationPlan({
      template,
      config: loadConfig(environment),
      fingerprint: await candidateFingerprint(),
      profileFactory: evaluationProviderProfile,
    });
    await privateJson(join(directory, 'plan.json'), plan);
    markPhase('operational-evidence');
    const localEvidence = await operationalEvidence(directory);
    checkInterrupted();
    const startApi = async (extra = {}) => {
      checkInterrupted();
      api = nodeService([join(root, 'tests/evaluation-api.cjs')], {
        ...environment,
        ...extra,
      });
      await api.start(`${testTarget.apiUrl}/health/ready`);
    };
    markPhase('prepare-product-attempts');
    await startApi();
    prepared = await prepareEvaluation({ plan, state, directory, runId });
    await privateJson(controlsPath, {
      attempts: Object.fromEntries(
        prepared.cases.flatMap((entry) => {
          if (entry.binding.reviewCase)
            return [
              [
                entry.binding.attemptId,
                {
                  review: entry.binding.reviewCase.expected,
                  reason: entry.oracle.expected.reason ?? 'UNSUPPORTED_CLAIM',
                },
              ],
            ];
          if (
            ['contradictory-material', 'near-irrelevant'].includes(
              entry.oracle?.caseId,
            )
          )
            return [[entry.binding.attemptId, { scenario: 'ambiguous' }]];
          return [];
        }),
      ),
    });
    checkInterrupted();
    markPhase('authorize');
    await authorizeEvaluation({ plan, prepared, state, directory });
    markPhase('ingestion');
    await runEvaluationFn({ plan, prepared, directory, stages: ['INGESTION'] });
    checkInterrupted();
    markPhase('calibration');
    let calibratedEnvironment;
    await runEvaluationFn({
      plan,
      prepared,
      directory,
      stages: ['CALIBRATION'],
      activateCalibration: async (artifact) => {
        requireCondition(
          artifact.version === 'help-evidence-2' && artifact.origin === 'TEST',
          'BROWSER_EVALUATION_CALIBRATION_ORIGIN',
        );
        calibratedEnvironment = {
          HELP_CALIBRATION_JSON: JSON.stringify(artifact),
          HELP_CALIBRATION_CORPUS_SHA256: prepared.corpusHash,
        };
        await api.stop();
        await startApi(calibratedEnvironment);
      },
    });
    requireCondition(
      calibratedEnvironment,
      'BROWSER_EVALUATION_CALIBRATION_MISSING',
    );
    checkInterrupted();
    markPhase('functional');
    await runEvaluationFn({
      plan,
      prepared,
      directory,
      stages: ['FUNCTIONAL'],
    });
    checkInterrupted();
    markPhase('browser-start');
    web = nodeService(
      [
        join(root, 'node_modules/next/dist/bin/next'),
        'start',
        '--hostname',
        '127.0.0.1',
        '--port',
        String(testTarget.webPort),
      ],
      publicTestEnvironment(state),
      join(root, 'apps/web'),
    );
    await web.start(testTarget.webUrl);
    browserDriver = await createBrowserDriver({
      plan,
      prepared,
      directory,
      state,
      webOrigin: testTarget.webUrl,
    });
    requireCondition(
      browserDriver && typeof browserDriver.close === 'function',
      'BROWSER_EVALUATION_DRIVER_INVALID',
    );
    checkInterrupted();
    markPhase('evaluation');
    const result = await runEvaluationFn({
      plan,
      prepared,
      directory,
      stages: ['EVALUATION'],
      browserDriver,
    });
    checkInterrupted();
    markPhase('resume-completed');
    const again = await runEvaluationFn({
      plan,
      prepared,
      directory,
      browserDriver,
    });
    requireCondition(
      again.samples.length === result.samples.length &&
        again.receipts.length === result.receipts.length,
      'BROWSER_EVALUATION_RESUME_DUPLICATED_WORK',
    );
    requireCondition(
      result.profiles.length === 2 &&
        result.profiles.every(
          (profile) =>
            profile.count === 100 &&
            profile.success === 100 &&
            profile.belowDocumentaryTarget === true,
        ),
      'BROWSER_EVALUATION_VISIBLE_TARGET_NOT_MET',
    );
    const coverage = assertEvaluationCompleteness(result, localEvidence);
    requireCondition(
      coverage.status === 'COMPLETE',
      'BROWSER_EVALUATION_ADVERSARIAL_INCOMPLETE',
    );
    Object.assign(summary, {
      status: 'PASSED',
      profiles: result.profiles,
      coverage,
      candidateFingerprint: plan.candidateFingerprint,
      corpusHash: prepared.corpusHash,
      samples: result.samples.length,
      receipts: result.receipts.length,
    });
    markPhase('complete');
  } catch (error) {
    failure = error;
    summary.status = 'FAILED';
    summary.failure = {
      phase,
      code:
        error instanceof EvaluationError
          ? error.code
          : 'BROWSER_EVALUATION_FAILED',
    };
  } finally {
    const cleanupErrors = await closeConsumers();
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    summary.cleanupErrors = cleanupErrors;
    summary.consumers = {
      apiStopped: !api?.running,
      webStopped: !web?.running,
      browserCloseCompleted: !!browserDriver && cleanupErrors.length === 0,
      apiStartup: api?.startupMeasurements ?? [],
      webStartup: web?.startupMeasurements ?? [],
    };
    if (cleanupErrors.length) {
      summary.status = 'FAILED';
      failure ??= new EvaluationError('BROWSER_EVALUATION_CLEANUP_FAILED');
    }
    try {
      if (originalEvidence) await verifyHistoricalEvidence(originalEvidence);
      if (originalRows) {
        const after = await readOnlyDatabase(state, durableSnapshot);
        await privateJson(join(directory, 'historical-rows-after.json'), after);
        assertHistoricalRowsPreserved(originalRows, after);
      }
      summary.historicalEvidencePreserved =
        !!originalRows && !!originalEvidence;
    } catch (error) {
      summary.status = 'FAILED';
      summary.historicalEvidencePreserved = false;
      summary.preservationError =
        error instanceof EvaluationError
          ? error.code
          : 'BROWSER_EVALUATION_PRESERVATION_UNVERIFIED';
      failure ??= error;
    }
    try {
      if (directory)
        await privateJson(join(directory, 'browser-campaign-summary.json'), {
          ...summary,
          completedAt: new Date().toISOString(),
        });
    } finally {
      await lock.close();
      await unlink(lockPath);
    }
  }
  if (failure)
    throw new EvaluationError(
      summary.failure?.code ??
        summary.preservationError ??
        'BROWSER_EVALUATION_FAILED',
    );
  return { ...summary, directory };
}

export async function browserEvaluationMain(args = process.argv.slice(2)) {
  let directory;
  if (args.length) {
    requireCondition(
      args.length === 2 &&
        args[0] === '--directory' &&
        args[1] &&
        !args[1].startsWith('--'),
      'BROWSER_EVALUATION_INVALID_ARGUMENTS',
    );
    directory = args[1];
  }
  const { createEvaluationBrowserDriver } =
    await import('./evaluation-browser-driver.mjs');
  return runBrowserEvaluation({
    directory,
    createBrowserDriver: createEvaluationBrowserDriver,
  });
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  browserEvaluationMain()
    .then((value) => console.log(JSON.stringify(value)))
    .catch((error) => {
      console.error(
        error instanceof EvaluationError
          ? error.code
          : 'BROWSER_EVALUATION_FAILED',
      );
      process.exitCode = 1;
    });
}
