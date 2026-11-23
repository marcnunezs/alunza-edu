// Operator-only bridge for the physical HELP TEST campaign. Import is inert.
import { createServer } from 'node:http';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  readFile,
  mkdir,
  appendFile,
  writeFile,
  rename,
} from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import {
  helpFeedbackResponseSchema,
  helpRequestResponseSchema,
  helpHistoryResponseSchema,
  helpReferenceResponseSchema,
} from '@alunza/contracts';
import { additionalStudents } from '../fixtures/demo/academic.mjs';
import {
  loginLinuxVmActors,
  validateHttpPayload,
  assertDurable,
  canonicalHash,
} from '../tests/integration/linux-vm-api.mjs';
import {
  createLinuxVmObserver,
  readLinuxVmSnapshot,
  validateBrokerSnapshot,
} from '../tests/integration/linux-vm-observer.mjs';
import {
  setupHelpScope,
  publicHelpScope,
  closeHelpScope,
} from '../tests/integration/linux-vm-help-fixture.mjs';
import { readPrivateJson } from './linux-vm-browser-contract.mjs';
import {
  loadHelpManifest,
  validateHelpManifest,
  HELP_CASE_IDS,
  requireValue as check,
} from './linux-vm-help-contract.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const sha = (value) => createHash('sha256').update(value).digest('hex');
const object = (value) =>
  value && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys, optional = []) =>
  object(value) &&
  keys.every((key) => Object.hasOwn(value, key)) &&
  Object.keys(value).every(
    (key) => keys.includes(key) || optional.includes(key),
  );

export function validateHelpAction(action, input) {
  const shapes = {
    inspect: [],
    finish: [],
    prepare: ['scope'],
    close: ['scope'],
    login: ['scope', 'role'],
    'verify-attempt': [
      'scope',
      'attemptId',
      'code',
      'diagnosis',
      'key',
      'status',
      'payload',
    ],
    fault: ['scope', 'attemptId', 'enabled'],
    'verify-help': [
      'scope',
      'attemptId',
      'requestId',
      'expectedStatus',
      'kind',
    ],
    'verify-retry': ['scope', 'firstAttemptId', 'retryAttemptId'],
  };
  check(
    Object.hasOwn(shapes, action) &&
      exact(
        input,
        shapes[action],
        action === 'verify-help' ? ['expectedLevel'] : [],
      ),
    'HELP_ACTION_SHAPE',
  );
  if ('scope' in input)
    check(HELP_CASE_IDS.includes(input.scope), 'HELP_ACTION_SCOPE');
  for (const key of [
    'attemptId',
    'requestId',
    'firstAttemptId',
    'retryAttemptId',
    'key',
  ])
    if (key in input) check(UUID.test(input[key]), 'HELP_ACTION_ID');
  if (action === 'login')
    check(['student', 'teacher'].includes(input.role), 'HELP_LOGIN_ROLE');
  if (action === 'verify-attempt')
    check(
      typeof input.code === 'string' &&
        Buffer.byteLength(input.code) <= 65536 &&
        ['FAILED_TEST', 'SUCCESS'].includes(input.diagnosis) &&
        input.status === 201 &&
        object(input.payload),
      'HELP_ATTEMPT_SHAPE',
    );
  if (action === 'fault')
    check(
      input.scope === 'H03' && typeof input.enabled === 'boolean',
      'HELP_FAULT_SCOPE',
    );
  if (action === 'verify-help')
    check(
      ['SUPPORTED', 'NO_EVIDENCE', 'PROVIDER_UNAVAILABLE'].includes(
        input.expectedStatus,
      ) &&
        ['FEEDBACK', 'HINT'].includes(input.kind) &&
        (!('expectedLevel' in input) || input.expectedLevel === 1),
      'HELP_EXPECTATION',
    );
  return input;
}

// SQL snapshots stay private; only digests and counts enter durable receipts.
export function assertAttemptSnapshot(snapshot, s, code, diagnosis) {
  const a = snapshot.attempt;
  check(
    a &&
      a.student_id === s.actorId &&
      a.organization_id === s.organizationId &&
      a.class_id === s.classId &&
      a.activity_id === s.activityId &&
      a.activity_exercise_id === s.assignmentId &&
      a.exercise_version_id === s.exerciseVersionId,
    'HELP_ATTEMPT_OWNER',
  );
  check(
    a.code === code &&
      a.technical_result?.diagnosisCode === diagnosis &&
      snapshot.results.length === 1 &&
      snapshot.results[0].attempt_id === a.id,
    'HELP_ATTEMPT_DURABLE',
  );
  check(
    snapshot.events.length === 2 &&
      ['ATTEMPT_SUBMITTED', 'EXECUTION_COMPLETED'].every(
        (type) =>
          snapshot.events.filter((event) => event.event_type === type)
            .length === 1,
      ),
    'HELP_ATTEMPT_EVENTS',
  );
  return {
    attemptId: a.id,
    executionId: a.execution_id,
    diagnosis,
    codeSha256: sha(a.code),
    technicalResultSha256: canonicalHash(a.technical_result),
    snapshotSha256: canonicalHash(snapshot),
  };
}

