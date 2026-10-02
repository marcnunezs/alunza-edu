/* eslint @typescript-eslint/no-require-imports: "off" */
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { setTimeout: delay } = require('node:timers/promises');
const { createClient } = require('@supabase/supabase-js');
const pg = require('pg');
const c = require('@alunza/contracts');
const fixture = require('../../fixtures/foundation/identity.json');
const { assertLaboratoryTestState } = require('../laboratory-test-state.cjs');
const {
  setMaterialFault,
  clearMaterialFault,
} = require('../help-fault-materials.cjs');
beforeEach(() => clearMaterialFault());
afterEach(() => clearMaterialFault());
const [admin, teacher, student, adminB, teacherB, studentB] = fixture.users;
let state, pool, base, demo, corpus, first;
const sessions = new Map();
const schema = (value, contract) => {
  expect(contract.safeParse(value).success).toBe(true);
  return value.data;
};
async function request(path, options = {}) {
  const who = options.actor ?? teacher;
  const headers = {
    Authorization: `Bearer ${sessions.get(who.id).access_token}`,
  };
  if (options.key) headers['Idempotency-Key'] = options.key;
  if (options.revision) headers['If-Match'] = `"${options.revision}"`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${base}/api/v1${path}`, {
    method: options.method ?? 'GET',
    headers,
    body:
      options.form ??
      (options.body === undefined ? undefined : JSON.stringify(options.body)),
    signal: AbortSignal.timeout(45000),
  });
  expect(response.headers.get('cache-control')).toContain('no-store');
  if (options.binary) return response;
  const payload = await response.json();
  const output = JSON.stringify(payload);
  for (const secret of [
    state.authAdminKey,
    state.applicationPassword,
    sessions.get(who.id).access_token,
  ])
    expect(output).not.toContain(secret);
  if (!response.ok)
    expect(c.errorResponseSchema.safeParse(payload).success).toBe(true);
  return { status: response.status, payload, data: payload.data };
}
async function upload({
  title = 'Material de integración',
  text = 'Una función recibe parámetros y retorna un resultado.',
  name = 'material.txt',
  type = 'text/plain',
  bytes,
  classId,
  source,
  actor = teacher,
  activityId,
  key = randomUUID(),
} = {}) {
  const form = new globalThis.FormData();
  form.set(
    'file',
    new globalThis.Blob([bytes ?? Buffer.from(text)], { type }),
    name,
  );
  if (!source) form.set('title', title);
  if (activityId) form.set('activityId', activityId);
  return request(
    source
      ? `/sources/${source.id}/versions`
      : `/classes/${classId ?? demo.classes[0].id}/sources`,
    { actor, form, method: 'POST', key, revision: source?.revision },
  );
}
async function finished(id, actor = teacher, expected = 'SUCCEEDED') {
  const deadline = Date.now() + 40000;
  while (Date.now() < deadline) {
    const current = await request(`/sources/${id}`, { actor });
    expect(current.status).toBe(200);
    const source = schema(current.payload, c.materialSourceResponseSchema);
    if (['SUCCEEDED', 'FAILED'].includes(source.latestJob?.state)) {
      expect(source.latestJob.state).toBe(expected);
      return source;
    }
    await delay(150);
  }
  throw new Error(
    `No finalizó el procesamiento ${expected} dentro del presupuesto local.`,
  );
}
const denied = (response) => expect([403, 404]).toContain(response.status);
beforeAll(async () => {
  state = JSON.parse(readFileSync(process.env.ALUNZA_TEST_STATE, 'utf8'));
  assertLaboratoryTestState(state);
  base = process.env.ALUNZA_TEST_API_URL;
  if (base !== 'http://127.0.0.1:4300') throw new Error('Solo LAB TEST.');
  pool = new pg.Pool({ connectionString: state.migrationUrl, max: 3 });
  demo = await import('../../fixtures/demo/academic.mjs');
  corpus = (await import('../../fixtures/demo/materials.mjs')).materials;
  await (
    await import('../../scripts/academic-fixture.mjs')
  ).seedAcademic(state);
  for (const user of fixture.users) {
    const auth = createClient(state.authUrl, state.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const result = await auth.auth.signInWithPassword({
      email: user.email,
      password: state.fixturePassword,
    });
    if (!result.data.session || result.error)
      throw new Error('No se autenticó el actor ficticio de materiales.');
    sessions.set(user.id, result.data.session);
  }
}, 60000);
afterAll(async () => {
  await pool?.end();
});

test('six canonical documents become complete sources, two per class, with real private storage', async () => {
  expect(corpus).toHaveLength(6);
  for (const doc of corpus) {
    const actor = doc.classId === demo.classes[2].id ? teacherB : teacher;
    const result = await upload({
      ...doc,
      bytes: readFileSync(doc.filePath),
      name: doc.fileName,
      type:
        doc.format === 'PDF'
          ? 'application/pdf'
          : doc.format === 'MARKDOWN'
            ? 'text/markdown'
            : 'text/plain',
      actor,
      key: `canonical-material-${doc.key}`,
    });
    expect(result.status).toBe(202);
    schema(result.payload, c.materialOperationResponseSchema);
    const ready = await finished(result.data.source.id, actor);
    expect(ready.availability).toBe('READY');
    expect(ready.chunkCount).toBeGreaterThan(0);
    expect(ready.activeVersion.version).toBe(1);
    if (!first) first = ready;
  }
  for (const cls of demo.classes) {
    const list = await request(`/classes/${cls.id}/sources`, {
      actor: cls.teacherId === teacher.id ? teacher : teacherB,
    });
    expect(
      schema(list.payload, c.materialSourceListResponseSchema),
    ).toHaveLength(2);
  }
}, 120000);

test('students only see available authorized sources; direct storage access is denied even with known object path', async () => {
  const own = await request(`/classes/${demo.classes[0].id}/sources`, {
    actor: student,
  });
  expect(own.status).toBe(200);
  expect(own.data).toHaveLength(2);
  denied(
    await request(`/classes/${demo.classes[1].id}/sources`, { actor: student }),
  );
  denied(await request(`/sources/${first.id}`, { actor: studentB }));
  denied(await request(`/sources/${first.id}`, { actor: teacherB }));
  denied(await request(`/sources/${first.id}`, { actor: adminB }));
  const key = (
    await pool.query(
      'SELECT storage_object_key FROM app.source_versions WHERE id=$1',
      [first.activeVersion.id],
    )
  ).rows[0].storage_object_key;
  for (const actor of [student, teacher, admin]) {
    const auth = createClient(state.authUrl, state.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        headers: {
          Authorization: `Bearer ${sessions.get(actor.id).access_token}`,
        },
      },
    });
    expect(
      (await auth.storage.from('materials').download(key)).error,
    ).toBeTruthy();
    expect(
      (await auth.storage.from('materials').upload(`${key}-forged`, 'forged'))
        .error,
    ).toBeTruthy();
  }
  const file = await request(
    `/sources/${first.id}/versions/${first.activeVersion.id}/content`,
    { actor: student, binary: true },
  );
  expect(file.status).toBe(200);
  expect(file.headers.get('content-disposition')).toContain('attachment');
  expect((await file.arrayBuffer()).byteLength).toBe(
    first.activeVersion.sizeBytes,
  );
});

test('admin scopes are minimal and do not grant pedagogical activity access', async () => {
  const scopes = await request(`/classes/${demo.classes[0].id}/source-scopes`, {
    actor: admin,
  });
  expect(scopes.status).toBe(200);
  schema(scopes.payload, c.materialScopeListResponseSchema);
  for (const scope of scopes.data)
    expect(Object.keys(scope).sort()).toEqual(['id', 'state', 'title']);
  denied(
    await request(`/classes/${demo.classes[0].id}/activities`, {
      actor: admin,
    }),
  );
  denied(await upload({ actor: student }));
  denied(await upload({ classId: demo.classes[0].id, actor: teacherB }));
});

test('repeating upload key returns one source and job; changed bytes conflict', async () => {
  const key = randomUUID();
  const initial = await upload({ key, title: 'Carga idempotente' });
  expect(initial.status).toBe(202);
  const replay = await upload({ key, title: 'Carga idempotente' });
  expect(replay.status).toBe(202);
  expect(replay.data.source.id).toBe(initial.data.source.id);
  expect(replay.data.job.id).toBe(initial.data.job.id);
  expect(
    (
      await upload({
        key,
        title: 'Carga idempotente',
        text: 'contenido distinto',
      })
    ).status,
  ).toBe(409);
  await finished(initial.data.source.id);
});

test('UTF-8 filenames survive upload, replacement, history and private download headers', async () => {
  const name = 'función y parámetros.txt';
  const initial = await upload({
    title: 'Nombres de archivo con acentos',
    name: name.normalize('NFD'),
  });
  expect(initial.status).toBe(202);
  expect(initial.data.version.fileName).toBe(name);
  const ready = await finished(initial.data.source.id);
  const replacementName = 'revisión de función.md';
  const replacement = await upload({
    source: ready,
    name: replacementName,
    type: 'text/markdown',
    text: '# Función\nComprueba sus parámetros y el retorno.',
  });
  expect(replacement.status).toBe(202);
  expect(replacement.data.version.fileName).toBe(replacementName);
  const current = await finished(ready.id);
  expect(current.activeVersion.fileName).toBe(replacementName);
  const history = await request(`/sources/${ready.id}/versions`);
  expect(history.data.map((version) => version.fileName).sort()).toEqual(
    [name, replacementName].sort(),
  );
  const download = await request(
    `/sources/${ready.id}/versions/${current.activeVersion.id}/content`,
    { actor: student, binary: true },
  );
  expect(download.status).toBe(200);
  expect(download.headers.get('content-disposition')).toContain(
    `filename*=UTF-8''${encodeURIComponent(replacementName)}`,
  );
  expect(await download.text()).toBe(
    '# Función\nComprueba sus parámetros y el retorno.',
  );
});

test.each([
  {
    name: 'image.txt',
    type: 'text/plain',
    bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]),
    expected: [415, 422],
  },
  {
    name: 'fake.pdf',
    type: 'application/pdf',
    bytes: Buffer.from('not a PDF'),
    expected: [415, 422],
  },
  {
    name: 'document.exe',
    type: 'text/plain',
    bytes: Buffer.from('text'),
    expected: [415],
  },
  {
    name: 'large.txt',
    type: 'text/plain',
    bytes: Buffer.alloc(10_000_001, 65),
    expected: [413],
  },
])(
  'rejects invalid content or size before publishing ($name)',
  async ({ expected, ...file }) => {
    const rejected = await upload(file);
    expect(expected).toContain(rejected.status);
  },
);

test('empty textual content and corrupt PDF leave no active generation and safe failure', async () => {
  for (const file of [
    { text: '  \n  ' },
    {
      bytes: Buffer.from('%PDF-1.7\ncorrupt\n%%EOF'),
      name: 'broken.pdf',
      type: 'application/pdf',
    },
  ]) {
    const result = await upload(file);
    if (result.status === 202) {
      const failed = await finished(result.data.source.id, teacher, 'FAILED');
      expect(failed.availability).toBe('NOT_READY');
      expect(failed.activeGenerationId).toBeNull();
      expect(failed.latestJob.errorMessage).toBeTruthy();
    } else expect([415, 422]).toContain(result.status);
  }
});

test('actual byte limit accepts exactly 10,000,000 bytes and ignores an untrusted MIME header', async () => {
  const bytes = Buffer.alloc(10_000_000, 32);
  bytes.write('Texto válido para la frontera exacta.\n');
  const result = await upload({
    bytes,
    name: 'exact.txt',
    type: 'application/pdf',
  });
  expect(result.status).toBe(202);
  expect(result.data.version.sizeBytes).toBe(10_000_000);
  expect(result.data.version.format).toBe('TXT');
  const source = (await request(`/sources/${result.data.source.id}`)).data;
  // Acceptance of bytes is independent of publication and its extraction budget.
  expect(
    (
      await request(`/sources/${source.id}/archive`, {
        actor: admin,
        method: 'POST',
        revision: source.revision,
        key: randomUUID(),
        body: { reason: 'Fin del fixture de tamaño' },
      })
    ).status,
  ).toBe(200);
}, 60000);

test('failed replacement keeps previous file and generation; teacher retries failed upload, admin reindexes', async () => {
  const original = await request(`/sources/${first.id}`);
  const failedText = 'Fallo permanente del proveedor de pruebas: función.';
  await setMaterialFault({ text: failedText, scenario: 'permanent' });
  const failedUpload = await upload({
    source: original.data,
    text: failedText,
  });
  expect(failedUpload.status).toBe(202);
  const failed = await finished(first.id, teacher, 'FAILED');
  expect(failed.availability).toBe('READY');
  expect(failed.activeGenerationId).toBe(original.data.activeGenerationId);
  expect(failed.activeVersion.id).toBe(original.data.activeVersion.id);
  const teacherRetry = await request(`/sources/${first.id}/reindex`, {
    method: 'POST',
    body: {},
    key: randomUUID(),
    revision: failed.revision,
  });
  expect(teacherRetry.status).toBe(202);
  expect(teacherRetry.data.version.id).toBe(failed.latestJob.versionId);
  const retried = await finished(first.id, teacher, 'FAILED');
  expect(retried.activeGenerationId).toBe(original.data.activeGenerationId);
  expect(retried.latestJob.generationId).not.toBe(
    failed.latestJob.generationId,
  );
  const reindex = await request(`/sources/${first.id}/reindex`, {
    actor: admin,
    method: 'POST',
    body: { versionId: retried.activeVersion.id },
    key: randomUUID(),
    revision: retried.revision,
  });
  expect(reindex.status).toBe(202);
  const rebuilt = await finished(first.id);
  expect(rebuilt.activeGenerationId).not.toBe(failed.activeGenerationId);
  expect(rebuilt.activeVersion.id).toBe(failed.activeVersion.id);
  const replacement = await upload({
    source: rebuilt,
    text: 'Nueva explicación de función con retorno.',
  });
  expect(replacement.status).toBe(202);
  first = await finished(first.id);
  expect(first.activeVersion.id).not.toBe(original.data.activeVersion.id);
  const versions = await request(`/sources/${first.id}/versions`);
  expect(versions.data.length).toBe(3);
  denied(await request(`/sources/${first.id}/versions`, { actor: student }));
  denied(
    await request(
      `/sources/${first.id}/versions/${original.data.activeVersion.id}/content`,
      { actor: student },
    ),
  );
}, 120000);

test('transient embedding failures retry durably and source can recover without synthetic production fallback', async () => {
  const text =
    'Fallo transitorio del proveedor de pruebas: función y condición.';
  await setMaterialFault({ text, scenario: 'transient' });
  const result = await upload({ text });
  expect(result.status).toBe(202);
  const ready = await finished(result.data.source.id);
  expect(ready.latestJob.attempts).toBe(2);
  expect(ready.availability).toBe('READY');
}, 60000);

test('visibility revokes subsequent content reads and blocks privilege fields', async () => {
  const source = (await request(`/sources/${first.id}`)).data;
  denied(
    await request(`/sources/${source.id}/visibility`, {
      actor: teacher,
      method: 'PATCH',
      revision: source.revision,
      body: { visible: false },
    }),
  );
  const hidden = await request(`/sources/${source.id}/visibility`, {
    actor: admin,
    method: 'PATCH',
    revision: source.revision,
    body: { visible: false },
  });
  expect(hidden.status).toBe(200);
  denied(await request(`/sources/${source.id}`, { actor: student }));
  const deniedFile = await request(
    `/sources/${source.id}/versions/${source.activeVersion.id}/content`,
    { actor: student, binary: true },
  );
  expect([403, 404]).toContain(deniedFile.status);
  expect(
    (
      await request(`/sources/${source.id}/visibility`, {
        actor: admin,
        method: 'PATCH',
        revision: hidden.data.revision,
        body: { visible: true, classId: demo.classes[1].id },
      })
    ).status,
  ).toBe(422);
  const visible = await request(`/sources/${source.id}/visibility`, {
    actor: admin,
    method: 'PATCH',
    revision: hidden.data.revision,
    body: { visible: true },
  });
  expect(visible.status).toBe(200);
});

test('revoked class membership is checked using the current state and existing JWT', async () => {
  await pool.query(
    'UPDATE app.class_memberships SET ended_at=now() WHERE class_id=$1 AND user_id=$2 AND ended_at IS NULL',
    [demo.classes[0].id, student.id],
  );
  try {
    denied(await request(`/sources/${first.id}`, { actor: student }));
  } finally {
    await pool.query(
      'UPDATE app.class_memberships SET ended_at=NULL WHERE class_id=$1 AND user_id=$2',
      [demo.classes[0].id, student.id],
    );
  }
});

test('disabled account loses material access immediately with its previous JWT', async () => {
  await pool.query(
    "UPDATE app.profiles SET account_state='DISABLED' WHERE id=$1",
    [student.id],
  );
  try {
    denied(await request(`/sources/${first.id}`, { actor: student }));
  } finally {
    await pool.query(
      "UPDATE app.profiles SET account_state='ACTIVE' WHERE id=$1",
      [student.id],
    );
  }
});

test('archive during indexing fences late activation and cannot be undone by retry', async () => {
  const text = 'Proveedor lento de pruebas: función archivo.';
  await setMaterialFault({ text, scenario: 'slow' });
  const uploading = await upload({ text });
  expect(uploading.status).toBe(202);
  const source = (await request(`/sources/${uploading.data.source.id}`)).data;
  const archived = await request(`/sources/${source.id}/archive`, {
    actor: admin,
    method: 'POST',
    revision: source.revision,
    key: randomUUID(),
    body: { reason: 'Retiro durante indexación' },
  });
  expect(archived.status).toBe(200);
  await delay(3000);
  const after = (await request(`/sources/${source.id}`, { actor: admin })).data;
  expect(after.state).toBe('ARCHIVED');
  expect(after.activeGenerationId).toBeNull();
  denied(await request(`/sources/${source.id}`, { actor: student }));
  const retry = await request(`/sources/${source.id}/reindex`, {
    actor: admin,
    method: 'POST',
    revision: after.revision,
    key: randomUUID(),
    body: {},
  });
  expect([403, 404, 409]).toContain(retry.status);
}, 60000);
