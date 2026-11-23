// Explicit TEST harness around the frozen .13 application. Importing has no effects.
// Material ingestion is independent; only help calls require a committed attempt.
const { createRequire } = require('node:module');
const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const {
  openSync,
  readFileSync,
  fstatSync,
  closeSync,
  constants,
} = require('node:fs');
const { open } = require('node:fs/promises');

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const PHASES = ['EMBEDDING', 'GENERATION', 'REVIEW'];
function requireValue(value, code) {
  if (!value) throw new Error(code);
}
function privateInfo(info) {
  requireValue(
    info.isFile() && info.size < 2 * 1024 * 1024,
    'HELP_PRIVATE_FILE',
  );
  if (process.platform === 'linux')
    requireValue(
      info.uid === process.getuid() && (info.mode & 0o077) === 0,
      'HELP_PRIVATE_PERMISSIONS',
    );
}
function readPrivate(path) {
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    privateInfo(fstatSync(fd));
    return JSON.parse(readFileSync(fd, 'utf8'));
  } finally {
    closeSync(fd);
  }
}
function scopesFor(manifest, record) {
  requireValue(
    record?.campaignId === manifest.campaignId && Array.isArray(record.scopes),
    'HELP_SCOPES_IDENTITY',
  );
  const seen = new Set();
  for (const scope of record.scopes) {
    requireValue(
      ['H01', 'H02', 'H03'].includes(scope.scope) &&
        [
          'actorId',
          'organizationId',
          'classId',
          'activityId',
          'assignmentId',
          'exerciseVersionId',
        ].every((key) => UUID.test(scope[key])) &&
        Array.isArray(scope.attemptIds) &&
        scope.attemptIds.every((id) => UUID.test(id)),
      'HELP_SCOPE_RECORD',
    );
    for (const attemptId of scope.attemptIds) {
      requireValue(!seen.has(attemptId), 'HELP_DUPLICATE_ATTEMPT');
      seen.add(attemptId);
    }
  }
  return record.scopes;
}
function faultForAttempt(
  manifest,
  fault,
  scopesRecord,
  attemptId,
  now = Date.now(),
) {
  const scopes = scopesFor(manifest, scopesRecord);
  requireValue(
    fault?.campaignId === manifest.campaignId,
    'HELP_FAULT_CAMPAIGN',
  );
  if (fault.disabled === true) return null;
  const expiresAt = Date.parse(fault.expiresAt);
  requireValue(
    fault.scenario === 'generation-unavailable' &&
      fault.scope === 'H03' &&
      UUID.test(fault.attemptId) &&
      Number.isFinite(expiresAt),
    'HELP_FAULT_RECORD',
  );
  const owned = scopes.filter(
    (s) => s.scope === fault.scope && s.attemptIds.includes(fault.attemptId),
  );
  requireValue(owned.length === 1, 'HELP_FAULT_SCOPE');
  // The fixture also queries control without an attempt while selecting evidence.
  // That path never receives a fault; this campaign injects only generation failure.
  if (expiresAt <= now || fault.attemptId !== attemptId) return null;
  return { scenario: 'generation-unavailable' };
}

// One independent READ COMMITTED observation sees only committed rows. Every
// ownership key is compared again in JS; no provider payload leaves this query.
const PROOF_SQL = `select r.id as "requestId", a.id as "attemptId", a.execution_id as "executionId",
 r.student_id as "actorId", r.organization_id as "organizationId", r.class_id as "classId",
 a.activity_id as "activityId", a.activity_exercise_id as "assignmentId", a.exercise_version_id as "exerciseVersionId",
 r.lifecycle_status as "lifecycleStatus", c.phase, c.state as "callState",
 a.technical_result->>'diagnosisCode' as "diagnosisCode",
 encode(sha256(convert_to(a.code,'UTF8')),'hex') as "codeSha256",
 encode(sha256(convert_to(a.technical_result::text,'UTF8')),'hex') as "resultSha256",
 (select encode(sha256(convert_to(p.private_test_results::text,'UTF8')),'hex')
  from app_private.attempt_results p where p.attempt_id=a.id and p.organization_id=a.organization_id) as "privateResultsSha256",
 (select count(*)::int from app_private.attempt_results p where p.attempt_id=a.id and p.organization_id=a.organization_id) as "privateResultRows",
 (select count(*)::int from app_private.attempt_events e where e.attempt_id=a.id and e.organization_id=a.organization_id and e.event_type='ATTEMPT_SUBMITTED') as "submittedEvents",
 (select count(*)::int from app_private.attempt_events e where e.attempt_id=a.id and e.organization_id=a.organization_id and e.event_type='EXECUTION_COMPLETED') as "completedEvents",
 (a.submitted_at<=r.requested_at and c.dispatched_at>=r.requested_at and r.deadline_at>clock_timestamp()) as "ordered"
 from app.feedback_requests r join app.attempts a on a.id=r.attempt_id
 and a.organization_id=r.organization_id and a.class_id=r.class_id and a.student_id=r.student_id
 join app_private.help_calls c on c.request_id=r.id
 where r.attempt_id=any($1::uuid[]) and c.phase=$2 and r.lifecycle_status='RUNNING' and c.state='DISPATCHED'
 and ($3::uuid is null or a.id=$3::uuid)`;