export function assertHelpEvidence({
  feedback,
  request,
  events,
  calls,
  observations,
  baseline,
  scope,
  expectedStatus,
  kind,
  source,
}) {
  check(
    request.id === feedback.requestId &&
      request.attempt_id === baseline.attemptId &&
      request.student_id === scope.actorId &&
      request.organization_id === scope.organizationId &&
      request.class_id === scope.classId &&
      request.lifecycle_status === 'SUCCEEDED' &&
      feedback.attemptId === baseline.attemptId &&
      feedback.kind === kind &&
      request.kind === kind,
    'HELP_RESULT_OWNER',
  );
  check(
    feedback.help.status === expectedStatus &&
      feedback.status === expectedStatus &&
      feedback.help.diagnosis_code === baseline.diagnosis,
    'HELP_RESULT_DIAGNOSIS',
  );
  const supported = expectedStatus === 'SUPPORTED',
    viewedType = kind === 'HINT' ? 'HINT_DELIVERED' : 'FEEDBACK_VIEWED';
  const requested = events.filter((e) => e.event_type === 'HELP_REQUESTED'),
    viewed = events.filter((e) => e.event_type === viewedType);
  const mustView = supported || kind === 'FEEDBACK';
  check(
    requested.length === 1 &&
      viewed.length === (mustView ? 1 : 0) &&
      events.length === (mustView ? 2 : 1) &&
      Boolean(feedback.viewedAt) === mustView &&
      request.level_reserved === false,
    'HELP_ACK_EVIDENCE',
  );
  check(
    kind === 'FEEDBACK'
      ? feedback.hintLevel === null
      : feedback.hintLevel === 1,
    'HELP_HINT_LEVEL',
  );
  if (supported)
    check(
      source &&
        feedback.help.source_refs.length > 0 &&
        feedback.help.source_refs.every(
          (ref) =>
            ref.source_id === source.id &&
            ref.source_version_id === source.versionId,
        ),
      'HELP_SOURCE_SCOPE',
    );
  else
    check(
      feedback.help.source_refs.length === 0 &&
        feedback.help.hint === '' &&
        (kind !== 'HINT' || feedback.presentationToken === null),
      'HELP_FALLBACK_CONSUMED_HINT',
    );
  const phases =
    expectedStatus === 'SUPPORTED'
      ? ['EMBEDDING', 'GENERATION', 'REVIEW']
      : expectedStatus === 'NO_EVIDENCE'
        ? ['EMBEDDING']
        : ['EMBEDDING', 'GENERATION'];
  check(
    calls.length === phases.length &&
      phases.every(
        (phase) => calls.filter((c) => c.phase === phase).length === 1,
      ),
    'HELP_PROVIDER_PHASES',
  );
  for (const phase of phases) {
    check(
      calls.find((call) => call.phase === phase).state ===
        (expectedStatus === 'PROVIDER_UNAVAILABLE' && phase === 'GENERATION'
          ? 'DISPATCHED'
          : 'COMPLETED'),
      'HELP_PROVIDER_CALL_STATE',
    );
    const matches = observations.filter(
      (o) => o.requestId === request.id && o.phase === phase,
    );
    check(
      matches.length === 1 &&
        matches[0].pass === true &&
        matches[0].committed === true &&
        matches[0].scope === scope.scope &&
        matches[0].attemptId === baseline.attemptId &&
        matches[0].executionId === baseline.executionId &&
        matches[0].codeSha256 === baseline.codeSha256 &&
        matches[0].submittedEvents === 1 &&
        matches[0].completedEvents === 1 &&
        matches[0].privateResultRows === 1,
      'HELP_PROVIDER_COMMIT_PROOF',
    );
  }
  return {
    pass: true,
    requestId: request.id,
    feedbackId: feedback.id,
    status: expectedStatus,
    kind,
    hintLevel: feedback.hintLevel,
    technicalResultSha256: baseline.technicalResultSha256,
    sourceCount: feedback.help.source_refs.length,
    viewedCount: viewed.length,
    sourceRefs: feedback.help.source_refs,
    providerCalls: calls.map(({ phase, state }) => ({
      provider: 'TEST',
      phase,
      state,
    })),
  };
}

export function assertRetryEvidence(first, retry, currentFirst) {
  check(
    first.attemptId !== retry.attemptId &&
      first.executionId !== retry.executionId &&
      first.diagnosis === 'FAILED_TEST' &&
      retry.diagnosis === 'SUCCESS' &&
      first.codeSha256 !== retry.codeSha256 &&
      first.technicalResultSha256 !== retry.technicalResultSha256,
    'HELP_RETRY_NEW_EVIDENCE',
  );
  check(
    canonicalHash(currentFirst) === first.snapshotSha256,
    'HELP_ORIGINAL_MUTATED',
  );
  return {
    pass: true,
    firstAttemptId: first.attemptId,
    retryAttemptId: retry.attemptId,
  };
}

