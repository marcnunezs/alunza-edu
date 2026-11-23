// Real HTTP only. Provisioning, candidate gates and final resource audits belong
// to the operator. Importing this module never starts services or sends traffic.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { isDeepStrictEqual } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import {
  attemptResponseSchema,
  errorResponseSchema,
  runExecutionResponseSchema,
} from '@alunza/contracts';
import testState from '../laboratory-test-state.cjs';
import {
  activities,
  additionalStudents,
  classes,
  exercises,
} from '../../fixtures/demo/academic.mjs';

const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hash = (value) => createHash('sha256').update(value).digest('hex');
const profiles = [
  'RUN-sequential',
  'SUBMIT-sequential',
  'RUN-concurrent',
  'SUBMIT-concurrent',
];
const maximumBodyBytes = 512 * 1024;

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

export function assertLocalApiUrl(baseUrl) {
  const target = new URL(baseUrl);
  requireCondition(
    target.origin === 'http://127.0.0.1:4300' &&
      target.pathname === '/' &&
      !target.username &&
      !target.password &&
      !target.search &&
      !target.hash,
    'The campaign requires the isolated LAB TEST API on 127.0.0.1:4300.',
  );
  return target.origin;
}

/** Log in to existing fictitious accounts; does not seed or change any quota. */
export async function loginCanonicalActors(state) {
  testState.assertLaboratoryTestState(state);
  const identity = JSON.parse(
    await readFile(
      new URL('../../fixtures/foundation/identity.json', import.meta.url),
      'utf8',
    ),
  );
  const users = [
    ...identity.users.filter((user) => user.role === 'STUDENT'),
    ...additionalStudents,
  ];
  const actors = [];
  for (const user of users) {
    const auth = createClient(state.authUrl, state.publishableKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    const login = await auth.auth.signInWithPassword({
      email: user.email,
      password: state.fixturePassword,
    });
    requireCondition(
      !login.error && login.data.session,
      'Unable to authenticate a fictitious campaign student.',
    );
    const classroom = classes.find((item) => item.studentIds.includes(user.id));
    const activity = activities.find(
      (item) => item.classId === classroom.id && item.state === 'PUBLISHED',
    );
    const assignment = activity.exercises[0];
    const exercise = exercises.find(
      (item) => item.versionId === assignment.exerciseVersionId,
    );
    requireCondition(
      exercise.tests.length === 2 &&
        exercise.tests.filter((item) => item.visibility === 'visible')
          .length === 1,
      'The campaign requires one visible and one hidden case.',
    );
    actors.push({
      id: user.id,
      organizationId: user.organizationId,
      classId: classroom.id,
      token: login.data.session.access_token,
      fixture: {
        activityId: activity.id,
        assignmentId: assignment.id,
        exerciseVersionId: exercise.versionId,
        successCode: exercise.referenceSolution,
        incorrectCode: exercise.incorrectSolution,
        visibleTestIds: exercise.tests
          .filter((item) => item.visibility === 'visible')
          .map((item) => item.id),
        hiddenTestIds: exercise.tests
          .filter((item) => item.visibility === 'hidden')
          .map((item) => item.id),
      },
    });
  }
  return actors;
}

export function describeDurations(values) {
  requireCondition(
    values.every((value) => Number.isFinite(value) && value >= 0),
    'Invalid duration evidence.',
  );
  if (values.length === 0)
    return { n: 0, p50Ms: null, p95Ms: null, maxMs: null };
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return {
    n: sorted.length,
    p50Ms:
      sorted.length % 2
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2,
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
    maxMs: sorted.at(-1),
  };
}

export function summarizeHttpProfile(rows) {
  const timings = describeDurations(rows.map((row) => row.durationMs));
  const failures = rows.filter((row) => !row.pass);
  const successes = rows.filter((row) => row.pass);
  return {
    ...timings,
    errors: failures.length,
    succeededUnder5Seconds: successes.filter((row) => row.durationMs < 5000)
      .length,
    // Timed-out and rejected requests remain in the primary distribution. Their
    // durations describe observed HTTP outcomes, never successful completion.
    successfulRequests: describeDurations(
      successes.map((row) => row.durationMs),
    ),
    failures: failures.map((row) => ({
      sequence: row.sequence,
      status: row.status,
      failureCodes: row.failureCodes,
    })),
    strictTargetMet:
      rows.length === 50 && failures.length === 0 && timings.p95Ms < 5000,
    scheduledImmediate: rows.filter((row) => row.scheduledPauseMs === 0).length,
    scheduledSixSecondPause: rows.filter((row) => row.scheduledPauseMs === 6000)
      .length,
    clientQuotaWait: describeDurations(
      rows.map((row) => row.clientQuotaWaitMs),
    ),
    firstRequest: rows[0]
      ? {
          sequence: rows[0].sequence,
          durationMs: rows[0].durationMs,
          pass: rows[0].pass,
        }
      : null,
    withoutFirstRequest: describeDurations(
      rows.slice(1).map((row) => row.durationMs),
    ),
    cacheState:
      'Not inferred from arrival delay; consult durable pair timestamps.',
  };
}

function validateActors(actors) {
  requireCondition(
    actors.length === 8 && new Set(actors.map((actor) => actor.id)).size === 8,
    'Eight distinct fictitious students are required.',
  );
  for (const actor of actors) {
    requireCondition(
      [
        actor.id,
        actor.organizationId,
        actor.classId,
        actor.fixture?.activityId,
        actor.fixture?.assignmentId,
        actor.fixture?.exerciseVersionId,
      ].every((value) => uuid.test(value)) &&
        typeof actor.token === 'string' &&
        actor.token.length > 20 &&
        typeof actor.fixture.successCode === 'string' &&
        typeof actor.fixture.incorrectCode === 'string' &&
        actor.fixture.visibleTestIds?.length === 1 &&
        actor.fixture.hiddenTestIds?.length === 1,
      'Incomplete fictitious actor or two-case fixture.',
    );
  }
  const organizations = [
    ...new Set(actors.map((actor) => actor.organizationId)),
  ];
  requireCondition(
    organizations.length === 2 &&
      organizations.every(
        (id) =>
          actors.filter((actor) => actor.organizationId === id).length === 4,
      ),
    'The canonical campaign requires two organizations with four students each.',
  );
  requireCondition(
    actors.some((actor) =>
      actors.some(
        (other) =>
          actor.organizationId === other.organizationId &&
          actor.classId !== other.classId,
      ),
    ),
    'A same-organization different-class negative is required.',
  );
}

/** Only these operational fields may leave the observer; never bodies or SQL. */
export function validateLedgerObservation(observation, requests) {
  requireCondition(
    observation &&
      Object.keys(observation).length === 1 &&
      Array.isArray(observation.executions),
    'Invalid ledger observation envelope.',
  );
  const expected = new Set(
    requests.map((row) => row.executionId).filter(Boolean),
  );
  const seen = new Set();
  const pairs = new Set();
  const fields = [
    'executionId',
    'pairId',
    'pairCreatedAt',
    'pairReadyAt',
    'pairAssignedAt',
    'executionAdmittedAt',
    'executionFinishedAt',
  ];
  const rows = observation.executions.map((row) => {
    requireCondition(
      Object.keys(row).length === fields.length &&
        fields.every((field) => field in row) &&
        expected.has(row.executionId) &&
        !seen.has(row.executionId),
      'Unexpected, duplicate or incomplete execution ledger evidence.',
    );
    seen.add(row.executionId);
    const timestamps = fields
      .slice(2)
      .map((field) => (row[field] === null ? null : Date.parse(row[field])));
    requireCondition(
      timestamps.every((value) => value === null || Number.isFinite(value)),
      'Invalid ledger timestamp.',
    );
    requireCondition(
      row.pairId === null || (uuid.test(row.pairId) && !pairs.has(row.pairId)),
      'An execution pair was reused or malformed.',
    );
    if (row.pairId) pairs.add(row.pairId);
    const [created, ready, assigned, admitted, finished] = timestamps;
    requireCondition(
      admitted !== null &&
        (finished === null || finished >= admitted) &&
        (row.pairId === null
          ? created === null && ready === null && assigned === null
          : created !== null &&
            ready !== null &&
            assigned !== null &&
            created <= ready &&
            ready <= assigned &&
            admitted <= assigned &&
            (finished === null || assigned <= finished)),
      'Inconsistent durable lifecycle timestamps.',
    );
    return {
      ...row,
      preparationMs: ready === null ? null : ready - created,
      admissionToAssignmentMs: assigned === null ? null : assigned - admitted,
      assignedToFinishedMs:
        assigned === null || finished === null ? null : finished - assigned,
      preparedBeforeAdmission: ready === null ? null : ready <= admitted,
    };
  });
  requireCondition(
    seen.size === expected.size,
    'Missing execution ledger evidence.',
  );
  return rows;
}

export function auditLedgerOrdering(rows) {
  const paired = rows.filter((row) => row.pairId !== null);
  const pairsUnique =
    new Set(paired.map((row) => row.pairId)).size === paired.length;
  const executionsUnique =
    new Set(rows.map((row) => row.executionId)).size === rows.length;
  const ordered = [...paired].sort(
    (a, b) => Date.parse(a.pairAssignedAt) - Date.parse(b.pairAssignedAt),
  );
  const overlaps = [];
  for (let index = 1; index < ordered.length; index++) {
    const previous = ordered[index - 1],
      current = ordered[index];
    if (previous.executionFinishedAt === null) {
      overlaps.push({
        previous: previous.executionId,
        current: current.executionId,
        reason: 'PREVIOUS_NOT_FINISHED',
      });
      continue;
    }
    const finished = Date.parse(previous.executionFinishedAt);
    if (Date.parse(current.pairCreatedAt) < finished)
      overlaps.push({
        previous: previous.executionId,
        current: current.executionId,
        reason: 'PREPARATION_BEFORE_FINISH',
      });
    if (Date.parse(current.pairAssignedAt) < finished)
      overlaps.push({
        previous: previous.executionId,
        current: current.executionId,
        reason: 'SERVICES_OVERLAP',
      });
  }
  return {
    executions: rows.length,
    paired: paired.length,
    pairsUnique,
    executionsUnique,
    overlaps,
    pass: pairsUnique && executionsUnique && overlaps.length === 0,
    limitation:
      'Durable server timestamps establish ordering relative to finalization, not the exact client receipt or response-finish event.',
  };
}

/**
 * observer({profile, executions}) runs after HTTP traffic for that profile and
 * returns {executions:[{executionId,pairId,pairCreatedAt,pairReadyAt,
 * pairAssignedAt,executionAdmittedAt,executionFinishedAt}]}. It must be read-only.
 * Optional beforeProfile(profile) belongs to the operator (for example, draining
 * and restarting the isolated API). It runs after smoke/previous ledger capture,
 * outside request timing. Its return value is never persisted.
 * Tokens, payloads and fixture source stay in memory; raw files hold metadata.
 * The output directory must be new. No automatic retry replaces a failed sample.
 */
export async function runDockerRuntimeApiCampaign({
  baseUrl,
  actors,
  outputDir,
  observer,
  beforeProfile,
  profileNames = profiles,
}) {
  const origin = assertLocalApiUrl(baseUrl);
  validateActors(actors);
  requireCondition(
    profileNames.length > 0 &&
      new Set(profileNames).size === profileNames.length &&
      profileNames.every((name) => profiles.includes(name)),
    'Unknown or duplicate campaign profile.',
  );
  requireCondition(
    typeof observer === 'function',
    'A read-only durable ledger observer is required.',
  );
  requireCondition(
    beforeProfile === undefined || typeof beforeProfile === 'function',
    'The optional profile setup must be a callback.',
  );
  await mkdir(outputDir, { recursive: true });
  const protocol = {
    schemaVersion: 1,
    campaignId: randomUUID(),
    startedAt: new Date().toISOString(),
    apiOrigin: origin,
    profileNames,
    requestsPerProfile: 50,
    concurrency: 4,
    actorRequestsPerMinute: 10,
    timeoutMs: 45000,
    maximumBodyBytes,
    targetMs: 5000,
    percentile: 'nearest-rank ceil(0.95*n)',
    measurement:
      'Fetch dispatch through final response body byte; JSON validation and evidence writes excluded.',
    sequentialSchedule:
      '25 immediate and 25 pauses of 6000ms after the preceding response; extra client quota wait recorded separately.',
    concurrentSchedule:
      'Groups of four distinct students from one organization; organizations alternate; last group has two.',
    replenishment:
      'Candidate API is responsible for replenishment after audited cleanup and HTTP finish.',
    startup: beforeProfile
      ? 'Operator setup before each profile is outside HTTP timing; first request retained. API restart evidence belongs to the operator; no cold DB or engine claim.'
      : 'First request retained; no asserted cold or hot classification.',
    excludedEvidence: [
      'credentials',
      'code',
      'response bodies',
      'hidden test content',
    ],
    actors: actors.map(({ id, organizationId, classId, fixture }) => ({
      id,
      organizationId,
      classId,
      activityId: fixture.activityId,
      assignmentId: fixture.assignmentId,
      exerciseVersionId: fixture.exerciseVersionId,
    })),
  };
  await writeFile(
    join(outputDir, 'protocol.json'),
    JSON.stringify(protocol, null, 2) + '\n',
    { flag: 'wx' },
  );
  const raw = await open(join(outputDir, 'requests.jsonl'), 'wx');
  const rows = [];
  const ledger = [];
  const profileSetups = [];
  const executionKeys = new Map();
  const attemptKeys = new Map();
  let sequence = 0,
    active = 0,
    writeQueue = Promise.resolve();
  const histories = new Map(actors.map((actor) => [actor.id, []]));
  const organizations = [
    ...new Set(actors.map((actor) => actor.organizationId)),
  ];
  let actorCursor = 0;
  const nextActor = () => actors[actorCursor++ % actors.length];
  const route = (fixture, mode) =>
    `/api/v1/activities/${fixture.activityId}/exercises/${fixture.assignmentId}/${mode === 'RUN' ? 'executions' : 'attempts'}`;
  async function quota(actor) {
    const started = performance.now();
    const history = histories.get(actor.id);
    let waited = false;
    while (true) {
      const now = performance.now();
      while (history.length && history[0] <= now - 60000) history.shift();
      if (history.length < 10) {
        history.push(now);
        return waited ? performance.now() - started : 0;
      }
      waited = true;
      await sleep(Math.max(1, history[0] + 60050 - now));
    }
  }
  async function request({
    actor,
    mode,
    profile,
    label,
    code = actor.fixture.successCode,
    fixture = actor.fixture,
    key = randomUUID(),
    method = 'POST',
    path = route(fixture, mode),
    expectedStatus = 201,
    expectedDiagnosis = 'SUCCESS',
    expectedReason,
    expectedError,
    expectedData,
    scheduledPauseMs = 0,
    priorResponseEndedAt = null,
    forbiddenMarkers = [],
  }) {
    const body =
      method === 'POST'
        ? JSON.stringify({ code, exerciseVersionId: fixture.exerciseVersionId })
        : undefined;
    const clientQuotaWaitMs = method === 'POST' ? await quota(actor) : 0;
    const row = {
      sequence: ++sequence,
      profile,
      label,
      mode,
      method,
      actorId: actor.id,
      organizationId: actor.organizationId,
      requestKey: method === 'POST' ? key : null,
      requestPayloadSha256: body ? hash(body) : null,
      scheduledPauseMs,
      clientQuotaWaitMs,
      httpStartedAt: new Date().toISOString(),
      actualGapAfterPreviousResponseMs:
        priorResponseEndedAt === null
          ? null
          : performance.now() - priorResponseEndedAt,
      inFlightAtDispatch: ++active,
      status: null,
      bytes: 0,
      responseSha256: null,
      responseComplete: false,
      requestId: null,
      executionId: null,
      attemptId: null,
      diagnosisCode: null,
      terminationReason: null,
      infrastructureStatus: null,
      runtimeMs: null,
      lifecycleMs: null,
      errorCode: null,
      failureCodes: [],
    };
    let payload, endedAt;
    const started = performance.now();
    try {
      const response = await fetch(origin + path, {
        method,
        headers: {
          Authorization: `Bearer ${actor.token}`,
          ...(body
            ? { 'Content-Type': 'application/json', 'Idempotency-Key': key }
            : {}),
        },
        ...(body ? { body } : {}),
        signal: AbortSignal.timeout(45000),
        redirect: 'manual',
      });
      row.status = response.status;
      const chunks = [];
      for await (const chunk of response.body) {
        row.bytes += chunk.length;
        if (row.bytes > maximumBodyBytes) throw new Error('RESPONSE_LIMIT');
        chunks.push(chunk);
      }
      endedAt = performance.now();
      row.responseComplete = true;
      row.httpFinishedAt = new Date().toISOString();
      const buffer = Buffer.concat(chunks);
      row.responseSha256 = hash(buffer);
      if (!response.headers.get('cache-control')?.includes('no-store'))
        row.failureCodes.push('CACHE_CONTROL');
      if (response.status !== expectedStatus)
        row.failureCodes.push('HTTP_STATUS');
      try {
        payload = JSON.parse(buffer.toString('utf8'));
      } catch {
        row.failureCodes.push('INVALID_JSON');
      }
      const schema = response.ok
        ? mode === 'RUN'
          ? runExecutionResponseSchema
          : attemptResponseSchema
        : errorResponseSchema;
      const parsed = schema.safeParse(payload);
      if (!parsed.success) row.failureCodes.push('PUBLIC_SCHEMA');
      else {
        row.requestId = parsed.data.requestId;
        if (response.ok) {
          const data = parsed.data.data;
          const result = data.technicalResult;
          Object.assign(row, {
            executionId: data.executionId,
            attemptId: data.attemptId ?? null,
            diagnosisCode: result.diagnosisCode,
            terminationReason: result.terminationReason,
            infrastructureStatus: result.infrastructureStatus,
            runtimeMs: result.runtimeMs,
            lifecycleMs: result.lifecycleMs,
          });
          if (method === 'POST') {
            for (const [identity, seen] of [
              [data.executionId, executionKeys],
              [data.attemptId, attemptKeys],
            ]) {
              if (!identity) continue;
              if (seen.has(identity) && seen.get(identity) !== key)
                row.failureCodes.push('EXECUTION_OR_ATTEMPT_REUSED');
              seen.set(identity, key);
            }
          }
          if (
            data.exerciseVersionId !== fixture.exerciseVersionId ||
            result.visibleTotal !== 1 ||
            result.visibleTestResults.some(
              (item) => !fixture.visibleTestIds.includes(item.id),
            )
          )
            row.failureCodes.push('FIXTURE_IDENTITY');
          if (result.diagnosisCode !== expectedDiagnosis)
            row.failureCodes.push('DIAGNOSIS');
          if (result.infrastructureStatus !== 'OK')
            row.failureCodes.push('INFRASTRUCTURE');
          if (
            mode === 'SUBMIT' &&
            expectedDiagnosis === 'SUCCESS' &&
            result.hiddenChecksPassed !== true
          )
            row.failureCodes.push('HIDDEN_CHECK_NOT_CONFIRMED');
          if (expectedReason && result.terminationReason !== expectedReason)
            row.failureCodes.push('TERMINATION_REASON');
          if (
            mode === 'SUBMIT' &&
            (data.code !== code ||
              data.activityId !== fixture.activityId ||
              data.assignmentId !== fixture.assignmentId)
          )
            row.failureCodes.push('ATTEMPT_IDENTITY');
          if (expectedData && !isDeepStrictEqual(data, expectedData))
            row.failureCodes.push('REPLAY_DIFFERENCE');
          const visibleProjection = JSON.stringify({
            ...data,
            code: undefined,
          });
          if (
            [...fixture.hiddenTestIds, ...forbiddenMarkers].some((marker) =>
              visibleProjection.includes(marker),
            )
          )
            row.failureCodes.push('HIDDEN_DISCLOSURE');
        } else {
          row.errorCode = parsed.data.error.code;
          if (expectedError && row.errorCode !== expectedError)
            row.failureCodes.push('ERROR_CODE');
        }
      }
    } catch (error) {
      // Never serialize an exception, request, response or SDK error object.
      row.failureCodes.push(
        error?.message === 'RESPONSE_LIMIT'
          ? 'RESPONSE_LIMIT'
          : ['TimeoutError', 'AbortError'].includes(error?.name)
            ? 'HTTP_TIMEOUT'
            : 'TRANSPORT_FAILURE',
      );
    } finally {
      endedAt ??= performance.now();
      row.httpFinishedAt ??= new Date().toISOString();
      row.durationMs = endedAt - started;
      row.pass = row.failureCodes.length === 0;
      active--;
      rows.push(row);
      writeQueue = writeQueue.then(async () => {
        await raw.write(JSON.stringify(row) + '\n');
        await raw.sync();
      });
      await writeQueue;
    }
    return { row, payload, endedAt, key };
  }

  async function observe(profile) {
    const selected = rows.filter(
      (row) => row.profile === profile && row.executionId,
    );
    const identities = new Map();
    for (const row of selected)
      if (!identities.has(row.executionId))
        identities.set(row.executionId, row);
    const unique = [...identities.values()];
    const observations = validateLedgerObservation(
      await observer({
        profile,
        executions: unique.map((row) => ({
          executionId: row.executionId,
          requestSequence: row.sequence,
          mode: row.mode,
          actorId: row.actorId,
          httpStartedAt: row.httpStartedAt,
          httpFinishedAt: row.httpFinishedAt,
        })),
      }),
      unique,
    );
    ledger.push(...observations.map((row) => ({ profile, ...row })));
    await writeFile(
      join(outputDir, `${profile}-ledger.json`),
      JSON.stringify(observations, null, 2) + '\n',
      { flag: 'wx' },
    );
  }

  let stoppedReason = null;
  try {
    for (const mode of ['RUN', 'SUBMIT']) {
      const actor = nextActor();
      const first = await request({
        actor,
        mode,
        profile: 'smoke',
        label: `${mode}-success`,
      });
      requireCondition(first.row.pass, 'SMOKE_FAILED');
      await request({
        actor,
        mode,
        profile: 'smoke',
        label: `${mode}-replay`,
        key: first.key,
        expectedData: first.payload.data,
      });
      await request({
        actor,
        mode,
        profile: 'smoke',
        label: `${mode}-conflict`,
        key: first.key,
        code: actor.fixture.incorrectCode,
        expectedStatus: 409,
        expectedError: 'IDEMPOTENCY_CONFLICT',
      });
      if (mode === 'SUBMIT') {
        await request({
          actor,
          mode,
          profile: 'smoke',
          label: 'SUBMIT-read-attempt',
          method: 'GET',
          path: `/api/v1/attempts/${first.row.attemptId}`,
          expectedStatus: 200,
          expectedData: first.payload.data,
        });
        const outsider = actors.find(
          (other) => other.organizationId !== actor.organizationId,
        );
        await request({
          actor: outsider,
          mode,
          profile: 'smoke',
          label: 'SUBMIT-read-forbidden',
          method: 'GET',
          path: `/api/v1/attempts/${first.row.attemptId}`,
          expectedStatus: 404,
          expectedError: 'RESOURCE_NOT_FOUND',
        });
      }
      const diagnoses = [
        ['SYNTAX_ERROR', 'module.exports.solve=;', 'STUDENT_SYNTAX'],
        [
          'RUNTIME_ERROR',
          'module.exports.solve=()=>{throw new Error("fixture");};',
          'STUDENT_EXCEPTION',
        ],
        ['FAILED_TEST', actor.fixture.incorrectCode, 'ASSERTION_FAILED'],
        [
          'TIMEOUT',
          'module.exports.solve=()=>{while(true){}};',
          'EXECUTION_DEADLINE',
        ],
        [
          'UNKNOWN',
          'module.exports.solve=()=>"x".repeat(65536);',
          'RETURN_LIMIT',
        ],
      ];
      for (const [expectedDiagnosis, code, expectedReason] of diagnoses)
        await request({
          actor: nextActor(),
          mode,
          profile: 'smoke',
          label: `${mode}-${expectedDiagnosis}`,
          code,
          expectedDiagnosis,
          expectedReason,
        });
      const sameOrg = actors.find((item) =>
        actors.some(
          (other) =>
            other.organizationId === item.organizationId &&
            other.classId !== item.classId,
        ),
      );
      for (const [label, outsider] of [
        [
          'class',
          actors.find(
            (other) =>
              other.organizationId === sameOrg.organizationId &&
              other.classId !== sameOrg.classId,
          ),
        ],
        [
          'organization',
          actors.find(
            (other) => other.organizationId !== sameOrg.organizationId,
          ),
        ],
      ])
        await request({
          actor: sameOrg,
          mode,
          profile: 'smoke',
          label: `${mode}-forbidden-${label}`,
          fixture: outsider.fixture,
          expectedStatus: 404,
          expectedError: 'RESOURCE_NOT_FOUND',
        });
    }
    const marker = `ALUNZA_HIDDEN_${randomUUID().replaceAll('-', '')}`;
    const actor = nextActor();
    await request({
      actor,
      mode: 'SUBMIT',
      profile: 'smoke',
      label: 'SUBMIT-hidden-console',
      code: `module.exports.solve=(a,b)=>{if(a<0)console.log("${marker}");return a+b;};`,
      forbiddenMarkers: [marker],
    });
    await observe('smoke');
    requireCondition(
      rows.every((row) => row.pass),
      'SMOKE_FAILED',
    );

    for (const profile of profileNames) {
      if (beforeProfile) {
        const started = performance.now();
        const setup = {
          profile,
          startedAt: new Date().toISOString(),
          completed: false,
        };
        try {
          await beforeProfile(profile);
          setup.completed = true;
        } finally {
          setup.finishedAt = new Date().toISOString();
          setup.durationMs = performance.now() - started;
          profileSetups.push(setup);
          await writeFile(
            join(outputDir, `${profile}-setup.json`),
            JSON.stringify(setup, null, 2) + '\n',
            { flag: 'wx' },
          );
        }
      }
      const [mode, schedule] = profile.split('-');
      if (schedule === 'sequential') {
        let previous = null;
        for (let index = 0; index < 50; index++) {
          const scheduledPauseMs = index % 2 ? 6000 : 0;
          if (scheduledPauseMs) await sleep(scheduledPauseMs);
          previous = await request({
            actor: nextActor(),
            mode,
            profile,
            label: `sample-${index + 1}`,
            scheduledPauseMs,
            priorResponseEndedAt: previous?.endedAt ?? null,
          });
        }
      } else {
        for (let offset = 0; offset < 50; offset += 4) {
          const group = actors.filter(
            (actor) =>
              actor.organizationId ===
              organizations[(offset / 4) % organizations.length],
          );
          await Promise.all(
            group.slice(0, Math.min(4, 50 - offset)).map((actor, index) =>
              request({
                actor,
                mode,
                profile,
                label: `sample-${offset + index + 1}`,
              }),
            ),
          );
        }
      }
      await observe(profile);
    }
  } catch (error) {
    stoppedReason =
      error?.message === 'SMOKE_FAILED'
        ? 'SMOKE_FAILED'
        : 'CAMPAIGN_OR_OBSERVER_FAILURE';
  } finally {
    await writeQueue;
    await raw.close();
  }
  const ledgerOrdering = auditLedgerOrdering(ledger);
  const summary = {
    schemaVersion: 1,
    campaignId: protocol.campaignId,
    finishedAt: new Date().toISOString(),
    stoppedReason,
    profileSetups,
    smoke: {
      requests: rows.filter((row) => row.profile === 'smoke').length,
      pass:
        rows.filter((row) => row.profile === 'smoke').length === 23 &&
        rows
          .filter((row) => row.profile === 'smoke')
          .every((row) => row.pass) &&
        stoppedReason !== 'SMOKE_FAILED',
    },
    profiles: Object.fromEntries(
      profileNames.map((profile) => [
        profile,
        summarizeHttpProfile(
          rows
            .filter((row) => row.profile === profile)
            .sort((a, b) => a.sequence - b.sequence),
        ),
      ]),
    ),
    ledger: Object.fromEntries(
      profileNames.map((profile) => {
        const selected = ledger.filter((row) => row.profile === profile);
        return [
          profile,
          {
            executions: selected.length,
            preparedBeforeAdmission: selected.filter(
              (row) => row.preparedBeforeAdmission === true,
            ).length,
            preparedAfterAdmission: selected.filter(
              (row) => row.preparedBeforeAdmission === false,
            ).length,
            preparation: describeDurations(
              selected
                .map((row) => row.preparationMs)
                .filter((value) => value !== null),
            ),
            admissionToAssignment: describeDurations(
              selected
                .map((row) => row.admissionToAssignmentMs)
                .filter((value) => value !== null),
            ),
            assignedToFinished: describeDurations(
              selected
                .map((row) => row.assignedToFinishedMs)
                .filter((value) => value !== null),
            ),
            note: 'Preparation can overlap request waiting; these are not disjoint summable HTTP stages. Service includes execution, cleanup and persistence.',
          },
        ];
      }),
    ),
    allRequestsRetained: rows.length,
    ledgerOrdering,
    requestsFailed: rows.filter((row) => !row.pass).length,
    complete:
      !stoppedReason &&
      profileNames.every(
        (profile) =>
          rows.filter((row) => row.profile === profile).length === 50,
      ),
    pass:
      !stoppedReason &&
      ledgerOrdering.pass &&
      rows.every((row) => row.pass) &&
      profileNames.every(
        (profile) =>
          rows.filter((row) => row.profile === profile).length === 50,
      ),
  };
  await writeFile(
    join(outputDir, 'summary.json'),
    JSON.stringify(summary, null, 2) + '\n',
    { flag: 'wx' },
  );
  return summary;
}
