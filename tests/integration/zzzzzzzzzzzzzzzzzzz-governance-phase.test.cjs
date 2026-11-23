/* eslint @typescript-eslint/no-require-imports: "off" */
const { readFileSync } = require('node:fs');
const { writeFile } = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const { URLSearchParams } = require('node:url');
const contracts = require('@alunza/contracts');
const identity = require('../../fixtures/foundation/identity.json');
let harness, exportHarness, csv, scope, releaseObserved, academic;
const evidence = [];
const detail = (c = scope) =>
  `/classes/${c.classroomId}/students/${c.studentId}`;
const governance = (c = scope) => `/exercises/${c.exerciseId}/governance`;
const exportsPath = (c = scope) =>
  `/organizations/${c.organizationId}/audit-exports`;
const request = (path, options = {}) => harness.request(scope, path, options);
const admin = (path, options = {}) =>
  request(path, { actor: 'admin', ...options });
const review = () =>
  request(`/signals/${scope.signalId}/review`, { method: 'PUT', body: {} });
const history = async () => (await harness.snapshot(scope)).history;
async function now() {
  return (
    await harness.database.query(
      'SELECT app_private.signal_instant(clock_timestamp()) AS value',
    )
  ).rows[0].value;
}
function safe(result) {
  expect(JSON.stringify(result)).not.toMatch(
    /DASHBOARD_HIDDEN_SENTINEL|presentationToken|dispatch_token|safe_changes|help_inputs|access_token/,
  );
}
function denied(result) {
  expect([403, 404]).toContain(result.status);
  expect(result.data).toBeUndefined();
  expect(result.noStore).toBe(true);
  safe(result);
}
async function createExport(body, key = randomUUID()) {
  const result = await admin(exportsPath(), { method: 'POST', body, key });
  expect(result.status).toBe(201);
  expect(result.noStore).toBe(true);
  contracts.auditExportResponseSchema.parse({
    data: result.data,
    requestId: result.requestId,
  });
  return result.data;
}
async function download(metadata, options = {}) {
  const result = await request(
    `${exportsPath()}/${metadata.exportId}/content`,
    { actor: 'admin', binary: true, ...options },
  );
  expect(result.status).toBe(200);
  expect(result.headers['cache-control']).toContain('no-store');
  expect(result.headers['content-type']).toMatch(
    /^text\/csv;\s*charset=utf-8/i,
  );
  expect(result.headers['x-content-type-options']).toBe('nosniff');
  const parsed = csv(result.bytes);
  expect(parsed.sha256).toBe(metadata.sha256);
  expect(parsed.byteLength).toBe(metadata.byteLength);
  expect(parsed.rowCount).toBe(metadata.rowCount);
  expect(parsed.rows.every((row) => row[6] === scope.organizationId)).toBe(
    true,
  );
  safe(result.bytes.toString('utf8'));
  return { ...result, parsed };
}
async function versionBody() {
  const concepts = (
    await harness.database.query(
      'SELECT concept_version_id FROM app.exercise_version_concepts WHERE exercise_version_id=$1 ORDER BY concept_version_id',
      [scope.versionId],
    )
  ).rows;
  return {
    title: 'Nueva versión de la historia integrada',
    statement: 'Devuelve el valor dos.',
    starterCode: 'module.exports.solve=()=>2;',
    language: 'javascript',
    entrypoint: 'solve',
    difficulty: 'INTERMEDIATE',
    conceptVersionIds: concepts.map((row) => row.concept_version_id),
    tests: [
      { id: 'visible-phase', visibility: 'visible', args: [], expected: 2 },
    ],
    executionLimits: {
      memoryBytes: 134217728,
      runtimeMs: 3000,
      outputBytes: 65536,
    },
  };
}
async function blockedRequests(holder, requests, expected) {
  return releaseObserved(harness.database, holder, requests, expected);
}
beforeAll(async () => {
  if (process.env.ALUNZA_TEST_API_URL !== 'http://127.0.0.1:4300')
    throw new Error('Governance phase requires isolated LAB TEST.');
  const state = JSON.parse(readFileSync(process.env.ALUNZA_TEST_STATE, 'utf8'));
  const fixture = await import('../e2e/governance-phase-fixture.mjs');
  const audit = await import('../e2e/audit-fixture.mjs');
  academic = await import('../../fixtures/demo/academic.mjs');
  releaseObserved = (await import('./helpers/governance-phase.mjs'))
    .releaseObservedGovernanceRequests;
  harness = await fixture.createGovernancePhaseHarness(state);
  exportHarness = audit.createAuditExportHarness(state);
  csv = audit.readAuditCsv;
}, 180000);
beforeEach(async () => {
  scope = await harness.prepare();
}, 180000);
afterAll(async () => {
  try {
    await exportHarness?.close();
  } finally {
    await harness?.close();
  }
  if (process.env.ALUNZA_GOVERNANCE_PHASE_FACTS)
    await writeFile(
      process.env.ALUNZA_GOVERNANCE_PHASE_FACTS,
      JSON.stringify(evidence),
      { mode: 0o600 },
    );
});

