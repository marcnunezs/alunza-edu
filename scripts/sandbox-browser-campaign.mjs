import { readFile, stat, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import pg from 'pg';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const origin = z.url().refine((value) => {
  const url = new URL(value);
  return (
    url.protocol === 'https:' &&
    url.origin === value &&
    !url.username &&
    !url.password &&
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  );
});
const configSchema = z.strictObject({
  baseUrl: origin,
  webOrigin: origin,
  fictitiousOnly: z.literal(true),
});
const fixtureSchema = z.strictObject({
  schemaVersion: z.literal(1),
  environment: z.literal('preproduction'),
  fictitiousOnly: z.literal(true),
  baseUrl: origin,
  webOrigin: origin,
  supabaseHost: z.string().regex(/^[a-zA-Z0-9.-]+(?::[0-9]{1,5})?$/),
  actorId: z.uuid(),
  activityId: z.uuid(),
  assignmentId: z.uuid(),
  exerciseVersionId: z.uuid(),
  actorSession: z
    .object({
      access_token: z.string().min(20),
      refresh_token: z.string().min(20),
      token_type: z.literal('bearer'),
      expires_in: z.number().int().positive(),
      expires_at: z.number().int().positive(),
      user: z.object({ id: z.uuid() }).passthrough(),
    })
    .passthrough(),
  successfulCode: z.string().min(1).max(65536),
  failingCode: z.string().min(1).max(65536),
  privateSentinels: z.array(z.string().min(8)).min(1).max(20),
});
export const browserCaseIds = Object.freeze([
  'browser-run-failed',
  'browser-submit-cancelled',
  'browser-submit-failed',
  'browser-submit-success',
  'browser-history-reload',
  'browser-intentional-retry',
  'browser-hidden-redaction',
  'browser-cleanup',
]);
export function planBrowserStage(stage) {
  const blockers = [];
  if (
    stage.kind !== 'api' ||
    !Array.isArray(stage.fixtures) ||
    stage.fixtures.length !== 1 ||
    stage.fixtures[0] !== 'browser-vertical'
  )
    blockers.push('EXCLUSIVE_BROWSER_VERTICAL_REQUIRED');
  if (!configSchema.safeParse(stage.config).success)
    blockers.push('BROWSER_STAGE_CONFIGURATION_REQUIRED');
  return {
    implemented: true,
    cases: browserCaseIds.map((id) => ({ id })),
    creations: 4,
    normalRequests: 320,
    clientRequests: 240,
    maxDurationSeconds: 600,
    blockers,
  };
}

/** Private, local read only. Never include its result in a report or diagnostic. */
export async function readBrowserFixture(stage, environment = process.env) {
  try {
    const config = configSchema.parse(stage.config);
    const path = environment.ALUNZA_SANDBOX_BROWSER_FIXTURES_FILE;
    if (!path || (await stat(path)).size > 262144) throw new Error();
    const fixture = fixtureSchema.parse(
      JSON.parse(await readFile(path, 'utf8')),
    );
    const authOrigin = new URL(`https://${fixture.supabaseHost}`);
    if (
      fixture.baseUrl !== config.baseUrl ||
      fixture.webOrigin !== config.webOrigin ||
      fixture.actorSession.user.id !== fixture.actorId ||
      authOrigin.host !== fixture.supabaseHost ||
      ['localhost', '127.0.0.1', '[::1]'].includes(authOrigin.hostname) ||
      fixture.actorSession.expires_at * 1000 <= Date.now() + 600000 ||
      fixture.successfulCode === fixture.failingCode
    )
      throw new Error();
    return fixture;
  } catch {
    throw new Error('INVALID_PRIVATE_BROWSER_CONFIGURATION');
  }
}

function databaseConfiguration(environment) {
  const databaseUrl = new URL(environment.ALUNZA_SANDBOX_API_DATABASE_URL);
  if (
    !['postgres:', 'postgresql:'].includes(databaseUrl.protocol) ||
    !/^alunza_app(?:\.[a-z0-9]+)?$/.test(
      decodeURIComponent(databaseUrl.username),
    ) ||
    databaseUrl.search ||
    ['localhost', '127.0.0.1', '[::1]'].includes(databaseUrl.hostname)
  )
    throw new Error('LIMITED_PREPRODUCTION_DATABASE_REQUIRED');
  return databaseUrl;
}
async function installedCypress(environment) {
  const { version } = JSON.parse(
    await readFile(join(root, 'node_modules/cypress/package.json'), 'utf8'),
  );
  const cache =
    environment.CYPRESS_CACHE_FOLDER ??
    (process.platform === 'win32'
      ? join(environment.LOCALAPPDATA ?? '', 'Cypress/Cache')
      : process.platform === 'darwin'
        ? join(homedir(), 'Library/Caches/Cypress')
        : join(homedir(), '.cache/Cypress'));
  const binary =
    environment.CYPRESS_RUN_BINARY ??
    join(
      cache,
      version,
      process.platform === 'win32'
        ? 'Cypress/Cypress.exe'
        : process.platform === 'darwin'
          ? 'Cypress.app/Contents/MacOS/Cypress'
          : 'Cypress/Cypress',
    );
  if (version !== '16.0.0' || !(await stat(binary)).isFile())
    throw new Error('PREINSTALLED_CYPRESS_REQUIRED');
}

export async function preflightBrowserStage(stage, environment = process.env) {
  const planned = planBrowserStage(stage),
    blockers = [...planned.blockers];
  if (
    !environment.ALUNZA_SANDBOX_BROWSER_FIXTURES_FILE ||
    !environment.ALUNZA_SANDBOX_API_DATABASE_URL ||
    !environment.ALUNZA_SANDBOX_API_DATABASE_CA_FILE
  )
    blockers.push('PRIVATE_BROWSER_FIXTURES_AND_LIMITED_DATABASE_REQUIRED');
  if (!blockers.length) {
    try {
      await readBrowserFixture(stage, environment);
      databaseConfiguration(environment);
      await readFile(environment.ALUNZA_SANDBOX_API_DATABASE_CA_FILE);
    } catch {
      blockers.push('INVALID_PRIVATE_BROWSER_CONFIGURATION');
    }
    try {
      await installedCypress(environment);
    } catch {
      blockers.push('PREINSTALLED_CYPRESS_REQUIRED');
    }
  }
  return { ...planned, blockers };
}

export const browserObservationSchema = z.strictObject({
  id: z.enum(browserCaseIds.filter((id) => id !== 'browser-cleanup')),
  executionId: z.uuid().optional(),
  attemptId: z.uuid().optional(),
  previousAttemptId: z.uuid().optional(),
  diagnosis: z.enum(['FAILED_TEST', 'SUCCESS']).optional(),
  clientRequests: z.number().int().min(0).max(240).optional(),
});
const reportSchema = z.strictObject({
  schemaVersion: z.literal(1),
  runId: z.uuid(),
  status: z.enum(['PASS', 'FAIL']),
  total: z.number().int(),
  passed: z.number().int(),
  failed: z.number().int(),
  pending: z.number().int(),
  skipped: z.number().int(),
  observations: z.array(browserObservationSchema).max(7),
  browser: z.string().max(40),
  browserVersion: z.string().max(40),
});

/** Pure final gate: an E2E pass alone never proves four remote cleanups. */
export function verifyBrowserEvidence(raw, runId, baseline, finalEvidence) {
  const report = reportSchema.parse(raw);
  const ids = report.observations.map((value) => value.id);
  if (
    report.runId !== runId ||
    report.status !== 'PASS' ||
    report.total !== 1 ||
    report.passed !== 1 ||
    report.failed + report.pending + report.skipped !== 0 ||
    new Set(ids).size !== 7 ||
    !browserCaseIds.slice(0, -1).every((id) => ids.includes(id))
  )
    throw new Error('BROWSER_EVIDENCE_INCOMPLETE');
  const executions = report.observations.flatMap((value) =>
    value.executionId ? [value.executionId] : [],
  );
  const attempts = report.observations.flatMap((value) =>
    value.attemptId ? [value.attemptId] : [],
  );
  const find = (id) => report.observations.find((value) => value.id === id);
  if (
    new Set(executions).size !== 4 ||
    executions.length !== 4 ||
    new Set(attempts).size !== 3 ||
    attempts.length !== 3 ||
    find('browser-run-failed').diagnosis !== 'FAILED_TEST' ||
    find('browser-submit-failed').diagnosis !== 'FAILED_TEST' ||
    find('browser-submit-success').diagnosis !== 'SUCCESS' ||
    find('browser-intentional-retry').diagnosis !== 'SUCCESS' ||
    find('browser-intentional-retry').previousAttemptId !==
      find('browser-submit-failed').attemptId
  )
    throw new Error('BROWSER_EXECUTION_COUNT');
  const previous = new Set(
    baseline.resources.map((value) => value.executionId),
  );
  const added = finalEvidence.resources.filter(
    (value) => !previous.has(value.executionId),
  );
  const normal = finalEvidence.normalRequests - baseline.normalRequests;
  const total = finalEvidence.totalRequests - baseline.totalRequests;
  if (
    finalEvidence.creations - baseline.creations !== 4 ||
    !Number.isSafeInteger(normal) ||
    normal < 0 ||
    normal > 320 ||
    !Number.isSafeInteger(total) ||
    total < normal ||
    total > 352 ||
    added.length !== 4 ||
    added.some(
      (value) =>
        !executions.includes(value.executionId) ||
        !value.providerResourceId ||
        value.creationState !== 'CONFIRMED' ||
        value.cleanupState !== 'VERIFIED' ||
        value.lifecycleStatus !== 'COMPLETED',
    ) ||
    new Set(added.map((value) => value.providerResourceId)).size !== 4 ||
    added.filter((value) => value.mode === 'RUN').length !== 1 ||
    added.filter((value) => value.mode === 'SUBMIT').length !== 3
  )
    throw new Error('DURABLE_BROWSER_SCOPE_MISMATCH');
  return [
    ...report.observations.map((value) => ({ ...value, status: 'PASS' })),
    { id: 'browser-cleanup', status: 'PASS', creations: 4, pending: 0 },
  ];
}

async function terminateBrowserTree(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    await new Promise((resolveTermination) => {
      const stop = spawn(
        'taskkill.exe',
        ['/PID', String(child.pid), '/T', '/F'],
        { windowsHide: true, stdio: 'ignore', timeout: 10000 },
      );
      stop.once('error', resolveTermination);
      stop.once('exit', resolveTermination);
    });
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      /* Already exited. */
    }
  }
}
async function runBrowser(
  stage,
  runId,
  reportPath,
  deadline,
  signal,
  sourceEnvironment,
  approvedReleaseId,
) {
  const environment = {};
  for (const key of [
    'PATH',
    'Path',
    'SystemRoot',
    'SYSTEMROOT',
    'COMSPEC',
    'TEMP',
    'TMP',
    'TMPDIR',
    'APPDATA',
    'LOCALAPPDATA',
    'USERPROFILE',
    'HOME',
    'DISPLAY',
    'XAUTHORITY',
    'DBUS_SESSION_BUS_ADDRESS',
    'CYPRESS_CACHE_FOLDER',
    'CYPRESS_RUN_BINARY',
  ])
    if (sourceEnvironment[key] !== undefined)
      environment[key] = sourceEnvironment[key];
  Object.assign(environment, {
    ALUNZA_SANDBOX_BROWSER_FIXTURES_FILE:
      sourceEnvironment.ALUNZA_SANDBOX_BROWSER_FIXTURES_FILE,
    ALUNZA_SANDBOX_BROWSER_STAGE: JSON.stringify(stage),
    ALUNZA_SANDBOX_BROWSER_RUN_ID: runId,
    ALUNZA_SANDBOX_BROWSER_REPORT: reportPath,
    ALUNZA_SANDBOX_BROWSER_DEADLINE: String(deadline),
    ALUNZA_SANDBOX_BROWSER_APPROVED_RELEASE_ID: approvedReleaseId,
    CYPRESS_CRASH_REPORTS: '0',
    CYPRESS_NO_COMMAND_LOG: '1',
  });
  return new Promise((resolveRun, reject) => {
    const child = spawn(
      process.execPath,
      [join(root, 'tests/remote-sandbox/run.mjs')],
      {
        cwd: root,
        env: environment,
        windowsHide: true,
        detached: process.platform !== 'win32',
        stdio: 'ignore',
      },
    );
    let terminating;
    const abort = () => {
      terminating ??= terminateBrowserTree(child);
    };
    const timer = setTimeout(abort, Math.max(1, deadline - Date.now()));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const clear = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    };
    child.once('error', () => {
      clear();
      reject(new Error('BROWSER_PROCESS_UNAVAILABLE'));
    });
    child.once('exit', async (code) => {
      clear();
      await terminating;
      resolveRun(code);
    });
  });
}

