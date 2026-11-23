import { readFile } from 'node:fs/promises';
import { prepareApiInterruption } from './sandbox-aca-control.mjs';
import {
  planBrowserStage,
  preflightBrowserStage,
  executeBrowserStage,
} from './sandbox-browser-campaign.mjs';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import pg from 'pg';
import {
  runExecutionResponseSchema,
  attemptResponseSchema,
  activityProgressResponseSchema,
  attemptListResponseSchema,
} from '@alunza/contracts';

const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
const origin = z.url().refine((value) => {
  const url = new URL(value);
  return (
    url.protocol === 'https:' &&
    url.origin === value &&
    !url.username &&
    !url.password
  );
});
const azureSchema = z.strictObject({
  subscriptionId: z.uuid(),
  resourceGroup: identifier,
  appName: identifier,
  revision: identifier,
  replica: identifier,
  container: z.literal('api'),
});
const configSchema = z.strictObject({
  baseUrl: origin,
  fictitiousOnly: z.literal(true),
  azure: azureSchema.optional(),
  allowedOperations: z.array(z.enum(['azure:interrupt-api'])).default([]),
});
const fixtureSchema = z.strictObject({
  schemaVersion: z.literal(1),
  environment: z.literal('preproduction'),
  fictitiousOnly: z.literal(true),
  baseUrl: origin,
  actors: z
    .array(
      z.strictObject({ actorId: z.uuid(), accessToken: z.string().min(20) }),
    )
    .min(4)
    .max(8),
  activityId: z.uuid(),
  assignmentId: z.uuid(),
  exerciseVersionId: z.uuid(),
  successfulCode: z.string().min(1).max(65536),
  failingCode: z.string().min(1).max(65536),
  privateSentinels: z.array(z.string().min(8)).min(1).max(20),
});

export function planApiStage(stage) {
  if (stage.fixtures?.includes('browser-vertical'))
    return planBrowserStage(stage);
  const config = configSchema.safeParse(stage.config);
  const blockers = [];
  if (!config.success) blockers.push('API_STAGE_CONFIGURATION_REQUIRED');
  const kind = stage.kind;
  if (!['api', 'recovery', 'performance'].includes(kind))
    blockers.push('UNSUPPORTED_API_STAGE');
  if (
    kind !== 'api' &&
    config.success &&
    (!config.data.azure ||
      !config.data.allowedOperations.includes('azure:interrupt-api'))
  )
    blockers.push('EXACT_PREPRODUCTION_INTERRUPT_AUTHORIZATION_REQUIRED');
  const cases =
    kind === 'api'
      ? [
          'fixture-without-evidence',
          'run-success',
          'run-failed',
          'run-timeout',
          'submit-failed',
          'no-progress-from-run-or-failed-submit',
          'submit-success',
          'replay',
          'payload-conflict',
          'intentional-retry',
          'attempt-history',
          'foreign-attempt',
          'progress',
          'cleanup',
        ]
      : kind === 'recovery'
        ? ['run-api-interruption', 'submit-api-interruption', 'cleanup']
        : [
            'run-sequential-50',
            'run-concurrent-50',
            'submit-sequential-50',
            'submit-concurrent-50',
            'cleanup',
          ];
  const creations = kind === 'api' ? 6 : kind === 'recovery' ? 2 : 200;
  return {
    implemented: true,
    cases: cases.map((id) => ({ id })),
    creations,
    normalRequests: creations * 80,
    clientRequests: kind === 'api' ? 30 : kind === 'recovery' ? 50 : 450,
    maxDurationSeconds:
      kind === 'api' ? 600 : kind === 'recovery' ? 600 : 10800,
    blockers,
  };
}

const observationSchema = z.object({
  campaignId: z.uuid(),
  creations: z.number().int().nonnegative(),
  normalRequests: z.number().int().nonnegative(),
  totalRequests: z.number().int().nonnegative(),
  resources: z.array(
    z.object({
      executionId: z.uuid(),
      creationId: z.uuid(),
      sandboxName: z.string().min(1),
      providerResourceId: z.string().min(1).nullable(),
      creationState: z.enum(['PREPARED', 'UNKNOWN', 'CONFIRMED']),
      cleanupState: z.enum(['PENDING', 'VERIFIED']),
      lifecycleStatus: z.enum(['RUNNING', 'COMPLETED']),
      mode: z.enum(['RUN', 'SUBMIT']),
    }),
  ),
});

