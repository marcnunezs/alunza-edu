// IMP-06.05: synthetic audit capacity data, restricted to fresh LAB TEST scopes.
// Only the public HTTP reads are application evidence; inserts are fixture setup.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { TextDecoder } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import { report } from '../../scripts/test-environment.mjs';

const require = createRequire(import.meta.url);
const identity = require('../../fixtures/foundation/identity.json');
const { assertLaboratoryTestState } = require('../laboratory-test-state.cjs');
const actors = Object.fromEntries(
  ['admin', 'teacher', 'student', 'foreignAdmin'].map((name, index) => [
    name,
    identity.users[index],
  ]),
);
actors.otherAdmin = identity.users[4];
export const auditPrivateSentinel = 'audit-private-fixture-sentinel-imp0605';
const asOf = '2026-09-02T00:00:00.000000Z';
const from = '2026-09-01T00:00:00.000000Z';
function safeTaskError(name, code) {
  // Never pass SQL text, token-bearing request data, or raw causes to Cypress.
  return new Error(
    `No se completó el fixture aislado de auditoría (${name}; ${code}).`,
  );
}

function eventsFor(organizationId, count, entityId, otherEntityId) {
  return Array.from({ length: count }, (_, index) => ({
    eventId: randomUUID(),
    organizationId,
    actorId: index === 0 ? null : actors[index % 2 ? 'teacher' : 'admin'].id,
    occurredAt: `2026-09-01T12:00:00.${String(Math.floor(index / 3)).padStart(6, '0')}Z`,
    action: index % 2 ? 'fixture.created' : 'fixture.updated',
    entityType: index % 3 ? 'class' : 'exercise',
    entityId: index % 9 === 0 ? null : index % 3 ? otherEntityId : entityId,
    outcome: index % 5 ? 'SUCCESS' : 'DENIED',
  })).sort(
    (a, b) =>
      b.occurredAt.localeCompare(a.occurredAt) ||
      a.eventId.localeCompare(b.eventId),
  );
}