async function appendObservation(path, observation) {
  const file = await open(
    path,
    constants.O_WRONLY |
      constants.O_APPEND |
      constants.O_CREAT |
      (constants.O_NOFOLLOW || 0),
    0o600,
  );
  try {
    // The observation log can grow; cap individual private control inputs instead.
    const info = await file.stat();
    requireValue(info.isFile(), 'HELP_OBSERVATION_FILE');
    if (process.platform === 'linux')
      requireValue(
        info.uid === process.getuid() && (info.mode & 0o077) === 0,
        'HELP_PRIVATE_PERMISSIONS',
      );
    await file.appendFile(JSON.stringify(observation) + '\n');
    await file.sync();
  } finally {
    await file.close();
  }
}
function createProofGuard({
  manifest,
  pool,
  readScopes = () => readPrivate(manifest.scopesPath),
  append = (row) => appendObservation(manifest.providerObservationsPath, row),
  now = () => new Date().toISOString(),
}) {
  return async (phase, context, signal) => {
    requireValue(PHASES.includes(phase), 'HELP_PROOF_PHASE');
    signal.throwIfAborted();
    const scopes = scopesFor(manifest, readScopes());
    const attempts = scopes.flatMap((s) => s.attemptIds);
    const expected = phase === 'EMBEDDING' ? null : context?.attemptId;
    requireValue(
      attempts.length > 0 &&
        (phase === 'EMBEDDING' ||
          (UUID.test(expected) && attempts.includes(expected))),
      'HELP_ATTEMPT_NOT_COMMITTED',
    );
    // Pool is administratively authenticated but read-only, never the application's
    // connection/transaction. Acquiring here prevents an in-memory proof of commit.
    const client = await pool.connect();
    let result;
    try {
      result = await client.query(PROOF_SQL, [attempts, phase, expected]);
    } finally {
      client.release();
    }
    signal.throwIfAborted();
    requireValue(result.rows.length === 1, 'HELP_PERSISTENCE_UNVERIFIED');
    const row = result.rows[0];
    const own = scopes.filter(
      (s) =>
        s.attemptIds.includes(row.attemptId) &&
        [
          'actorId',
          'organizationId',
          'classId',
          'activityId',
          'assignmentId',
          'exerciseVersionId',
        ].every((key) => s[key] === row[key]),
    );
    requireValue(
      own.length === 1 &&
        UUID.test(row.requestId) &&
        UUID.test(row.executionId) &&
        (expected === null || row.attemptId === expected) &&
        row.lifecycleStatus === 'RUNNING' &&
        row.phase === phase &&
        row.callState === 'DISPATCHED' &&
        row.ordered === true &&
        row.privateResultRows === 1 &&
        row.submittedEvents === 1 &&
        row.completedEvents === 1 &&
        ['codeSha256', 'resultSha256', 'privateResultsSha256'].every((key) =>
          HASH.test(row[key]),
        ),
      'HELP_PERSISTENCE_UNVERIFIED',
    );
    if (context)
      requireValue(
        context.diagnosisCode === row.diagnosisCode &&
          context.exerciseVersionId === row.exerciseVersionId,
        'HELP_CONTEXT_NOT_CANONICAL',
      );
    const observation = {
      campaignId: manifest.campaignId,
      scope: own[0].scope,
      attemptId: row.attemptId,
      requestId: row.requestId,
      executionId: row.executionId,
      phase,
      pass: true,
      committed: true,
      at: now(),
      codeSha256: row.codeSha256,
      resultSha256: row.resultSha256,
      privateResultsSha256: row.privateResultsSha256,
      submittedEvents: row.submittedEvents,
      completedEvents: row.completedEvents,
      privateResultRows: row.privateResultRows,
    };
    await append(observation);
    signal.throwIfAborted();
    return observation;
  };
}
function createEmbeddings(observedCall) {
  return {
    configuration: {
      id: 'materials-fixture-3d-v1',
      model: 'test-fixture-only',
      dimensions: 3,
    },
    async embed(texts, signal, observer) {
      return observedCall('EMBEDDING', signal, observer, async () => {
        signal.throwIfAborted();
        return texts.map((text) => [
          1,
          text.includes('condición') ? 1 : 0.1,
          text.includes('función') ? 1 : 0.2,
        ]);
      });
    },
  };
}
function guardedFactory({
  embeddings,
  testHelpFactory,
  control,
  guard,
  observedCall,
}) {
  const factory = testHelpFactory(embeddings, control);
  async function invoke(phase, context, signal, observer, operation) {
    try {
      await guard(phase, context, signal);
    } catch {
      // No model operation has run. Still settle the existing observer once with
      // a fixed error, without forwarding SQL, control files or input content.
      return observedCall(phase, signal, observer, async () => {
        throw new Error('HELP_PERSISTENCE_UNVERIFIED');
      });
    }
    return operation();
  }
  return (...args) => {
    const providers = factory(...args);
    return {
      ...providers,
      embeddings: {
        ...providers.embeddings,
        embed: (texts, signal, observer) =>
          invoke('EMBEDDING', null, signal, observer, () =>
            providers.embeddings.embed(texts, signal, observer),
          ),
      },
      generation: {
        ...providers.generation,
        generate: (input, signal, observer) =>
          invoke('GENERATION', input.context, signal, observer, () =>
            providers.generation.generate(input, signal, observer),
          ),
      },
      verification: {
        ...providers.verification,
        verify: (input, candidate, signal, observer) =>
          invoke('REVIEW', input.context, signal, observer, () =>
            providers.verification.verify(input, candidate, signal, observer),
          ),
      },
    };
  };
}
function assertStartup(manifest, config) {
  const db = new URL(config.databaseUrl);
  const vm = config.localVmConfiguration;
  requireValue(
    manifest.profile === 'PHYSICAL_HELP_TEST' &&
      config.environment === 'test' &&
      config.host === '127.0.0.1' &&
      config.port === 4300 &&
      manifest.endpoints.api === 'http://127.0.0.1:4300' &&
      manifest.endpoints.auth === 'http://127.0.0.1:18421' &&
      config.jwtIssuer === manifest.endpoints.auth + '/auth/v1' &&
      config.jwksUrl ===
        manifest.endpoints.auth + '/auth/v1/.well-known/jwks.json' &&
      config.supabaseUrl === manifest.endpoints.auth &&
      ['postgres:', 'postgresql:'].includes(db.protocol) &&
      db.hostname === '127.0.0.1' &&
      db.port === '18422' &&
      db.pathname === '/postgres' &&
      db.username === 'alunza_app' &&
      !db.search &&
      !db.hash &&
      config.helpWorkerEnabled === true &&
      config.materialsWorkerEnabled === true &&
      config.signalsWorkerEnabled === false &&
      config.practiceRunnerEnabled === true &&
      config.practiceRunnerProvider === 'local-vm' &&
      !config.azureEmbeddingConfiguration &&
      !config.azureGenerationConfiguration &&
      config.evaluation?.enabled === false &&
      vm?.provider === 'local-vm' &&
      vm.runnerVersion === manifest.candidate.runnerVersion &&
      vm.image === manifest.candidate.capsuleImageId &&
      vm.kitManifestSha256 === manifest.candidate.kitManifestSha256 &&
      vm.guestSha256 === manifest.candidate.guestSha256 &&
      vm.socketPath === manifest.brokerSocket &&
      config.practiceQuotas.actorConcurrency === 1 &&
      config.practiceQuotas.submitActorConcurrency === 2 &&
      config.practiceQuotas.organizationConcurrency === 4 &&
      config.practiceQuotas.actorRequestsPerMinute === 10,
    'HELP_TEST_CONFIGURATION',
  );
}
function closePoolAfterHttp(app, pool) {
  let closing;
  const close = () => (closing ??= pool.end());
  // Nest drains workers in onModuleDestroy before disposing the HTTP server.
  app.getHttpServer().once('close', () => {
    void close().catch(() => {
      process.exitCode = 1;
    });
  });
  return close;
}
const STARTUP_STAGES = new Set([
  'ARGUMENTS',
  'IMPORTS',
  'MANIFEST',
  'RUNTIME',
  'ARTIFACT_IMPORTS',
  'TEST_HELPER_IMPORTS',
  'CONFIG',
  'GUARDS',
  'SCOPES',
  'FAULT',
  'POOL',
  'READ_ONLY',
  'CREATE_APP',
  'HTTP_SHUTDOWN_HOOK',
  'LISTEN',
  'READY',
  'CLEANUP',
]);
const STARTUP_CODES = new Set([
  'HELP_MANIFEST_ARGUMENT',
  'MANIFEST_IDENTITY',
  'CANDIDATE_PINS_REQUIRED',
  'LOOPBACK_ENDPOINTS_REQUIRED',
  'PRIVATE_CONTROL_KEY',
  'PRIVATE_PATHS_REQUIRED',
  'HELP_PROFILE_REQUIRED',
  'HELP_PRIVATE_PATH',
  'HELP_PATH_ISOLATION',
  'PRIVATE_FILE_REQUIRED',
  'PRIVATE_FILE_PERMISSIONS',
  'HELP_PRIVATE_FILE',
  'HELP_PRIVATE_PERMISSIONS',
  'HELP_SCOPES_IDENTITY',
  'HELP_SCOPE_RECORD',
  'HELP_DUPLICATE_ATTEMPT',
  'HELP_FAULT_CAMPAIGN',
  'HELP_FAULT_RECORD',
  'HELP_FAULT_SCOPE',
  'HELP_TEST_CONFIGURATION',
  'HELP_READ_ONLY_REQUIRED',
  'HELP_API_START_FAILED',
]);
const STARTUP_SYSTEM_CODES = Object.freeze({
  ENOENT: 'FILE_MISSING',
  EACCES: 'FILE_ACCESS_DENIED',
  EPERM: 'FILE_ACCESS_DENIED',
  ELOOP: 'FILE_LINK_REJECTED',
  MODULE_NOT_FOUND: 'ARTIFACT_MODULE_MISSING',
  ERR_MODULE_NOT_FOUND: 'HARNESS_MODULE_MISSING',
  ERR_INVALID_PACKAGE_CONFIG: 'ARTIFACT_PACKAGE_INVALID',
  ECONNREFUSED: 'DEPENDENCY_REFUSED',
  ETIMEDOUT: 'DEPENDENCY_TIMEOUT',
  EADDRINUSE: 'LISTEN_ADDRESS_IN_USE',
  '28P01': 'DATABASE_AUTH_FAILED',
  42501: 'DATABASE_PERMISSION_DENIED',
  25006: 'DATABASE_READ_ONLY_REJECTED',
  '42P01': 'DATABASE_SCHEMA_MISSING',
  42703: 'DATABASE_COLUMN_MISSING',
});
const STARTUP_ERROR_TYPES = new Set([
  'Error',
  'TypeError',
  'SyntaxError',
  'ReferenceError',
  'RangeError',
  'ConfigurationError',
  'UnknownDependenciesException',
  'UndefinedModuleException',
  'UnknownModuleException',
  'InvalidClassModuleException',
  'UnknownExportException',
  'RuntimeException',
  'HelpBoundaryError',
  'AiBoundaryError',
]);
function createStartupReporter(
  write = (row) => console.error(JSON.stringify(row)),
) {
  let stage = 'ARGUMENTS';
  let reportedFailure = false;
  const emit = (row) => {
    try {
      write(row);
    } catch {
      /* Diagnostics cannot change startup/cleanup. */
    }
  };
  return {
    mark(value) {
      requireValue(STARTUP_STAGES.has(value), 'HELP_STARTUP_STAGE_INVALID');
      stage = value;
      emit({ event: 'PHYSICAL_HELP_API_STARTUP', stage });
    },
    failed(error) {
      if (reportedFailure) return;
      reportedFailure = true;
      const code = STARTUP_CODES.has(error?.message)
        ? error.message
        : Object.hasOwn(STARTUP_SYSTEM_CODES, error?.code ?? '')
          ? STARTUP_SYSTEM_CODES[error.code]
          : error instanceof SyntaxError
            ? 'INVALID_JSON_OR_MODULE'
            : 'STARTUP_FAILED';
      const name = error?.constructor?.name;
      const errorType = STARTUP_ERROR_TYPES.has(name) ? name : 'OTHER_ERROR';
      emit({
        event: 'PHYSICAL_HELP_API_STARTUP_FAILED',
        stage,
        code,
        errorType,
      });
    },
  };
}
function loadTestProviders() {
  // These are new TEST harness files. Production app and pg still resolve from
  // the measured artifactRoot; the frozen campaign contains no provider doubles.
  const { testHelpFactory } = require('../help-providers.cjs');
  const { observedCall } = require('../help-fault-observer.cjs');
  return { testHelpFactory, observedCall };
}
async function main(
  argv = process.argv.slice(2),
  startup = createStartupReporter(),
) {
  startup.mark('ARGUMENTS');
  requireValue(
    argv.length === 2 && argv[0] === '--manifest',
    'HELP_MANIFEST_ARGUMENT',
  );
  const script = (name) =>
    pathToFileURL(resolve(__dirname, '../../scripts', name)).href;
  startup.mark('IMPORTS');
  const { loadHelpManifest } = await import(
    script('linux-vm-help-contract.mjs')
  );
  const { readPrivateJson } = await import(
    script('linux-vm-browser-contract.mjs')
  );
  const { assertRuntimeTarget, physicalTestTarget } = await import(
    script('local-target.mjs')
  );
  startup.mark('MANIFEST');
  const manifest = await loadHelpManifest(argv[1]);
  startup.mark('RUNTIME');
  const runtime = await readPrivateJson(manifest.statePath);
  assertRuntimeTarget(runtime, physicalTestTarget);
  startup.mark('ARTIFACT_IMPORTS');
  const artifactRequire = createRequire(
    resolve(manifest.artifactRoot, 'package.json'),
  );
  const { createApp, loadConfig } = artifactRequire('./apps/api/dist/app.js');
  const { Pool } = artifactRequire('pg');
  startup.mark('TEST_HELPER_IMPORTS');
  const { testHelpFactory, observedCall } = loadTestProviders();
  startup.mark('CONFIG');
  const config = loadConfig();
  startup.mark('GUARDS');
  assertStartup(manifest, config);
  startup.mark('SCOPES');
  scopesFor(manifest, readPrivate(manifest.scopesPath));
  const control = (attemptId) =>
    faultForAttempt(
      manifest,
      readPrivate(manifest.faultPath),
      readPrivate(manifest.scopesPath),
      attemptId,
    );
  startup.mark('FAULT');
  control();
  startup.mark('POOL');
  const pool = new Pool({
    connectionString: runtime.migrationUrl,
    max: 1,
    connectionTimeoutMillis: 2000,
    statement_timeout: 2000,
    idleTimeoutMillis: 1000,
    allowExitOnIdle: true,
    options: '-c default_transaction_read_only=on',
    application_name: 'physical-help-commit-observer',
  });
  let app;
  let closePool = () => pool.end();
  try {
    startup.mark('READ_ONLY');
    const check = await pool.query('show default_transaction_read_only');
    requireValue(
      check.rows[0]?.default_transaction_read_only === 'on',
      'HELP_READ_ONLY_REQUIRED',
    );
    const embeddings = createEmbeddings(observedCall);
    const factory = guardedFactory({
      embeddings,
      testHelpFactory,
      control,
      observedCall,
      guard: createProofGuard({ manifest, pool }),
    });
    startup.mark('CREATE_APP');
    app = await createApp(config, embeddings, factory);
    startup.mark('HTTP_SHUTDOWN_HOOK');
    closePool = closePoolAfterHttp(app, pool);
    startup.mark('LISTEN');
    await app.listen(config.port, config.host);
    startup.mark('READY');
    console.log(
      JSON.stringify({
        event: 'PHYSICAL_HELP_API_READY',
        campaignId: manifest.campaignId,
        appArtifact: 'frozen-13',
        provider: 'TEST_DOUBLE',
      }),
    );
  } catch (error) {
    startup.failed(error);
    startup.mark('CLEANUP');
    try {
      await app?.close();
    } finally {
      await closePool();
    }
    throw new Error('HELP_API_START_FAILED', { cause: error });
  }
}
module.exports = {
  scopesFor,
  faultForAttempt,
  createProofGuard,
  createEmbeddings,
  guardedFactory,
  assertStartup,
  closePoolAfterHttp,
  createStartupReporter,
  loadTestProviders,
};
if (require.main === module) {
  const startup = createStartupReporter();
  main(undefined, startup).catch((error) => {
    startup.failed(error);
    console.error('No se inició la API aislada de ayuda.');
    process.exitCode = 1;
  });
}