function checkObservation(raw, campaignId) {
  const value = observationSchema.parse(raw);
  if (
    value.campaignId !== campaignId ||
    value.totalRequests < value.normalRequests ||
    new Set(value.resources.map((resource) => resource.executionId)).size !==
      value.resources.length
  )
    throw new Error('DURABLE_API_OBSERVATION_INVALID');
  return value;
}

function stageBudget(stage, planned) {
  const total = Math.min(
    stage.maxRequests ?? Infinity,
    planned.normalRequests + 8 * planned.creations,
  );
  return {
    ...planned,
    normalRequests: Math.min(
      planned.normalRequests,
      total - 8 * planned.creations,
    ),
    totalRequests: total,
  };
}

function checkDelta(baseline, finalEvidence, budget) {
  const delta = {
    creations: finalEvidence.creations - baseline.creations,
    normalRequests: finalEvidence.normalRequests - baseline.normalRequests,
    totalRequests: finalEvidence.totalRequests - baseline.totalRequests,
  };
  if (
    delta.creations < 0 ||
    delta.creations > budget.creations ||
    delta.normalRequests < 0 ||
    delta.normalRequests > budget.normalRequests ||
    delta.totalRequests < delta.normalRequests ||
    delta.totalRequests > budget.totalRequests
  )
    throw new Error('DURABLE_API_STAGE_BUDGET');
  return delta;
}

/** A cumulative campaign count cannot substitute for these exact new executions. */
export function verifyApiStageEvidence(
  stage,
  rawBaseline,
  rawFinal,
  executions,
) {
  const planned = planApiStage(stage);
  const baseline = checkObservation(rawBaseline, rawBaseline.campaignId);
  const finalEvidence = checkObservation(rawFinal, baseline.campaignId);
  const delta = checkDelta(
    baseline,
    finalEvidence,
    stageBudget(stage, planned),
  );
  const previous = new Map(
    baseline.resources.map((value) => [value.executionId, value]),
  );
  const added = finalEvidence.resources.filter(
    (value) => !previous.has(value.executionId),
  );
  const observed = new Map(
    executions.map((value) => [value.executionId, value.mode]),
  );
  const previousSessions = new Set(
    baseline.resources.map((value) => value.providerResourceId).filter(Boolean),
  );
  if (
    delta.creations !== planned.creations ||
    executions.length !== planned.creations ||
    observed.size !== planned.creations ||
    added.length !== planned.creations ||
    finalEvidence.resources.length !==
      baseline.resources.length + planned.creations ||
    finalEvidence.resources.some(
      (value) =>
        value.cleanupState !== 'VERIFIED' ||
        value.lifecycleStatus !== 'COMPLETED',
    ) ||
    added.some(
      (value) =>
        observed.get(value.executionId) !== value.mode ||
        value.creationState !== 'CONFIRMED' ||
        !value.providerResourceId ||
        previousSessions.has(value.providerResourceId) ||
        value.sandboxName !== `alunza-practice-${value.executionId}`,
    ) ||
    new Set(added.map((value) => value.providerResourceId)).size !==
      planned.creations ||
    new Set(added.map((value) => value.creationId)).size !==
      planned.creations ||
    baseline.resources.some(
      (value) =>
        !finalEvidence.resources.some(
          (after) =>
            after.executionId === value.executionId &&
            after.creationId === value.creationId &&
            after.providerResourceId === value.providerResourceId,
        ),
    )
  )
    throw new Error('DURABLE_API_SCOPE_MISMATCH');
  return { ...delta, pending: 0 };
}

/** This fixture has one required exercise; no previous pass can hide a missing update. */
export function verifyApiProgress(raw, activityId, state) {
  const value = activityProgressResponseSchema.parse(raw).data;
  const completed = state === 'success' ? 1 : 0;
  if (
    value.activityId !== activityId ||
    value.required !== 1 ||
    value.completed !== completed ||
    value.ratio !== completed ||
    value.evidenceState !==
      (state === 'initial' ? 'NO_ATTEMPTS' : 'HAS_EVIDENCE')
  )
    throw new Error('API_PROGRESS_MISMATCH');
  return value;
}

class ApiTransportFailure extends Error {
  constructor() {
    super('API_TRANSPORT_INTERRUPTED');
  }
}

