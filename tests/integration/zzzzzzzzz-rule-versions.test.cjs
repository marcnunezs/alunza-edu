/* eslint @typescript-eslint/no-require-imports: "off" */
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { setTimeout: delay } = require('node:timers/promises');
const { performance } = require('node:perf_hooks');
const pg = require('pg');
const { createClient } = require('@supabase/supabase-js');
const contracts = require('@alunza/contracts');
const { assertLaboratoryTestState } = require('../laboratory-test-state.cjs');
const fixture = require('../../fixtures/foundation/identity.json');
const [admin, teacher, student, foreignAdmin, secondAdmin] = fixture.users;
const sessions = new Map();
let pool, base, ids, stateForRuleTests;

const baseline = (type = 'INACTIVITY') => ({
  type,
  schemaVersion: 1,
  algorithmVersion: 'DEC005_V1',
  parameters:
    type === 'INACTIVITY'
      ? { inactivityDays: 7 }
      : type === 'REPEATED_ERROR'
        ? { repeatedErrorAttempts: 3, repeatedErrorWindowDays: 14 }
        : { stagnationAttempts: 3 },
});

async function api(
  path,
  { actor = admin, method = 'GET', body, key = randomUUID() } = {},
) {
  const token = actor ? sessions.get(actor.id) : undefined;
  const response = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(key === null ? {} : { 'Idempotency-Key': key }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10000),
  });
  const payload = await response.json();
  expect(response.headers.get('cache-control')).toContain('no-store');
  if (token) expect(JSON.stringify(payload)).not.toContain(token);
  if (response.ok) {
    if (path.split('?')[0].endsWith('/signal-rules/effective'))
      contracts.signalRuleEffectiveResponseSchema.parse(payload);
    else if (Array.isArray(payload.data))
      contracts.signalRuleVersionListResponseSchema.parse(payload);
    else contracts.signalRuleVersionResponseSchema.parse(payload);
  } else contracts.errorResponseSchema.parse(payload);
  return { status: response.status, ...payload };
}

const list = (query = '', options = {}) =>
  api(`/organizations/${ids.org}/signal-rules${query}`, options);
const effective = (options = {}) =>
  api(`/organizations/${ids.org}/signal-rules/effective`, options);
const create = (body = baseline(), options = {}) =>
  api(`/organizations/${ids.org}/signal-rules`, {
    method: 'POST',
    body,
    ...options,
  });
const get = (id, options = {}) => api(`/signal-rules/${id}`, options);
const activate = (id, expectedCurrentVersionId = null, options = {}) =>
  api(`/signal-rules/${id}/activate`, {
    method: 'POST',
    body: { expectedCurrentVersionId },
    ...options,
  });
async function auditCount(id, action) {
  const result = await pool.query(
    'SELECT count(*)::integer AS count FROM app.audit_events WHERE entity_id=$1 AND action=$2',
    [id, action],
  );
  return result.rows[0].count;
}

