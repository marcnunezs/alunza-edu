/* eslint @typescript-eslint/no-require-imports: "off" */
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const pg = require('pg');
const { createClient } = require('@supabase/supabase-js');
const contracts = require('@alunza/contracts');
const { assertLaboratoryTestState } = require('../laboratory-test-state.cjs');
const fixture = require('../../fixtures/foundation/identity.json');
const { setHelpFault, clearHelpFault } = require('../help-fault-controls.cjs');
const {
  setStorageFault,
  clearStorageFault,
  storageFaultReached,
} = require('../help-fault-storage.cjs');
const [admin, teacher, student, , , outsider] = fixture.users;
let ids = Object.fromEntries(
  [
    'org',
    'course',
    'class',
    'concept',
    'conceptVersion',
    'exercise',
    'version',
    'activity',
    'assignment',
  ].map((name) => [name, randomUUID()]),
);
const sessions = new Map();
let state, pool, base, secondStudent;
const source = 'module.exports.solve=(a,b)=>a+b;';
beforeAll(async () => {
  state = JSON.parse(readFileSync(process.env.ALUNZA_TEST_STATE, 'utf8'));
  assertLaboratoryTestState(state);
  base = process.env.ALUNZA_TEST_API_URL;
  if (
    state.projectId !== 'alunza-edu-laboratorio-test' ||
    base !== 'http://127.0.0.1:4300'
  )
    throw new Error('HELP tests require isolated TEST.');
  pool = new pg.Pool({ connectionString: state.migrationUrl, max: 5 });
  const demo = await import('../../fixtures/demo/academic.mjs');
  secondStudent = demo.additionalStudents[0];
  for (const user of [admin, teacher, student, outsider, secondStudent]) {
    const auth = createClient(state.authUrl, state.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const login = await auth.auth.signInWithPassword({
      email: user.email,
      password: state.fixturePassword,
    });
    if (login.error || !login.data.session)
      throw new Error('No se obtuvo sesión ficticia de HELP.');
    sessions.set(user.id, login.data.session.access_token);
  }
}, 120000);
beforeEach(async () => {
  clearHelpFault();
  clearStorageFault();
  ids = Object.fromEntries(
    Object.keys(ids).map((name) => [name, randomUUID()]),
  );
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO app.organizations(id,code,name) VALUES($1,$2,$3)',
      [
        ids.org,
        `HELP-${ids.org.slice(0, 8).toUpperCase()}`,
        'Práctica aislada',
      ],
    );
    for (const user of [admin, teacher, student, secondStudent])
      await client.query(
        "INSERT INTO app.organization_memberships(organization_id,user_id,role,state,joined_at) VALUES($1,$2,$3,'ACTIVE',now())",
        [ids.org, user.id, user.role],
      );
    await client.query(
      "INSERT INTO app.courses(id,organization_id,code,name,academic_period) VALUES($1,$2,'HELP','Programación','2026-2')",
      [ids.course, ids.org],
    );
    await client.query(
      "INSERT INTO app.classes(id,organization_id,course_id,teacher_id,code,name) VALUES($1,$2,$3,$4,'HELP','Clase HELP')",
      [ids.class, ids.org, ids.course, teacher.id],
    );
    for (const user of [student, secondStudent])
      await client.query(
        'INSERT INTO app.class_memberships(organization_id,class_id,user_id) VALUES($1,$2,$3)',
        [ids.org, ids.class, user.id],
      );
    await client.query(
      "INSERT INTO app.concept_tags(id,organization_id,normalized_name) VALUES($1,$2,'sumar')",
      [ids.concept, ids.org],
    );
    await client.query(
      "INSERT INTO app.concept_versions(id,organization_id,concept_id,version,name,description,created_by) VALUES($1,$2,$3,1,'Sumar','Sumar', $4)",
      [ids.conceptVersion, ids.org, ids.concept, admin.id],
    );
    await client.query(
      'UPDATE app.concept_tags SET current_version_id=$2 WHERE id=$1',
      [ids.concept, ids.conceptVersion],
    );
    await client.query(
      'INSERT INTO app.exercises(id,organization_id,owner_id) VALUES($1,$2,$3)',
      [ids.exercise, ids.org, teacher.id],
    );
    await client.query(
      "INSERT INTO app.exercise_versions(id,organization_id,exercise_id,version,title,statement,starter_code,difficulty,created_by) VALUES($1,$2,$3,1,'Sumar','Suma dos valores',$4,'BEGINNER',$5)",
      [ids.version, ids.org, ids.exercise, source, teacher.id],
    );
    await client.query(
      'INSERT INTO app.exercise_version_concepts VALUES($1,$2,$3)',
      [ids.org, ids.version, ids.conceptVersion],
    );
    await client.query(
      "INSERT INTO app_private.exercise_tests(organization_id,exercise_version_id,test_id,position,visibility,args,expected) VALUES($1,$2,'visible',0,'visible','[2,3]','5'),($1,$2,'IMP04_HELP_HIDDEN_SENTINEL',1,'hidden','[7,8]','15')",
      [ids.org, ids.version],
    );
    await client.query(
      'UPDATE app.exercises SET current_version_id=$2 WHERE id=$1',
      [ids.exercise, ids.version],
    );
    await client.query(
      "INSERT INTO app.activities(id,organization_id,class_id,created_by,title,type) VALUES($1,$2,$3,$4,'Actividad HELP','FORMATIVE')",
      [ids.activity, ids.org, ids.class, teacher.id],
    );
    await client.query(
      'INSERT INTO app.activity_exercises(id,organization_id,activity_id,exercise_version_id,position) VALUES($1,$2,$3,$4,0)',
      [ids.assignment, ids.org, ids.activity, ids.version],
    );
    await client.query(
      "UPDATE app.activities SET state='PUBLISHED' WHERE id=$1",
      [ids.activity],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}, 120000);
afterAll(async () => {
  await pool?.end();
});

// Fixture clock isolation: each case owns its organization, while the student
// admission quota is global. Age completed cases only; never relax live quotas.
afterEach(async () => {
  clearHelpFault();
  clearStorageFault();
  await pool.query(
    "UPDATE app.feedback_requests SET requested_at=least(requested_at,clock_timestamp()-interval '61 seconds') WHERE organization_id=$1 AND lifecycle_status='SUCCEEDED'",
    [ids.org],
  );
});
async function api(
  route,
  {
    actor = student,
    method = 'GET',
    body,
    form,
    key,
    revision,
    binary = false,
  } = {},
) {
  const response = await fetch(`${base}/api/v1${route}`, {
    method,
    headers: {
      Authorization: `Bearer ${sessions.get(actor.id)}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(key ? { 'Idempotency-Key': key } : {}),
      ...(revision ? { 'If-Match': `"${revision}"` } : {}),
    },
    body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
    signal: AbortSignal.timeout(45000),
  });
  expect(response.headers.get('cache-control')).toContain('no-store');
  if (binary) return response;
  const payload = await response.json();
  expect(JSON.stringify(payload)).not.toContain('IMP04_HELP_HIDDEN_SENTINEL');
  if (!response.ok)
    expect(contracts.errorResponseSchema.safeParse(payload).success).toBe(true);
  return { status: response.status, data: payload.data, payload };
}
async function until(check, budget = 25000) {
  const end = Date.now() + budget;
  while (Date.now() < end) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('No terminó la ayuda ficticia dentro del plazo local.');
}
async function upload(
  text = 'Una función recibe parámetros y retorna un resultado. Una condición permite decidir.',
  previous,
) {
  const form = new globalThis.FormData();
  form.set(
    'file',
    new globalThis.Blob([text], { type: 'text/plain' }),
    'ayuda.txt',
  );
  if (!previous) form.set('title', 'Material ficticio para ayuda');
  const accepted = await api(
    previous
      ? `/sources/${previous.id}/versions`
      : `/classes/${ids.class}/sources`,
    {
      actor: teacher,
      method: 'POST',
      form,
      key: randomUUID(),
      revision: previous?.revision,
    },
  );
  expect(accepted.status).toBe(202);
  return until(async () => {
    const current = await api(`/sources/${accepted.data.source.id}`, {
      actor: teacher,
    });
    expect(current.status).toBe(200);
    expect(current.data.latestJob.state).not.toBe('FAILED');
    return current.data.latestJob.state === 'SUCCEEDED' ? current.data : null;
  }, 40000);
}
async function attempt(marker = '', code = 'module.exports.solve=(a,b)=>a-b;') {
  const submitted = await api(
    `/activities/${ids.activity}/exercises/${ids.assignment}/attempts`,
    {
      method: 'POST',
      key: randomUUID(),
      body: { exerciseVersionId: ids.version, code: `${code}\n// ${marker}` },
    },
  );
  expect(submitted.status).toBe(201);
  return submitted.data.attemptId;
}
async function requestHelp(attemptId, kind = 'HINT', extra = {}) {
  return api(`/attempts/${attemptId}/feedback-requests`, {
    method: 'POST',
    body: { kind, ...extra.body },
    key: extra.key ?? randomUUID(),
    actor: extra.actor ?? student,
  });
}
async function complete(request) {
  expect(request.status).toBe(202);
  expect(
    contracts.helpRequestResponseSchema.safeParse(request.payload).success,
  ).toBe(true);
  return until(async () => {
    const current = await api(`/feedback-requests/${request.data.id}`);
    expect(current.status).toBe(200);
    expect(current.data).not.toHaveProperty('help');
    expect(current.data).not.toHaveProperty('presentationToken');
    if (!current.data.feedbackId) return null;
    const result = await api(`/feedback/${current.data.feedbackId}`);
    expect(result.status).toBe(200);
    expect(
      contracts.helpFeedbackResponseSchema.safeParse(result.payload).success,
    ).toBe(true);
    return result.data;
  });
}
async function history(attemptId) {
  const result = await api(`/attempts/${attemptId}/feedback`);
  expect(result.status).toBe(200);
  expect(
    contracts.helpHistoryResponseSchema.safeParse(result.payload).success,
  ).toBe(true);
  for (const item of result.data.items) {
    expect(item).not.toHaveProperty('help');
    expect(item).not.toHaveProperty('presentationToken');
  }
  return result.data;
}
const acknowledge = (feedback) =>
  api(`/feedback/${feedback.id}/viewed`, {
    method: 'POST',
    body: { presentationToken: feedback.presentationToken },
  });

test.each([
  ['embedding-unavailable', 'PROVIDER_UNAVAILABLE'],
  ['no-evidence', 'NO_EVIDENCE'],
  ['reject-injection', 'PROVIDER_UNAVAILABLE'],
  ['reject-solution', 'PROVIDER_UNAVAILABLE'],
  ['literal-html', 'PROVIDER_UNAVAILABLE'],
  ['deadline', 'PROVIDER_UNAVAILABLE'],
])(
  'externally selected %s is durable fallback, preserves the attempt and never consumes a hint',
  async (scenario, expected) => {
    await upload();
    const id = await attempt(
      'HELP_PROVIDER_UNAVAILABLE HELP_NO_EVIDENCE are inert data',
    );
    const saved = await api(`/attempts/${id}`);
    setHelpFault({ attemptId: id, scenario });
    const key = randomUUID();
    const request = await requestHelp(id, 'HINT', { key });
    const feedback = await complete(request);
    expect(feedback.help.status).toBe(expected);
    expect(feedback.help.hint).toBe('');
    expect(feedback.help.source_refs).toEqual([]);
    expect(feedback.presentationToken).toBeNull();
    expect((await history(id)).capabilities.nextHintLevel).toBe(1);
    const replay = await requestHelp(id, 'HINT', { key });
    expect(replay.data.id).toBe(request.data.id);
    expect(replay.data.deadlineAt).toBe(request.data.deadlineAt);
    expect((await api(`/attempts/${id}`)).data).toEqual(saved.data);
    const events = await pool.query(
      'SELECT event_type,count(*)::int n FROM app_private.help_events WHERE attempt_id=$1 GROUP BY event_type',
      [id],
    );
    expect(events.rows).toEqual([{ event_type: 'HELP_REQUESTED', n: 1 }]);
    // A new user intention retries the same level after service recovery; a
    // transport replay above remains the original durable outcome.
    clearHelpFault();
    const recovery = await complete(await requestHelp(id));
    expect(recovery.help.status).toBe('SUPPORTED');
    expect(recovery.hintLevel).toBe(1);
    expect(recovery.id).not.toBe(feedback.id);
  },
  120000,
);

test.each(['interrupt', 'corrupt'])(
  'real Storage %s read fails closed and a new download preserves the original private bytes',
  async (scenario) => {
    const text =
      'Una función retorna un resultado. Documento privado original y verificable.';
    const source = await upload(text);
    const id = await attempt();
    const feedback = await complete(await requestHelp(id));
    const ref = feedback.help.source_refs[0];
    const key = (
      await pool.query(
        'SELECT storage_object_key FROM app.source_versions WHERE id=$1',
        [source.activeVersion.id],
      )
    ).rows[0].storage_object_key;
    const route = `/feedback/${feedback.id}/sources/${ref.chunk_id}/content`;
    setStorageFault({ key, scenario });
    const failed = await api(route);
    expect(storageFaultReached()).toBe(true);
    expect(failed.status).toBe(503);
    expect(failed.payload.error.code).toBe('STORAGE_UNAVAILABLE');
    expect(JSON.stringify(failed.payload)).not.toContain(text);
    clearStorageFault();
    const recovered = await api(route, { binary: true });
    expect(recovered.status).toBe(200);
    expect(await recovered.text()).toBe(text);
    expect((await history(id)).capabilities.preparedFeedbackId).toBe(
      feedback.id,
    );
    const events = await pool.query(
      "SELECT count(*)::int n FROM app_private.help_events WHERE attempt_id=$1 AND event_type<>'HELP_REQUESTED'",
      [id],
    );
    expect(events.rows[0].n).toBe(0);
  },
  120000,
);

test('source revoked after real Storage read but before delivery returns no bytes and cannot ACK the old help', async () => {
  const text =
    'Una función recibe entradas. Documento privado para revocación durante lectura.';
  const source = await upload(text);
  const id = await attempt();
  const feedback = await complete(await requestHelp(id));
  const ref = feedback.help.source_refs[0];
  const key = (
    await pool.query(
      'SELECT storage_object_key FROM app.source_versions WHERE id=$1',
      [source.activeVersion.id],
    )
  ).rows[0].storage_object_key;
  setStorageFault({ key, scenario: 'hold' });
  const reading = api(
    `/feedback/${feedback.id}/sources/${ref.chunk_id}/content`,
    { binary: true },
  );
  try {
    await until(() => storageFaultReached());
    const revoked = await api(`/sources/${source.id}/visibility`, {
      actor: admin,
      method: 'PATCH',
      revision: source.revision,
      body: { visible: false },
    });
    expect(revoked.status).toBe(200);
  } finally {
    clearStorageFault();
  }
  const response = await reading;
  expect(response.status).toBe(404);
  expect(await response.text()).not.toContain(text);
  expect((await acknowledge(feedback)).data.available).toBe(false);
  expect((await history(id)).capabilities.nextHintLevel).toBe(1);
  const events = await pool.query(
    "SELECT count(*)::int n FROM app_private.help_events WHERE attempt_id=$1 AND event_type<>'HELP_REQUESTED'",
    [id],
  );
  expect(events.rows[0].n).toBe(0);
}, 120000);

test('explanation uses a confirmed own attempt, metadata polling and reusable idempotence without revealing hidden evidence', async () => {
  await upload();
  const id = await attempt();
  for (const actor of [admin, teacher, outsider, secondStudent])
    expect((await requestHelp(id, 'FEEDBACK', { actor })).status).toBe(404);
  expect((await requestHelp(randomUUID(), 'FEEDBACK')).status).toBe(404);
  expect(
    (await requestHelp(id, 'FEEDBACK', { body: { classId: ids.class } }))
      .status,
  ).toBe(422);
  const key = randomUUID();
  const [accepted, repeat] = await Promise.all([
    requestHelp(id, 'FEEDBACK', { key }),
    requestHelp(id, 'FEEDBACK', { key }),
  ]);
  expect(repeat.data.id).toBe(accepted.data.id);
  expect((await requestHelp(id, 'HINT', { key })).status).toBe(409);
  const feedback = await complete(accepted);
  expect(feedback.id).not.toBe(accepted.data.id);
  expect(feedback.help.status).toBe('SUPPORTED');
  expect(feedback.help.hint).toBe('');
  expect(feedback.viewedAt).toBeNull();
  const reused = await requestHelp(id, 'FEEDBACK');
  expect(reused.data.id).toBe(accepted.data.id);
  const summary = await history(id);
  expect(summary.items).toHaveLength(1);
  expect(summary.capabilities.canExplain).toBe(true);
  expect((await acknowledge(feedback)).status).toBe(200);
  expect((await acknowledge(feedback)).status).toBe(200);
  const evidence = await pool.query(
    'SELECT event_type,count(*)::int n FROM app_private.help_events WHERE attempt_id=$1 GROUP BY event_type',
    [id],
  );
  expect(evidence.rows).toEqual(
    expect.arrayContaining([
      { event_type: 'HELP_REQUESTED', n: 1 },
      { event_type: 'FEEDBACK_VIEWED', n: 1 },
    ]),
  );
  const input = await pool.query(
    'SELECT input FROM app_private.help_inputs WHERE request_id=$1',
    [accepted.data.id],
  );
  const context = input.rows[0].input.context;
  expect(Object.keys(context).sort()).toEqual([
    'attemptId',
    'code',
    'concepts',
    'diagnosisCode',
    'exerciseVersionId',
    'infrastructureStatus',
    'statement',
    'visibleTests',
  ]);
  expect(context.visibleTests).toEqual([{ id: 'visible', passed: false }]);
  for (const actor of [admin, teacher, outsider, secondStudent])
    expect((await api(`/feedback/${feedback.id}`, { actor })).status).toBe(404);
}, 120000);

test('three hint levels remain reserved until explicit valid ACK and CLOSED activity permits new help', async () => {
  await upload();
  const id = await attempt();
  await pool.query("UPDATE app.activities SET state='CLOSED' WHERE id=$1", [
    ids.activity,
  ]);
  for (let level = 1; level <= 3; level++) {
    const current = await complete(
      await requestHelp(id, 'HINT', { body: { hintLevel: level } }),
    );
    expect(current.help.status).toBe('SUPPORTED');
    expect(current.hintLevel).toBe(level);
    expect(current.help.hint.length).toBeGreaterThan(0);
    const pending = await history(id);
    expect(pending.capabilities.preparedFeedbackId).toBe(current.id);
    expect((await requestHelp(id)).status).toBe(409);
    const again = await api(`/feedback/${current.id}`);
    expect(again.data.presentationToken).toBe(current.presentationToken);
    const forged = await api(`/feedback/${current.id}/viewed`, {
      method: 'POST',
      body: { presentationToken: randomUUID() },
    });
    expect(forged.status).toBe(400);
    expect(forged.payload.error.code).toBe('INVALID_REQUEST');
    const acknowledgements = await Promise.all([
      acknowledge(current),
      acknowledge(current),
    ]);
    expect(acknowledgements.map((response) => response.status)).toEqual([
      200, 200,
    ]);
  }
  const final = await history(id);
  expect(final.capabilities.canHint).toBe(false);
  expect(final.capabilities.reason).toBe('HINT_LEVELS_EXHAUSTED');
  const exhausted = await requestHelp(id);
  expect(exhausted.status).toBe(400);
  expect(exhausted.payload.error.code).toBe('INVALID_REQUEST');
  const events = await pool.query(
    "SELECT hint_level FROM app_private.help_events WHERE attempt_id=$1 AND event_type='HINT_DELIVERED' ORDER BY hint_level",
    [id],
  );
  expect(events.rows.map((row) => row.hint_level)).toEqual([1, 2, 3]);
}, 120000);

test('cited original version survives replacement; any used source revocation suppresses entire feedback irreversibly', async () => {
  const originalText =
    'Una función recibe parámetros y retorna un resultado. Original histórico ficticio.';
  const first = await upload(originalText);
  const second = await upload(
    'Una condición selecciona una rama. Segunda fuente ficticia.',
  );
  const id = await attempt();
  const feedback = await complete(await requestHelp(id));
  expect(feedback.help.status).toBe('SUPPORTED');
  expect(feedback.help.source_refs).toHaveLength(2);
  const cited = feedback.help.source_refs.find(
    (ref) => ref.source_id === first.id,
  );
  expect(cited).toBeDefined();
  const replacement = await upload(
    'Una función organiza instrucciones. Versión sustituta ficticia.',
    first,
  );
  expect(replacement.activeVersion.id).not.toBe(cited.source_version_id);
  const reference = await api(
    `/feedback/${feedback.id}/sources/${cited.chunk_id}`,
  );
  expect(reference.status).toBe(200);
  expect(
    contracts.helpReferenceResponseSchema.safeParse(reference.payload).success,
  ).toBe(true);
  expect(reference.data.versionId).toBe(cited.source_version_id);
  expect(reference.data).not.toHaveProperty('storageKey');
  const content = await api(
    `/feedback/${feedback.id}/sources/${cited.chunk_id}/content`,
    { binary: true },
  );
  expect(content.status).toBe(200);
  expect(await content.text()).toBe(originalText);
  expect(
    (
      await api(
        `/sources/${first.id}/versions/${cited.source_version_id}/content`,
      )
    ).status,
  ).toBe(404);
  const hidden = await api(`/sources/${second.id}/visibility`, {
    actor: admin,
    method: 'PATCH',
    revision: second.revision,
    body: { visible: false },
  });
  expect(hidden.status).toBe(200);
  const revoked = await api(`/feedback/${feedback.id}`);
  expect(revoked.data.available).toBe(false);
  expect(revoked.data.help.status).toBe('NO_EVIDENCE');
  expect(revoked.data.help.hint).toBe('');
  expect(revoked.data.help.source_refs).toEqual([]);
  expect(revoked.data.presentationToken).toBeNull();
  expect(
    (await api(`/feedback/${feedback.id}/sources/${cited.chunk_id}`)).status,
  ).toBe(404);
  expect((await acknowledge(feedback)).data.available).toBe(false);
  expect(
    (
      await api(`/sources/${second.id}/visibility`, {
        actor: admin,
        method: 'PATCH',
        revision: hidden.data.revision,
        body: { visible: true },
      })
    ).status,
  ).toBe(200);
  expect((await api(`/feedback/${feedback.id}`)).data.available).toBe(false);
  expect((await history(id)).capabilities.nextHintLevel).toBe(1);
}, 120000);

test.each([
  'invalid-output',
  'fake-reference',
  'diagnosis-contradiction',
  'review-unavailable',
  'ambiguous',
])(
  'provider boundary %s releases the same hint level without delivery events',
  async (scenario) => {
    await upload();
    const id = await attempt();
    setHelpFault({ attemptId: id, scenario });
    const feedback = await complete(await requestHelp(id));
    expect(feedback.help.status).toBe(
      scenario === 'ambiguous' ? 'NO_EVIDENCE' : 'PROVIDER_UNAVAILABLE',
    );
    expect(feedback.help.hint).toBe('');
    expect(feedback.help.source_refs).toEqual([]);
    expect(feedback.presentationToken).toBeNull();
    expect((await history(id)).capabilities.nextHintLevel).toBe(1);
    const events = await pool.query(
      "SELECT count(*)::int n FROM app_private.help_events WHERE attempt_id=$1 AND event_type<>'HELP_REQUESTED'",
      [id],
    );
    expect(events.rows[0].n).toBe(0);
    if (['review-unavailable', 'ambiguous'].includes(scenario)) {
      const explanation = await complete(await requestHelp(id, 'FEEDBACK'));
      expect(explanation.help.status).toBe(feedback.help.status);
      expect(explanation.presentationToken).not.toBeNull();
      expect(explanation.help.hint).toBe('');
      expect(explanation.help.source_refs).toEqual([]);
      const acknowledgements = await Promise.all([
        acknowledge(explanation),
        acknowledge(explanation),
      ]);
      expect(acknowledgements.map((response) => response.status)).toEqual([
        200, 200,
      ]);
      expect(
        acknowledgements.every((response) => response.data.viewedAt !== null),
      ).toBe(true);
      const delivered = await pool.query(
        'SELECT event_type,count(*)::int n FROM app_private.help_events WHERE feedback_id=$1 GROUP BY event_type',
        [explanation.id],
      );
      expect(delivered.rows).toEqual([{ event_type: 'FEEDBACK_VIEWED', n: 1 }]);
      expect((await history(id)).capabilities.nextHintLevel).toBe(1);
    }
  },
  120000,
);

test('complete oversized code is NO_EVIDENCE before generation and preserves the next hint level', async () => {
  await upload();
  const id = await attempt('a'.repeat(3000));
  const request = await requestHelp(id);
  const feedback = await complete(request);
  expect(feedback.help.status).toBe('NO_EVIDENCE');
  expect(feedback.help.explanation).toContain('límite');
  expect(feedback.help.hint).toBe('');
  expect(feedback.help.source_refs).toEqual([]);
  expect(feedback.presentationToken).toBeNull();
  expect((await history(id)).capabilities.nextHintLevel).toBe(1);
  const calls = await pool.query(
    "SELECT phase FROM app_private.help_calls WHERE request_id=$1 AND phase IN('GENERATION','REVIEW')",
    [request.data.id],
  );
  expect(calls.rowCount).toBe(0);
}, 120000);

test('SUCCESS restricts new help to explanation and withdrawal cancels slow help before publication', async () => {
  await upload();
  const success = await attempt('', source);
  const unavailable = await requestHelp(success);
  expect(unavailable.status).toBe(400);
  expect(unavailable.payload.error.code).toBe('INVALID_REQUEST');
  expect((await history(success)).capabilities.reason).toBe('EXPLANATION_ONLY');
  expect(
    (await complete(await requestHelp(success, 'FEEDBACK'))).help.hint,
  ).toBe('');
  const id = await attempt();
  setHelpFault({ attemptId: id, scenario: 'generation-delay' });
  const pending = await requestHelp(id);
  await until(async () => {
    const result = await pool.query(
      "SELECT 1 FROM app_private.help_calls WHERE request_id=$1 AND phase='GENERATION' AND state='DISPATCHED'",
      [pending.data.id],
    );
    return result.rowCount === 1;
  });
  await pool.query(
    'UPDATE app.class_memberships SET ended_at=clock_timestamp() WHERE class_id=$1 AND user_id=$2',
    [ids.class, student.id],
  );
  expect((await api(`/feedback-requests/${pending.data.id}`)).status).toBe(404);
  await until(async () => {
    const result = await pool.query(
      'SELECT f.rag_status,f.suppressed_at FROM app.feedbacks f WHERE request_id=$1',
      [pending.data.id],
    );
    return result.rows[0]?.suppressed_at ? result.rows[0] : null;
  });
  const row = await pool.query(
    'SELECT rag_status,hint FROM app.feedbacks WHERE request_id=$1',
    [pending.data.id],
  );
  expect(row.rows[0]).toEqual({ rag_status: 'NO_EVIDENCE', hint: '' });
}, 120000);