export async function preflightApiStage(stage, environment = process.env) {
  if (stage.fixtures?.includes('browser-vertical'))
    return preflightBrowserStage(stage, environment);
  const planned = planApiStage(stage);
  const blockers = [...planned.blockers];
  if (
    !environment.ALUNZA_SANDBOX_API_FIXTURES_FILE ||
    !environment.ALUNZA_SANDBOX_API_DATABASE_URL ||
    !environment.ALUNZA_SANDBOX_API_DATABASE_CA_FILE
  )
    blockers.push('PRIVATE_API_FIXTURES_AND_LIMITED_DATABASE_REQUIRED');
  if (!blockers.length) {
    try {
      await readPrivateConfiguration(stage, environment);
    } catch {
      blockers.push('INVALID_PRIVATE_API_CONFIGURATION');
    }
  }
  return { ...planned, blockers };
}

async function readPrivateConfiguration(stage, environment) {
  const config = configSchema.parse(stage.config);
  const bytes = await readFile(environment.ALUNZA_SANDBOX_API_FIXTURES_FILE);
  if (bytes.length > 262144) throw new Error('Fixture configuration too large');
  const fixture = fixtureSchema.parse(JSON.parse(bytes.toString('utf8')));
  if (
    fixture.baseUrl !== config.baseUrl ||
    new Set(fixture.actors.map((actor) => actor.actorId)).size !==
      fixture.actors.length
  )
    throw new Error('Fixture destination mismatch');
  const databaseUrl = new URL(environment.ALUNZA_SANDBOX_API_DATABASE_URL);
  if (
    !['postgres:', 'postgresql:'].includes(databaseUrl.protocol) ||
    !/^alunza_app(?:\.[a-z0-9]+)?$/.test(
      decodeURIComponent(databaseUrl.username),
    ) ||
    databaseUrl.search ||
    ['localhost', '127.0.0.1', '[::1]'].includes(databaseUrl.hostname)
  )
    throw new Error('Limited preproduction database required');
  const ca = await readFile(
    environment.ALUNZA_SANDBOX_API_DATABASE_CA_FILE,
    'utf8',
  );
  return { config, fixture, databaseUrl, ca };
}

