/* eslint @typescript-eslint/no-require-imports: "off" */
// IMP-05.08: canonical local persistence and public projections. Runner results
// are explicit staged fixtures; HELP uses the real TEST pipeline, never Azure.
const { readFileSync } = require('node:fs');
const { randomUUID, createHash } = require('node:crypto');
const { resolve } = require('node:path');
const { URLSearchParams } = require('node:url');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { setTimeout: delay } = require('node:timers/promises');
const { Pool } = require('pg');
const { createClient } = require('@supabase/supabase-js');
const contracts = require('@alunza/contracts');
const { setHelpFault, clearHelpFault } = require('../help-fault-controls.cjs');
const {
  evaluateSignalBoundary,
} = require('../../apps/api/dist/signals/signal-processing.js');
const {
  signalSnapshotSchema,
} = require('../../apps/api/dist/signals/signals.schemas.js');
const execute = promisify(execFile);
let harness, application;
const sessions = new Map();
const hash = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const query = (value) => new URLSearchParams(value).toString();
const micros = (value) =>
  BigInt(Date.parse(value.replace(/\.\d+/, ''))) * 1000n +
  BigInt((value.match(/\.(\d+)/)?.[1] ?? '').padEnd(6, '0'));
const stripObserved = (value) =>
  JSON.parse(
    JSON.stringify(value, (key, entry) =>
      key === 'observedAt' ? undefined : entry,
    ),
  );