test('IMP06-PHASE-01: misma historia Docker, ayuda entregada, detalle y revisión idempotente', async () => {
  const before = await history();
  expect(before.attempts.count).toBe(3);
  expect(new Set(scope.attemptIds).size).toBe(3);
  const progress = await request(
    `${detail()}/progress?asOf=${encodeURIComponent(scope.asOf)}`,
  );
  expect(progress.status).toBe(200);
  contracts.studentDetailProgressResponseSchema.parse({
    data: progress.data,
    requestId: progress.requestId,
  });
  expect(progress.data.progress.observation.summary.attempts).toBe(3);
  for (const attemptId of scope.attemptIds) {
    const attempt = await request(
      `${detail()}/attempts/${attemptId}?asOf=${encodeURIComponent(scope.asOf)}`,
    );
    expect(attempt.status).toBe(200);
    expect(attempt.data.attempt.technicalResult.diagnosisCode).toBe(
      'FAILED_TEST',
    );
    expect(attempt.data.exercise.exerciseVersionId).toBe(scope.versionId);
    safe(attempt);
  }
  const help = await request(
    `${detail()}/feedback/${scope.hintId}?asOf=${encodeURIComponent(scope.asOf)}`,
  );
  expect(help.status).toBe(200);
  expect(help.data.feedback.help.status).toBe('SUPPORTED');
  expect(help.data.feedback.help.diagnosis_code).toBe('FAILED_TEST');
  const signal = await request(
    `${detail()}/signals/${scope.signalId}?asOf=${encodeURIComponent(scope.asOf)}`,
  );
  expect(signal.status).toBe(200);
  expect(signal.data.signal.state).toBe('ACTIVE');
  expect(signal.data.evidence.attempts.map((item) => item.id).sort()).toEqual(
    [...scope.attemptIds].sort(),
  );
  expect(await history()).toEqual(before);
  const reviewed = await review();
  expect(reviewed.status).toBe(200);
  expect(reviewed.data.reviewedBy).toBe(scope.teacherId);
  expect(reviewed.data.reviewedAt).toBeTruthy();
  expect((await review()).data).toEqual(reviewed.data);
  const facts = await harness.facts(scope);
  expect(facts.reviews).toHaveLength(1);
  expect(facts.audits.SIGNAL_REVIEWED).toBe(1);
  expect(await history()).toEqual(before);
  evidence.push({
    caseId: 'IMP06-PHASE-01',
    organizationId: scope.organizationId,
    attemptIds: scope.attemptIds,
    signalId: scope.signalId,
    realAttempts: 3,
    deliveredHints: 1,
    reviews: 1,
  });
}, 180000);

