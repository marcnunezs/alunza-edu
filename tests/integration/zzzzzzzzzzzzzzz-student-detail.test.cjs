/* eslint @typescript-eslint/no-require-imports: "off" */
const { readFileSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const { URLSearchParams } = require('node:url');
const { setTimeout: delay } = require('node:timers/promises');
const {
  setStorageFault,
  clearStorageFault,
  storageFaultReached,
} = require('../help-fault-storage.cjs');
const c = require('@alunza/contracts');
let harness, scope;
const base = () => `/classes/${scope.classroomId}/students/${scope.studentId}`;
const query = (values = {}) =>
  new URLSearchParams({ asOf: scope.asOf, ...values }).toString();
const route = (suffix, values) => `${base()}${suffix}?${query(values)}`;
function safe(data) {
  const value = JSON.stringify(data);
  for (const forbidden of [
    'DASHBOARD_HIDDEN_SENTINEL',
    'STUDENT_DETAIL_OTHER_CLASS_7331',
    'presentationToken',
    'presentation_token',
    'storageKey',
    'help_inputs',
    'dispatch_token',
  ])
    expect(value).not.toContain(forbidden);
}
async function get(suffix, schema, values) {
  const response = await harness.request(route(suffix, values));
  expect(response.status).toBe(200);
  expect(response.noStore).toBe(true);
  schema.parse({ data: response.data, requestId: response.requestId });
  safe(response.data);
  return response.data;
}
beforeAll(async () => {
  if (process.env.ALUNZA_TEST_API_URL !== 'http://127.0.0.1:4300')
    throw new Error('Detalle requiere LAB TEST.');
  const state = JSON.parse(readFileSync(process.env.ALUNZA_TEST_STATE, 'utf8'));
  const { createStudentDetailHarness } =
    await import('../e2e/student-detail-fixture.mjs');
  harness = await createStudentDetailHarness(state);
  scope = await harness.prepare();
}, 180000);
afterAll(async () => {
  clearStorageFault();
  await harness?.close();
});

test('HU017-E1: detalle integra progreso, intento Docker y evidencia de la persona/clase sin mutar', async () => {
  const before = await harness.snapshot(scope);
  const progress = await get(
    '/progress',
    c.studentDetailProgressResponseSchema,
  );
  expect(progress.studentId).toBe(scope.studentId);
  expect(progress.classId).toBe(scope.classroomId);
  expect(progress.progress.summary).toMatchObject({
    completed: 1,
    required: 3,
    ratio: 1 / 3,
    evidenceState: 'HAS_EVIDENCE',
  });
  expect(progress.progress.observation.summary.attempts).toBe(7);
  const attempt = await get(
    `/attempts/${scope.attemptId}`,
    c.studentDetailAttemptResponseSchema,
  );
  expect(attempt.attempt).toEqual(scope.originalAttempt);
  expect(attempt.exercise.exerciseVersionId).toBe(
    scope.assignments[0].versionId,
  );
  expect(attempt.exercise.tests).toHaveLength(1);
  expect(attempt.exercise.tests[0].visibility).toBe('visible');
  expect(attempt.exercise.concepts).toHaveLength(2);
  const evidence = await get(
    '/evidence',
    c.studentDetailEvidenceResponseSchema,
    { limit: 2 },
  );
  expect(evidence.data).toHaveLength(2);
  expect(evidence.page.hasMore).toBe(true);
  const seen = evidence.data.map((item) => item.attempt.id);
  let cursor = evidence.page.nextCursor;
  while (cursor) {
    const next = await get('/evidence', c.studentDetailEvidenceResponseSchema, {
      limit: 2,
      cursor,
    });
    seen.push(...next.data.map((item) => item.attempt.id));
    cursor = next.page.nextCursor;
  }
  expect(new Set(seen).size).toBe(7);
  expect(seen.sort()).toEqual([...scope.attemptIds].sort());
  expect(seen).not.toContain(scope.otherAttemptId);
  expect(await harness.snapshot(scope)).toEqual(before);
});

test('ayuda docente solo incluye entregas hasta el corte y sus lecturas no generan ACK, eventos ni llamadas IA', async () => {
  const before = await harness.snapshot(scope);
  const history = await get(
    `/attempts/${scope.attemptId}/feedback`,
    c.studentDetailFeedbackHistoryResponseSchema,
    { limit: 1 },
  );
  expect(history.items).toHaveLength(1);
  expect(history.page.hasMore).toBe(true);
  const next = await get(
    `/attempts/${scope.attemptId}/feedback`,
    c.studentDetailFeedbackHistoryResponseSchema,
    { limit: 1, cursor: history.page.nextCursor },
  );
  expect(
    [...history.items, ...next.items].map((item) => item.id).sort(),
  ).toEqual([scope.feedbackId, scope.hintId].sort());
  for (const feedbackId of [scope.preparedId, scope.presentedId]) {
    const denied = await harness.request(route(`/feedback/${feedbackId}`));
    expect(denied.status).toBe(404);
    expect(denied.data).toBeUndefined();
  }
  const fallback = await get(
    `/feedback/${scope.feedbackId}`,
    c.studentDetailFeedbackResponseSchema,
  );
  expect(fallback.feedback.help.status).toBe('NO_EVIDENCE');
  const hint = await get(
    `/feedback/${scope.hintId}`,
    c.studentDetailFeedbackResponseSchema,
  );
  expect(hint.feedback.help.status).toBe('SUPPORTED');
  expect(hint.feedback.help.diagnosis_code).toBe(
    scope.originalAttempt.technicalResult.diagnosisCode,
  );
  const reference = await get(
    `/feedback/${scope.hintId}/sources/${scope.chunkId}`,
    c.studentDetailReferenceResponseSchema,
  );
  expect(reference.reference.sourceId).toBe(scope.sourceId);
  expect(reference.reference.text).toContain('función');
  const content = await harness.content(
    route(`/feedback/${scope.hintId}/sources/${scope.chunkId}/content`),
  );
  expect(content.status).toBe(200);
  expect(content.noStore).toBe(true);
  expect(content.mimeType).toContain('text/plain');
  expect(content.text).toContain('función');
  const pre = await get(
    `/attempts/${scope.attemptId}/feedback`,
    c.studentDetailFeedbackHistoryResponseSchema,
    { asOf: scope.beforeDelivery },
  );
  expect(pre.items).toEqual([]);
  const created = scope.feedbackTimes.find(
    (f) => f.id === scope.hintId,
  ).created;
  expect(
    (
      await harness.request(
        route(`/feedback/${scope.hintId}`, { asOf: created }),
      )
    ).status,
  ).toBe(404);
  const inclusive = await get(
    `/feedback/${scope.hintId}`,
    c.studentDetailFeedbackResponseSchema,
    { asOf: scope.deliveredAt },
  );
  expect(inclusive.feedback.id).toBe(scope.hintId);
  expect(await harness.snapshot(scope)).toEqual(before);
});

test('señales reutilizan episodio/regla/evidencia existente sin habilitar revisión ni otra persona', async () => {
  const before = await harness.snapshot(scope);
  const signals = await get('/signals', c.studentDetailSignalsResponseSchema, {
    state: 'ALL',
    limit: 1,
  });
  expect(signals.data.length).toBe(1);
  const signal = await get(
    `/signals/${signals.data[0].id}`,
    c.studentDetailSignalResponseSchema,
  );
  expect(signal.signal.studentId).toBe(scope.studentId);
  expect(signal.signal.rule.id).toBe(signals.data[0].rule.id);
  for (const item of signal.evidence.attempts)
    expect(scope.attemptIds).toContain(item.id);
  const forbidden = await harness.request(
    `${base()}/signals/${signal.signal.id}/review`,
    { method: 'POST', body: {} },
  );
  expect(forbidden.status).toBe(404);
  expect(await harness.snapshot(scope)).toEqual(before);
});

test('HU017-E2: filtro inválido se rechaza y filtro válido sin evidencia conserva estados explícitos', async () => {
  for (const filter of [
    { from: 'malformed' },
    { from: '2027-01-01T00:00:00Z' },
    { activityId: 'invalid' },
    { limit: 101 },
    { studentId: scope.emptyStudentId },
    { includeHidden: true },
  ])
    expect((await harness.request(route('/progress', filter))).status).toBe(
      422,
    );
  expect(
    (
      await harness.request(
        route('/evidence', { kind: 'HINT', diagnosisCode: 'SUCCESS' }),
      )
    ).status,
  ).toBe(422);
  const filtered = await get(
    '/progress',
    c.studentDetailProgressResponseSchema,
    { activityId: scope.activityIds[1] },
  );
  expect(filtered.progress.summary).toMatchObject({
    required: 1,
    completed: 0,
    evidenceState: 'NO_ATTEMPTS',
  });
  expect(filtered.progress.observation.attempts).toEqual([]);
  const empty = await harness.request(
    `/classes/${scope.classroomId}/students/${scope.emptyStudentId}/progress?${query()}`,
  );
  expect(empty.status).toBe(200);
  expect(empty.data.progress.summary).toMatchObject({
    required: 3,
    completed: 0,
    evidenceState: 'NO_ATTEMPTS',
  });
  const first = await get('/evidence', c.studentDetailEvidenceResponseSchema, {
    limit: 1,
  });
  expect(
    (
      await harness.request(
        route('/evidence', {
          limit: 1,
          cursor: first.page.nextCursor,
          activityId: scope.activityIds[1],
        }),
      )
    ).status,
  ).toBe(422);
  expect(
    (
      await harness.request(
        `/classes/${scope.classroomId}/students/${scope.emptyStudentId}/evidence?${query({ cursor: first.page.nextCursor, limit: 1 })}`,
      )
    ).status,
  ).toBe(422);
});

test('HU017-E3/E4: ADMIN, alumno, docente ajeno e IDs cruzados no obtienen identidad, código ni ayuda', async () => {
  const suffixes = [
    '/progress',
    '/evidence',
    `/attempts/${scope.attemptId}`,
    `/attempts/${scope.attemptId}/feedback`,
    `/feedback/${scope.hintId}`,
    `/feedback/${scope.hintId}/sources/${scope.chunkId}`,
    '/signals',
    `/signals/${scope.signals[0].id}`,
  ];
  for (const actor of ['admin', 'student', 'foreignAdmin', 'foreignTeacher'])
    for (const suffix of suffixes) {
      const response = await harness.request(route(suffix), { actor });
      expect([403, 404]).toContain(response.status);
      expect(response.data).toBeUndefined();
    }
  for (const actor of ['admin', 'student', 'foreignTeacher'])
    expect([403, 404]).toContain(
      (
        await harness.content(
          route(`/feedback/${scope.hintId}/sources/${scope.chunkId}/content`),
          { actor },
        )
      ).status,
    );
  for (const suffix of [
    `/attempts/${scope.otherAttemptId}`,
    `/attempts/${randomUUID()}`,
  ]) {
    const response = await harness.request(route(suffix));
    expect(response.status).toBe(404);
    expect(response.data).toBeUndefined();
  }
  for (const studentId of [harness.actors.foreignTeacher.id, randomUUID()])
    expect(
      (
        await harness.request(
          `/classes/${scope.classroomId}/students/${studentId}/progress?${query()}`,
        )
      ).status,
    ).toBe(404);
  expect(
    (
      await harness.request(
        `/classes/${scope.otherClassId}/students/${scope.studentId}/progress?${query()}`,
      )
    ).status,
  ).toBe(404);
  const ownOther = await harness.request(
    `/classes/${scope.otherClassId}/students/${scope.studentId}/progress?${query()}`,
    { actor: 'foreignTeacher' },
  );
  expect(ownOther.status).toBe(200);
  expect(ownOther.data.progress.observation.summary.attempts).toBe(1);
});

test('revocación y reasignación vigentes invalidan las lecturas con JWT anterior sin restaurar ayuda revocada', async () => {
  for (const actor of ['teacher', 'student']) {
    await harness.revoke({ ...scope, actor });
    try {
      for (const suffix of [
        '/progress',
        `/attempts/${scope.attemptId}`,
        `/feedback/${scope.hintId}`,
      ])
        expect([403, 404]).toContain(
          (await harness.request(route(suffix))).status,
        );
    } finally {
      await harness.revoke({ ...scope, actor, restore: true });
    }
  }
  await harness.enrollment(scope);
  try {
    expect((await harness.request(route('/progress'))).status).toBe(404);
    expect(
      (await harness.request(route(`/attempts/${scope.attemptId}`))).status,
    ).toBe(404);
  } finally {
    await harness.enrollment({ ...scope, restore: true });
  }
  // Student/enrollment revocation permanently invalidates existing help. A
  // reactivated membership cannot make those source references readable again.
  expect(
    (
      await harness.request(
        route(`/feedback/${scope.hintId}/sources/${scope.chunkId}`),
      )
    ).status,
  ).toBe(404);
  // Reassignment starts with independent, still-authorized delivered help.
  scope = await harness.prepare();
  await get(
    `/feedback/${scope.hintId}/sources/${scope.chunkId}`,
    c.studentDetailReferenceResponseSchema,
  );
  await harness.database.query(
    'UPDATE app.classes SET teacher_id=$3 WHERE id=$1 AND organization_id=$2',
    [scope.classroomId, scope.organizationId, harness.actors.foreignTeacher.id],
  );
  try {
    for (const suffix of [
      '/progress',
      '/evidence',
      `/attempts/${scope.attemptId}`,
      `/attempts/${scope.attemptId}/feedback`,
      `/feedback/${scope.hintId}`,
      `/feedback/${scope.hintId}/sources/${scope.chunkId}`,
      '/signals',
      `/signals/${scope.signals[0].id}`,
    ]) {
      const denied = await harness.request(route(suffix));
      expect(denied.status).toBe(404);
      expect(denied.data).toBeUndefined();
      // The historical cut remains identical; authority is current.
      const transferred = await harness.request(route(suffix), {
        actor: 'foreignTeacher',
      });
      expect(transferred.status).toBe(200);
      safe(transferred.data);
    }
    const contentPath = route(
      `/feedback/${scope.hintId}/sources/${scope.chunkId}/content`,
    );
    expect((await harness.content(contentPath)).status).toBe(404);
    expect(
      (await harness.content(contentPath, { actor: 'foreignTeacher' })).status,
    ).toBe(200);
  } finally {
    await harness.database.query(
      'UPDATE app.classes SET teacher_id=$3 WHERE id=$1 AND organization_id=$2',
      [scope.classroomId, scope.organizationId, harness.actors.teacher.id],
    );
  }
  expect((await harness.request(route('/progress'))).status).toBe(200);
}, 180000);

test('fuente revocada oculta contenido/cita sin fabricar otra ayuda ni alterar el diagnóstico persistido', async () => {
  // Neither permission nor source revocation from another scenario can be
  // undone by restoring ACTIVE/VISIBLE. Exercise Storage with a fresh scope.
  scope = await harness.prepare();
  const contentRoute = route(
    `/feedback/${scope.hintId}/sources/${scope.chunkId}/content`,
  );
  // The private object key stays in Node and never enters a Cypress task/env.
  const key = (
    await harness.database.query(
      'SELECT v.storage_object_key FROM app.source_versions v JOIN app.sources s ON s.current_version_id=v.id WHERE s.id=$1 AND s.organization_id=$2',
      [scope.sourceId, scope.organizationId],
    )
  ).rows[0].storage_object_key;
  const initial = await harness.snapshot(scope);
  setStorageFault({ key, scenario: 'corrupt' });
  try {
    const failed = await harness.content(contentRoute);
    expect(storageFaultReached()).toBe(true);
    expect(failed.status).toBe(503);
    expect(JSON.parse(failed.text).error.code).toBe('STORAGE_UNAVAILABLE');
    expect(failed.text).not.toContain('Una función recibe argumentos');
  } finally {
    clearStorageFault();
  }
  const recovered = await harness.content(contentRoute);
  expect(recovered.status).toBe(200);
  expect(recovered.text).toContain('Una función recibe argumentos');
  expect(await harness.snapshot(scope)).toEqual(initial);
  setStorageFault({ key, scenario: 'hold' });
  const reading = harness.content(contentRoute);
  let before;
  try {
    const deadline = Date.now() + 10000;
    while (!storageFaultReached() && Date.now() < deadline) await delay(20);
    expect(storageFaultReached()).toBe(true);
    await harness.sourceVisibility(scope);
    before = await harness.snapshot(scope);
  } finally {
    clearStorageFault();
  }
  try {
    const interrupted = await reading;
    expect(interrupted.status).toBe(404);
    expect(interrupted.noStore).toBe(true);
    expect(interrupted.text).not.toContain('Una función recibe argumentos');
    expect(await harness.snapshot(scope)).toEqual(before);
    const hint = await get(
      `/feedback/${scope.hintId}`,
      c.studentDetailFeedbackResponseSchema,
    );
    expect(hint.feedback.available).toBe(false);
    expect(hint.feedback.help).toBe(null);
    expect(hint.feedback.status).toBe('SUPPORTED');
    expect(
      (
        await harness.request(
          route(`/feedback/${scope.hintId}/sources/${scope.chunkId}`),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await harness.content(
          route(`/feedback/${scope.hintId}/sources/${scope.chunkId}/content`),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await get(
          `/attempts/${scope.attemptId}`,
          c.studentDetailAttemptResponseSchema,
        )
      ).attempt,
    ).toEqual(scope.originalAttempt);
    expect(await harness.snapshot(scope)).toEqual(before);
  } finally {
    await harness.sourceVisibility({ ...scope, restore: true });
  }
}, 180000);