async function internal(action, actor) {
  const db = await application.connect();
  try {
    await db.query('BEGIN');
    await db.query(
      "SELECT set_config('app.actor_id',$1,true),set_config('app.session_id',$2,true)",
      [actor ? harness.actors[actor].id : '', actor ? sessions.get(actor) : ''],
    );
    const value = await action(db);
    await db.query('COMMIT');
    return value;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}
async function read(path, schema, actor = 'teacher') {
  const response = await harness.request(path, { actor });
  expect(response.status).toBe(200);
  expect(response.noStore).toBe(true);
  schema.parse({ data: response.data, requestId: response.requestId });
  for (const forbidden of [
    'DASHBOARD_HIDDEN_SENTINEL',
    'PHASE_VERSION_PRIVATE',
    'module.exports',
    'privateTestResults',
    'clockVector',
  ])
    expect(JSON.stringify(response.data)).not.toContain(forbidden);
  return response.data;
}
async function cutAfter(watermark) {
  // Clock-only precondition. Never retry until an academic counter is correct.
  for (let index = 0; index < 20; index++) {
    const at = (
      await harness.database.query(
        'SELECT app_private.signal_instant(clock_timestamp()) AS at',
      )
    ).rows[0].at;
    if (!watermark || micros(at) >= micros(watermark)) return at;
  }
  throw new Error('PHASE_FIXTURE_CLOCK_BEFORE_CANONICAL_FACT');
}
async function views(c, at) {
  const prefix = `/classes/${c.classroomId}`;
  const dashboard = await read(
    `${prefix}/dashboard?${query({ asOf: at })}`,
    contracts.dashboardResponseSchema,
  );
  const evidence = await read(
    `${prefix}/dashboard/evidence?${query({ asOf: at, limit: 100 })}`,
    contracts.dashboardEvidenceResponseSchema,
  );
  const signals = await read(
    `${prefix}/signals?${query({ asOf: at, state: 'ALL', limit: 100 })}`,
    contracts.dashboardSignalsResponseSchema,
  );
  const progress = await read(
    `/me/progress?${query({ classId: c.classroomId, asOf: at, limit: 100 })}`,
    contracts.studentProgressResponseSchema,
    'student',
  );
  const details = [];
  for (const signal of signals.data)
    details.push(
      await read(
        `${prefix}/signals/${signal.id}?${query({ asOf: at })}`,
        contracts.dashboardSignalDetailResponseSchema,
      ),
    );
  return stripObserved({ dashboard, evidence, signals, progress, details });
}
async function facts(c) {
  // Hash only: raw attempts never enter reports, assertions or public payloads.
  const { rows } = await harness.database.query(
    `WITH lanes AS (SELECT id FROM app_private.signal_lanes WHERE organization_id=$1)
    SELECT jsonb_build_object(
      'attempts',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM app.attempts a WHERE organization_id=$1),
      'events',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM app_private.attempt_events e WHERE organization_id=$1),
      'evaluations',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM app_private.signal_evaluations e WHERE lane_id IN(SELECT id FROM lanes)),
      'snapshots',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM app_private.signal_snapshots s WHERE lane_id IN(SELECT id FROM lanes)),
      'episodes',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM app_private.signal_episodes e WHERE lane_id IN(SELECT id FROM lanes)),
      'reviews',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM app_private.signal_reviews r WHERE lane_id IN(SELECT id FROM lanes)),
      'jobs',(SELECT jsonb_agg(to_jsonb(j) ORDER BY lane_id) FROM app_private.signal_jobs j WHERE lane_id IN(SELECT id FROM lanes)),
      'rules',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM app.signal_rule_versions r WHERE organization_id=$1)) AS value`,
    [c.organizationId],
  );
  return hash(rows[0].value);
}
async function maintenance(mode, c, at) {
  const args = [
    resolve(__dirname, '../../scripts/signals-rebuild.mjs'),
    mode,
    '--target',
    'test',
    '--organization',
    c.organizationId,
    '--class',
    c.classroomId,
    '--student',
    c.studentIds[0],
    '--activity',
    c.activityIds[0],
    '--as-of',
    at,
  ];
  const result = await execute(process.execPath, args, {
    windowsHide: true,
    timeout: 60_000,
    maxBuffer: 1024 * 1024,
  });
  expect(result.stderr).toBe('');
  return JSON.parse(result.stdout);
}
async function replay(c, at) {
  const inputs = await internal(
    async (db) =>
      (
        await db.query(
          'SELECT app_private.signal_replay_inputs($1::jsonb) AS value',
          [
            JSON.stringify({
              organizationId: c.organizationId,
              classId: c.classroomId,
              studentId: c.studentIds[0],
              activityId: c.activityIds[0],
              asOf: at,
            }),
          ],
        )
      ).rows[0].value,
  );
  let verified = 0;
  for (const input of inputs) {
    const snapshot = signalSnapshotSchema.parse(input.snapshot);
    for (const evaluation of input.evaluations) {
      expect(evaluateSignalBoundary(snapshot, evaluation.boundary)).toEqual(
        evaluation.result,
      );
      verified++;
    }
  }
  expect(verified).toBeGreaterThan(0);
  return hash(inputs);
}
async function inactivity(c) {
  await harness.processSignals(c);
  const result = await harness.database.query(
    `SELECT e.result,j.next_deadline_micros::text AS deadline,l.id AS lane_id
    FROM app_private.signal_lanes l JOIN app_private.signal_jobs j ON j.lane_id=l.id
    JOIN LATERAL(SELECT result FROM app_private.signal_evaluations WHERE lane_id=l.id ORDER BY evaluation_sequence DESC LIMIT 1)e ON true
    WHERE l.organization_id=$1 AND l.student_id=$2 AND l.activity_id=$3 AND l.type='INACTIVITY'`,
    [c.organizationId, c.studentIds[0], c.activityIds[0]],
  );
  expect(result.rows).toHaveLength(1);
  const value = result.rows[0];
  expect(value.result.outcome).toBe('NO_MATCH');
  expect(value.result.evidence.lastAt).toBeTruthy();
  expect(value.deadline).toBe(
    (micros(value.result.evidence.lastAt) + 7n * 86400000000n).toString(),
  );
  return value;
}
async function helpPermit(slots = 1) {
  // Respect the real six-request/minute quota shared with earlier integration
  // cases. Wait on server facts before admission; never mutate quota records or
  // retry a failed academic request until it passes.
  for (let index = 0; index < 260; index++) {
    const row = (
      await harness.database.query(
        "SELECT count(*)::integer AS recent FROM app.feedback_requests WHERE student_id=$1 AND requested_at>clock_timestamp()-interval '60 seconds'",
        [harness.actors.student.id],
      )
    ).rows[0];
    if (row.recent + slots <= 6) return;
    await delay(250);
  }
  throw new Error('PHASE_HELP_QUOTA_PRECONDITION_TIMEOUT');
}
async function feedback(attemptId, kind = 'HINT', hintLevel = 2) {
  await helpPermit();
  const requested = await harness.request(
    `/attempts/${attemptId}/feedback-requests`,
    {
      actor: 'student',
      method: 'POST',
      body: { kind, ...(kind === 'HINT' ? { hintLevel } : {}) },
    },
  );
  expect(requested.status).toBe(202);
  for (let index = 0; index < 200; index++) {
    const state = await harness.request(
      `/feedback-requests/${requested.data.id}`,
      { actor: 'student' },
    );
    expect(state.status).toBe(200);
    if (state.data.feedbackId) {
      const response = await harness.request(
        `/feedback/${state.data.feedbackId}`,
        { actor: 'student' },
      );
      expect(response.status).toBe(200);
      return { ...response.data, requestId: requested.data.id };
    }
    await delay(100);
  }
  throw new Error('PHASE_HELP_TIMEOUT');
}
async function acknowledge(value) {
  const response = await harness.request(`/feedback/${value.id}/viewed`, {
    actor: 'student',
    method: 'POST',
    body: { presentationToken: value.presentationToken },
  });
  expect(response.status).toBe(200);
}

// The caller controls the transaction boundary. No dates or event order are
// supplied by the fixture; canonical finalization assigns both on the server.
async function heldSubmission(db, c, assignment, success) {
  await db.query(
    "SELECT set_config('app.actor_id',$1,true),set_config('app.session_id',$2,true),set_config('app.organization_id',$3,true)",
    [c.studentIds[0], sessions.get('student'), c.organizationId],
  );
  const source = success
    ? 'module.exports.solve=()=>1;'
    : 'module.exports.solve=()=>0;';
  const reservation = (
    await db.query(
      'SELECT app_private.admit_practice_submit($1,$2,$3,$4,$5,$6,$7,NULL::uuid,$8,$9,true,1,32,120) AS value',
      [
        randomUUID(),
        assignment.activityId,
        assignment.id,
        assignment.versionId,
        randomUUID(),
        createHash('sha256').update(source).digest('hex'),
        source,
        'dashboard-fixture-v1',
        randomUUID(),
      ],
    )
  ).rows[0].value;
  expect(reservation.kind).toBe('reserved');
  await db.query(
    "SELECT set_config('app.actor_id','',true),set_config('app.session_id','',true),set_config('app.organization_id','',true)",
  );
  const technical = contracts.submitTechnicalResultSchema.parse({
    runnerVersion: 'dashboard-fixture-v1',
    diagnosisCode: success ? 'SUCCESS' : 'FAILED_TEST',
    terminationReason: success ? 'COMPLETED' : 'ASSERTION_FAILED',
    infrastructureStatus: 'OK',
    visibleTestResults: [
      { id: 'dashboard-visible', passed: success, stdout: '', stderr: '' },
    ],
    visiblePassed: success ? 1 : 0,
    visibleTotal: 1,
    outputTruncated: false,
    outputBytes: 0,
    runtimeMs: 1,
    lifecycleMs: 1,
    hiddenChecksPassed: success,
    allRequiredPassed: success,
  });
  expect(
    (
      await db.query(
        'SELECT app_private.stage_practice_submit_result($1,$2,$3::jsonb,$4::jsonb) AS value',
        [
          reservation.executionId,
          reservation.leaseToken,
          JSON.stringify(technical),
          JSON.stringify([
            {
              id: assignment.hiddenId ?? 'DASHBOARD_HIDDEN_SENTINEL',
              passed: success,
            },
          ]),
        ],
      )
    ).rows[0].value,
  ).toBe(true);
  const value = (
    await db.query(
      'SELECT app_private.finish_practice_submit($1,$2,true) AS value',
      [reservation.executionId, reservation.leaseToken],
    )
  ).rows[0].value;
  return value.attempt ?? value;
}

beforeAll(async () => {
  if (process.env.ALUNZA_TEST_API_URL !== 'http://127.0.0.1:4300')
    throw new Error('Phase acceptance requires isolated LAB TEST.');
  const state = JSON.parse(readFileSync(process.env.ALUNZA_TEST_STATE, 'utf8'));
  const { createDashboardHarness } =
    await import('../e2e/dashboard-fixture.mjs');
  harness = await createDashboardHarness(state);
  const url = new URL(state.migrationUrl);
  url.username = 'alunza_app';
  url.password = state.applicationPassword;
  application = new Pool({
    connectionString: url.href,
    max: 3,
    allowExitOnIdle: true,
  });
  for (const actor of ['teacher', 'student']) {
    const auth = createClient(state.authUrl, state.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const result = await auth.auth.signInWithPassword({
      email: harness.actors[actor].email,
      password: state.fixturePassword,
    });
    expect(result.error).toBeNull();
    sessions.set(
      actor,
      JSON.parse(
        Buffer.from(
          result.data.session.access_token.split('.')[1],
          'base64url',
        ),
      ).session_id,
    );
  }
}, 90_000);
afterEach(() => clearHelpFault());
afterAll(async () => {
  await application?.end();
  await harness?.close();
});

test('IMP05-AC-01 · SIG13/14: missing and altered projections rebuild without changing public facts, reviews or neighboring scopes', async () => {
  const c = await harness.prepare({ signals: true });
  await harness.historical(c);
  const neighbor = await harness.prepare({ signals: true });
  const at = await cutAfter();
  const before = await views(c, at);
  const neighboringViews = await views(neighbor, at);
  expect(before.dashboard.summary).toMatchObject({
    completed: 1,
    required: 6,
    students: 2,
  });
  expect(before.progress.summary).toMatchObject({ completed: 1, required: 3 });
  const original = await facts(c),
    neighboringFacts = await facts(neighbor);
  const rows = (
    await harness.database.query(
      `SELECT p.episode_id,p.payload,p.digest FROM app_private.signal_projections p
    JOIN app_private.signal_lanes l ON l.id=p.lane_id WHERE l.organization_id=$1 ORDER BY p.episode_id`,
      [c.organizationId],
    )
  ).rows;
  expect(rows).toHaveLength(2);
  await harness.database.query(
    'DELETE FROM app_private.signal_projections WHERE episode_id=$1',
    [rows[0].episode_id],
  );
  await harness.database.query(
    'UPDATE app_private.signal_projections SET payload=$2::jsonb WHERE episode_id=$1',
    [rows[1].episode_id, '{"alteredFixture":true}'],
  );
  expect(await views(c, at)).toEqual(before);
  const checked = await maintenance('check', c, at);
  expect(checked.consistent).toBe(false);
  expect(checked.mismatches).toBe(2);
  expect(checked.verifiedEvaluations).toBeGreaterThan(0);
  const replayBefore = await replay(c, at);
  for (let index = 0; index < 2; index++) {
    const rebuilt = await maintenance('rebuild', c, at);
    expect(rebuilt.consistent).toBe(true);
    expect(rebuilt.operationalStateChanged).toBe(false);
    expect((await maintenance('report', c, at)).mismatches).toBe(0);
    expect(await facts(c)).toBe(original);
    expect(await views(c, at)).toEqual(before);
    expect(await replay(c, at)).toBe(replayBefore);
  }
  expect(
    (
      await harness.database.query(
        `SELECT p.episode_id,p.payload,p.digest FROM app_private.signal_projections p
    JOIN app_private.signal_lanes l ON l.id=p.lane_id WHERE l.organization_id=$1 ORDER BY p.episode_id`,
        [c.organizationId],
      )
    ).rows,
  ).toEqual(rows);
  expect(await facts(neighbor)).toBe(neighboringFacts);
  expect(await views(neighbor, at)).toEqual(neighboringViews);
  for (const actor of ['admin', 'foreignTeacher', 'student'])
    expect(
      (await harness.request(`/classes/${c.classroomId}/dashboard`, { actor }))
        .status,
    ).toBe(404);
  expect(
    (await harness.request(`/classes/${c.otherClassId}/dashboard`)).status,
  ).toBe(404);
  expect(await views(c, at)).toEqual(before);
}, 180_000);

test('IMP05-AC-07 · query optimization preserves freshness states, unacknowledged changes and public counts', async () => {
  const c = await harness.prepare({ signals: true });
  await harness.processSignals(c);
  const at = await cutAfter();
  const beforeFacts = await facts(c);
  const db = await harness.database.connect();
  try {
    await db.query('BEGIN; GRANT alunza_app,alunza_identity TO postgres');
    await db.query(
      "SELECT set_config('app.actor_id',$1,true),set_config('app.session_id',$2,true),set_config('app.organization_id',$3,true)",
      [harness.actors.teacher.id, sessions.get('teacher'), c.organizationId],
    );
    async function project() {
      await db.query('SET LOCAL ROLE alunza_app');
      const result = (
        await db.query(
          'SELECT app_private.dashboard_read($1,$2::jsonb) AS dashboard,app_private.dashboard_signals($1,$3::jsonb) AS signals',
          [
            c.classroomId,
            JSON.stringify({ asOf: at }),
            JSON.stringify({ asOf: at, state: 'ALL', limit: 100 }),
          ],
        )
      ).rows[0];
      contracts.dashboardResponseSchema.parse({
        data: result.dashboard,
        requestId: randomUUID(),
      });
      contracts.dashboardSignalsResponseSchema.parse({
        data: result.signals,
        requestId: randomUUID(),
      });
      expect(result.dashboard.signals.processing).toEqual(
        result.signals.processing,
      );
      for (const count of result.dashboard.signals.counts) {
        const selected = result.signals.data.filter(
          (signal) =>
            signal.type === count.type && signal.state === count.state,
        );
        expect(count).toMatchObject({
          count: selected.length,
          currentStudents: selected.filter((signal) => signal.currentMember)
            .length,
          historicalStudents: selected.filter((signal) => !signal.currentMember)
            .length,
        });
      }
      await db.query('RESET ROLE');
      return result;
    }
    const baseline = await project();
    expect(baseline.signals.processing).toMatchObject({
      status: 'UP_TO_DATE',
      pendingLanes: 0,
      failedLanes: 0,
    });
    const lane = (
      await db.query(
        "SELECT id FROM app_private.signal_lanes WHERE class_id=$1 AND type='STAGNATION' ORDER BY id LIMIT 1",
        [c.classroomId],
      )
    ).rows[0].id;
    const laneCount = (
      await db.query(
        `SELECT count(*)::int AS count FROM app_private.signal_lanes l
        JOIN app.signal_rule_versions v ON v.organization_id=l.organization_id AND v.type=l.type
        WHERE l.class_id=$1 AND v.valid_from<=$2 AND (v.valid_to IS NULL OR v.valid_to>$2)`,
        [c.classroomId, at],
      )
    ).rows[0].count;
    async function variant(sql, values, expected) {
      await db.query('SAVEPOINT freshness');
      const changed = await db.query(sql, values);
      expect(changed.rowCount).toBeGreaterThan(0);
      const current = await project();
      expect(current.signals.processing).toMatchObject(expected);
      expect(current.signals.processing.evaluatedAt).toBe(
        baseline.signals.processing.evaluatedAt,
      );
      expect(current.dashboard.summary).toEqual(baseline.dashboard.summary);
      expect(current.dashboard.signals.counts).toEqual(
        baseline.dashboard.signals.counts,
      );
      expect(current.signals.data).toEqual(baseline.signals.data);
      await db.query('ROLLBACK TO SAVEPOINT freshness');
    }
    const pending = { status: 'PENDING', pendingLanes: 1, failedLanes: 0 };
    await variant(
      "UPDATE app_private.signal_jobs SET last_revision=repeat('0',64) WHERE lane_id=$1",
      [lane],
      pending,
    );
    await variant(
      "UPDATE app_private.signal_jobs SET failed_at=clock_timestamp(),attempts=5,last_error_code='PROCESSING_FAILED' WHERE lane_id=$1",
      [lane],
      { status: 'FAILED', pendingLanes: 0, failedLanes: 1 },
    );
    await variant(
      'DELETE FROM app_private.signal_jobs WHERE lane_id=$1',
      [lane],
      pending,
    );
    // Explicit operational fixture, rolled back with this connection: a finalized
    // change without ACK must remain pending even when its time is beyond T and
    // the clock revision matches. No canonical producer or immutable ACK changes.
    await variant(
      `INSERT INTO app_private.signal_input_changes(component,scope_key,organization_id,source,source_id,occurred_at,finalized_revision,finalized_at)
       SELECT 'REVIEW',l.id::text,l.organization_id,'IMP05_ACCEPTANCE_OPERATIONAL_FIXTURE',l.id,$2::timestamptz+interval '1 day',clock.revision,clock_timestamp()
       FROM app_private.signal_lanes l JOIN app_private.signal_evidence_clocks clock ON clock.component='REVIEW' AND clock.scope_key=l.id::text WHERE l.id=$1`,
      [lane, at],
      pending,
    );
    await variant(
      'UPDATE app_private.signal_jobs SET next_deadline_micros=0 WHERE lane_id=$1',
      [lane],
      pending,
    );
    await variant(
      "UPDATE app_private.signal_jobs SET continuation='{}' WHERE lane_id=$1",
      [lane],
      pending,
    );
    await variant(
      'UPDATE app_private.signal_jobs j SET through_time=NULL,boundary_key=NULL FROM app_private.signal_lanes l WHERE l.id=j.lane_id AND l.class_id=$1',
      [c.classroomId],
      {
        status: 'NOT_EVALUATED',
        pendingLanes: laneCount,
        failedLanes: 0,
        processedThrough: null,
      },
    );
    expect(stripObserved(await project())).toEqual(stripObserved(baseline));
  } finally {
    await db.query('ROLLBACK');
    db.release();
  }
  expect(await facts(c)).toBe(beforeFacts);
}, 180_000);

test('IMP05-AC-02 · HU015/016/018: late canonical commit changes the same cut, exposes pending work and preserves prior evaluations', async () => {
  const c = await harness.prepare({ signals: true });
  const oldEvaluations = (
    await harness.database.query(
      'SELECT e.id,e.result FROM app_private.signal_evaluations e JOIN app_private.signal_lanes l ON l.id=e.lane_id WHERE l.organization_id=$1 ORDER BY e.id',
      [c.organizationId],
    )
  ).rows;
  const db = await application.connect();
  let open = false;
  try {
    await db.query('BEGIN');
    open = true;
    const attempt = await heldSubmission(db, c, c.assignments[0], true);
    const at = await cutAfter(attempt.submittedAt);
    await harness.processSignals(c); // advances through T without seeing the held fact
    const before = await views(c, at);
    expect(before.dashboard.summary.period.attempts).toBe(5);
    await db.query('COMMIT');
    open = false;
    const pending = await views(c, at);
    expect(pending.dashboard.summary.period.attempts).toBe(6);
    expect(pending.dashboard.summary.completed).toBe(1);
    expect(pending.dashboard.signals.processing.status).toBe('PENDING');
    expect(
      pending.evidence.data.some(
        (entry) => entry.attempt?.id === attempt.attemptId,
      ),
    ).toBe(true);
    await harness.processSignals(c);
    const after = await views(c, at);
    expect(after.dashboard.summary).toEqual(pending.dashboard.summary);
    expect(after.dashboard.signals.processing.pendingLanes).toBe(0);
    const current = (
      await harness.database.query(
        'SELECT e.id,e.result FROM app_private.signal_evaluations e WHERE e.id=ANY($1::uuid[]) ORDER BY e.id',
        [oldEvaluations.map((e) => e.id)],
      )
    ).rows;
    expect(current).toEqual(oldEvaluations);
    expect(await replay(c, await cutAfter())).toMatch(/^[a-f0-9]{64}$/);
    const stable = await facts(c);
    await views(c, at);
    expect(await facts(c)).toBe(stable);
  } finally {
    if (open) await db.query('ROLLBACK');
    db.release();
  }
}, 180_000);

test('IMP05-AC-03 · RNF-CON02/IA05: real TEST help, unavailable and contradictory generation preserve outcomes; eligible ACK changes inactivity once', async () => {
  const c = await harness.prepare({ signals: true });
  const before = await inactivity(c);
  await helpPermit(2);
  expect(await harness.help({ ...c, supported: true })).toMatchObject({
    feedbackViews: 1,
    deliveredHints: 1,
    status: 'SUPPORTED',
  });
  const delivered = await inactivity(c);
  expect(micros(delivered.result.evidence.lastAt)).toBeGreaterThan(
    micros(before.result.evidence.lastAt),
  );
  const reference = (
    await harness.database.query(
      "SELECT id,app_private.signal_instant(occurred_at) AS at FROM app_private.help_events WHERE attempt_id=$1 AND event_type='HINT_DELIVERED'",
      [c.attemptIds[1]],
    )
  ).rows;
  expect(reference).toHaveLength(1);
  expect(delivered.result.evidence.lastAt).toBe(reference[0].at);
  expect(delivered.result.evidence.referenceEvents).toContainEqual({
    source: 'HELP',
    id: reference[0].id,
  });
  const at = await cutAfter(reference[0].at);
  const stableViews = await views(c, at);
  const replayBefore = await replay(c, at);
  const resultBefore = (
    await harness.database.query(
      'SELECT technical_result FROM app.attempts WHERE id=$1',
      [c.attemptIds[1]],
    )
  ).rows[0].technical_result;
  for (const scenario of [
    'generation-unavailable',
    'diagnosis-contradiction',
  ]) {
    setHelpFault({ attemptId: c.attemptIds[1], scenario });
    const failure = await feedback(c.attemptIds[1]);
    expect(failure.help.status).toBe('PROVIDER_UNAVAILABLE');
    expect(failure.help.diagnosis_code).toBe('FAILED_TEST');
    expect(failure.help.hint).toBe('');
    expect(failure.presentationToken).toBeNull();
    const calls = (
      await harness.database.query(
        "SELECT phase,state,result FROM app_private.help_calls WHERE request_id=$1 AND phase='GENERATION'",
        [failure.requestId],
      )
    ).rows;
    expect(calls).toHaveLength(1); // actual provider dispatch, not an unused fault flag
    expect(calls[0].state).toBe(
      scenario === 'generation-unavailable' ? 'DISPATCHED' : 'COMPLETED',
    );
    if (scenario === 'diagnosis-contradiction')
      expect(calls[0].result.candidate.diagnosis_code).toBe('SUCCESS');
    expect(
      (
        await harness.database.query(
          "SELECT count(*)::integer n FROM app_private.help_events WHERE request_id=$1 AND event_type<>'HELP_REQUESTED'",
          [failure.requestId],
        )
      ).rows[0].n,
    ).toBe(0);
    const unchanged = await inactivity(c);
    expect(unchanged.result.evidence.lastAt).toBe(
      delivered.result.evidence.lastAt,
    );
    expect(unchanged.deadline).toBe(delivered.deadline);
    const after = await views(c, at);
    // Processing is current metadata; the original cut and pedagogical data stay fixed.
    expect(after.dashboard.summary).toEqual(stableViews.dashboard.summary);
    expect(after.evidence).toEqual(stableViews.evidence);
    expect(after.progress).toEqual(stableViews.progress);
    expect(after.signals.data).toEqual(stableViews.signals.data);
    expect(await replay(c, at)).toBe(replayBefore);
    expect(
      (
        await harness.database.query(
          'SELECT technical_result FROM app.attempts WHERE id=$1',
          [c.attemptIds[1]],
        )
      ).rows[0].technical_result,
    ).toEqual(resultBefore);
  }
  setHelpFault({
    attemptId: c.attemptIds[1],
    scenario: 'generation-unavailable',
  });
  const unavailableFeedback = await feedback(c.attemptIds[1], 'FEEDBACK');
  expect(unavailableFeedback.help.status).toBe('PROVIDER_UNAVAILABLE');
  expect(unavailableFeedback.presentationToken).toBeTruthy();
  expect((await inactivity(c)).result.evidence.lastAt).toBe(
    delivered.result.evidence.lastAt,
  );
  await acknowledge(unavailableFeedback);
  await acknowledge(unavailableFeedback);
  const fallbackRead = await inactivity(c);
  const fallbackEvents = (
    await harness.database.query(
      "SELECT id,app_private.signal_instant(occurred_at) AS at FROM app_private.help_events WHERE request_id=$1 AND event_type='FEEDBACK_VIEWED'",
      [unavailableFeedback.requestId],
    )
  ).rows;
  expect(fallbackEvents).toHaveLength(1);
  expect(fallbackRead.result.evidence.lastAt).toBe(fallbackEvents[0].at);
  expect(fallbackRead.result.evidence.referenceEvents).toContainEqual({
    source: 'HELP',
    id: fallbackEvents[0].id,
  });
  clearHelpFault();
  const hint = await feedback(c.attemptIds[1]);
  expect(hint.help.status).toBe('SUPPORTED');
  const priorAck = await inactivity(c);
  expect(priorAck.result.evidence.lastAt).toBe(
    fallbackRead.result.evidence.lastAt,
  );
  await acknowledge(hint);
  await acknowledge(hint);
  const afterAck = await inactivity(c);
  expect(micros(afterAck.result.evidence.lastAt)).toBeGreaterThan(
    micros(priorAck.result.evidence.lastAt),
  );
  const events = (
    await harness.database.query(
      "SELECT id,app_private.signal_instant(occurred_at) AS at FROM app_private.help_events WHERE request_id=$1 AND event_type='HINT_DELIVERED'",
      [hint.requestId],
    )
  ).rows;
  expect(events).toHaveLength(1);
  expect(afterAck.result.evidence.lastAt).toBe(events[0].at);
  for (let index = 0; index < 3; index++)
    await harness.request(`/feedback/${hint.id}`, { actor: 'student' });
  expect((await inactivity(c)).result.evidence.lastAt).toBe(events[0].at);
}, 240_000);

test('IMP05-AC-04 · HU015/016/018-E3: enrollment termination uses the current roster while retaining historical episodes', async () => {
  const c = await harness.prepare({ signals: true });
  const at = await cutAfter();
  const before = await views(c, at);
  await harness.database.query(
    'UPDATE app.class_memberships SET ended_at=clock_timestamp() WHERE class_id=$1 AND user_id=$2 AND ended_at IS NULL',
    [c.classroomId, c.studentIds[0]],
  );
  const summary = await read(
    `/classes/${c.classroomId}/dashboard?${query({ asOf: at })}`,
    contracts.dashboardResponseSchema,
  );
  expect(summary.summary).toMatchObject({
    students: 1,
    completed: 0,
    required: 3,
  });
  const history = await read(
    `/classes/${c.classroomId}/signals?${query({ asOf: at, state: 'ALL' })}`,
    contracts.dashboardSignalsResponseSchema,
  );
  expect(history.data.map((s) => s.id)).toEqual(
    before.signals.data.map((s) => s.id),
  );
  expect(history.data.every((s) => !s.currentMember)).toBe(true);
  expect(
    (
      await harness.request(
        `/me/progress?${query({ classId: c.classroomId, asOf: at })}`,
        { actor: 'student' },
      )
    ).status,
  ).toBe(404);
  for (const signal of history.data)
    expect(
      (
        await read(
          `/classes/${c.classroomId}/signals/${signal.id}?${query({ asOf: at })}`,
          contracts.dashboardSignalDetailResponseSchema,
        )
      ).signal.currentMember,
    ).toBe(false);
}, 120_000);

test('IMP05-AC-05 · E24: a real commit predating review creates a new witness outside the immutable reviewed base', async () => {
  const c = await harness.prepare({ signals: true });
  const db = await application.connect();
  let open = false;
  try {
    await db.query('BEGIN');
    open = true;
    const late = await heldSubmission(db, c, c.assignments[0], false);
    const { signalId } = await harness.review(c);
    const review = (
      await harness.database.query(
        'SELECT *,app_private.signal_instant(reviewed_at) AS exact_reviewed_at FROM app_private.signal_reviews WHERE episode_id=$1',
        [signalId],
      )
    ).rows[0];
    expect(micros(late.submittedAt)).toBeLessThanOrEqual(
      micros(review.exact_reviewed_at),
    );
    const base = (
      await harness.database.query(
        'SELECT input_references FROM app_private.signal_snapshots WHERE id=$1',
        [review.snapshot_id],
      )
    ).rows[0].input_references;
    expect(base.submissions.some((a) => a.id === late.attemptId)).toBe(false);
    const atReview = await read(
      `/classes/${c.classroomId}/signals/${signalId}?${query({ asOf: review.exact_reviewed_at })}`,
      contracts.dashboardSignalDetailResponseSchema,
    );
    expect(atReview.signal.state).toBe('REVIEWED');
    await db.query('COMMIT');
    open = false;
    await harness.processSignals(c);
    const after = await read(
      `/classes/${c.classroomId}/signals?${query({ state: 'ALL', type: 'REPEATED_ERROR' })}`,
      contracts.dashboardSignalsResponseSchema,
    );
    expect(after.data).toHaveLength(2);
    const original = after.data.find((e) => e.id === signalId);
    const next = after.data.find((e) => e.previousEpisodeId === signalId);
    expect(original.state).toBe('REVIEWED');
    expect(original.reviewedAt).toBe(review.exact_reviewed_at);
    expect(original.reviewedBy).toBe(review.reviewed_by);
    expect(next).toBeDefined();
    expect(next.state).toBe('ACTIVE');
    expect(next.rule.id).toBe(original.rule.id);
    const detail = await read(
      `/classes/${c.classroomId}/signals/${next.id}`,
      contracts.dashboardSignalDetailResponseSchema,
    );
    expect(detail.evidence.attempts.map((a) => a.id)).toContain(late.attemptId);
    expect(
      (
        await harness.database.query(
          'SELECT *,app_private.signal_instant(reviewed_at) AS exact_reviewed_at FROM app_private.signal_reviews WHERE episode_id=$1',
          [signalId],
        )
      ).rows[0],
    ).toEqual(review);
    const currentCut = await cutAfter();
    const beforeRebuild = await views(c, currentCut);
    await maintenance('rebuild', c, currentCut);
    expect(await views(c, currentCut)).toEqual(beforeRebuild);
    expect(await replay(c, currentCut)).toMatch(/^[a-f0-9]{64}$/);
  } finally {
    if (open) await db.query('ROLLBACK');
    db.release();
  }
}, 180_000);

test('IMP05-AC-06 · E18/E22: publishing exercise v2 preserves v1 history and progress; activities, assignments and versions never share a triplet', async () => {
  const c = await harness.prepare({ empty: true });
  expect(c.assignments[0].versionId).toBe(c.assignments[2].versionId);
  for (const type of ['REPEATED_ERROR', 'STAGNATION']) {
    const created = await harness.request(
      `/organizations/${c.organizationId}/signal-rules`,
      {
        actor: 'admin',
        method: 'POST',
        body: {
          type,
          schemaVersion: 1,
          algorithmVersion: 'DEC005_V1',
          parameters:
            type === 'STAGNATION'
              ? { stagnationAttempts: 3 }
              : { repeatedErrorAttempts: 3, repeatedErrorWindowDays: 14 },
        },
      },
    );
    expect(created.status).toBe(201);
    expect(
      (
        await harness.request(`/signal-rules/${created.data.id}/activate`, {
          actor: 'admin',
          method: 'POST',
          body: { expectedCurrentVersionId: null },
        })
      ).status,
    ).toBe(200);
  }
  const a1 = await harness.submit(c, 0),
    a2 = await harness.submit(c, 0),
    b1 = await harness.submit(c, 2);
  await harness.processSignals(c);
  expect(
    (
      await read(
        `/classes/${c.classroomId}/signals?state=ALL`,
        contracts.dashboardSignalsResponseSchema,
      )
    ).data,
  ).toEqual([]);
  const success = await harness.submit(c, 0, true);
  const before = await views(c, await cutAfter(success.submittedAt));
  expect(before.progress.summary).toMatchObject({ completed: 1, required: 3 });
  const exercise = (
    await harness.database.query(
      'SELECT e.id,e.revision FROM app.exercises e JOIN app.exercise_versions v ON v.exercise_id=e.id WHERE v.id=$1',
      [c.assignments[0].versionId],
    )
  ).rows[0];
  const concepts = (
    await harness.database.query(
      'SELECT concept_version_id FROM app.exercise_version_concepts WHERE exercise_version_id=$1 ORDER BY concept_version_id',
      [c.assignments[0].versionId],
    )
  ).rows.map((row) => row.concept_version_id);
  const version = await harness.request(`/exercises/${exercise.id}/versions`, {
    method: 'POST',
    headers: { 'If-Match': `"${exercise.revision}"` },
    body: {
      title: 'Versión dos independiente',
      statement: 'Devuelve uno; la publicación anterior conserva sus pruebas.',
      starterCode: 'module.exports.solve=()=>0;',
      language: 'javascript',
      entrypoint: 'solve',
      difficulty: 'BEGINNER',
      conceptVersionIds: concepts,
      tests: [
        {
          id: 'dashboard-visible',
          visibility: 'visible',
          args: [],
          expected: 1,
        },
        {
          id: 'PHASE_VERSION_PRIVATE',
          visibility: 'hidden',
          args: [1],
          expected: 1,
        },
      ],
      executionLimits: {
        memoryBytes: 134217728,
        runtimeMs: 3000,
        outputBytes: 65536,
      },
    },
  });
  expect(version.status).toBe(201);
  expect(version.data.version).toBe(2);
  const original = await harness.request(
    `/activities/${c.activityIds[0]}/exercises/${c.assignments[0].id}`,
    { actor: 'student' },
  );
  expect(original.status).toBe(200);
  expect(original.data.exerciseVersionId).toBe(c.assignments[0].versionId);
  expect((await views(c, await cutAfter())).progress.summary).toEqual(
    before.progress.summary,
  );
  const draft = await harness.request(`/classes/${c.classroomId}/activities`, {
    method: 'POST',
    body: {
      title: 'Asignación versión dos',
      instructions: 'Evidencia separada',
      type: 'FORMATIVE',
      opensAt: null,
      closesAt: null,
      exercises: [
        { exerciseVersionId: version.data.id, position: 0, required: true },
      ],
    },
  });
  expect(draft.status).toBe(201);
  const published = await harness.request(
    `/activities/${draft.data.id}/publish`,
    { method: 'POST', headers: { 'If-Match': `"${draft.data.revision}"` } },
  );
  expect(published.status).toBe(200);
  const assignment = {
    id: published.data.exercises[0].id,
    activityId: published.data.id,
    versionId: version.data.id,
    hiddenId: 'PHASE_VERSION_PRIVATE',
  };
  const newAttempts = [];
  for (let index = 0; index < 2; index++)
    newAttempts.push(
      await internal((db) => heldSubmission(db, c, assignment, false)),
    );
  await harness.processSignals(c);
  expect(
    (
      await read(
        `/classes/${c.classroomId}/signals?state=ALL`,
        contracts.dashboardSignalsResponseSchema,
      )
    ).data,
  ).toEqual([]);
  newAttempts.push(
    await internal((db) => heldSubmission(db, c, assignment, false)),
  );
  await harness.processSignals(c);
  const final = await views(c, await cutAfter(newAttempts[2].submittedAt));
  expect(final.progress.summary).toMatchObject({ completed: 1, required: 4 });
  expect(final.dashboard.summary).toMatchObject({ completed: 1, required: 8 });
  expect(final.signals.data).toHaveLength(2);
  expect(
    final.signals.data.every((s) => s.activityExerciseId === assignment.id),
  ).toBe(true);
  for (const detail of final.details) {
    expect(detail.evidence.attempts.map((a) => a.id).sort()).toEqual(
      newAttempts.map((a) => a.attemptId).sort(),
    );
    expect(
      detail.evidence.attempts.every(
        (a) => a.exerciseVersionId === version.data.id,
      ),
    ).toBe(true);
  }
  for (const previous of [a1, a2, b1, success])
    expect(
      final.evidence.data.find((e) => e.attempt?.id === previous.attemptId)
        .attempt.exerciseVersionId,
    ).toBe(c.assignments[0].versionId);
}, 180_000);