beforeAll(async () => {
  const state = JSON.parse(readFileSync(process.env.ALUNZA_TEST_STATE, 'utf8'));
  assertLaboratoryTestState(state);
  stateForRuleTests = state;
  base = process.env.ALUNZA_TEST_API_URL;
  if (base !== 'http://127.0.0.1:4300')
    throw new Error('Rule versions require isolated LAB TEST.');
  pool = new pg.Pool({ connectionString: state.migrationUrl, max: 3 });
  for (const user of [admin, teacher, student, foreignAdmin, secondAdmin]) {
    const auth = createClient(state.authUrl, state.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const login = await auth.auth.signInWithPassword({
      email: user.email,
      password: state.fixturePassword,
    });
    if (login.error || !login.data.session)
      throw new Error('No se obtuvo sesión ficticia de reglas.');
    sessions.set(user.id, login.data.session.access_token);
  }
}, 120000);

beforeEach(async () => {
  ids = { org: randomUUID(), foreignOrg: randomUUID() };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const organization of [ids.org, ids.foreignOrg])
      await client.query(
        'INSERT INTO app.organizations(id,code,name) VALUES($1,$2,$3)',
        [
          organization,
          `RULE-${organization.slice(0, 12).toUpperCase()}`,
          'Reglas ficticias aisladas',
        ],
      );
    for (const [organization, user, role] of [
      [ids.org, admin, 'ADMIN'],
      [ids.org, secondAdmin, 'ADMIN'],
      [ids.org, teacher, 'TEACHER'],
      [ids.org, student, 'STUDENT'],
      [ids.foreignOrg, foreignAdmin, 'ADMIN'],
    ])
      await client.query(
        "INSERT INTO app.organization_memberships(organization_id,user_id,role,state,joined_at) VALUES($1,$2,$3,'ACTIVE',now())",
        [organization, user.id, role],
      );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

afterAll(async () => {
  await pool?.end();
});

test('RF026-E3: listado vacío, sesión, roles y organización ajena', async () => {
  const empty = await list();
  expect(empty.status).toBe(200);
  expect(empty.data).toEqual([]);
  expect(empty.page).toEqual({ nextCursor: null, hasMore: false });
  const configured = await effective();
  expect(configured.status).toBe(200);
  expect(configured.data.organizationId).toBe(ids.org);
  expect(configured.data.observedAt).toMatch(/\.\d{6}Z$/);
  expect(configured.data.rules).toEqual([
    { type: 'INACTIVITY', ruleVersion: null },
    { type: 'REPEATED_ERROR', ruleVersion: null },
    { type: 'STAGNATION', ruleVersion: null },
  ]);
  expect((await list('', { actor: null })).status).toBe(401);
  expect((await effective({ actor: null })).status).toBe(401);
  for (const actor of [teacher, student]) {
    expect((await list('', { actor })).status).toBe(403);
    expect((await effective({ actor })).status).toBe(403);
    expect((await create(baseline(), { actor })).status).toBe(403);
  }
  expect((await list('', { actor: foreignAdmin })).status).toBe(404);
  expect((await effective({ actor: foreignAdmin })).status).toBe(404);
  expect(
    (await api(`/organizations/${randomUUID()}/signal-rules/effective`)).status,
  ).toBe(404);
  expect((await get(randomUUID())).status).toBe(404);
  const rule = (await create()).data;
  expect((await get(rule.id, { actor: foreignAdmin })).status).toBe(404);
  expect((await activate(rule.id, null, { actor: foreignAdmin })).status).toBe(
    404,
  );
  expect((await get(rule.id, { actor: teacher })).status).toBe(404);
  expect((await activate(rule.id, null, { actor: student })).status).toBe(404);
});

test('RF026-E1: dos creaciones con la misma clave confirman una versión y una auditoría', async () => {
  const key = randomUUID();
  const [first, replay] = await Promise.all([
    create(baseline(), { key }),
    create(baseline(), { key }),
  ]);
  expect([first.status, replay.status]).toEqual([201, 201]);
  expect(first.data).toEqual(replay.data);
  expect(first.data.state).toBe('DRAFT');
  expect(first.data.validFrom).toBeNull();
  expect(first.data.createdBy).toBe(admin.id);
  expect(await auditCount(first.data.id, 'RULE_VERSION_CREATED')).toBe(1);
  expect((await list()).data.map((rule) => rule.id)).toEqual([first.data.id]);
  const changed = await create(
    { ...baseline(), parameters: { inactivityDays: 8 } },
    { key },
  );
  expect(changed.status).toBe(409);
  expect(changed.error.code).toBe('IDEMPOTENCY_CONFLICT');
  const foreign = await api(`/organizations/${ids.foreignOrg}/signal-rules`, {
    actor: foreignAdmin,
    method: 'POST',
    body: baseline(),
    key,
  });
  expect(foreign.status).toBe(201);
  expect(foreign.data.id).not.toBe(first.data.id);
});

test('RF026-E1/E2: activación inmediata preserva vigencias, parámetros y snapshots de replay', async () => {
  const createKey = randomUUID();
  const first = (await create(baseline(), { key: createKey })).data;
  const activationKey = randomUUID();
  const active = await activate(first.id, null, { key: activationKey });
  expect(active.status).toBe(200);
  expect(active.data.state).toBe('ACTIVE');
  expect(active.data.activatedBy).toBe(admin.id);
  expect(active.data.validFrom).toMatch(/\.\d{6}Z$/);
  expect(active.data.validTo).toBeNull();
  expect((await activate(first.id, null, { key: activationKey })).data).toEqual(
    active.data,
  );
  const idempotentCurrent = await activate(first.id, first.id);
  expect(idempotentCurrent.status).toBe(200);
  expect(idempotentCurrent.data).toEqual(active.data);
  expect(await auditCount(first.id, 'RULE_VERSION_ACTIVATED')).toBe(1);

  const second = (
    await create({ ...baseline(), parameters: { inactivityDays: 8 } })
  ).data;
  expect(second.version).toBe(first.version + 1);
  const stale = await activate(second.id, null);
  expect(stale.status).toBe(409);
  expect(stale.error.code).toBe('RULE_VERSION_CONFLICT');
  const next = await activate(second.id, first.id, { actor: secondAdmin });
  expect(next.status).toBe(200);
  const retired = await get(first.id);
  expect(retired.data.state).toBe('RETIRED');
  expect(retired.data.validTo).toBe(next.data.validFrom);
  expect(retired.data.parameters).toEqual(first.parameters);
  expect(retired.data.createdAt).toBe(first.createdAt);
  expect(retired.data.createdBy).toBe(first.createdBy);
  expect(retired.data.validFrom).toBe(active.data.validFrom);
  expect(next.data.activatedBy).toBe(secondAdmin.id);
  expect((await create(baseline(), { key: createKey })).data).toEqual(first);
  expect((await activate(first.id, null, { key: activationKey })).data).toEqual(
    active.data,
  );
  expect(await auditCount(first.id, 'RULE_VERSION_ACTIVATED')).toBe(1);
  const cannotReactivate = await activate(first.id, second.id);
  expect(cannotReactivate.status).toBe(409);
  expect(cannotReactivate.error.code).toBe('RULE_VERSION_ALREADY_ACTIVATED');
  expect((await get(second.id)).data).toEqual(next.data);
  expect((await effective()).data.rules).toEqual([
    { type: 'INACTIVITY', ruleVersion: next.data },
    { type: 'REPEATED_ERROR', ruleVersion: null },
    { type: 'STAGNATION', ruleVersion: null },
  ]);
  expect(
    (
      await api(`/signal-rules/${second.id}`, {
        method: 'PATCH',
        body: { parameters: { inactivityDays: 9 } },
      })
    ).status,
  ).toBe(404);
});

test('RF026-E1: activaciones concurrentes del mismo tipo tienen un ganador sin solapamiento', async () => {
  const left = (await create()).data;
  const right = (
    await create({ ...baseline(), parameters: { inactivityDays: 8 } })
  ).data;
  const results = await Promise.all([
    activate(left.id),
    activate(right.id, null, { actor: secondAdmin }),
  ]);
  expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
  expect(results.find((result) => result.status === 409).error.code).toBe(
    'RULE_VERSION_CONFLICT',
  );
  const versions = (await list('?type=INACTIVITY')).data;
  expect(versions.filter((rule) => rule.state === 'ACTIVE')).toHaveLength(1);
  expect(versions.filter((rule) => rule.state === 'DRAFT')).toHaveLength(1);
  expect(
    (await auditCount(left.id, 'RULE_VERSION_ACTIVATED')) +
      (await auditCount(right.id, 'RULE_VERSION_ACTIVATED')),
  ).toBe(1);
});

test('RF026-E1: dos activaciones con una clave confirman un solo instante y efecto auditado', async () => {
  const rule = (await create()).data;
  const key = randomUUID();
  const results = await Promise.all([
    activate(rule.id, null, { key }),
    activate(rule.id, null, { key }),
  ]);
  expect(results.map((result) => result.status)).toEqual([200, 200]);
  expect(results[0].data).toEqual(results[1].data);
  expect(await auditCount(rule.id, 'RULE_VERSION_ACTIVATED')).toBe(1);
  const conflict = await activate(rule.id, rule.id, { key });
  expect(conflict.status).toBe(409);
  expect(conflict.error.code).toBe('IDEMPOTENCY_CONFLICT');
});

test('RF026-E1: un tipo bloqueado permite activar otro tipo y otra organización', async () => {
  const first = (await create()).data;
  const anotherType = (await create(baseline('STAGNATION'))).data;
  const foreign = (
    await api(`/organizations/${ids.foreignOrg}/signal-rules`, {
      actor: foreignAdmin,
      method: 'POST',
      body: baseline(),
    })
  ).data;
  const blocker = await pool.connect();
  let pending;
  let completed;
  try {
    await blocker.query('BEGIN');
    await blocker.query(
      "SELECT organization_id FROM app_private.signal_rule_scopes WHERE organization_id=$1 AND type='INACTIVITY' FOR UPDATE",
      [ids.org],
    );
    pending = activate(first.id);
    const deadline = Date.now() + 1000;
    let waiting = false;
    while (Date.now() < deadline) {
      const observed = await pool.query(
        "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'SELECT app_private.activate_rule_version%') AS waiting",
      );
      if (observed.rows[0].waiting) {
        waiting = true;
        break;
      }
      await delay(10);
    }
    expect(waiting).toBe(true);
    const independent = await Promise.all([
      activate(anotherType.id),
      activate(foreign.id, null, { actor: foreignAdmin }),
    ]);
    expect(independent.map((result) => result.status)).toEqual([200, 200]);
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
    if (pending) completed = await pending;
  }
  expect(completed.status).toBe(200);
});

test('RF026-E2/E3: organización archivada conserva lectura y rechaza mutaciones y replays', async () => {
  const key = randomUUID();
  const draft = (await create(baseline(), { key })).data;
  const activationKey = randomUUID();
  const active = (await activate(draft.id, null, { key: activationKey })).data;
  await pool.query(
    'UPDATE app.organizations SET archived_at=clock_timestamp(),archived_by=$2 WHERE id=$1',
    [ids.org, admin.id],
  );
  expect((await list()).status).toBe(200);
  expect((await get(draft.id)).data).toEqual(active);
  expect((await effective()).data.rules[0].ruleVersion).toEqual(active);
  for (const operation of [
    create(baseline(), { key }),
    create(),
    activate(draft.id, null, { key: activationKey }),
    activate(draft.id, draft.id),
  ]) {
    const rejected = await operation;
    expect(rejected.status).toBe(409);
    expect(rejected.error.code).toBe('ORGANIZATION_ARCHIVED');
  }
  expect(await auditCount(draft.id, 'RULE_VERSION_CREATED')).toBe(1);
  expect(await auditCount(draft.id, 'RULE_VERSION_ACTIVATED')).toBe(1);
});

test('RF026-E3: permisos actuales se revalidan antes de entregar replays', async () => {
  const key = randomUUID();
  const rule = (await create(baseline(), { key })).data;
  const activationKey = randomUUID();
  expect((await activate(rule.id, null, { key: activationKey })).status).toBe(
    200,
  );
  await pool.query(
    "UPDATE app.organization_memberships SET role='TEACHER' WHERE organization_id=$1 AND user_id=$2",
    [ids.org, admin.id],
  );
  try {
    expect((await create(baseline(), { key })).status).toBe(403);
    expect((await list()).status).toBe(403);
    expect((await effective()).status).toBe(403);
    expect((await get(rule.id)).status).toBe(404);
    expect((await activate(rule.id, null, { key: activationKey })).status).toBe(
      404,
    );
  } finally {
    await pool.query(
      "UPDATE app.organization_memberships SET role='ADMIN' WHERE organization_id=$1 AND user_id=$2",
      [ids.org, admin.id],
    );
  }
  expect((await create(baseline(), { key })).data.id).toBe(rule.id);
  expect(await auditCount(rule.id, 'RULE_VERSION_CREATED')).toBe(1);
  expect(await auditCount(rule.id, 'RULE_VERSION_ACTIVATED')).toBe(1);
});

test('RF026-E1/E3: lista filtra y pagina sin aceptar un cursor de otra organización o tipo', async () => {
  const rules = [];
  for (const type of [
    'INACTIVITY',
    'INACTIVITY',
    'REPEATED_ERROR',
    'STAGNATION',
  ])
    rules.push((await create(baseline(type))).data);
  const first = await list('?type=INACTIVITY&limit=1');
  expect(first.status).toBe(200);
  expect(first.data).toHaveLength(1);
  expect(first.page.hasMore).toBe(true);
  const second = await list(
    `?type=INACTIVITY&limit=1&cursor=${first.page.nextCursor}`,
  );
  expect(second.data).toHaveLength(1);
  expect(second.page.hasMore).toBe(false);
  expect(
    new Set([...first.data, ...second.data].map((rule) => rule.id)).size,
  ).toBe(2);
  const foreign = (
    await api(`/organizations/${ids.foreignOrg}/signal-rules`, {
      actor: foreignAdmin,
      method: 'POST',
      body: baseline(),
    })
  ).data;
  expect((await list(`?type=INACTIVITY&cursor=${foreign.id}`)).status).toBe(
    422,
  );
  expect((await list(`?type=INACTIVITY&cursor=${rules[2].id}`)).status).toBe(
    422,
  );
});

test('RF026-E4: valores, campos, schema y algoritmo inválidos conservan la configuración', async () => {
  const active = (await create()).data;
  await activate(active.id);
  for (const body of [
    { ...baseline(), parameters: { inactivityDays: -1 } },
    { ...baseline(), parameters: {} },
    { ...baseline(), parameters: { inactivityDays: 1.5 } },
    { ...baseline(), parameters: { inactivityDays: '7' } },
    { ...baseline(), parameters: { inactivityDays: 2147483648 } },
    { ...baseline(), parameters: { inactivityDays: 7, extra: true } },
    { ...baseline(), type: 'OTHER' },
    { ...baseline(), schemaVersion: 2 },
    { ...baseline(), algorithmVersion: 'CUSTOM' },
    { ...baseline(), createdBy: foreignAdmin.id },
    { ...baseline('STAGNATION'), parameters: { stagnationAttempts: 1 } },
    { ...baseline('REPEATED_ERROR'), parameters: { repeatedErrorAttempts: 3 } },
  ]) {
    const rejected = await create(body);
    expect(rejected.status).toBe(422);
    expect(rejected.error.code).toBe('VALIDATION_FAILED');
    expect(rejected.error.fields.length).toBeGreaterThan(0);
  }
  expect((await create(baseline(), { key: null })).status).toBe(400);
  expect(
    (
      await activate(active.id, active.id, {
        body: {
          expectedCurrentVersionId: active.id,
          effectiveAt: '2099-01-01T00:00:00Z',
        },
      })
    ).status,
  ).toBe(422);
  expect((await activate(active.id, active.id, { body: {} })).status).toBe(422);
  expect((await list('?type=OTHER')).status).toBe(422);
  expect((await list('?search=arbitrary')).status).toBe(422);
  expect(
    (
      await api(
        `/organizations/${ids.org}/signal-rules/effective?at=2099-01-01`,
      )
    ).status,
  ).toBe(422);
  expect((await list()).data).toHaveLength(1);
  expect((await get(active.id)).data.state).toBe('ACTIVE');
});

test('RF026-E1: efectivas no depende de la primera página ni del último borrador', async () => {
  const versions = [];
  for (let index = 0; index < 102; index++)
    versions.push((await create()).data);
  const selected = (await activate(versions[100].id)).data;
  const otherType = (await create(baseline('STAGNATION'))).data;
  const otherActive = (await activate(otherType.id)).data;
  const page = await list('?type=INACTIVITY&limit=100');
  expect(page.data).toHaveLength(100);
  expect(page.page.hasMore).toBe(true);
  expect(page.data.every((version) => version.id !== selected.id)).toBe(true);
  const actual = await effective();
  expect(actual.data.rules).toEqual([
    { type: 'INACTIVITY', ruleVersion: selected },
    { type: 'REPEATED_ERROR', ruleVersion: null },
    { type: 'STAGNATION', ruleVersion: otherActive },
  ]);
  expect((await get(versions[101].id)).data.state).toBe('DRAFT');
  expect(await auditCount(selected.id, 'RULE_VERSION_ACTIVATED')).toBe(1);

  // Full HTTP + parsing, on the same real fixture with >100 historical versions.
  // The service is already warm; this does not claim remote or cold-start latency.
  const profiles = [];
  for (const concurrency of [1, 4]) {
    const samples = [];
    let next = 0;
    await Promise.all(
      Array.from({ length: concurrency }, async () => {
        while (next < 50) {
          const sample = next++;
          const started = performance.now();
          try {
            const response = await effective();
            const correct =
              response.status === 200 &&
              response.data.rules[0].ruleVersion.id === selected.id &&
              response.data.rules[2].ruleVersion.id === otherActive.id;
            samples.push({
              sample,
              durationMs: performance.now() - started,
              status: response.status,
              outcome: correct ? 'passed' : 'failed',
            });
          } catch {
            samples.push({
              sample,
              durationMs: performance.now() - started,
              status: null,
              outcome: 'failed',
            });
          }
        }
      }),
    );
    samples.sort((left, right) => left.sample - right.sample);
    const durations = samples
      .map((sample) => sample.durationMs)
      .sort((a, b) => a - b);
    profiles.push({
      concurrency,
      samples,
      p95Ms: durations[Math.ceil(0.95 * durations.length) - 1],
      failures: samples.filter((sample) => sample.outcome !== 'passed').length,
    });
  }
  const { report } = await import('../../scripts/test-environment.mjs');
  await report(
    'rules-api-performance',
    {
      status: profiles.every(
        (profile) => profile.failures === 0 && profile.p95Ms < 3000,
      )
        ? 'passed'
        : 'failed',
      environment: 'isolated-lab-test',
      node: process.version,
      sampleCountPerProfile: 50,
      historyVersions: 103,
      measurement:
        'HTTP request through validated response; warm local service',
      percentile: 'nearest-rank',
      thresholdMs: 3000,
      profiles,
      coldStart: 'not-measured',
      remote: 'not-tested',
    },
    'imp-05',
  );
  for (const profile of profiles) {
    expect(profile.samples).toHaveLength(50);
    expect(profile.failures).toBe(0);
    expect(profile.p95Ms).toBeLessThan(3000);
  }
}, 120000);

test('RF026-E1: la lectura efectiva observa un snapshot íntegro durante activaciones atómicas', async () => {
  const oldInactivity = (await create()).data;
  const oldStagnation = (await create(baseline('STAGNATION'))).data;
  await activate(oldInactivity.id);
  await activate(oldStagnation.id);
  const newInactivity = (
    await create({ ...baseline(), parameters: { inactivityDays: 9 } })
  ).data;
  const newStagnation = (
    await create({
      ...baseline('STAGNATION'),
      parameters: { stagnationAttempts: 4 },
    })
  ).data;
  const sessionId = JSON.parse(
    Buffer.from(sessions.get(admin.id).split('.')[1], 'base64url').toString(
      'utf8',
    ),
  ).session_id;
  const limited = new URL(stateForRuleTests.migrationUrl);
  limited.username = 'alunza_app';
  limited.password = stateForRuleTests.applicationPassword;
  const writer = new pg.Client({ connectionString: limited.href });
  await writer.connect();
  const statePair = (response) => {
    expect(response.status).toBe(200);
    return response.data.rules.map((entry) => entry.ruleVersion?.id ?? null);
  };
  const oldPair = [oldInactivity.id, null, oldStagnation.id];
  const newPair = [newInactivity.id, null, newStagnation.id];
  try {
    await writer.query('BEGIN');
    await writer.query(
      "SELECT set_config('app.actor_id',$1,true),set_config('app.session_id',$2,true),set_config('app.organization_id',$3,true),set_config('app.request_id',$4,true)",
      [admin.id, sessionId, ids.org, randomUUID()],
    );
    for (const [next, previous] of [
      [newInactivity.id, oldInactivity.id],
      [newStagnation.id, oldStagnation.id],
    ])
      await writer.query(
        'SELECT app_private.activate_rule_version($1::uuid,$2::uuid,$3::uuid,$4::text)',
        [ids.org, next, previous, randomUUID()],
      );
    expect(statePair(await effective())).toEqual(oldPair);
    const reads = Promise.all(Array.from({ length: 8 }, () => effective()));
    await writer.query('COMMIT');
    for (const response of await reads)
      expect([oldPair, newPair]).toContainEqual(statePair(response));
    expect(statePair(await effective())).toEqual(newPair);
  } finally {
    await writer.query('ROLLBACK');
    await writer.end();
  }
  expect(await auditCount(newInactivity.id, 'RULE_VERSION_ACTIVATED')).toBe(1);
  expect(await auditCount(newStagnation.id, 'RULE_VERSION_ACTIVATED')).toBe(1);
});

test('RF026-E3: efectivas revalida membresía y perfil aunque se conserve el token', async () => {
  const active = (await create()).data;
  await activate(active.id);
  await pool.query(
    "UPDATE app.organization_memberships SET state='DISABLED' WHERE organization_id=$1 AND user_id=$2",
    [ids.org, admin.id],
  );
  try {
    expect((await effective()).status).toBe(404);
  } finally {
    await pool.query(
      "UPDATE app.organization_memberships SET state='ACTIVE' WHERE organization_id=$1 AND user_id=$2",
      [ids.org, admin.id],
    );
  }
  await pool.query(
    "UPDATE app.profiles SET account_state='DISABLED' WHERE id=$1",
    [admin.id],
  );
  try {
    expect((await effective()).status).toBe(403);
  } finally {
    await pool.query(
      "UPDATE app.profiles SET account_state='ACTIVE' WHERE id=$1",
      [admin.id],
    );
  }
  expect((await effective()).data.rules[0].ruleVersion.id).toBe(active.id);
});

test('RF026-E1/E2: un fallo de auditoría revierte vigencia, reserva y efecto; la clave se recupera', async () => {
  const first = (await create()).data;
  const active = (await activate(first.id)).data;
  const next = (
    await create({ ...baseline(), parameters: { inactivityDays: 8 } })
  ).data;
  const beforeScope = await pool.query(
    "SELECT current_version_id,next_version FROM app_private.signal_rule_scopes WHERE organization_id=$1 AND type='INACTIVITY'",
    [ids.org],
  );
  const key = randomUUID();
  const fault = `imp05_rule_audit_${randomUUID().replaceAll('-', '')}`;
  await pool.query(`
    CREATE FUNCTION app_private.${fault}() RETURNS trigger
    LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
    BEGIN
      IF NEW.entity_id='${next.id}'::uuid AND NEW.action='RULE_VERSION_ACTIVATED' THEN
        RAISE EXCEPTION USING ERRCODE='XX000',MESSAGE='RULE_TEST_AUDIT_FAILURE';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER ${fault} BEFORE INSERT ON app.audit_events
      FOR EACH ROW EXECUTE FUNCTION app_private.${fault}();
  `);
  try {
    const rejected = await activate(next.id, first.id, { key });
    expect(rejected.status).toBe(503);
    expect(rejected.error.code).toBe('PERSISTENCE_UNAVAILABLE');
    expect(rejected.error.retryable).toBe(true);
    expect((await get(first.id)).data).toEqual(active);
    expect((await get(next.id)).data).toEqual(next);
    expect(await auditCount(next.id, 'RULE_VERSION_ACTIVATED')).toBe(0);
    const operation = await pool.query(
      "SELECT count(*)::integer AS count FROM app_private.signal_rule_operations WHERE organization_id=$1 AND actor_id=$2 AND operation='ACTIVATE' AND key=$3",
      [ids.org, admin.id, key],
    );
    expect(operation.rows[0].count).toBe(0);
    const scope = await pool.query(
      "SELECT current_version_id,next_version FROM app_private.signal_rule_scopes WHERE organization_id=$1 AND type='INACTIVITY'",
      [ids.org],
    );
    expect(scope.rows[0]).toEqual(beforeScope.rows[0]);
  } finally {
    await pool.query(
      `DROP TRIGGER ${fault} ON app.audit_events; DROP FUNCTION app_private.${fault}();`,
    );
  }
  const recovered = await activate(next.id, first.id, { key });
  expect(recovered.status).toBe(200);
  expect(recovered.data.state).toBe('ACTIVE');
  expect(await auditCount(next.id, 'RULE_VERSION_ACTIVATED')).toBe(1);
});

test('RF026-E3: una sesión revocada mientras espera el mutex no confirma activación', async () => {
  const rule = (await create()).data;
  const auth = createClient(
    stateForRuleTests.authUrl,
    stateForRuleTests.publishableKey,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
  const login = await auth.auth.signInWithPassword({
    email: secondAdmin.email,
    password: stateForRuleTests.fixturePassword,
  });
  if (login.error || !login.data.session)
    throw new Error('No se obtuvo la sesión ficticia para probar revocación.');
  const token = login.data.session.access_token;
  const sessionId = JSON.parse(
    Buffer.from(token.split('.')[1], 'base64url').toString('utf8'),
  ).session_id;
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
      sessionId,
    )
  )
    throw new Error('Invalid fixture session.');
  const previousToken = sessions.get(secondAdmin.id);
  sessions.set(secondAdmin.id, token);
  const key = randomUUID();
  const blocker = await pool.connect();
  let pending;
  let completed;
  try {
    await blocker.query('BEGIN');
    await blocker.query(
      "SELECT organization_id FROM app_private.signal_rule_scopes WHERE organization_id=$1 AND type='INACTIVITY' FOR UPDATE",
      [ids.org],
    );
    pending = activate(rule.id, null, { actor: secondAdmin, key });
    const deadline = Date.now() + 1000;
    let waiting = false;
    while (Date.now() < deadline) {
      const observed = await pool.query(
        "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'SELECT app_private.activate_rule_version%') AS waiting",
      );
      if (observed.rows[0].waiting) {
        waiting = true;
        break;
      }
      await delay(10);
    }
    expect(waiting).toBe(true);
    await pool.query('DELETE FROM auth.sessions WHERE id=$1 AND user_id=$2', [
      sessionId,
      secondAdmin.id,
    ]);
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
    try {
      if (pending) completed = await pending;
    } finally {
      sessions.set(secondAdmin.id, previousToken);
    }
  }
  expect(completed.status).toBe(403);
  expect(completed.error.code).toBe('FORBIDDEN');
  expect((await get(rule.id)).data).toEqual(rule);
  expect(await auditCount(rule.id, 'RULE_VERSION_ACTIVATED')).toBe(0);
  const operation = await pool.query(
    "SELECT count(*)::integer AS count FROM app_private.signal_rule_operations WHERE organization_id=$1 AND actor_id=$2 AND operation='ACTIVATE' AND key=$3",
    [ids.org, secondAdmin.id, key],
  );
  expect(operation.rows[0].count).toBe(0);
});