test('IMP06-PHASE-02: versión, gobierno y archivo conservan historia; visor y CSV coinciden con sus hechos', async () => {
  const before = await history();
  const original = await admin(governance());
  expect(original.status).toBe(200);
  const version = await admin(`/exercises/${scope.exerciseId}/versions`, {
    method: 'POST',
    body: await versionBody(),
    revision: original.data.revision,
  });
  expect(version.status).toBe(201);
  const updated = await admin(governance());
  expect(updated.data.currentVersion.id).not.toBe(scope.versionId);
  const changed = await admin(governance(), {
    method: 'PATCH',
    revision: updated.data.revision,
    body: { ownerId: scope.adminId, visibility: 'PRIVATE' },
  });
  expect(changed.status).toBe(200);
  const archived = await admin(`/exercises/${scope.exerciseId}/archive`, {
    method: 'POST',
    revision: changed.data.revision,
    body: {
      reason:
        'Conservar la publicación, intentos y ayuda de la historia integrada',
    },
  });
  expect(archived.status).toBe(200);
  expect(archived.data.state).toBe('ARCHIVED');
  expect((await harness.facts(scope)).exercise.archived).toBe(true);
  expect(await history()).toEqual(before);
  const cut = await now();
  const expected = (await harness.auditRows({ ...scope, asOf: cut })).filter(
    (row) => row.entityId === scope.exerciseId,
  );
  expect(expected.map((row) => row.action)).toEqual(
    expect.arrayContaining([
      'exercise.version.created',
      'exercise.governance.updated',
      'exercise.archived',
    ]),
  );
  const filters = { from: scope.from, asOf: cut, entityId: scope.exerciseId };
  const listed = await admin(
    `/organizations/${scope.organizationId}/audit-events?${new URLSearchParams({ ...filters, limit: '100' })}`,
  );
  expect(listed.status).toBe(200);
  expect(listed.data.items.map((row) => row.eventId)).toEqual(
    expected.map((row) => row.eventId),
  );
  const metadata = await createExport(filters);
  const file = await download(metadata);
  expect(file.parsed.rows).toEqual(
    expected.map((row) => [
      row.eventId,
      row.occurredAt,
      row.actorId ?? '',
      row.action,
      row.entityType,
      row.entityId ?? '',
      row.organizationId,
      row.outcome,
    ]),
  );
  expect(await history()).toEqual(before);
  evidence.push({
    caseId: 'IMP06-PHASE-02',
    organizationId: scope.organizationId,
    exerciseId: scope.exerciseId,
    originalVersionId: scope.versionId,
    exportId: metadata.exportId,
    rowCount: metadata.rowCount,
    sha256: metadata.sha256,
  });
}, 180000);

test('IMP06-PHASE-03: filtros, políticas, límites y vacíos no inventan ni publican resultados parciales', async () => {
  const before = await history();
  expect((await request(`${detail()}/progress?asOf=invalid`)).status).toBe(422);
  const empty = await request(
    `/classes/${scope.classroomId}/students/${scope.studentIds[1]}/evidence?asOf=${encodeURIComponent(scope.asOf)}`,
  );
  expect(empty.status).toBe(200);
  expect(empty.data.data).toEqual([]);
  const current = await admin(governance());
  expect(
    (
      await admin(governance(), {
        method: 'PATCH',
        revision: current.data.revision,
        body: { visibility: 'PUBLIC' },
      })
    ).status,
  ).toBe(422);
  const invalid = await versionBody();
  invalid.tests[0].visibility = 'PUBLIC';
  expect(
    (
      await admin(`/exercises/${scope.exerciseId}/versions`, {
        method: 'POST',
        body: invalid,
        revision: current.data.revision,
      })
    ).status,
  ).toBe(422);
  expect(
    (
      await admin(exportsPath(), {
        method: 'POST',
        body: { from: 'invalid', asOf: scope.asOf },
      })
    ).status,
  ).toBe(422);
  const metadata = await createExport({
    asOf: scope.asOf,
    action: 'NO_SUCH_OPERATION_IMP0607',
  });
  expect(metadata.rowCount).toBe(0);
  expect((await download(metadata)).parsed.rows).toEqual([]);
  for (const profile of ['rowOverflow', 'byteOverflow']) {
    const oversized = await exportHarness.prepare({ profile });
    const rejected = await exportHarness.create(oversized);
    expect(rejected.status).toBe(422);
    expect(rejected.body.error.code).toBe('AUDIT_EXPORT_LIMIT_EXCEEDED');
    const facts = await exportHarness.facts(oversized);
    expect(facts.exports).toHaveLength(1);
    expect(facts.exports[0]).toMatchObject({ state: 'FAILED', storedBytes: 0 });
    expect(facts.generated).toBe(0);
  }
  expect(await history()).toEqual(before);
  evidence.push({
    caseId: 'IMP06-PHASE-03',
    organizationId: scope.organizationId,
    emptyRows: 0,
    rejectedLimits: ['rows', 'bytes'],
  });
}, 180000);