export function createAuditHarness(
  state,
  { apiBaseUrl = 'http://127.0.0.1:4300' } = {},
) {
  assertLaboratoryTestState(state);
  assert.equal(apiBaseUrl, 'http://127.0.0.1:4300');
  const scopes = new Map();
  const sessions = new Map();

  async function database(action) {
    const db = new pg.Client({
      connectionString: state.migrationUrl,
      connectionTimeoutMillis: 5000,
      query_timeout: 15000,
    });
    try {
      await db.connect();
      await db.query('BEGIN');
      const value = await action(db);
      await db.query('COMMIT');
      return value;
    } catch (error) {
      await db.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      await db.end();
    }
  }
  function context(input) {
    const found = scopes.get(input?.organizationId);
    assert.ok(found, 'Only scopes created by this harness may be changed.');
    return found;
  }
  async function session(actor = 'admin') {
    assert.ok(Object.hasOwn(actors, actor));
    if (sessions.has(actor)) return sessions.get(actor);
    const auth = createClient(state.authUrl, state.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const result = await auth.auth.signInWithPassword({
      email: actors[actor].email,
      password: state.fixturePassword,
    });
    assert.equal(result.error, null);
    assert.ok(result.data.session);
    sessions.set(actor, result.data.session);
    return result.data.session;
  }
  async function insertEvents(db, events) {
    await db.query(
      `INSERT INTO app.audit_events(id,organization_id,actor_id,actor_kind,occurred_at,action,entity_type,entity_id,result,correlation_id,safe_changes,request_id)
       SELECT x."eventId",x."organizationId",x."actorId",CASE WHEN x."actorId" IS NULL THEN 'SYSTEM' ELSE 'USER' END,
         x."occurredAt",x.action,x."entityType",x."entityId",x.outcome,gen_random_uuid(),$2::jsonb,gen_random_uuid()
       FROM jsonb_to_recordset($1::jsonb) AS x("eventId" uuid,"organizationId" uuid,"actorId" uuid,"occurredAt" timestamptz,action text,"entityType" text,"entityId" uuid,outcome text)`,
      [
        JSON.stringify(events),
        JSON.stringify({ fixture: true, privateMarker: auditPrivateSentinel }),
      ],
    );
  }
  async function prepare(options = {}) {
    assert.ok(Object.keys(options).every((key) => key === 'profile'));
    const profile = options.profile ?? 'functional';
    assert.ok(
      [
        'functional',
        'capacity',
        'hostile',
        'rowOverflow',
        'byteOverflow',
      ].includes(profile),
    );
    const organizationId = randomUUID(),
      otherOrganizationId = randomUUID();
    const entityId = randomUUID(),
      otherEntityId = randomUUID();
    const events = eventsFor(
      organizationId,
      profile === 'rowOverflow'
        ? 10001
        : ['capacity', 'byteOverflow'].includes(profile)
          ? 10000
          : 25,
      entityId,
      otherEntityId,
    );
    if (profile === 'hostile') {
      const values = [
        '=1+1',
        ' +SUM(A1:A2)',
        '\t@SUM(A1:A2)',
        '-2+3',
        '＝1+1',
        '\u202e+1',
        'á, ñ, "texto"\r\nsegunda línea',
        'control\u0001seguro',
      ];
      events.forEach((event, index) => {
        event.action = values[index % values.length];
        event.entityType = `tipo, "área" ${index}`;
      });
    }
    if (profile === 'byteOverflow')
      events.forEach((event) => {
        event.action = '\u0001'.repeat(100);
        event.entityType = '\u0002'.repeat(100);
        event.outcome = '\u0003'.repeat(80);
      });
    const foreignEvents = eventsFor(
      otherOrganizationId,
      profile === 'capacity' ? 1000 : 11,
      randomUUID(),
      randomUUID(),
    );
    const filters = {
      actorId: actors.admin.id,
      action: 'fixture.updated',
      entityType: 'exercise',
      entityId,
      from,
      asOf,
    };
    const combined = events.filter(
      (event) =>
        event.actorId === filters.actorId &&
        event.action === filters.action &&
        event.entityType === filters.entityType &&
        event.entityId === entityId,
    );
    const scope = {
      organizationId,
      otherOrganizationId,
      name: `Auditoría E2E ${organizationId.slice(0, 8)}`,
      from,
      asOf,
      adminId: actors.admin.id,
      teacherId: actors.teacher.id,
      studentId: actors.student.id,
      otherAdminId: actors.otherAdmin.id,
      entityId,
      filters,
      firstEventId: events[0].eventId,
      nullActorEventId: events.find((event) => event.actorId === null).eventId,
      oracle: {
        total: events.length,
        foreignTotal: foreignEvents.length,
        combinedTotal: combined.length,
        combinedIds: combined.map((event) => event.eventId),
      },
    };
    await database(async (db) => {
      for (const [id, name, admin] of [
        [organizationId, scope.name, actors.admin],
        [otherOrganizationId, 'Auditoría E2E ajena', actors.foreignAdmin],
      ]) {
        await db.query(
          'INSERT INTO app.organizations(id,code,name) VALUES($1,$2,$3)',
          [id, `AUD-${id.slice(0, 8).toUpperCase()}`, name],
        );
        await db.query(
          "INSERT INTO app.organization_memberships(organization_id,user_id,role,state,joined_at) VALUES($1,$2,'ADMIN','ACTIVE',clock_timestamp())",
          [id, admin.id],
        );
      }
      for (const actor of [actors.teacher, actors.student])
        await db.query(
          "INSERT INTO app.organization_memberships(organization_id,user_id,role,state,joined_at) VALUES($1,$2,$3,'ACTIVE',clock_timestamp())",
          [organizationId, actor.id, actor.role],
        );
      await db.query(
        "INSERT INTO app.organization_memberships(organization_id,user_id,role,state,joined_at) VALUES($1,$2,'ADMIN','ACTIVE',clock_timestamp())",
        [organizationId, identity.users[4].id],
      );
      await insertEvents(db, [...events, ...foreignEvents]);
    });
    scopes.set(organizationId, { scope, events, foreignEvents });
    return scope;
  }
  async function request(input, path, options = {}) {
    context(input);
    assert.ok(path.startsWith('/organizations/') && !path.includes('://'));
    const auth = await session(options.actor ?? 'admin');
    const response = await fetch(`${apiBaseUrl}/api/v1${path}`, {
      method: options.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${auth.access_token}`,
        ...(options.body === undefined
          ? {}
          : { 'Content-Type': 'application/json' }),
        ...options.headers,
      },
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 10000),
      redirect: 'error',
    });
    const raw =
      options.binary || options.method === 'HEAD'
        ? Buffer.from(await response.arrayBuffer())
        : null;
    const body =
      raw === null
        ? await response.json()
        : response.headers.get('content-type')?.includes('application/json') &&
            raw.length
          ? JSON.parse(raw.toString('utf8'))
          : null;
    const text = JSON.stringify(body);
    assert.ok(!text.includes(auditPrivateSentinel));
    assert.ok(!text.includes(auth.access_token));
    return {
      status: response.status,
      body,
      data: body?.data,
      requestId: body?.requestId ?? response.headers.get('x-request-id'),
      headers: Object.fromEntries(response.headers),
      ...(raw === null ? {} : { bytes: raw }),
      noStore:
        response.headers.get('cache-control')?.includes('no-store') === true,
    };
  }
  async function revoke(input, { actor = 'admin', restore = false } = {}) {
    const { scope } = context(input);
    assert.ok(['admin', 'teacher'].includes(actor));
    await database((db) =>
      db.query(
        'UPDATE app.organization_memberships SET state=$3 WHERE organization_id=$1 AND user_id=$2',
        [
          scope.organizationId,
          actors[actor].id,
          restore ? 'ACTIVE' : 'DISABLED',
        ],
      ),
    );
    return null;
  }
  async function archive(input) {
    const { scope } = context(input);
    await database((db) =>
      db.query(
        'UPDATE app.organizations SET archived_at=clock_timestamp(),archived_by=$2 WHERE id=$1',
        [scope.organizationId, actors.admin.id],
      ),
    );
    return null;
  }
  async function snapshot(input) {
    const { scope } = context(input);
    return database(async (db) => {
      const result = {};
      for (const table of [
        'audit_events',
        'organization_memberships',
        'exercises',
        'exercise_versions',
        'activities',
        'activity_exercises',
        'attempts',
        'feedbacks',
      ])
        result[table] = (
          await db.query(
            `SELECT count(*)::integer AS count,md5(coalesce(string_agg(to_jsonb(t)::text,',' ORDER BY to_jsonb(t)::text),'')) AS digest FROM app.${table} t WHERE organization_id=$1`,
            [scope.organizationId],
          )
        ).rows[0];
      return result;
    });
  }
  async function append(input, event = {}) {
    const { events } = context(input);
    assert.ok(
      Object.keys(event).every((key) => ['occurredAt', 'action'].includes(key)),
    );
    const row = {
      ...events[0],
      eventId: randomUUID(),
      occurredAt: event.occurredAt ?? '2026-09-01T11:00:00.000001Z',
      action: event.action ?? 'fixture.late',
    };
    await database((db) => insertEvents(db, [row]));
    return row;
  }
  async function beginLate(input) {
    const { scope, events } = context(input);
    const db = new pg.Client({
      connectionString: state.migrationUrl,
      connectionTimeoutMillis: 5000,
    });
    await db.connect();
    await db.query('BEGIN');
    const row = {
      ...events.at(-1),
      eventId: randomUUID(),
      organizationId: scope.organizationId,
      occurredAt: '2026-09-01T11:00:00.000001Z',
      action: 'fixture.late',
    };
    try {
      await insertEvents(db, [row]);
    } catch (error) {
      await db.query('ROLLBACK');
      await db.end();
      throw error;
    }
    return {
      row,
      finish: async (commit = true) => {
        try {
          await db.query(commit ? 'COMMIT' : 'ROLLBACK');
        } finally {
          await db.end();
        }
      },
    };
  }
  return {
    prepare,
    request,
    revoke,
    archive,
    snapshot,
    append,
    beginLate,
    session,
    expected: (input) => context(input).events,
    exportDatabase: (input, action) => {
      context(input);
      return database(action);
    },
    close: async () => {
      sessions.clear();
      scopes.clear();
    },
  };
}

export function auditTasks(state) {
  const harness = createAuditHarness(state);
  const handlers = {
    prepare: (input) => harness.prepare(input),
    revoke: (input) => harness.revoke(input, input),
    archive: (input) => harness.archive(input),
    snapshot: (input) => harness.snapshot(input),
    async performance(input) {
      assert.ok(Array.isArray(input.samples) && input.samples.length <= 50);
      assert.ok(
        input.samples.every(
          (sample) =>
            Number.isFinite(sample.durationMs) && sample.durationMs >= 0,
        ),
      );
      assert.ok(
        Number.isFinite(input.firstNavigationMs) &&
          input.firstNavigationMs >= 0,
      );
      const sorted = input.samples
        .map((sample) => sample.durationMs)
        .sort((a, b) => a - b);
      const p95Ms = sorted.length
        ? sorted[Math.ceil(sorted.length * 0.95) - 1]
        : null;
      const passed =
        input.firstNavigationValid === true &&
        input.samples.length === 50 &&
        input.samples.every((sample) => sample.valid === true) &&
        p95Ms < 3000;
      await report(
        'audit-ui-performance',
        {
          status: passed ? 'passed' : 'failed',
          firstNavigationMs: input.firstNavigationMs,
          firstNavigationValid: input.firstNavigationValid,
          samples: input.samples,
          p95Ms,
          percentile: 'nearest-rank',
          concurrency: 1,
          capacity: { events: 10000, foreignEvents: 1000 },
          environment:
            'LAB TEST Chrome production build; services started; first navigation separate from 50 warm samples',
        },
        'imp-06',
      );
      return { passed, p95Ms, samples: input.samples.length };
    },
  };
  return Object.fromEntries(
    Object.entries(handlers).map(([name, handler]) => [
      `audit:${name}`,
      async (input) => {
        try {
          return await handler(input ?? {});
        } catch (error) {
          const code =
            typeof error?.code === 'string' &&
            /^[A-Z0-9_]{3,60}$/.test(error.code)
              ? error.code
              : 'FIXTURE_FAILURE';
          const directory = resolve('.local/evidence/imp-06');
          await mkdir(directory, { recursive: true });
          await writeFile(
            resolve(directory, 'audit-fixture-error.json'),
            JSON.stringify(
              {
                task: name,
                code,
                constraint:
                  typeof error?.constraint === 'string' &&
                  /^[a-z0-9_]+$/.test(error.constraint)
                    ? error.constraint
                    : null,
              },
              null,
              2,
            ),
            { mode: 0o600 },
          );
          throw safeTaskError(name, code);
        }
      },
    ]),
  );
}

// Generated with Cypress Author on 2026-11-03 for the IMP-06.06 E2E support.
export const auditCsvHeaders = [
  'event_id',
  'occurred_at',
  'actor_id',
  'action',
  'entity_type',
  'entity_id',
  'organization_id',
  'outcome',
];
export const auditExportDigest = (bytes) =>
  createHash('sha256').update(bytes).digest('hex');

// Independent, strict reader: no production serializer is used as the oracle.
export function readAuditCsv(bytes) {
  assert.ok(Buffer.isBuffer(bytes));
  assert.deepEqual(
    [...bytes.subarray(0, 3)],
    [0xef, 0xbb, 0xbf],
    'CSV_UTF8_BOM',
  );
  const text = new TextDecoder('utf-8', { fatal: true }).decode(
    bytes.subarray(3),
  );
  const records = [];
  let row = [],
    field = '',
    quoted = false,
    closed = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index++;
      } else if (char === '"') {
        quoted = false;
        closed = true;
      } else field += char;
    } else if (closed && char === ',') {
      row.push(field);
      field = '';
      closed = false;
    } else if (closed && char === '\r' && text[index + 1] === '\n') {
      row.push(field);
      records.push(row);
      row = [];
      field = '';
      closed = false;
      index++;
    } else if (!closed && field === '' && char === '"') quoted = true;
    else assert.fail('CSV_NON_QUOTED_FIELD_OR_INVALID_SEPARATOR');
  }
  assert.equal(quoted, false, 'CSV_UNTERMINATED_FIELD');
  assert.equal(closed, false, 'CSV_MISSING_FINAL_CRLF');
  assert.equal(row.length, 0);
  assert.deepEqual(records.shift(), auditCsvHeaders);
  assert.ok(records.every((record) => record.length === 8));
  return {
    headerFields: auditCsvHeaders,
    rows: records,
    rowCount: records.length,
    byteLength: bytes.length,
    sha256: auditExportDigest(bytes),
  };
}

export function createAuditExportHarness(state) {
  const base = createAuditHarness(state);
  const owned = new Map();
  async function prepare(options = {}) {
    const scope = await base.prepare(options);
    owned.set(scope.organizationId, scope);
    return scope;
  }
  const check = (input) => {
    assert.ok(owned.has(input?.organizationId), 'AUDIT_EXPORT_UNOWNED_SCOPE');
    return owned.get(input.organizationId);
  };
  async function create(input, options = {}) {
    const scope = check(input);
    return base.request(
      scope,
      `/organizations/${scope.organizationId}/audit-exports`,
      {
        method: 'POST',
        timeoutMs: 45000,
        body: options.body ?? { from: scope.from, asOf: scope.asOf },
        ...options,
        headers: {
          'Idempotency-Key': options.key ?? randomUUID(),
          ...options.headers,
        },
      },
    );
  }
  async function metadata(input, exportId, options = {}) {
    check(input);
    return base.request(
      input,
      `/organizations/${input.organizationId}/audit-exports/${exportId}`,
      options,
    );
  }
  async function content(input, exportId, options = {}) {
    check(input);
    return base.request(
      input,
      `/organizations/${input.organizationId}/audit-exports/${exportId}/content`,
      { binary: true, timeoutMs: 45000, ...options },
    );
  }
  async function facts(input) {
    check(input);
    return base.exportDatabase(input, async (db) => {
      const exports = (
        await db.query(
          `SELECT id AS "exportId",state,error_code AS "errorCode",row_count AS "rowCount",byte_length AS "byteLength",sha256,
        coalesce(octet_length(content),0) AS "storedBytes" FROM app_private.audit_exports
        WHERE organization_id=$1 AND ($2::uuid IS NULL OR id=$2) ORDER BY requested_at,id`,
          [input.organizationId, input.exportId ?? null],
        )
      ).rows;
      const deliveries = (
        await db.query(
          `SELECT id,state FROM app_private.audit_export_deliveries
        WHERE organization_id=$1 AND ($2::uuid IS NULL OR export_id=$2) ORDER BY started_at,id`,
          [input.organizationId, input.exportId ?? null],
        )
      ).rows;
      const events = (
        await db.query(
          `SELECT action,count(*)::integer AS count FROM app.audit_events
        WHERE organization_id=$1 AND ($2::uuid IS NULL OR entity_id=$2) AND action LIKE 'AUDIT_EXPORT_%' GROUP BY action`,
          [input.organizationId, input.exportId ?? null],
        )
      ).rows;
      const counts = Object.fromEntries(
        events.map((row) => [row.action, row.count]),
      );
      return {
        exports,
        deliveries,
        // A durable reservation is the request record; no synthetic audit event.
        requested: exports.length,
        generated: counts.AUDIT_EXPORT_GENERATED ?? 0,
        failed: counts.AUDIT_EXPORT_FAILED ?? 0,
        downloaded: counts.AUDIT_EXPORT_DOWNLOADED ?? 0,
        expired: counts.AUDIT_EXPORT_EXPIRED ?? 0,
      };
    });
  }
  async function waitForFacts(input, condition, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    do {
      const value = await facts(input);
      if (condition(value)) return value;
      await delay(25);
    } while (Date.now() < deadline);
    assert.fail('AUDIT_EXPORT_FACT_TIMEOUT');
  }
  async function expire(input) {
    check(input);
    return base.exportDatabase(input, async (db) => {
      const updated = await db.query(
        `WITH moment AS MATERIALIZED (SELECT clock_timestamp() AS at)
        UPDATE app_private.audit_exports SET generated_at=moment.at-interval '25 hours',expires_at=moment.at-interval '1 hour'
        FROM moment WHERE organization_id=$1 AND id=$2 AND state='READY'`,
        [input.organizationId, input.exportId],
      );
      assert.equal(updated.rowCount, 1);
      return null;
    });
  }
  async function applicationDatabase(
    input,
    action,
    actorId = '',
    sessionId = '',
  ) {
    check(input);
    const limited = new URL(state.migrationUrl);
    limited.username = 'alunza_app';
    limited.password = state.applicationPassword;
    const db = new pg.Client({
      connectionString: limited.href,
      connectionTimeoutMillis: 5000,
      query_timeout: 10000,
    });
    try {
      await db.connect();
      await db.query('BEGIN');
      const role = await db.query(
        "SELECT current_user='alunza_app' AND NOT rolsuper AND NOT rolbypassrls AS limited FROM pg_roles WHERE rolname=current_user",
      );
      assert.equal(
        role.rows[0]?.limited,
        true,
        'AUDIT_EXPORT_APPLICATION_ROLE_REQUIRED',
      );
      await db.query(
        "SELECT set_config('app.actor_id',$1,true),set_config('app.session_id',$2,true),set_config('app.organization_id','',true)",
        [actorId, sessionId],
      );
      const result = await action(db);
      await db.query('COMMIT');
      return result;
    } catch (error) {
      await db.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      await db.end();
    }
  }
  async function asApplication(input, action, actor = 'admin') {
    check(input);
    const auth = await base.session(actor);
    const claims = JSON.parse(
      Buffer.from(auth.access_token.split('.')[1], 'base64url').toString(
        'utf8',
      ),
    );
    assert.ok(claims.session_id);
    return applicationDatabase(input, action, auth.user.id, claims.session_id);
  }
  async function reserve(
    input,
    key = randomUUID(),
    body = { from: input.from, asOf: input.asOf },
  ) {
    return asApplication(
      input,
      async (db) =>
        (
          await db.query(
            'SELECT app_private.audit_export_reserve($1,$2,$3::jsonb) AS data',
            [input.organizationId, key, JSON.stringify(body)],
          )
        ).rows[0].data,
    );
  }
  async function expireLease(input) {
    check(input);
    return base.exportDatabase(input, async (db) => {
      const result = await db.query(
        "UPDATE app_private.audit_exports SET lease_until=clock_timestamp()-interval '1 second' WHERE organization_id=$1 AND id=$2 AND state='RUNNING'",
        [input.organizationId, input.exportId],
      );
      assert.equal(result.rowCount, 1);
      return null;
    });
  }
  async function maintain(input) {
    check(input);
    return applicationDatabase(input, async (db) => {
      await db.query('SELECT app_private.audit_export_maintain()');
      return null;
    });
  }
  async function beginDelivery(input) {
    return asApplication(
      input,
      async (db) =>
        (
          await db.query(
            'SELECT app_private.audit_export_delivery_begin($1,$2) AS data',
            [input.organizationId, input.exportId],
          )
        ).rows[0].data,
    );
  }
  async function expireDelivery(input) {
    check(input);
    return base.exportDatabase(input, async (db) => {
      const result = await db.query(
        "UPDATE app_private.audit_export_deliveries SET deadline_at=clock_timestamp()-interval '1 second' WHERE organization_id=$1 AND export_id=$2 AND state='PENDING'",
        [input.organizationId, input.exportId],
      );
      assert.ok(result.rowCount > 0);
      return null;
    });
  }
  async function finishDelivery(input, ticket, outcome) {
    check(input);
    assert.ok(['FINISHED', 'ABORTED'].includes(outcome));
    await base.exportDatabase(input, async (db) => {
      const ownedTicket = await db.query(
        'SELECT id FROM app_private.audit_export_deliveries WHERE organization_id=$1 AND export_id=$2 AND id=$3',
        [input.organizationId, input.exportId, ticket.ticketId],
      );
      assert.equal(ownedTicket.rowCount, 1);
    });
    return applicationDatabase(input, async (db) => {
      return (
        await db.query(
          'SELECT app_private.audit_export_delivery_finish($1,$2,$3) AS data',
          [ticket.ticketId, ticket.ticketToken, outcome],
        )
      ).rows[0].data;
    });
  }
  async function holdReservation(input) {
    const scope = check(input);
    const db = new pg.Client({
      connectionString: state.migrationUrl,
      connectionTimeoutMillis: 5000,
    });
    let released = false;
    try {
      await db.connect();
      await db.query('BEGIN');
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `audit-export:${scope.organizationId}:${scope.adminId}`,
      ]);
      const pid = (await db.query('SELECT pg_backend_pid() AS pid')).rows[0]
        .pid;
      return {
        async waitForBlocked(timeoutMs = 1500) {
          const deadline = Date.now() + timeoutMs;
          do {
            const waiting = await base.exportDatabase(
              input,
              async (observer) =>
                (
                  await observer.query(
                    `SELECT EXISTS(
              SELECT 1 FROM pg_stat_activity a WHERE a.wait_event_type='Lock'
                AND $1::integer=ANY(pg_blocking_pids(a.pid))
                AND a.query LIKE '%audit_export_reserve%') AS waiting`,
                    [pid],
                  )
                ).rows[0].waiting,
            );
            if (waiting) return;
            await delay(10);
          } while (Date.now() < deadline);
          assert.fail('AUDIT_EXPORT_EXPECTED_ADVISORY_WAIT');
        },
        async release() {
          if (released) return;
          released = true;
          try {
            await db.query('COMMIT');
          } finally {
            await db.end();
          }
        },
      };
    } catch (error) {
      await db.query('ROLLBACK').catch(() => undefined);
      await db.end();
      throw error;
    }
  }
  return {
    ...base,
    prepare,
    create,
    metadata,
    content,
    facts,
    waitForFacts,
    expire,
    asApplication,
    reserve,
    expireLease,
    maintain,
    beginDelivery,
    expireDelivery,
    finishDelivery,
    holdReservation,
    close: async () => {
      owned.clear();
      await base.close();
    },
  };
}

export function auditExportTasks(state) {
  const harness = createAuditExportHarness(state);
  const handlers = {
    prepare: (input) => harness.prepare(input),
    revoke: (input) => harness.revoke(input, input),
    expire: (input) => harness.expire(input),
    facts: (input) => harness.facts(input),
    async readDownload(input) {
      assert.ok(['csv', 'metadata'].includes(input.kind));
      assert.equal(basename(input.fileName), input.fileName);
      const fileName = `auditoria-${input.organizationId}-${input.exportId}.${input.kind === 'csv' ? 'csv' : 'json'}`;
      assert.equal(input.fileName, fileName);
      const directory = resolve('.local/evidence/cypress-downloads');
      const path = resolve(directory, fileName);
      assert.equal(await realpath(path), path, 'AUDIT_DOWNLOAD_SYMLINK');
      assert.equal(
        await realpath(directory),
        directory,
        'AUDIT_DOWNLOAD_DIRECTORY_SYMLINK',
      );
      const known = await harness.facts(input);
      assert.equal(known.exports.length, 1);
      const bytes = await readFile(path);
      if (input.kind === 'csv') {
        const result = readAuditCsv(bytes);
        assert.equal(result.sha256, known.exports[0].sha256);
        assert.equal(result.rowCount, known.exports[0].rowCount);
        assert.equal(result.byteLength, known.exports[0].byteLength);
        assert.ok(result.rows.every((row) => row[6] === input.organizationId));
        return result;
      }
      const { auditExportMetadataSchema } = await import('@alunza/contracts');
      const metadata = auditExportMetadataSchema.parse(
        JSON.parse(bytes.toString('utf8')),
      );
      assert.equal(metadata.exportId, input.exportId);
      assert.equal(metadata.organizationId, input.organizationId);
      assert.equal(metadata.sha256, known.exports[0].sha256);
      return { metadata, byteLength: bytes.length };
    },
    async performance(input) {
      assert.ok(Array.isArray(input.samples) && input.samples.length <= 50);
      assert.ok(
        input.samples.every(
          (sample) =>
            Number.isFinite(sample.durationMs) && sample.durationMs >= 0,
        ),
      );
      assert.ok(
        Number.isFinite(input.firstNavigationMs) &&
          input.firstNavigationMs >= 0,
      );
      const sorted = input.samples
        .map((sample) => sample.durationMs)
        .sort((a, b) => a - b);
      const p95Ms = sorted.length
        ? sorted[Math.ceil(sorted.length * 0.95) - 1]
        : null;
      const passed =
        input.firstNavigationValid === true &&
        input.samples.length === 50 &&
        input.samples.every((sample) => sample.valid === true) &&
        p95Ms < 3000;
      await report(
        'audit-export-ui-performance',
        {
          status: passed ? 'passed' : 'failed',
          firstNavigationMs: input.firstNavigationMs,
          firstNavigationValid: input.firstNavigationValid,
          samples: input.samples,
          p95Ms,
          percentile: 'nearest-rank',
          concurrency: 1,
          capacity: { events: 10000, foreignEvents: 1000 },
          environment:
            'LAB TEST Chrome production build; first export separate from 50 warm complete exports/downloads',
        },
        'imp-06',
      );
      return { passed, p95Ms, samples: input.samples.length };
    },
  };
  return Object.fromEntries(
    Object.entries(handlers).map(([name, handler]) => [
      `auditExport:${name}`,
      async (input) => {
        try {
          return await handler(input ?? {});
        } catch (error) {
          const code =
            typeof error?.code === 'string' &&
            /^[A-Z0-9_]{3,60}$/.test(error.code)
              ? error.code
              : 'FIXTURE_FAILURE';
          const directory = resolve('.local/evidence/imp-06');
          await mkdir(directory, { recursive: true });
          await writeFile(
            resolve(directory, 'audit-export-fixture-error.json'),
            JSON.stringify(
              {
                task: name,
                code,
                constraint:
                  typeof error?.constraint === 'string' &&
                  /^[a-z0-9_]+$/.test(error.constraint)
                    ? error.constraint
                    : null,
              },
              null,
              2,
            ),
            { mode: 0o600 },
          );
          throw safeTaskError(`export:${name}`, code);
        }
      },
    ]),
  );
}
