/* eslint @typescript-eslint/no-require-imports: "off" */
const { readFileSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');
const pg = require('pg');
const contracts = require('@alunza/contracts');
require('reflect-metadata');
let harness, worker, helpers, fixtureState;
const review = (scope, options = {}) =>
  harness.request(`/signals/${scope.signalId}/review`, {
    method: 'PUT',
    body: {},
    ...options,
  });
const facts = (scope) =>
  helpers.signalReviewFacts(harness.database, scope, scope.signalId);
const sources = (scope) =>
  helpers.immutableReviewSources(harness.database, scope);
function assertReviewed(response, scope, actor = 'teacher') {
  expect(response.status).toBe(200);
  expect(response.noStore).toBe(true);
  contracts.signalReviewResponseSchema.parse({
    data: response.data,
    requestId: response.requestId,
  });
  expect(response.data).toMatchObject({
    signalId: scope.signalId,
    classId: scope.classroomId,
    studentId: scope.studentId,
    state: 'REVIEWED',
    reviewedBy: harness.actors[actor].id,
  });
  expect(response.data.reviewedAt).toMatch(/\.\d{6}Z$/);
  expect(response.data.reviewedByName.length).toBeGreaterThan(0);
  for (const forbidden of [
    'DASHBOARD_HIDDEN_SENTINEL',
    'base_witness_keys',
    'snapshot_id',
    'base_digest',
  ])
    expect(JSON.stringify(response)).not.toContain(forbidden);
}
beforeAll(async () => {
  if (process.env.ALUNZA_TEST_API_URL !== 'http://127.0.0.1:4300')
    throw new Error('Revisión requiere LAB TEST.');
  const state = JSON.parse(readFileSync(process.env.ALUNZA_TEST_STATE, 'utf8'));
  fixtureState = state;
  const { createSignalReviewHarness } =
    await import('../e2e/signal-review-fixture.mjs');
  helpers = await import('./helpers/signal-review.mjs');
  harness = await createSignalReviewHarness(state);
  worker = await helpers.signalReviewWorker(state);
}, 180000);
afterAll(async () => {
  await worker?.close();
  await harness?.close();
});

test('HU019-E1: revisión pública confirma responsable, fecha, una auditoría y evidencia original sin IA', async () => {
  const scope = await harness.prepare();
  const before = await facts(scope),
    immutable = await sources(scope);
  expect(before.episode.state).toBe('ACTIVE');
  expect(before.reviews).toEqual([]);
  const response = await review(scope);
  assertReviewed(response, scope);
  const after = await facts(scope);
  expect(after.reviews).toHaveLength(1);
  expect(after.audits).toHaveLength(1);
  expect(after.audits[0]).toMatchObject({
    actor_id: harness.actors.teacher.id,
    entity_type: 'SIGNAL',
    action: 'SIGNAL_REVIEWED',
  });
  const retained = ({
    state: _state,
    reviewed_by: _by,
    reviewed_at: _at,
    stopped_at: _stopped,
    stop_reason: _reason,
    ...value
  }) => value;
  expect(retained(after.episode)).toEqual(retained(before.episode));
  expect(await sources(scope)).toEqual(immutable);
  const old = await harness.request(
    `/classes/${scope.classroomId}/signals/${scope.signalId}?asOf=${encodeURIComponent(scope.asOf)}`,
  );
  expect(old.status).toBe(200);
  expect(old.data.signal.state).toBe('ACTIVE');
  expect(old.data.signal.reviewedAt).toBeNull();
  const current = await harness.request(
    `/classes/${scope.classroomId}/signals/${scope.signalId}`,
  );
  expect(current.status).toBe(200);
  expect(current.data.signal).toMatchObject({
    state: 'REVIEWED',
    reviewedBy: response.data.reviewedBy,
    reviewedAt: response.data.reviewedAt,
  });
  const atReview = await harness.request(
    `/classes/${scope.classroomId}/signals/${scope.signalId}?asOf=${encodeURIComponent(response.data.reviewedAt)}`,
  );
  expect(atReview.data.signal.state).toBe('REVIEWED');
}, 180000);

test('HU019-E2: identificadores/payload/query inválidos y ámbitos ajenos no mutan ni revelan datos', async () => {
  const scope = await harness.prepare({ realSubmit: false });
  const before = await facts(scope);
  expect(
    (
      await harness.request('/signals/invalid/review', {
        method: 'PUT',
        body: {},
      })
    ).status,
  ).toBe(422);
  expect((await review({ ...scope, signalId: randomUUID() })).status).toBe(404);
  for (const body of [
    { reviewedBy: harness.actors.teacher.id },
    { reviewedAt: scope.asOf },
    { state: 'REVIEWED' },
    { classId: scope.classroomId },
  ])
    expect((await review(scope, { body })).status).toBe(422);
  expect(
    (
      await harness.request(
        `/signals/${scope.signalId}/review?asOf=${scope.asOf}`,
        { method: 'PUT', body: {} },
      )
    ).status,
  ).toBe(422);
  for (const actor of ['admin', 'student', 'foreignAdmin', 'foreignTeacher']) {
    const denied = await review(scope, { actor });
    expect([403, 404]).toContain(denied.status);
    expect(denied.data).toBeUndefined();
    expect(JSON.stringify(denied)).not.toContain(scope.classroomId);
  }
  expect((await review(scope, { actor: null })).status).toBe(401);
  expect(
    (await review(scope, { headers: { Authorization: 'Bearer invalid' } }))
      .status,
  ).toBe(401);
  expect(await facts(scope)).toEqual(before);
});

test('HU019-E3: revocación de membresía, matrícula o perfil con JWT anterior impide confirmar', async () => {
  const scope = await harness.prepare({ realSubmit: false });
  const before = await facts(scope);
  for (const actor of ['teacher', 'student']) {
    await harness.database.query(
      "UPDATE app.organization_memberships SET state='DISABLED' WHERE organization_id=$1 AND user_id=$2",
      [scope.organizationId, harness.actors[actor].id],
    );
    try {
      expect([403, 404]).toContain((await review(scope)).status);
    } finally {
      await harness.database.query(
        "UPDATE app.organization_memberships SET state='ACTIVE' WHERE organization_id=$1 AND user_id=$2",
        [scope.organizationId, harness.actors[actor].id],
      );
    }
  }
  await harness.database.query(
    'UPDATE app.class_memberships SET ended_at=clock_timestamp() WHERE organization_id=$1 AND class_id=$2 AND user_id=$3',
    [scope.organizationId, scope.classroomId, scope.studentId],
  );
  try {
    expect((await review(scope)).status).toBe(404);
  } finally {
    await harness.database.query(
      'UPDATE app.class_memberships SET ended_at=NULL WHERE organization_id=$1 AND class_id=$2 AND user_id=$3',
      [scope.organizationId, scope.classroomId, scope.studentId],
    );
  }
  await harness.database.query(
    "UPDATE app.profiles SET account_state='DISABLED' WHERE id=$1",
    [harness.actors.teacher.id],
  );
  try {
    expect([401, 403, 404]).toContain((await review(scope)).status);
  } finally {
    await harness.database.query(
      "UPDATE app.profiles SET account_state='ACTIVE' WHERE id=$1",
      [harness.actors.teacher.id],
    );
  }
  expect(await facts(scope)).toEqual(before);
});

test('HU019-E4/SIG14: dos solicitudes concurrentes observan una revisión y replay conserva primer resultado', async () => {
  const scope = await harness.prepare({ realSubmit: false });
  const sessions = await Promise.all(
    Array.from({ length: 2 }, async () => {
      const auth = createClient(
        fixtureState.authUrl,
        fixtureState.publishableKey,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
      const result = await auth.auth.signInWithPassword({
        email: harness.actors.teacher.email,
        password: fixtureState.fixturePassword,
      });
      expect(result.error).toBeNull();
      return result.data.session;
    }),
  );
  const sessionId = (session) =>
    JSON.parse(
      Buffer.from(session.access_token.split('.')[1], 'base64url').toString(),
    ).session_id;
  expect(sessionId(sessions[0])).not.toBe(sessionId(sessions[1]));
  const holder = await harness.database.connect();
  let requests;
  try {
    await holder.query('BEGIN');
    await holder.query(
      'SELECT lane_id FROM app_private.signal_jobs WHERE lane_id=(SELECT lane_id FROM app_private.signal_episodes WHERE id=$1) FOR UPDATE',
      [scope.signalId],
    );
    requests = sessions.map((session) =>
      review(scope, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      }),
    );
    await helpers.waitForReviewLocks(harness.database, 2);
    await holder.query('COMMIT');
  } finally {
    await holder.query('ROLLBACK');
    holder.release();
  }
  const responses = await Promise.all(requests);
  for (const response of responses) assertReviewed(response, scope);
  expect(responses[1].data).toEqual(responses[0].data);
  const first = await facts(scope);
  expect(first.reviews).toHaveLength(1);
  expect(first.audits).toHaveLength(1);
  // A client that lost the first response retries the same semantic operation.
  expect((await review(scope)).data).toEqual(responses[0].data);
  expect(await facts(scope)).toEqual(first);
});

test('HU019-E3/E4: reasignación durante espera se reautoriza y sucesor preserva primera revisión', async () => {
  const scope = await harness.prepare({ realSubmit: false });
  const holder = await harness.database.connect();
  let request;
  try {
    await holder.query('BEGIN');
    // Runtime governance takes this lock before committing a reassignment.
    // The fixture owner must reproduce it explicitly.
    await holder.query(
      'SELECT id FROM app.organizations WHERE id=$1 FOR UPDATE',
      [scope.organizationId],
    );
    await holder.query('UPDATE app.classes SET teacher_id=$2 WHERE id=$1', [
      scope.classroomId,
      harness.actors.foreignTeacher.id,
    ]);
    request = review(scope);
    await helpers.waitForReviewLocks(harness.database);
    await holder.query('COMMIT');
  } finally {
    await holder.query('ROLLBACK');
    holder.release();
  }
  expect((await request).status).toBe(404);
  const accepted = await review(scope, { actor: 'foreignTeacher' });
  assertReviewed(accepted, scope, 'foreignTeacher');
  const saved = await facts(scope);
  await harness.database.query(
    'UPDATE app.classes SET teacher_id=$2 WHERE id=$1',
    [scope.classroomId, harness.actors.teacher.id],
  );
  expect((await review(scope)).data).toEqual(accepted.data);
  expect(await facts(scope)).toEqual(saved);
});

test('fallo de auditoría revierte episodio, revisión y proyección; reintento posterior confirma una vez', async () => {
  const scope = await harness.prepare({ realSubmit: false });
  const before = await facts(scope),
    immutable = await sources(scope);
  const clearFault = await helpers.reviewAuditFailure(harness.database, scope);
  try {
    const failed = await review(scope);
    expect(failed.status).toBe(503);
    expect(failed.data).toBeUndefined();
    expect(await facts(scope)).toEqual(before);
    expect(await sources(scope)).toEqual(immutable);
  } finally {
    await clearFault();
  }
  assertReviewed(await review(scope), scope);
  expect((await facts(scope)).audits).toHaveLength(1);
});

test('matrícula histórica y clase archivada no se revisan; actividad CLOSED conserva revisión autorizada', async () => {
  const scope = await harness.prepare({ realSubmit: false });
  const before = await facts(scope);
  await harness.database.query(
    "UPDATE app.activities SET state='CLOSED' WHERE id=ANY($1::uuid[])",
    [scope.activityIds],
  );
  await harness.database.query(
    'UPDATE app.classes SET archived_at=clock_timestamp() WHERE id=$1',
    [scope.classroomId],
  );
  expect((await review(scope)).status).toBe(409);
  expect(await facts(scope)).toEqual(before);
  const closed = await harness.prepare({ realSubmit: false });
  await harness.database.query(
    "UPDATE app.activities SET state='CLOSED' WHERE id=ANY($1::uuid[])",
    [closed.activityIds],
  );
  assertReviewed(await review(closed), closed);
});

test('lease/captura concurrente no cambia base; replay y reconstrucción conservan revisión original', async () => {
  const scope = await harness.prepare({ realSubmit: false });
  const laneId = (await facts(scope)).episode.lane_id;
  await harness.submit(scope, 0, false);
  const job = await worker.repository.claim(laneId);
  expect(job).not.toBeNull();
  const snapshot = await worker.repository.capture(job);
  expect(snapshot).not.toBeNull();
  const before = await facts(scope);
  try {
    const busy = await review(scope);
    expect(busy.status).toBe(409);
    expect(busy.error.code).toBe('REQUEST_IN_PROGRESS');
    expect(await facts(scope)).toEqual(before);
  } finally {
    expect(['COMMITTED', 'REPLAY']).toContain(
      (await worker.finish(job, snapshot)).status,
    );
  }
  assertReviewed(await review(scope), scope);
  const reviewed = await facts(scope);
  await harness.submit(scope, 0, false);
  const laterJob = await worker.repository.claim(laneId);
  expect(laterJob).not.toBeNull();
  const laterSnapshot = await worker.repository.capture(laterJob);
  try {
    assertReviewed(await review(scope), scope);
    expect(await facts(scope)).toEqual(reviewed);
  } finally {
    expect(['COMMITTED', 'REPLAY']).toContain(
      (await worker.finish(laterJob, laterSnapshot)).status,
    );
  }
  await harness.processSignals(scope);
  const asOf = (
    await harness.database.query(
      'SELECT app_private.signal_instant(clock_timestamp()) AS value',
    )
  ).rows[0].value;
  const maintenanceScope = {
    organizationId: scope.organizationId,
    classId: scope.classroomId,
    studentId: scope.studentId,
    activityId: scope.activityIds[0],
    asOf,
  };
  await worker.repository.maintenance('rebuild', maintenanceScope);
  const after = await facts(scope);
  expect(after.episode.state).toBe('REVIEWED');
  expect(after.reviews).toEqual(reviewed.reviews);
  expect(after.audits).toEqual(reviewed.audits);
  const newer = await harness.database.query(
    'SELECT count(*)::integer AS count FROM app_private.signal_episodes WHERE lane_id=$1 AND previous_episode_id=$2',
    [laneId, scope.signalId],
  );
  expect(newer.rows[0].count).toBe(1);
});

test('captura de revisión espera el fence de cobertura y toma el corte después del escritor', async () => {
  // Negative control in the exclusive TEST database: reproduce the previous
  // unfenced function, observe premature commit, then restore its exact DDL.
  // No repository migration or canonical source is rewritten by this control.
  const unfencedScope = await harness.prepare({ realSubmit: false });
  const definition = (
    await harness.database.query(
      "SELECT pg_get_functiondef('app_private.signal_review(uuid)'::regprocedure) AS value",
    )
  ).rows[0].value;
  const fence =
    /\s+lock table app\.profiles,app\.organizations,[\s\S]*?perform 1 from app_private\.signal_coverage_epochs where ends_at is null order by source,id for share;/;
  const unfencedDefinition = definition.replace(fence, '');
  expect(unfencedDefinition === definition).toBe(false);
  const control = new pg.Client({
    connectionString: fixtureState.migrationUrl,
  });
  await control.connect();
  const privileges = (
    await control.query(
      "SELECT pg_has_role('postgres','alunza_identity','MEMBER') AS member,pg_has_role('postgres','alunza_identity','SET') AS can_set,pg_has_role('postgres','alunza_identity','USAGE') AS can_inherit,has_schema_privilege('alunza_identity','app_private','CREATE') AS create_schema",
    )
  ).rows[0];
  let grantedRole = false,
    grantedCreate = false,
    changedDefinition = false;
  try {
    if (!privileges.can_set) {
      await control.query('GRANT alunza_identity TO postgres');
      grantedRole = true;
    }
    if (!privileges.create_schema) {
      await control.query(
        'GRANT CREATE ON SCHEMA app_private TO alunza_identity',
      );
      grantedCreate = true;
    }
    await control.query('SET ROLE alunza_identity');
    await control.query(unfencedDefinition);
    changedDefinition = true;
    await control.query('RESET ROLE');
    await control.query('BEGIN');
    await control.query(
      'SELECT source FROM app_private.signal_capture_registry ORDER BY source FOR UPDATE',
    );
    const premature = await review(unfencedScope);
    assertReviewed(premature, unfencedScope);
    expect((await facts(unfencedScope)).reviews).toHaveLength(1);
  } finally {
    try {
      await control.query('ROLLBACK');
      if (changedDefinition) {
        await control.query('SET ROLE alunza_identity');
        await control.query(definition);
      }
    } finally {
      try {
        await control.query('RESET ROLE');
        if (grantedCreate)
          await control.query(
            'REVOKE CREATE ON SCHEMA app_private FROM alunza_identity',
          );
        if (grantedRole)
          await control.query('REVOKE alunza_identity FROM postgres');
      } finally {
        await control.end();
      }
    }
  }
  const restoredPrivileges = (
    await harness.database.query(
      "SELECT pg_has_role('postgres','alunza_identity','MEMBER') AS member,pg_has_role('postgres','alunza_identity','SET') AS can_set,pg_has_role('postgres','alunza_identity','USAGE') AS can_inherit,has_schema_privilege('alunza_identity','app_private','CREATE') AS create_schema",
    )
  ).rows[0];
  expect(restoredPrivileges).toEqual(privileges);
  const restored = (
    await harness.database.query(
      "SELECT pg_get_functiondef('app_private.signal_review(uuid)'::regprocedure) AS value",
    )
  ).rows[0].value;
  expect(restored === definition).toBe(true);
  const scope = await harness.prepare({ realSubmit: false });
  const original = await facts(scope);
  const laneId = original.episode.lane_id;
  const countSnapshots = async () =>
    (
      await harness.database.query(
        'SELECT count(*)::integer AS count FROM app_private.signal_snapshots WHERE lane_id=$1',
        [laneId],
      )
    ).rows[0].count;
  const initialSnapshots = await countSnapshots();
  const holder = await harness.database.connect();
  let pending,
    settled = false,
    barrierAt;
  try {
    await holder.query('BEGIN');
    await holder.query(
      'SELECT source FROM app_private.signal_capture_registry ORDER BY source FOR UPDATE',
    );
    pending = review(scope).then((response) => {
      settled = true;
      return response;
    });
    await helpers.waitForReviewLocks(harness.database);
    expect(settled).toBe(false);
    expect(await facts(scope)).toEqual(original);
    expect(await countSnapshots()).toBe(initialSnapshots);
    barrierAt = (
      await holder.query(
        'SELECT app_private.signal_instant(clock_timestamp()) AS value',
      )
    ).rows[0].value;
    await holder.query('COMMIT');
  } finally {
    await holder.query('ROLLBACK');
    holder.release();
  }
  const response = await pending;
  assertReviewed(response, scope);
  const captured = (
    await harness.database.query(
      `SELECT s.observed_through >= $2::timestamptz AS after_barrier,
    app_private.signal_instant(s.observed_through) AS observed_through
    FROM app_private.signal_reviews r JOIN app_private.signal_snapshots s ON s.id=r.snapshot_id WHERE r.episode_id=$1`,
      [scope.signalId, barrierAt],
    )
  ).rows[0];
  expect(captured.after_barrier).toBe(true);
  expect(captured.observed_through).toBe(response.data.reviewedAt);
  expect((await facts(scope)).audits).toHaveLength(1);
});