test('IMP06-PHASE-04: roles, clase, organización y revocación conservan límites y rechazan sin datos', async () => {
  const before = await history();
  for (const actor of ['admin', 'student', 'foreignTeacher'])
    denied(
      await request(
        `${detail()}/progress?asOf=${encodeURIComponent(scope.asOf)}`,
        { actor },
      ),
    );
  denied(
    await request(
      `/classes/${scope.otherClassId}/students/${scope.studentId}/progress?asOf=${encodeURIComponent(scope.asOf)}`,
    ),
  );
  for (const actor of ['teacher', 'student']) {
    denied(await request(governance(), { actor }));
    denied(
      await request(`/organizations/${scope.organizationId}/audit-events`, {
        actor,
      }),
    );
  }
  const foreignOrganizationId = identity.organizations[1].id;
  const foreignClass = academic.classes.find(
    (row) => row.organizationId === foreignOrganizationId,
  );
  expect(
    (
      await harness.database.query(
        'SELECT id FROM app.classes WHERE id=$1 AND organization_id=$2',
        [foreignClass.id, foreignOrganizationId],
      )
    ).rows,
  ).toHaveLength(1);
  denied(
    await request(
      `/classes/${foreignClass.id}/students/${foreignClass.studentIds[0]}/progress?asOf=${encodeURIComponent(scope.asOf)}`,
    ),
  );
  const foreignExercise = academic.exercises.find(
    (row) => row.organizationId === foreignOrganizationId,
  );
  denied(
    await admin(`/exercises/${foreignExercise.id}/governance`, {
      method: 'PATCH',
      revision: 1,
      body: { visibility: 'PRIVATE' },
    }),
  );
  denied(await admin(`/organizations/${foreignOrganizationId}/audit-events`));
  denied(
    await admin(`/organizations/${foreignOrganizationId}/audit-exports`, {
      method: 'POST',
      body: { asOf: scope.asOf },
    }),
  );
  expect(
    (
      await admin(governance(), {
        method: 'PATCH',
        revision: 1,
        body: {
          visibility: 'ORGANIZATION',
          organizationId: foreignOrganizationId,
        },
      })
    ).status,
  ).toBe(422);
  const opened = await request(
    `/classes/${scope.classroomId}/signals/${scope.signalId}`,
  );
  expect(opened.status).toBe(200);
  await harness.revoke({ ...scope, actor: 'teacher' });
  try {
    denied(await review());
  } finally {
    await harness.revoke({ ...scope, actor: 'teacher', restore: true });
  }
  expect((await harness.facts(scope)).reviews).toEqual([]);
  expect(await history()).toEqual(before);
  evidence.push({
    caseId: 'IMP06-PHASE-04',
    organizationId: scope.organizationId,
    deniedRoles: 3,
    crossClassDenied: true,
    crossOrganizationDenied: true,
    revokedReviewDenied: true,
  });
}, 180000);