/** All assertions use real API + durable metadata; outputs exclude code, tokens and bodies. */
export async function executeApiStage(stage, context) {
  if (stage.fixtures?.includes('browser-vertical'))
    return executeBrowserStage(stage, context);
  const environment = context.env ?? process.env;
  const planned = await preflightApiStage(stage, environment);
  if (planned.blockers.length)
    return { status: 'BLOCKED', cases: [], blockers: planned.blockers };
  const { config, fixture, databaseUrl, ca } = await readPrivateConfiguration(
    stage,
    environment,
  );
  const campaignId = context.campaign.campaignId;
  const pool = new pg.Pool({
    connectionString: databaseUrl.href,
    ssl: { ca, rejectUnauthorized: true, servername: databaseUrl.hostname },
    max: 1,
    connectionTimeoutMillis: 3000,
    statement_timeout: 3000,
  });
  pool.on('error', () => undefined);
  const cases = [];
  const samples = [];
  const executions = [];
  let baselineEvidence;
  const budget = stageBudget(stage, planned);
  const lastPost = new Map();
  let clientRequests = 0;
  let observations = 0;
  const deadline = Math.min(
    context.deadline ?? Infinity,
    Date.now() + planned.maxDurationSeconds * 1000,
    Date.parse(context.campaign.expiresAt),
  );
  const assertLive = () => {
    if (Date.now() >= deadline || context.signal?.aborted)
      throw new Error('CAMPAIGN_DEADLINE');
  };
  const wait = async (milliseconds) => {
    assertLive();
    await delay(
      Math.min(milliseconds, Math.max(1, deadline - Date.now())),
      undefined,
      { signal: context.signal },
    );
  };
  const observe = async () => {
    assertLive();
    if (++observations > 1500) throw new Error('OBSERVATION_BUDGET');
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
      const evidence = checkObservation(
        rows[0]?.evidence ?? {
          campaignId,
          creations: 0,
          normalRequests: 0,
          totalRequests: 0,
          resources: [],
        },
        campaignId,
      );
      if (baselineEvidence) checkDelta(baselineEvidence, evidence, budget);
      return evidence;
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  };
  const request = async (path, actorIndex = 0, body, key) => {
    assertLive();
    if (++clientRequests > planned.clientRequests)
      throw new Error('CLIENT_REQUEST_BUDGET');
    if (body) {
      // Stay below the normal ten requests/minute per actor, including replays.
      const elapsed = Date.now() - (lastPost.get(actorIndex) ?? 0);
      if (elapsed < 6100) await wait(6100 - elapsed);
      lastPost.set(actorIndex, Date.now());
    }
    const started = performance.now();
    const response = await fetch(`${config.baseUrl}${path}`, {
      method: body ? 'POST' : 'GET',
      redirect: 'error',
      headers: {
        authorization: `Bearer ${fixture.actors[actorIndex].accessToken}`,
        ...(body
          ? { 'content-type': 'application/json', 'idempotency-key': key }
          : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: context.signal
        ? AbortSignal.any([
            context.signal,
            AbortSignal.timeout(
              Math.min(45000, Math.max(1, deadline - Date.now())),
            ),
          ])
        : AbortSignal.timeout(
            Math.min(45000, Math.max(1, deadline - Date.now())),
          ),
    }).catch(() => {
      throw new ApiTransportFailure();
    });
    if (
      response.headers.get('x-release-id') !== context.campaign.candidate.commit
    )
      throw new Error('API_CANDIDATE_MISMATCH');
    const chunks = [];
    let bytes = 0;
    try {
      for await (const chunk of response.body ?? []) {
        bytes += chunk.length;
        if (bytes > 262144) throw new Error('RESPONSE_TOO_LARGE');
        chunks.push(chunk);
      }
    } catch (error) {
      if (error.message === 'RESPONSE_TOO_LARGE') throw error;
      throw new ApiTransportFailure();
    }
    const text = Buffer.concat(chunks).toString('utf8');
    if (fixture.privateSentinels.some((value) => text.includes(value)))
      throw new Error('PRIVATE_CONTENT_LEAK');
    return {
      status: response.status,
      body: JSON.parse(text),
      durationMs: performance.now() - started,
    };
  };
  const route = (mode) =>
    `/api/v1/activities/${fixture.activityId}/exercises/${fixture.assignmentId}/${mode === 'RUN' ? 'executions' : 'attempts'}`;
  const payload = (code) => ({
    code,
    exerciseVersionId: fixture.exerciseVersionId,
  });
  const parseResult = (mode, response) => {
    if (response.status !== 201) throw new Error('UNEXPECTED_HTTP_STATUS');
    return (
      mode === 'RUN' ? runExecutionResponseSchema : attemptResponseSchema
    ).parse(response.body).data;
  };
  const rememberExecution = (mode, result) => {
    if (executions.some((value) => value.executionId === result.executionId))
      throw new Error('DUPLICATE_EXECUTION');
    executions.push({ executionId: result.executionId, mode });
    return { executionId: result.executionId };
  };
  const history = async () => {
    const response = await request(route('SUBMIT'));
    if (response.status !== 200) throw new Error('UNEXPECTED_HTTP_STATUS');
    const value = attemptListResponseSchema.parse(response.body);
    if (value.page.hasMore || value.page.nextCursor !== null)
      throw new Error('UNEXPECTED_PREVIOUS_ATTEMPTS');
    return value.data;
  };
  const progress = async (state) => {
    const response = await request(
      `/api/v1/activities/${fixture.activityId}/progress`,
    );
    if (response.status !== 200) throw new Error('UNEXPECTED_HTTP_STATUS');
    return verifyApiProgress(response.body, fixture.activityId, state);
  };
  const runCase = async (id, action) => {
    try {
      const detail = await action();
      cases.push({ id, status: 'PASS', ...detail });
    } catch {
      cases.push({ id, status: 'FAIL' });
      throw new Error('API_CASE_FAILED');
    }
  };
  const waitCleanup = async () => {
    while (true) {
      const evidence = await observe();
      if (
        evidence.resources.every(
          (value) =>
            value.cleanupState === 'VERIFIED' &&
            value.lifecycleStatus === 'COMPLETED',
        )
      )
        return evidence;
      await wait(3000);
    }
  };
  let finalEvidence = null;
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
    baselineEvidence = baseline;
    if (stage.kind === 'api') {
      await runCase('fixture-without-evidence', async () => {
        await progress('initial');
        if ((await history()).length !== 0)
          throw new Error('UNEXPECTED_PREVIOUS_ATTEMPTS');
      });
      for (const [id, code, expected] of [
        ['run-success', fixture.successfulCode, 'SUCCESS'],
        ['run-failed', fixture.failingCode, 'FAILED_TEST'],
        ['run-timeout', 'module.exports.solve=()=>{while(true){}}', 'TIMEOUT'],
      ])
        await runCase(id, async () => {
          const result = parseResult(
            'RUN',
            await request(route('RUN'), 0, payload(code), randomUUID()),
          );
          if (result.technicalResult.diagnosisCode !== expected)
            throw new Error('DIAGNOSIS');
          return rememberExecution('RUN', result);
        });
      let failed;
      await runCase('submit-failed', async () => {
        failed = parseResult(
          'SUBMIT',
          await request(
            route('SUBMIT'),
            0,
            payload(fixture.failingCode),
            randomUUID(),
          ),
        );
        if (
          failed.technicalResult.diagnosisCode !== 'FAILED_TEST' ||
          failed.attemptNumber !== 1
        )
          throw new Error('DIAGNOSIS');
        return rememberExecution('SUBMIT', failed);
      });
      await runCase('no-progress-from-run-or-failed-submit', async () => {
        await progress('failed');
      });
      const key = randomUUID();
      const body = payload(fixture.successfulCode);
      let saved;
      await runCase('submit-success', async () => {
        saved = parseResult(
          'SUBMIT',
          await request(route('SUBMIT'), 0, body, key),
        );
        if (
          !saved.technicalResult.allRequiredPassed ||
          saved.attemptNumber !== 2
        )
          throw new Error('DIAGNOSIS');
        await progress('success');
        return rememberExecution('SUBMIT', saved);
      });
      await runCase('replay', async () => {
        const beforeReplay = await observe();
        const replay = parseResult(
          'SUBMIT',
          await request(route('SUBMIT'), 0, body, key),
        );
        if (
          JSON.stringify(replay) !== JSON.stringify(saved) ||
          (await observe()).creations !== beforeReplay.creations
        )
          throw new Error('REPLAY_CHANGED');
      });
      await runCase('payload-conflict', async () => {
        if (
          (await request(route('SUBMIT'), 0, payload(fixture.failingCode), key))
            .status !== 409
        )
          throw new Error('CONFLICT_REQUIRED');
      });
      let retried;
      await runCase('intentional-retry', async () => {
        retried = parseResult(
          'SUBMIT',
          await request(
            route('SUBMIT'),
            0,
            { ...body, previousAttemptId: saved.attemptId },
            randomUUID(),
          ),
        );
        if (
          retried.attemptId === saved.attemptId ||
          retried.previousAttemptId !== saved.attemptId ||
          retried.attemptNumber !== 3 ||
          !retried.technicalResult.allRequiredPassed
        )
          throw new Error('NEW_EVIDENCE_REQUIRED');
        return rememberExecution('SUBMIT', retried);
      });
      await runCase('attempt-history', async () => {
        const listed = await history();
        if (
          listed.length !== 3 ||
          [failed, saved, retried].some(
            (value) =>
              !listed.some(
                (entry) =>
                  entry.attemptId === value.attemptId &&
                  entry.executionId === value.executionId,
              ),
          )
        )
          throw new Error('HISTORY_CHANGED');
        for (const value of [failed, saved, retried]) {
          const response = await request(`/api/v1/attempts/${value.attemptId}`);
          if (response.status !== 200)
            throw new Error('UNEXPECTED_HTTP_STATUS');
          const detail = attemptResponseSchema.parse(response.body).data;
          if (JSON.stringify(detail) !== JSON.stringify(value))
            throw new Error('HISTORY_CHANGED');
        }
      });
      await runCase('foreign-attempt', async () => {
        if (
          ![403, 404].includes(
            (await request(`/api/v1/attempts/${saved.attemptId}`, 1)).status,
          )
        )
          throw new Error('FOREIGN_ATTEMPT');
      });
      await runCase('progress', async () => {
        await progress('success');
      });
    } else if (stage.kind === 'recovery') {
      for (const mode of ['RUN', 'SUBMIT'])
        await runCase(`${mode.toLowerCase()}-api-interruption`, async () => {
          const interrupt = await prepareApiInterruption(
            config.azure,
            context.signal,
            context.campaign.candidate,
          );
          const existing = new Set(
            (await observe()).resources.map((value) => value.executionId),
          );
          const body = payload('module.exports.solve=()=>{while(true){}}');
          const key = randomUUID();
          let requestSettled = false;
          const pending = request(route(mode), 0, body, key).then(
            (response) => {
              requestSettled = true;
              return { response };
            },
            (error) => {
              requestSettled = true;
              return { error };
            },
          );
          let interrupted;
          while (!interrupted) {
            if (requestSettled)
              throw new Error('INTERRUPTION_REQUEST_ALREADY_SETTLED');
            interrupted = (await observe()).resources.find(
              (value) =>
                !existing.has(value.executionId) &&
                value.creationState === 'CONFIRMED' &&
                value.lifecycleStatus === 'RUNNING' &&
                value.mode === mode,
            );
            if (!interrupted) await wait(200);
          }
          if (requestSettled)
            throw new Error('INTERRUPTION_REQUEST_ALREADY_SETTLED');
          await interrupt.interrupt();
          const restart = await interrupt.verifyRestart();
          const initial = await pending;
          // A normal 201 (including a pre-existing UNKNOWN) cannot prove that this
          // request lost its API process. Candidate/redaction failures are fatal.
          if (initial.error && !(initial.error instanceof ApiTransportFailure))
            throw initial.error;
          if (
            initial.response &&
            ![502, 503, 504].includes(initial.response.status)
          )
            throw new Error('INTERRUPTION_REQUEST_COMPLETED');
          const settled = await waitCleanup();
          const resource = settled.resources.find(
            (value) => value.executionId === interrupted.executionId,
          );
          if (!resource || resource.cleanupState !== 'VERIFIED')
            throw new Error('CLEANUP');
          const replay = parseResult(
            mode,
            await request(route(mode), 0, body, key),
          );
          if (
            replay.executionId !== interrupted.executionId ||
            replay.technicalResult.diagnosisCode !== 'UNKNOWN' ||
            replay.technicalResult.infrastructureStatus !== 'FAILED' ||
            replay.technicalResult.terminationReason !== 'RUNNER_FAILURE'
          )
            throw new Error('INTERRUPTION_NOT_PROVEN');
          const replayAgain = parseResult(
            mode,
            await request(route(mode), 0, body, key),
          );
          if (
            JSON.stringify(replayAgain) !== JSON.stringify(replay) ||
            (await observe()).creations !== settled.creations
          )
            throw new Error('RECOVERY_REPLAY_CHANGED');
          return {
            ...rememberExecution(mode, replay),
            restart,
            replayVerified: true,
          };
        });
    } else {
      for (const mode of ['RUN', 'SUBMIT'])
        for (const concurrency of [1, 4])
          await runCase(
            `${mode.toLowerCase()}-${concurrency === 1 ? 'sequential' : 'concurrent'}-50`,
            async () => {
              const interruption = await prepareApiInterruption(
                config.azure,
                context.signal,
                context.campaign.candidate,
              );
              await interruption.interrupt();
              const restart = await interruption.verifyRestart();
              // Readiness is read-only. It does not warm or create a student capsule.
              for (let attempt = 0; ; attempt++) {
                try {
                  if ((await request('/health/ready')).status === 200) break;
                } catch {
                  /* Restart may still be in progress. */
                }
                if (attempt >= 30) throw new Error('API_RESTART');
                await wait(2000);
              }
              const measured = [];
              for (let index = 0; index < 50; index += concurrency) {
                const batch = await Promise.all(
                  Array.from(
                    { length: Math.min(concurrency, 50 - index) },
                    async (_, offset) => {
                      const response = await request(
                        route(mode),
                        (index + offset) % 4,
                        payload(fixture.successfulCode),
                        randomUUID(),
                      );
                      const value = parseResult(mode, response);
                      if (value.technicalResult.diagnosisCode !== 'SUCCESS')
                        throw new Error('DIAGNOSIS');
                      rememberExecution(mode, value);
                      return {
                        executionId: value.executionId,
                        durationMs: response.durationMs,
                        temperature:
                          index === 0 ? 'first-api-batch' : 'warm-api',
                        capsule: 'new',
                      };
                    },
                  ),
                );
                measured.push(...batch);
              }
              samples.push({ mode, concurrency, restart, values: measured });
              const p95Ms = measured
                .map((value) => value.durationMs)
                .sort((a, b) => a - b)[47];
              if (p95Ms >= 5000) throw new Error('P95_TARGET');
              return { count: measured.length, p95Ms, restart };
            },
          );
    }
    await runCase('cleanup', async () => {
      finalEvidence = await waitCleanup();
      return verifyApiStageEvidence(
        stage,
        baselineEvidence,
        finalEvidence,
        executions,
      );
    });
  } catch {
    // Never turn a missing observation or a failed provider into a passing stage.
    if (!cases.some((value) => value.status === 'FAIL'))
      cases.push({ id: 'stage', status: 'FAIL' });
    finalEvidence = await observe().catch(() => null);
  } finally {
    await pool.end();
  }
  const result = {
    status: cases.some((value) => value.status === 'FAIL') ? 'FAIL' : 'PASS',
    cases,
    samples,
    clientRequests,
    observations,
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