export async function createHelpController(m) {
  validateHelpManifest(m);
  check(process.platform === 'linux', 'PHYSICAL_CONTROLLER_LINUX_ONLY');
  const state = await readPrivateJson(m.statePath);
  check(
    state.projectId === 'alunza-edu-laboratorio-physical-test' &&
      state.authUrl === m.endpoints.auth,
    'PHYSICAL_TEST_REQUIRED',
  );
  const db = new URL(state.migrationUrl);
  check(
    db.hostname === '127.0.0.1' &&
      db.port === '18422' &&
      db.pathname === '/postgres',
    'DATABASE_TARGET',
  );
  const app = new URL(db);
  app.username = 'alunza_app';
  app.password = state.applicationPassword;
  const adminPool = new pg.Pool({ connectionString: db.href, max: 4 }),
    applicationPool = new pg.Pool({ connectionString: app.href, max: 2 });
  const identity = JSON.parse(
    await readFile(
      new URL('../fixtures/foundation/identity.json', import.meta.url),
      'utf8',
    ),
  );
  const students = [
      identity.users[2],
      additionalStudents[0],
      additionalStudents[1],
    ],
    teacher = identity.users[1];
  const scopes = new Map(),
    sessions = new Map();
  let baseline = null,
    stopping = false,
    queue = Promise.resolve();
  await mkdir(m.controlDir, { recursive: false, mode: 0o700 });
  const record = (value) =>
    appendFile(
      join(m.controlDir, 'control-events.jsonl'),
      JSON.stringify({
        at: new Date().toISOString(),
        campaignId: m.campaignId,
        ...value,
      }) + '\n',
      { mode: 0o600 },
    );
  const save = async (path, value) => {
    const temp = path + '.' + randomUUID() + '.tmp';
    await writeFile(temp, JSON.stringify(value) + '\n', {
      mode: 0o600,
      flag: 'wx',
    });
    await rename(temp, path);
  };
  const saveScopes = () =>
    save(m.scopesPath, {
      campaignId: m.campaignId,
      scopes: [...scopes.values()].map((s) => ({
        scope: s.scope,
        actorId: s.actorId,
        organizationId: s.organizationId,
        classId: s.classId,
        activityId: s.activityId,
        assignmentId: s.assignmentId,
        exerciseVersionId: s.exerciseVersionId,
        attemptIds: s.attemptIds ?? [],
        closed: s.closed ?? false,
      })),
    });
  for (const path of [m.scopesPath, m.faultPath]) {
    try {
      const existing = await readPrivateJson(path);
      check(
        existing.campaignId === m.campaignId &&
          (path === m.scopesPath
            ? existing.scopes?.length === 0
            : existing.disabled === true),
        'HELP_CONTROL_STATE_OCCUPIED',
      );
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  await saveScopes();
  await save(m.faultPath, { campaignId: m.campaignId, disabled: true });
  await appendFile(m.providerObservationsPath, '', { mode: 0o600 });
  async function authenticate(user) {
    const auth = createClient(state.authUrl, state.publishableKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    const result = await auth.auth.signInWithPassword({
      email: user.email,
      password: state.fixturePassword,
    });
    check(
      !result.error && result.data.session?.user.id === user.id,
      'REAL_AUTH_REQUIRED',
    );
    sessions.set(user.id, result.data.session);
    return result.data.session;
  }
  const userFor = (s, role) =>
    role === 'student'
      ? students[HELP_CASE_IDS.indexOf(s.scope)]
      : role === 'teacher'
        ? teacher
        : role === 'admin'
          ? identity.users[0]
          : identity.users[5];
  async function request(
    s,
    role,
    method,
    path,
    body,
    revision,
    { key = randomUUID(), expected, raw = false } = {},
  ) {
    check(/^\/[A-Za-z0-9/?=&.-]+$/.test(path), 'HELP_API_PATH');
    const user = userFor(s, role),
      session = sessions.get(user.id) ?? (await authenticate(user));
    const form = body instanceof globalThis.FormData;
    const response = await fetch(m.endpoints.api + '/api/v1' + path, {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(40000),
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        ...(body === undefined || form
          ? {}
          : { 'Content-Type': 'application/json' }),
        ...(method === 'GET' ? {} : { 'Idempotency-Key': key }),
        ...(revision ? { 'If-Match': `"${revision}"` } : {}),
      },
      ...(body === undefined
        ? {}
        : { body: form ? body : JSON.stringify(body) }),
    });
    check(
      expected
        ? response.status === expected
        : response.status >= 200 && response.status < 300,
      'HELP_API_STATUS',
    );
    check(
      response.headers.get('cache-control')?.includes('no-store'),
      'HELP_API_CACHE',
    );
    const bytes = Buffer.from(await response.arrayBuffer());
    check(bytes.length <= 1024 * 1024, 'HELP_API_SIZE');
    if (raw) return bytes;
    const payload = JSON.parse(bytes.toString('utf8'));
    return { status: response.status, payload, data: payload.data };
  }
  const scopedApi =
    (s) =>
    (...args) =>
      request(s, ...args);
  const scope = (name) => {
    const s = scopes.get(name);
    check(s && s.prepared && !s.closed, 'HELP_UNKNOWN_OR_CLOSED_SCOPE');
    return s;
  };
  async function inspect() {
    const raw = validateBrokerSnapshot(
      await readLinuxVmSnapshot(m.brokerSocket),
      m.candidate,
    );
    const ledger = (
      await adminPool.query(
        `SELECT count(*)::int AS total,count(*) FILTER(WHERE cleanup_state='PENDING')::int AS pending FROM app_private.local_vm_resources WHERE context->>'hostId'=$1`,
        [raw.context.hostId],
      )
    ).rows[0];
    return {
      candidate: m.candidate,
      webSourceDigest: m.webSourceDigest,
      context: raw.context,
      records: raw.records,
      totals: raw.totals,
      ledger,
    };
  }
  async function idle() {
    const snap = await inspect();
    check(
      !baseline ||
        snap.context.brokerGeneration === baseline.context.brokerGeneration,
      'HELP_BROKER_CHANGED',
    );
    check(
      snap.totals.active === 0 &&
        snap.totals.uncertain === 0 &&
        snap.ledger.pending === 0 &&
        snap.records.every((r) => r.state === 'CLOSED' && r.cleanupVerified),
      'HELP_HOST_NOT_IDLE',
    );
    const owned = [...scopes.values()].map((s) => s.classId).filter(Boolean);
    const pending = (
      await adminPool.query(
        `SELECT count(*)::int n FROM app.feedback_requests WHERE class_id=ANY($1::uuid[]) AND lifecycle_status IN('QUEUED','RUNNING')`,
        [owned],
      )
    ).rows[0].n;
    check(pending === 0, 'HELP_JOBS_PENDING');
    const materials = (
      await adminPool.query(
        "SELECT count(*)::int n FROM app.material_jobs WHERE class_id=ANY($1::uuid[]) AND lifecycle_status IN('UPLOADING','QUEUED','RUNNING')",
        [owned],
      )
    ).rows[0].n;
    check(materials === 0, 'HELP_MATERIAL_JOBS_PENDING');
    return snap;
  }
  async function attemptSnapshot(id) {
    const client = await adminPool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const attempt = (
        await client.query('SELECT * FROM app.attempts WHERE id=$1', [id])
      ).rows[0];
      const results = (
        await client.query(
          'SELECT * FROM app_private.attempt_results WHERE attempt_id=$1',
          [id],
        )
      ).rows;
      const events = (
        await client.query(
          'SELECT * FROM app_private.attempt_events WHERE attempt_id=$1 ORDER BY event_type',
          [id],
        )
      ).rows;
      await client.query('COMMIT');
      return JSON.parse(JSON.stringify({ attempt, results, events }));
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  async function prepare(name) {
    check(!scopes.has(name), 'HELP_SCOPE_ALREADY_PREPARED');
    baseline ??= await idle();
    const s = {
      scope: name,
      attemptIds: [],
      attemptProofs: new Map(),
      helpProofs: new Map(),
      closed: false,
    };
    scopes.set(name, s);
    const retained = await setupHelpScope({
      state,
      adminPool,
      campaignId: m.campaignId,
      scope: name,
      student: students[HELP_CASE_IDS.indexOf(name)],
      teacher,
      api: scopedApi(s),
      retain: async (value) => {
        Object.assign(s, value);
        await saveScopes();
      },
    });
    Object.assign(s, retained);
    const actors = await loginLinuxVmActors(state, {});
    s.actor = actors.find((a) => a.id === s.actorId);
    s.actor.classId = s.classId;
    s.actor.fixtures = { SUBMIT: s.fixture };
    s.observer = await createLinuxVmObserver({
      state,
      adminPool,
      applicationPool,
      actors,
      candidate: m.candidate,
      socketPath: m.brokerSocket,
    });
    await record({
      event: 'SCOPE_PREPARED',
      scope: name,
      classId: s.classId,
      exerciseVersionId: s.exerciseVersionId,
      sourceId: s.source?.id ?? null,
    });
    return publicHelpScope(s);
  }
  async function verifyAttempt(input) {
    const s = scope(input.scope);
    check(
      !s.attemptProofs.has(input.attemptId) && s.attemptProofs.size < 2,
      'HELP_ATTEMPT_COUNT',
    );
    if (s.attemptProofs.size === 1)
      check(
        s.helpProofs.size === (s.scope === 'H03' ? 2 : 1),
        'HELP_RETRY_BEFORE_HELP',
      );
    check(
      input.diagnosis ===
        (s.attemptProofs.size === 0 ? 'FAILED_TEST' : 'SUCCESS') &&
        input.code ===
          (s.attemptProofs.size === 0
            ? s.fixture.incorrectCode
            : s.fixture.successCode),
      'HELP_ATTEMPT_SEQUENCE',
    );
    const checked = validateHttpPayload(input.payload, {
      actor: s.actor,
      fixture: s.fixture,
      mode: 'SUBMIT',
      code: input.code,
      status: input.status,
      expectedStatus: 201,
      expectedDiagnosis: input.diagnosis,
    });
    check(
      checked.failures.length === 0 &&
        checked.data.attemptId === input.attemptId,
      'HELP_PUBLIC_RESULT',
    );
    const observation = await s.observer.observe({
      actorId: s.actorId,
      mode: 'SUBMIT',
      key: input.key,
    });
    assertDurable(
      observation,
      checked.data,
      s.actor,
      'SUBMIT',
      input.code,
      m.candidate,
    );
    const snapshot = await attemptSnapshot(input.attemptId),
      proof = assertAttemptSnapshot(snapshot, s, input.code, input.diagnosis);
    check(
      proof.attemptId === input.attemptId &&
        proof.executionId === checked.data.executionId,
      'HELP_ATTEMPT_IDENTITY',
    );
    const result = {
      pass: true,
      attemptId: proof.attemptId,
      executionId: proof.executionId,
      requestId: checked.requestId,
      diagnosis: proof.diagnosis,
      observationSha256: canonicalHash(observation),
      technicalResultSha256: proof.technicalResultSha256,
    };
    s.attemptProofs.set(input.attemptId, proof);
    s.attemptIds.push(input.attemptId);
    await saveScopes();
    await record({
      event: 'ATTEMPT_COMMITTED_BEFORE_HELP',
      scope: s.scope,
      ...result,
      snapshotSha256: proof.snapshotSha256,
      codeSha256: proof.codeSha256,
      events: 2,
      vmRetired: true,
    });
    return result;
  }
  async function helpRows(requestId) {
    const request = (
      await adminPool.query('SELECT * FROM app.feedback_requests WHERE id=$1', [
        requestId,
      ])
    ).rows[0];
    check(request, 'HELP_REQUEST_MISSING');
    const calls = (
      await adminPool.query(
        'SELECT phase,state,dispatched_at,completed_at FROM app_private.help_calls WHERE request_id=$1 ORDER BY phase',
        [requestId],
      )
    ).rows;
    const events = (
      await adminPool.query(
        'SELECT event_type,hint_level FROM app_private.help_events WHERE request_id=$1 ORDER BY event_type',
        [requestId],
      )
    ).rows;
    return { request, calls, events };
  }
  async function verifyNegatives(s, attemptId) {
    if (s.negatives) return;
    const counts = async () =>
      (
        await adminPool.query(
          `SELECT (SELECT count(*)::int FROM app.feedback_requests WHERE class_id=$1) requests,(SELECT count(*)::int FROM app_private.help_calls c JOIN app.feedback_requests r ON r.id=c.request_id WHERE r.class_id=$1) calls`,
          [s.classId],
        )
      ).rows[0];
    const before = await counts();
    const deniedKeys = [];
    for (const [role, id, body, status] of [
      ['student', randomUUID(), { kind: 'HINT' }, 404],
      ['outsider', attemptId, { kind: 'HINT' }, 404],
      // help_assert_attempt deliberately maps every non-owner, including the
      // teacher and governance administrator, to RESOURCE_NOT_FOUND (404).
      ['teacher', attemptId, { kind: 'HINT' }, 404],
      ['admin', attemptId, { kind: 'HINT' }, 404],
      ['student', attemptId, { kind: 'HINT', diagnosisCode: 'SUCCESS' }, 422],
    ]) {
      const key = randomUUID();
      deniedKeys.push(key);
      const response = await request(
        s,
        role,
        'POST',
        `/attempts/${id}/feedback-requests`,
        body,
        undefined,
        { expected: status, key },
      );
      check(!response.data && response.payload.error, 'HELP_NEGATIVE_ENVELOPE');
    }
    check(
      canonicalHash(before) === canonicalHash(await counts()),
      'HELP_REJECTED_INPUT_PERSISTED',
    );
    check(
      (
        await adminPool.query(
          "SELECT count(*)::int n FROM app.operation_keys WHERE operation='help.request' AND key=ANY($1::text[])",
          [deniedKeys],
        )
      ).rows[0].n === 0,
      'HELP_REJECTED_KEY_PERSISTED',
    );
    s.negatives = true;
    await record({
      event: 'HELP_NEGATIVES_VERIFIED',
      scope: s.scope,
      nonexistent: 404,
      foreign: 404,
      teacher: 404,
      administrator: 404,
      extraDiagnosis: 422,
      noRequestOrProviderAdmission: true,
    });
  }
  async function verifyHelp(input) {
    const s = scope(input.scope),
      saved = s.attemptProofs.get(input.attemptId);
    check(
      saved &&
        saved.diagnosis === 'FAILED_TEST' &&
        !s.helpProofs.has(input.requestId),
      'HELP_UNREGISTERED_ATTEMPT',
    );
    const expected =
      s.scope === 'H01'
        ? ['FEEDBACK', 'SUPPORTED']
        : s.scope === 'H02'
          ? ['HINT', 'NO_EVIDENCE']
          : [
              'HINT',
              s.helpProofs.size === 0 ? 'PROVIDER_UNAVAILABLE' : 'SUPPORTED',
            ];
    check(
      input.kind === expected[0] && input.expectedStatus === expected[1],
      'HELP_CASE_EXPECTATION',
    );
    check(
      canonicalHash(await attemptSnapshot(input.attemptId)) ===
        saved.snapshotSha256,
      'HELP_ORIGINAL_MUTATED',
    );
    const status = (
      await request(
        s,
        'student',
        'GET',
        `/feedback-requests/${input.requestId}`,
      )
    ).payload;
    check(
      helpRequestResponseSchema.safeParse(status).success &&
        status.data.state === 'SUCCEEDED' &&
        status.data.feedbackId,
      'HELP_REQUEST_NOT_COMPLETED',
    );
    const response = (
      await request(s, 'student', 'GET', `/feedback/${status.data.feedbackId}`)
    ).payload;
    check(
      helpFeedbackResponseSchema.safeParse(response).success,
      'HELP_FEEDBACK_SCHEMA',
    );
    const feedback = response.data,
      rows = await helpRows(input.requestId);
    const text = await readFile(m.providerObservationsPath, 'utf8');
    check(Buffer.byteLength(text) <= 2 * 1024 * 1024, 'HELP_OBSERVATIONS_SIZE');
    const observations = text
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((o) => o.campaignId === m.campaignId);
    const result = assertHelpEvidence({
      feedback,
      ...rows,
      observations,
      baseline: saved,
      scope: s,
      expectedStatus: input.expectedStatus,
      kind: input.kind,
      source: s.source,
    });
    const projected = JSON.stringify(response);
    check(
      s.fixture.hiddenTestIds.every((marker) => !projected.includes(marker)) &&
        !projected.includes(s.actor.token),
      'HELP_PRIVATE_DISCLOSURE',
    );
    const prepared = (
      await adminPool.query(
        'SELECT input FROM app_private.help_inputs WHERE request_id=$1',
        [input.requestId],
      )
    ).rows;
    if (input.expectedStatus === 'NO_EVIDENCE')
      check(prepared.length === 0, 'HELP_EMPTY_CORPUS_PREPARED');
    else {
      const context = prepared[0]?.input?.context;
      check(
        prepared.length === 1 &&
          exact(context, [
            'attemptId',
            'code',
            'concepts',
            'diagnosisCode',
            'exerciseVersionId',
            'infrastructureStatus',
            'statement',
            'visibleTests',
          ]) &&
          context.attemptId === saved.attemptId &&
          sha(context.code) === saved.codeSha256 &&
          context.diagnosisCode === saved.diagnosis &&
          context.exerciseVersionId === s.exerciseVersionId &&
          context.visibleTests.length === 2 &&
          context.visibleTests.every(
            (test) =>
              exact(test, ['id', 'passed']) &&
              s.fixture.visibleTestIds.includes(test.id),
          ),
        'HELP_PROVIDER_INPUT_SCOPE',
      );
      check(
        s.fixture.hiddenTestIds.every(
          (marker) => !JSON.stringify(prepared).includes(marker),
        ),
        'HELP_PROVIDER_HIDDEN_DISCLOSURE',
      );
    }
    // Repetition is a transport replay of the UI's operation, never a new hint.
    const operation = (
      await adminPool.query(
        "SELECT key FROM app.operation_keys WHERE operation='help.request' AND resource_id=$1 AND actor_id=$2",
        [input.requestId, s.actorId],
      )
    ).rows;
    check(operation.length === 1, 'HELP_OPERATION_IDENTITY');
    const replay = (
      await request(
        s,
        'student',
        'POST',
        `/attempts/${input.attemptId}/feedback-requests`,
        {
          kind: input.kind,
          ...(input.kind === 'HINT' ? { hintLevel: feedback.hintLevel } : {}),
        },
        undefined,
        { key: operation[0].key, expected: 202 },
      )
    ).data;
    check(
      replay.id === status.data.id &&
        replay.deadlineAt === status.data.deadlineAt,
      'HELP_REPLAY_CHANGED',
    );
    // Existing ACK must precede this action; a duplicate cannot create an event.
    if (result.viewedCount === 1) {
      check(UUID.test(feedback.presentationToken), 'HELP_ACK_TOKEN_MISSING');
      await request(
        s,
        'student',
        'POST',
        `/feedback/${feedback.id}/viewed`,
        { presentationToken: feedback.presentationToken },
        undefined,
        { expected: 200 },
      );
    }
    const after = await helpRows(input.requestId);
    check(
      canonicalHash(after.calls) === canonicalHash(rows.calls) &&
        canonicalHash(after.events) === canonicalHash(rows.events),
      'HELP_REPLAY_OR_ACK_DUPLICATED',
    );
    const history = (
      await request(
        s,
        'student',
        'GET',
        `/attempts/${input.attemptId}/feedback`,
      )
    ).payload;
    check(
      helpHistoryResponseSchema.safeParse(history).success,
      'HELP_HISTORY_SCHEMA',
    );
    if (input.kind === 'HINT')
      check(
        history.data.capabilities.nextHintLevel ===
          (input.expectedStatus === 'SUPPORTED' ? 2 : 1),
        'HELP_HINT_CAPABILITY',
      );
    for (const ref of feedback.help.source_refs) {
      const detail = (
        await request(
          s,
          'student',
          'GET',
          `/feedback/${feedback.id}/sources/${ref.chunk_id}`,
        )
      ).payload;
      check(
        helpReferenceResponseSchema.safeParse(detail).success &&
          detail.data.sourceId === s.source.id &&
          detail.data.versionId === s.source.versionId,
        'HELP_REFERENCE_SCOPE',
      );
      const bytes = await request(
        s,
        'student',
        'GET',
        `/feedback/${feedback.id}/sources/${ref.chunk_id}/content`,
        undefined,
        undefined,
        { raw: true },
      );
      check(
        sha(bytes) === s.source.sha256 &&
          bytes.toString('utf8') === s.source.text,
        'HELP_SOURCE_BYTES',
      );
    }
    await verifyNegatives(s, input.attemptId);
    check(
      canonicalHash(await attemptSnapshot(input.attemptId)) ===
        saved.snapshotSha256,
      'HELP_ORIGINAL_MUTATED',
    );
    s.helpProofs.set(input.requestId, result);
    await record({
      event: 'HELP_VERIFIED',
      scope: s.scope,
      ...result,
      replayPreserved: true,
      ackIdempotent: true,
      sourceBytesVerified: result.sourceCount > 0,
      providerIsTest: true,
    });
    return result;
  }
  async function close(name, complete) {
    const s = scopes.get(name);
    check(s, 'HELP_UNKNOWN_SCOPE');
    if (s.closed) return { closed: true, scope: name };
    await idle();
    if (complete)
      check(
        s.retryVerified &&
          s.attemptProofs.size === 2 &&
          s.helpProofs.size === (name === 'H03' ? 2 : 1),
        'HELP_SCOPE_INCOMPLETE',
      );
    await closeHelpScope(s, scopedApi(s));
    await saveScopes();
    await record({
      event: 'SCOPE_CLOSED',
      scope: name,
      preservesHistory: true,
      preservesStorageBytes: true,
    });
    return { closed: true, scope: name };
  }
  async function dispatch(action, input) {
    validateHelpAction(action, input);
    check(!stopping, 'HELP_CONTROL_STOPPING');
    if (action === 'inspect') return inspect();
    if (action === 'prepare') return prepare(input.scope);
    if (action === 'login') {
      const s = scope(input.scope),
        session = await authenticate(userFor(s, input.role));
      if (input.role === 'student') s.actor.token = session.access_token;
      return session;
    }
    if (action === 'verify-attempt') return verifyAttempt(input);
    if (action === 'verify-help') return verifyHelp(input);
    if (action === 'fault') {
      const s = scope(input.scope);
      check(s.attemptIds.includes(input.attemptId), 'HELP_FAULT_ATTEMPT');
      await idle();
      await save(
        m.faultPath,
        input.enabled
          ? {
              campaignId: m.campaignId,
              scope: input.scope,
              attemptId: input.attemptId,
              scenario: 'generation-unavailable',
              expiresAt: new Date(Date.now() + 120000).toISOString(),
            }
          : { campaignId: m.campaignId, disabled: true },
      );
      await record({
        event: 'HELP_FAULT',
        scope: s.scope,
        attemptId: input.attemptId,
        enabled: input.enabled,
      });
      return { enabled: input.enabled };
    }
    if (action === 'verify-retry') {
      const s = scope(input.scope),
        first = s.attemptProofs.get(input.firstAttemptId),
        retry = s.attemptProofs.get(input.retryAttemptId);
      check(
        first && retry && s.helpProofs.size === (s.scope === 'H03' ? 2 : 1),
        'HELP_RETRY_PREREQUISITE',
      );
      const result = assertRetryEvidence(
        first,
        retry,
        await attemptSnapshot(first.attemptId),
      );
      check(
        canonicalHash(await attemptSnapshot(retry.attemptId)) ===
          retry.snapshotSha256,
        'HELP_RETRY_MUTATED',
      );
      s.retryVerified = true;
      await record({ event: 'RETRY_VERIFIED', scope: s.scope, ...result });
      return result;
    }
    if (action === 'close') return close(input.scope, true);
    if (action === 'finish') {
      check(
        HELP_CASE_IDS.every(
          (name) => scopes.get(name)?.closed && scopes.get(name)?.retryVerified,
        ),
        'HELP_CAMPAIGN_INCOMPLETE',
      );
      const final = await idle();
      check(
        final.totals.qemuStarted - baseline.totals.qemuStarted === 6 &&
          final.ledger.total - baseline.ledger.total === 6,
        'HELP_VM_COUNT',
      );
      const owned = [...scopes.values()].map((s) => s.classId),
        attempts = (
          await adminPool.query(
            'SELECT count(*)::int n FROM app.attempts WHERE class_id=ANY($1::uuid[])',
            [owned],
          )
        ).rows[0].n;
      check(attempts === 6, 'HELP_ATTEMPT_COUNT');
      for (const s of scopes.values())
        for (const proof of s.attemptProofs.values())
          check(
            canonicalHash(await attemptSnapshot(proof.attemptId)) ===
              proof.snapshotSha256,
            'HELP_FINAL_ATTEMPT_MUTATED',
          );
      await save(m.faultPath, { campaignId: m.campaignId, disabled: true });
      const result = { pass: true, final, scopesClosed: 3 };
      await record({ event: 'CAMPAIGN_VERIFIED', ...result });
      return result;
    }
    throw new Error('HELP_ACTION_UNKNOWN');
  }
  return {
    dispatch(action, input) {
      const next = queue.then(() => dispatch(action, input));
      queue = next.catch(async (error) => {
        await record({
          event: 'CONTROL_ACTION_FAILED',
          action: Object.hasOwn(
            {
              inspect: 1,
              prepare: 1,
              login: 1,
              'verify-attempt': 1,
              fault: 1,
              'verify-help': 1,
              'verify-retry': 1,
              close: 1,
              finish: 1,
            },
            action,
          )
            ? action
            : 'unknown',
          scope: HELP_CASE_IDS.includes(input?.scope) ? input.scope : null,
          code: /^[A-Z][A-Z0-9_]{1,80}$/.test(error?.message ?? '')
            ? error.message
            : 'HELP_CONTROL_REJECTED',
        });
      });
      return next;
    },
    async shutdown() {
      stopping = true;
      const failed = [];
      try {
        await queue;
      } catch {
        failed.push('receipt');
      }
      try {
        await save(m.faultPath, { campaignId: m.campaignId, disabled: true });
      } catch {
        failed.push('fault');
      }
      for (const name of scopes.keys())
        try {
          await close(name, false);
        } catch {
          failed.push(name);
        }
      await Promise.all([adminPool.end(), applicationPool.end()]);
      await record({
        event: 'CONTROL_SHUTDOWN',
        pass: failed.length === 0,
        failed,
      });
      check(failed.length === 0, 'HELP_SHUTDOWN_INCOMPLETE');
    },
  };
}

export async function serveHelpControl(m) {
  const controller = await createHelpController(m);
  const server = createServer(async (req, res) => {
    let status = 400,
      data = { ok: false, error: 'HELP_CONTROL_REJECTED' };
    try {
      const key = String(req.headers['x-alunza-control-key'] ?? '');
      check(
        req.socket.remoteAddress === '127.0.0.1' &&
          req.method === 'POST' &&
          req.url === '/task' &&
          !req.headers.origin &&
          req.headers['content-type'] === 'application/json' &&
          Buffer.byteLength(key) === Buffer.byteLength(m.controlKey) &&
          timingSafeEqual(Buffer.from(key), Buffer.from(m.controlKey)),
        'HELP_PRIVATE_PEER',
      );
      const chunks = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        check(bytes <= 1048576, 'HELP_CONTROL_SIZE');
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      check(
        exact(body, ['campaignId', 'action', 'input']) &&
          body.campaignId === m.campaignId,
        'HELP_CONTROL_ENVELOPE',
      );
      data = {
        campaignId: m.campaignId,
        ok: true,
        data: await controller.dispatch(body.action, body.input),
      };
      status = 200;
    } catch (error) {
      if (/^[A-Z][A-Z0-9_]{1,80}$/.test(error?.message ?? ''))
        data.error = error.message;
    }
    res.writeHead(status, {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    });
    res.end(JSON.stringify(data));
  });
  server.requestTimeout = 50000;
  server.headersTimeout = 5000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(4302, '127.0.0.1', resolve);
  });
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    server.close();
    await controller.shutdown();
  };
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => {
      void stop().catch(() => {
        process.exitCode = 1;
      });
    });
  console.log(
    JSON.stringify({
      status: 'ready',
      scope: 'PHYSICAL_HELP_PRIVATE_CONTROL',
      campaignId: m.campaignId,
      port: 4302,
    }),
  );
  return { server, stop };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  check(
    process.argv.length === 4 && process.argv[2] === '--manifest',
    'HELP_CONTROL_USAGE',
  );
  await serveHelpControl(await loadHelpManifest(process.argv[3]));
}