/** Browser traffic is real. Only sanitized observations and durable cleanup are reported. */
export async function executeBrowserStage(stage, context) {
  const sourceEnvironment = context.env ?? process.env;
  const planned = await preflightBrowserStage(stage, sourceEnvironment);
  if (planned.blockers.length)
    return { status: 'BLOCKED', cases: [], blockers: planned.blockers };
  const campaignId = z.uuid().parse(context.campaign.campaignId);
  const approvedReleaseId = context.campaign.candidate?.commit;
  if (!/^[a-f0-9]{40}$/.test(approvedReleaseId ?? ''))
    throw new Error('BROWSER_APPROVED_RELEASE_REQUIRED');
  const databaseUrl = databaseConfiguration(sourceEnvironment);
  const ca = await readFile(
    sourceEnvironment.ALUNZA_SANDBOX_API_DATABASE_CA_FILE,
    'utf8',
  );
  const pool = new pg.Pool({
    connectionString: databaseUrl.href,
    ssl: { ca, rejectUnauthorized: true, servername: databaseUrl.hostname },
    max: 1,
    connectionTimeoutMillis: 3000,
    statement_timeout: 3000,
  });
  pool.on('error', () => undefined);
  const deadline = Math.min(
    context.deadline ?? Infinity,
    Date.now() + planned.maxDurationSeconds * 1000,
    Date.parse(context.campaign.expiresAt),
  );
  const assertLive = () => {
    if (
      !Number.isFinite(deadline) ||
      Date.now() >= deadline ||
      context.signal?.aborted
    )
      throw new Error('CAMPAIGN_DEADLINE');
  };
  let observations = 0;
  const observe = async () => {
    assertLive();
    if (++observations > 100) throw new Error('OBSERVATION_BUDGET');
    const client = await pool.connect();
    try {
      await client.query('BEGIN READ ONLY');
      const role = await client.query(
        "SELECT current_user='alunza_app' AND NOT rolsuper AND NOT rolbypassrls AS allowed FROM pg_roles WHERE rolname=current_user",
      );
      if (!role.rows[0]?.allowed) throw new Error('LIMITED_ROLE_REQUIRED');
      await client.query(
        "SELECT set_config('app.actor_id','',true),set_config('app.session_id','',true),set_config('app.organization_id','',true)",
      );
      const { rows } = await client.query(
        'SELECT app_private.observe_sandbox_campaign($1::uuid) AS evidence',
        [campaignId],
      );
      await client.query('COMMIT');
      const evidence = rows[0]?.evidence;
      if (
        !evidence ||
        evidence.campaignId !== campaignId ||
        !Number.isSafeInteger(evidence.creations) ||
        !Array.isArray(evidence.resources)
      )
        throw new Error('CAMPAIGN_OBSERVATION_REQUIRED');
      return evidence;
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  };
  const cases = [];
  let finalEvidence,
    browserReport = null;
  try {
    const baseline = await observe();
    if (
      baseline.resources.some(
        (value) =>
          value.cleanupState !== 'VERIFIED' ||
          value.lifecycleStatus !== 'COMPLETED',
      )
    )
      throw new Error('UNRESOLVED_PREVIOUS_STAGE');
    const runId = randomUUID(),
      directory = join(root, '.local/reports/imp-03-07');
    await mkdir(directory, { recursive: true });
    const reportPath = join(directory, `browser-${runId}.json`);
    const exitCode = await runBrowser(
      stage,
      runId,
      reportPath,
      deadline,
      context.signal,
      sourceEnvironment,
      approvedReleaseId,
    );
    if ((await stat(reportPath)).size > 65536)
      throw new Error('BROWSER_REPORT_LIMIT');
    browserReport = reportSchema.parse(
      JSON.parse(await readFile(reportPath, 'utf8')),
    );
    if (
      browserReport.runId !== runId ||
      exitCode !== 0 ||
      browserReport.status !== 'PASS' ||
      browserReport.total !== 1 ||
      browserReport.passed !== 1 ||
      browserReport.failed + browserReport.pending + browserReport.skipped !== 0
    )
      throw new Error('BROWSER_VERTICAL_FAILED');
    while (true) {
      finalEvidence = await observe();
      if (
        finalEvidence.resources.every(
          (value) =>
            value.cleanupState === 'VERIFIED' &&
            value.lifecycleStatus === 'COMPLETED',
        )
      )
        break;
      await delay(2000, undefined, { signal: context.signal });
    }
    cases.push(
      ...verifyBrowserEvidence(browserReport, runId, baseline, finalEvidence),
    );
  } catch {
    cases.push({ id: 'browser-stage', status: 'FAIL' });
    finalEvidence = await observe().catch(() => null);
  } finally {
    await pool.end();
  }
  const result = {
    status: cases.some((value) => value.status === 'FAIL') ? 'FAIL' : 'PASS',
    cases,
    observations,
    clientRequests:
      browserReport?.observations.find(
        (value) => value.id === 'browser-hidden-redaction',
      )?.clientRequests ?? null,
    providerObserved: finalEvidence
      ? {
          creations: finalEvidence.creations,
          normalRequests: finalEvidence.normalRequests,
          totalRequests: finalEvidence.totalRequests,
          pending: finalEvidence.resources.filter(
            (value) => value.cleanupState !== 'VERIFIED',
          ).length,
        }
      : null,
  };
  await context.appendEvidence?.(result);
  return result;
}