test('IMP06-PHASE-05: barreras observables serializan revisión y gobierno concurrentes', async () => {
  const before = await history();
  expect(
    (await request('/signals/invalid/review', { method: 'PUT', body: {} }))
      .status,
  ).toBe(422);
  const holder = await harness.database.connect();
  let reviewBarrier;
  try {
    await holder.query('BEGIN');
    await holder.query(
      'SELECT lane_id FROM app_private.signal_jobs WHERE lane_id=(SELECT lane_id FROM app_private.signal_episodes WHERE id=$1) FOR UPDATE',
      [scope.signalId],
    );
    const requests = [review(), review()];
    reviewBarrier = await blockedRequests(holder, requests, 2);
  } finally {
    await holder.query('ROLLBACK');
    holder.release();
  }
  const reviews = reviewBarrier.responses;
  expect(reviews.map((item) => item.status)).toEqual([200, 200]);
  expect(reviews[1].data).toEqual(reviews[0].data);
  expect((await review()).data).toEqual(reviews[0].data);
  const current = await admin(governance());
  const lock = await harness.database.connect();
  let governanceBarrier;
  try {
    await lock.query('BEGIN');
    await lock.query('SELECT id FROM app.exercises WHERE id=$1 FOR UPDATE', [
      scope.exerciseId,
    ]);
    const requests = [
      admin(governance(), {
        method: 'PATCH',
        revision: current.data.revision,
        body: { visibility: 'ORGANIZATION' },
      }),
      admin(governance(), {
        method: 'PATCH',
        revision: current.data.revision,
        body: { ownerId: scope.adminId },
      }),
    ];
    governanceBarrier = await blockedRequests(lock, requests, 2);
  } finally {
    await lock.query('ROLLBACK');
    lock.release();
  }
  const changes = governanceBarrier.responses;
  expect(changes.map((item) => item.status).sort()).toEqual([200, 412]);
  const facts = await harness.facts(scope);
  expect(facts.reviews).toHaveLength(1);
  expect(facts.audits.SIGNAL_REVIEWED).toBe(1);
  expect(facts.exercise.revision).toBe(current.data.revision + 1);
  expect(await history()).toEqual(before);
  evidence.push({
    caseId: 'IMP06-PHASE-05',
    organizationId: scope.organizationId,
    observedReviewWaiters: reviewBarrier.observed,
    observedGovernanceWaiters: governanceBarrier.observed,
    reviews: 1,
    governanceChanges: 1,
  });
}, 180000);

test('IMP06-PHASE-06: replay recupera instantánea idéntica y entrega reautoriza al solicitante', async () => {
  const before = await history();
  const key = randomUUID(),
    body = { from: scope.from, asOf: await now() };
  // Discard the application response after its real request completed; recover
  // by the same transport key rather than regenerate with a new request.
  const discarded = await createExport(body, key);
  const initial = await download(discarded);
  const current = await admin(governance());
  expect(
    (
      await admin(governance(), {
        method: 'PATCH',
        revision: current.data.revision,
        body: { visibility: 'ORGANIZATION' },
      })
    ).status,
  ).toBe(200);
  const recovered = await createExport(body, key);
  expect(recovered).toEqual(discarded);
  expect((await download(recovered)).bytes.equals(initial.bytes)).toBe(true);
  const facts = await harness.facts(scope);
  expect(facts.exports).toHaveLength(1);
  expect(facts.audits.AUDIT_EXPORT_GENERATED).toBe(1);
  denied(
    await request(`${exportsPath()}/${recovered.exportId}`, {
      actor: 'foreignAdmin',
    }),
  );
  const otherAdmin = await request(
    `${exportsPath()}/${recovered.exportId}/content`,
    { actor: 'foreignAdmin', binary: true },
  );
  expect(otherAdmin.status).toBe(404);
  const deliveriesBefore = (await harness.facts(scope)).deliveries.length;
  await harness.revoke({ ...scope, actor: 'admin' });
  try {
    denied(await admin(`${exportsPath()}/${recovered.exportId}`));
    const response = await request(
      `${exportsPath()}/${recovered.exportId}/content`,
      { actor: 'admin', binary: true },
    );
    expect(response.status).toBe(404);
    expect(response.headers['content-type']).not.toContain('text/csv');
    expect((await harness.facts(scope)).deliveries).toHaveLength(
      deliveriesBefore,
    );
  } finally {
    await harness.revoke({ ...scope, actor: 'admin', restore: true });
  }
  expect(await history()).toEqual(before);
  evidence.push({
    caseId: 'IMP06-PHASE-06',
    organizationId: scope.organizationId,
    exportId: recovered.exportId,
    byteIdentical: true,
    generationCount: 1,
    revokedDeliveryDenied: true,
  });
}, 180000);
