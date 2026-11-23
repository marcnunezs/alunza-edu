/* eslint @typescript-eslint/no-require-imports: "off" */
const { readFileSync, existsSync, writeFileSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const { URLSearchParams } = require('node:url');
const { resolve } = require('node:path');
const { setHelpFault, clearHelpFault } = require('../help-fault-controls.cjs');
const contracts = require('@alunza/contracts');
let harness;
const query = (values) =>
  new URLSearchParams(
    Object.entries(values).filter(
      ([, value]) => value !== null && value !== undefined,
    ),
  ).toString();
const dashboard = (c, values = {}) =>
  `/classes/${c.classroomId}/dashboard?${query({ asOf: c.asOf, ...values })}`;
const evidence = (c, values = {}) =>
  `/classes/${c.classroomId}/dashboard/evidence?${query({ asOf: c.asOf, ...values })}`;
const signals = (c, values = {}) =>
  `/classes/${c.classroomId}/signals?${query(values)}`;
async function read(path, schema, options) {
  const response = await harness.request(path, options);
  if (response.status !== 200) {
    const code = /^[A-Z_]{3,60}$/.test(response.error?.code ?? '')
      ? response.error.code
      : 'UNKNOWN';
    const fields = (response.error?.fields ?? [])
      .map((entry) => entry.field)
      .filter((field) => /^[A-Za-z][A-Za-z0-9_.]{0,60}$/.test(field));
    throw new Error(
      `Dashboard HTTP ${response.status}; code=${code}; fields=${fields.join(',') || 'none'}`,
    );
  }
  expect(response.status).toBe(200);
  expect(response.noStore).toBe(true);
  schema.parse({ data: response.data, requestId: response.requestId });
  const serialized = JSON.stringify(response.data);
  for (const forbidden of [
    'DASHBOARD_HIDDEN_SENTINEL',
    'module.exports',
    'privateTestResults',
    'clockVector',
    'coverageHistory',
  ])
    expect(serialized).not.toContain(forbidden);
  return response.data;
}

beforeAll(async () => {
  if (process.env.ALUNZA_TEST_API_URL !== 'http://127.0.0.1:4300')
    throw new Error('Dashboard integration requires isolated LAB TEST.');
  const state = JSON.parse(readFileSync(process.env.ALUNZA_TEST_STATE, 'utf8'));
  const { createDashboardHarness } =
    await import('../e2e/dashboard-fixture.mjs');
  harness = await createDashboardHarness(state);
}, 90_000);
afterAll(async () => {
  await harness?.close();
});

test('HU016-E1: cifras y conceptos se contrastan con 6 obligaciones, 1 logro y 5 intentos independientes', async () => {
  const c = await harness.prepare();
  const result = await read(dashboard(c), contracts.dashboardResponseSchema);
  expect(result.roster).toBe('CURRENT_ACTIVE');
  expect(result.summary).toMatchObject({
    students: 2,
    completed: 1,
    required: 6,
    ratio: 1 / 6,
    evidenceState: 'HAS_EVIDENCE',
    period: {
      attempts: 5,
      technicalFailures: 4,
      unverifiableAttempts: 0,
      hintsDelivered: 0,
    },
  });
  expect(result.summary.period.byDiagnosis).toEqual([
    { diagnosisCode: 'SUCCESS', count: 1 },
    { diagnosisCode: 'SYNTAX_ERROR', count: 0 },
    { diagnosisCode: 'RUNTIME_ERROR', count: 0 },
    { diagnosisCode: 'FAILED_TEST', count: 4 },
    { diagnosisCode: 'TIMEOUT', count: 0 },
    { diagnosisCode: 'UNKNOWN', count: 0 },
  ]);
  expect(
    result.byActivity.find((entry) => entry.activityId === c.activityIds[0]),
  ).toMatchObject({ completed: 1, required: 4, period: { attempts: 5 } });
  expect(
    result.byActivity.find((entry) => entry.activityId === c.activityIds[1]),
  ).toMatchObject({ completed: 0, required: 2, period: { attempts: 0 } });
  expect(
    result.byConcept.find((entry) => entry.conceptId === c.conceptIds[0]),
  ).toMatchObject({
    completed: 1,
    required: 4,
    period: { attempts: 4, technicalFailures: 3 },
  });
  expect(
    result.byConcept.find((entry) => entry.conceptId === c.conceptIds[1]),
  ).toMatchObject({
    completed: 1,
    required: 6,
    period: { attempts: 5, technicalFailures: 4 },
  });
  const filtered = await read(
    dashboard(c, { conceptId: c.conceptIds[0], activityId: c.activityIds[0] }),
    contracts.dashboardResponseSchema,
  );
  expect(filtered.summary).toMatchObject({
    completed: 1,
    required: 2,
    period: { attempts: 4, technicalFailures: 3 },
  });
  const completions = await read(
    evidence(c, { kind: 'COMPLETION' }),
    contracts.dashboardEvidenceResponseSchema,
  );
  expect(completions.data).toHaveLength(1);
  expect(completions.data[0]).toMatchObject({
    kind: 'COMPLETION',
    attempt: { id: c.attemptIds[0], allRequiredPassed: true },
  });
});

test('HU015/016-E1: período limita observación y conserva éxito acumulado previo; corte es inclusivo', async () => {
  const c = await harness.prepare();
  const from = c.attemptTimes.at(-1);
  const current = await read(
    dashboard(c, { from }),
    contracts.dashboardResponseSchema,
  );
  expect(current.summary).toMatchObject({
    completed: 1,
    required: 6,
    period: { attempts: 1, technicalFailures: 1 },
  });
  const atSuccess = await read(
    dashboard(c, { asOf: c.afterSuccess }),
    contracts.dashboardResponseSchema,
  );
  expect(atSuccess.summary).toMatchObject({
    completed: 1,
    required: 6,
    period: { attempts: 1, technicalFailures: 0 },
  });
  const previous = await read(
    dashboard(c, { asOf: c.beforeAttempts }),
    contracts.dashboardResponseSchema,
  );
  expect(previous.summary).toMatchObject({
    completed: 0,
    required: 6,
    evidenceState: 'NO_ATTEMPTS',
    period: { attempts: 0 },
  });
  const own = await read(
    `/me/progress?${query({ classId: c.classroomId, from, asOf: c.asOf })}`,
    contracts.studentProgressResponseSchema,
    { actor: 'student' },
  );
  expect(own.summary).toMatchObject({ completed: 1, required: 3 });
  expect(own.observation.summary).toMatchObject({
    attempts: 1,
    technicalFailures: 1,
  });
  expect(own.observation.attempts.map((attempt) => attempt.id)).toEqual([
    c.attemptIds.at(-1),
  ]);
});

test('HU016-E1/E2: evidencia y alumnado paginan sin duplicación y cursor no cambia el ámbito', async () => {
  const c = await harness.prepare();
  const all = [];
  let cursor;
  do {
    const page = await read(
      evidence(c, { limit: 2, cursor }),
      contracts.dashboardEvidenceResponseSchema,
    );
    all.push(...page.data.map((entry) => entry.attempt.id));
    cursor = page.page.nextCursor;
  } while (cursor);
  expect(all).toHaveLength(5);
  expect(new Set(all).size).toBe(5);
  expect(all.sort()).toEqual([...c.attemptIds].sort());
  const first = await read(
    dashboard(c, { limit: 1 }),
    contracts.dashboardResponseSchema,
  );
  expect(first.students.data).toHaveLength(1);
  expect(first.students.page.hasMore).toBe(true);
  const next = await read(
    dashboard(c, { limit: 1, cursor: first.students.page.nextCursor }),
    contracts.dashboardResponseSchema,
  );
  expect(next.students.data).toHaveLength(1);
  expect(next.students.data[0].studentId).not.toBe(
    first.students.data[0].studentId,
  );
  expect(next.summary).toEqual(first.summary);
  expect(
    (
      await harness.request(
        dashboard(c, {
          cursor: first.students.page.nextCursor,
          conceptId: c.conceptIds[0],
        }),
      )
    ).status,
  ).toBe(422);
});

test('HU015/016/018-E2/E3: filtros inválidos, roles, otra clase y organización no revelan datos', async () => {
  const c = await harness.prepare({ signals: true });
  for (const values of [
    { from: c.asOf, asOf: c.beforeAttempts },
    { studentId: c.studentIds[0] },
    { limit: 101 },
    { activityId: 'incorrecto' },
    { asOf: '2026-01-01T12:00:00' },
  ])
    expect((await harness.request(dashboard(c, values))).status).toBe(422);
  expect(
    (await harness.request(dashboard(c, { asOf: '2099-01-01T00:00:00Z' })))
      .status,
  ).toBe(400);
  expect(
    (await harness.request(dashboard(c, { activityId: randomUUID() }))).status,
  ).toBe(404);
  expect(
    (await harness.request(signals(c, { state: 'RESOLVED' }))).status,
  ).toBe(422);
  expect(
    (await harness.request(signals(c, { from: c.beforeAttempts }))).status,
  ).toBe(422);
  const firstSignal = c.signals[0].id;
  const routes = [
    dashboard(c),
    evidence(c),
    signals(c),
    `/classes/${c.classroomId}/signals/${firstSignal}`,
  ];
  for (const path of routes) {
    expect((await harness.request(path, { actor: null })).status).toBe(401);
    for (const actor of [
      'admin',
      'student',
      'foreignTeacher',
      'foreignAdmin',
    ]) {
      const denied = await harness.request(path, { actor });
      expect(denied.status).toBe(404);
      expect(denied.data).toBeUndefined();
      expect(JSON.stringify(denied)).not.toContain(c.name);
    }
  }
  expect(
    (await harness.request(`/classes/${c.otherClassId}/dashboard`)).status,
  ).toBe(404);
  await harness.revoke(c);
  expect((await harness.request(dashboard(c))).status).toBe(404);
});

test('HU016-E4/HU018-E4: sin intentos y sin reglas informa cero observado, sin evaluación y 0/0 histórico', async () => {
  const c = await harness.prepare({ empty: true });
  const result = await read(dashboard(c), contracts.dashboardResponseSchema);
  expect(result.summary).toMatchObject({
    students: 2,
    completed: 0,
    required: 6,
    evidenceState: 'NO_ATTEMPTS',
    period: { attempts: 0, hintsDelivered: 0 },
  });
  expect([...result.signals.processing.unconfiguredTypes].sort()).toEqual([
    'INACTIVITY',
    'REPEATED_ERROR',
    'STAGNATION',
  ]);
  const list = await read(signals(c), contracts.dashboardSignalsResponseSchema);
  expect(list.data).toEqual([]);
  const historic = await read(
    dashboard(c, { asOf: '2020-01-01T00:00:00Z' }),
    contracts.dashboardResponseSchema,
  );
  expect(historic.summary).toMatchObject({
    completed: 0,
    required: 0,
    ratio: null,
    evidenceState: 'NO_REQUIRED_EXERCISES',
  });
});

test('HU018-E1: tres tipos, evidencia pública y REVIEWED histórico permanecen separados de condición actual', async () => {
  const c = await harness.prepare({ signals: true });
  expect(c.signals.map((entry) => entry.type).sort()).toEqual([
    'REPEATED_ERROR',
    'STAGNATION',
  ]);
  const beforeReview = (
    await read(signals(c), contracts.dashboardSignalsResponseSchema)
  ).asOf;
  const historical = await harness.historical(c);
  await harness.syntheticInactivity(c);
  const result = await read(
    signals(c, { state: 'ALL' }),
    contracts.dashboardSignalsResponseSchema,
  );
  expect(result.data.map((entry) => entry.type).sort()).toEqual([
    'INACTIVITY',
    'REPEATED_ERROR',
    'STAGNATION',
  ]);
  const reviewed = result.data.find(
    (entry) => entry.id === historical.reviewedId,
  );
  expect(reviewed.state).toBe('REVIEWED');
  expect(reviewed.reviewedAt).not.toBeNull();
  const stopped = result.data.find((entry) => entry.type === 'STAGNATION');
  expect(stopped.state).toBe('ACTIVE');
  expect(stopped.stoppedAt).not.toBeNull();
  expect(stopped.lastEvaluation.outcome).toBe('NO_MATCH');
  const earlier = await read(
    signals(c, { asOf: beforeReview, state: 'ALL' }),
    contracts.dashboardSignalsResponseSchema,
  );
  expect(earlier.data.find((entry) => entry.id === reviewed.id)).toMatchObject({
    state: 'ACTIVE',
    reviewedAt: null,
    stoppedAt: null,
  });
  for (const signal of result.data) {
    const detail = await read(
      `/classes/${c.classroomId}/signals/${signal.id}`,
      contracts.dashboardSignalDetailResponseSchema,
    );
    expect(detail.signal.rule.configuration.type).toBe(signal.type);
    expect(detail.signal.cause).not.toBe('');
    if (signal.type !== 'INACTIVITY')
      expect(detail.evidence.attempts).toHaveLength(3);
    else expect(detail.evidence.lastAt).not.toBeNull();
  }
  for (let index = 0; index < 3; index++) await harness.submit(c, 0, false);
  await harness.processSignals(c);
  const renewed = await read(
    signals(c, { state: 'ALL' }),
    contracts.dashboardSignalsResponseSchema,
  );
  const oldEpisode = renewed.data.find((entry) => entry.id === stopped.id);
  const newEpisode = renewed.data.find(
    (entry) =>
      entry.type === 'STAGNATION' && entry.previousEpisodeId === stopped.id,
  );
  expect(oldEpisode.lastEvaluation).toEqual(stopped.lastEvaluation);
  expect(oldEpisode.lastEvaluation.evaluationTime <= oldEpisode.stoppedAt).toBe(
    true,
  );
  expect(newEpisode).toBeDefined();
  expect(newEpisode.rule.id).toBe(oldEpisode.rule.id);
  expect(newEpisode.lastEvaluation.outcome).toBe('MATCH');
  expect(newEpisode.stoppedAt).toBeNull();
}, 120_000);

test('HU018-E2: trabajo FAILED y referencia ausente informan limitación sin borrar señales ni fabricar cero', async () => {
  const c = await harness.prepare({ signals: true });
  const before = await read(
    `/classes/${c.classroomId}/dashboard`,
    contracts.dashboardResponseSchema,
  );
  const job = (
    await harness.database.query(
      "SELECT j.lane_id,j.attempts,j.failed_at,j.last_error_code FROM app_private.signal_jobs j JOIN app_private.signal_lanes l ON l.id=j.lane_id WHERE l.organization_id=$1 AND l.student_id=$2 AND l.type='REPEATED_ERROR' ORDER BY l.id LIMIT 1",
      [c.organizationId, c.studentIds[0]],
    )
  ).rows[0];
  expect(job).toBeDefined();
  try {
    await harness.database.query(
      "UPDATE app_private.signal_jobs SET attempts=5,failed_at=clock_timestamp(),last_error_code='PROCESSING_FAILED' WHERE lane_id=$1",
      [job.lane_id],
    );
    const failed = await read(
      `/classes/${c.classroomId}/dashboard`,
      contracts.dashboardResponseSchema,
    );
    expect(failed.signals.processing.status).toBe('FAILED');
    expect(failed.signals.processing.failedLanes).toBeGreaterThan(0);
    expect(failed.signals.counts).toEqual(before.signals.counts);
    expect(failed.summary.completed).toBe(1);
  } finally {
    await harness.database.query(
      'UPDATE app_private.signal_jobs SET attempts=$2,failed_at=$3,last_error_code=$4 WHERE lane_id=$1',
      [job.lane_id, job.attempts, job.failed_at, job.last_error_code],
    );
  }
  const cut = before.asOf;
  const stableDashboard = await read(
    dashboard(c, { asOf: cut }),
    contracts.dashboardResponseSchema,
  );
  const stableSignals = await read(
    signals(c, { asOf: cut, state: 'ALL' }),
    contracts.dashboardSignalsResponseSchema,
  );
  const withoutObservationTime = ({ observedAt: _observedAt, ...rest }) => rest;
  const controlPath = resolve(
    __dirname,
    '../../.local/help-fault-control.json',
  );
  const previousControl = existsSync(controlPath)
    ? readFileSync(controlPath)
    : null;
  try {
    for (const scenario of [
      'generation-unavailable',
      'diagnosis-contradiction',
    ]) {
      setHelpFault({ attemptId: c.attemptIds[1], scenario });
      // No new help request or ACK is made: the persisted facts, signal
      // snapshots, rules and cutoff must remain identical in both conditions.
      const unchangedDashboard = await read(
        dashboard(c, { asOf: cut }),
        contracts.dashboardResponseSchema,
      );
      const unchangedSignals = await read(
        signals(c, { asOf: cut, state: 'ALL' }),
        contracts.dashboardSignalsResponseSchema,
      );
      expect(withoutObservationTime(unchangedDashboard)).toEqual(
        withoutObservationTime(stableDashboard),
      );
      expect(withoutObservationTime(unchangedSignals)).toEqual(
        withoutObservationTime(stableSignals),
      );
    }
  } finally {
    if (previousControl)
      writeFileSync(controlPath, previousControl, { mode: 0o600 });
    else clearHelpFault();
  }
  const missing = await harness.syntheticInactivity({
    ...c,
    missingReference: true,
  });
  const detail = await read(
    `/classes/${c.classroomId}/signals/${missing.signalId}`,
    contracts.dashboardSignalDetailResponseSchema,
  );
  expect(detail.signal.state).toBe('ACTIVE');
  expect(detail.signal.verification).toBe('UNVERIFIABLE');
  expect(detail.evidence.events).toEqual([]);
  expect(detail.evidence.explanation).not.toBe('');
}, 90_000);

test('HU016/018-E3: alumno deshabilitado sale del denominador actual y sus señales conservan historia', async () => {
  const c = await harness.prepare({ signals: true });
  await harness.revoke(c, 'student');
  const result = await read(dashboard(c), contracts.dashboardResponseSchema);
  expect(result.summary).toMatchObject({
    students: 1,
    completed: 0,
    required: 3,
    period: { attempts: 0 },
  });
  expect(result.students.data.map((entry) => entry.studentId)).toEqual([
    c.studentIds[1],
  ]);
  const history = await read(
    signals(c, { state: 'ALL' }),
    contracts.dashboardSignalsResponseSchema,
  );
  expect(history.data).toHaveLength(2);
  expect(history.data.every((entry) => entry.currentMember === false)).toBe(
    true,
  );
});

test('HU015/016-E1: fallback leído produce un evento real, replay no duplica pistas ni altera completitud', async () => {
  const c = await harness.prepare();
  const before = await read(
    `/classes/${c.classroomId}/dashboard`,
    contracts.dashboardResponseSchema,
  );
  expect(await harness.help(c)).toEqual({
    feedbackViews: 1,
    deliveredHints: 0,
    status: 'NO_EVIDENCE',
  });
  const after = await read(
    `/classes/${c.classroomId}/dashboard`,
    contracts.dashboardResponseSchema,
  );
  expect(after.summary.completed).toBe(before.summary.completed);
  expect(after.summary.period.attempts).toBe(5);
  expect(after.summary.period.hintsDelivered).toBe(0);
  expect(after.summary.period.activityEvents).toBe(
    before.summary.period.activityEvents + 1,
  );
  const events = await read(
    `/classes/${c.classroomId}/dashboard/evidence?kind=EVENT`,
    contracts.dashboardEvidenceResponseSchema,
  );
  expect(
    events.data.filter((entry) => entry.event.eventType === 'FEEDBACK_VIEWED'),
  ).toHaveLength(1);
}, 60_000);
