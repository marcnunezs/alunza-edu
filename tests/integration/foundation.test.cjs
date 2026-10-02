const { assertLaboratoryTestState } = require('../laboratory-test-state.cjs');
/* eslint @typescript-eslint/no-require-imports: "off" */
const { readFileSync } = require('node:fs');
const path = require('node:path');
const pg = require('pg');
const { createClient } = require('@supabase/supabase-js');

const fixture = JSON.parse(
  readFileSync(
    path.resolve(__dirname, '../../fixtures/foundation/identity.json'),
    'utf8',
  ),
);
const orgA = fixture.organizations[0];
const orgB = fixture.organizations[1];
const studentA = fixture.users.find(
  (user) => user.role === 'STUDENT' && user.organizationId === orgA.id,
);
const missingId = '99999999-9999-4999-8999-999999999999';
const uuidPattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
let state;
let apiUrl;
let admin;
let application;
let jose;
const sessions = new Map();

function assertLocalTestTarget() {
  if (!process.env.ALUNZA_TEST_STATE || !process.env.ALUNZA_TEST_API_URL) {
    throw new Error(
      'Run npm run test:integration to prepare the isolated local test project.',
    );
  }
  state = JSON.parse(readFileSync(process.env.ALUNZA_TEST_STATE, 'utf8'));
  assertLaboratoryTestState(state);
  apiUrl = process.env.ALUNZA_TEST_API_URL;
  const database = new URL(state.migrationUrl);
  if (
    state.projectId !== 'alunza-edu-laboratorio-test' ||
    state.authUrl !== 'http://127.0.0.1:18421' ||
    apiUrl !== 'http://127.0.0.1:4300' ||
    !['postgres:', 'postgresql:'].includes(database.protocol) ||
    database.hostname !== '127.0.0.1' ||
    database.port !== '18422' ||
    database.pathname !== '/postgres'
  ) {
    throw new Error(
      'Integration tests refuse to modify a target outside the isolated Alunza test project.',
    );
  }
}

function authClient() {
  return createClient(state.authUrl, state.publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

async function api(resource, token, headers = {}) {
  const response = await fetch(`${apiUrl}${resource}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    signal: AbortSignal.timeout(8000),
  });
  const body = await response.json();
  // Keep diagnostics safe: assertions must never print the local state or access tokens.
  const responseText = JSON.stringify(body);
  for (const secret of [
    state.authAdminKey,
    state.applicationPassword,
    state.fixturePassword,
  ]) {
    expect(responseText.includes(secret)).toBe(false);
  }
  if (token) expect(responseText.includes(token)).toBe(false);
  expect(body.requestId).toMatch(uuidPattern);
  expect(response.headers.get('x-request-id')).toBe(body.requestId);
  expect(response.headers.get('cache-control')).toContain('no-store');
  return { status: response.status, body, headers: response.headers };
}

function expectError(result, status, code) {
  expect(result.status).toBe(status);
  expect(result.body).toEqual({
    error: { code, message: expect.any(String), fields: [], retryable: false },
    requestId: expect.stringMatching(uuidPattern),
  });
}

async function asApplication(actorId, organizationId, action) {
  const client = await application.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT set_config('app.actor_id', $1, true), set_config('app.organization_id', $2, true)",
      [actorId, organizationId],
    );
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function rolledBackAdmin(action) {
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    return await action(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

beforeAll(async () => {
  assertLocalTestTarget();
  jose = await import('jose');
  admin = new pg.Pool({
    connectionString: state.migrationUrl,
    max: 1,
    connectionTimeoutMillis: 3000,
  });
  const url = new URL(state.migrationUrl);
  url.username = 'alunza_app';
  url.password = state.applicationPassword;
  application = new pg.Pool({
    connectionString: url.href,
    max: 1,
    connectionTimeoutMillis: 3000,
  });
  for (const user of fixture.users) {
    const client = authClient();
    const { data, error } = await client.auth.signInWithPassword({
      email: user.email,
      password: state.fixturePassword,
    });
    if (error || !data.session || data.user?.id !== user.id) {
      throw new Error(
        `Real Supabase login failed for fixture role ${user.role} (${error?.code ?? 'identity_mismatch'}).`,
      );
    }
    sessions.set(user.id, {
      client,
      token: data.session.access_token,
      metadata: data.user.user_metadata,
    });
  }
}, 60000);

afterAll(async () => {
  await Promise.all([admin?.end(), application?.end()]);
});

describe('Real Supabase identity and NestJS access', () => {
  it('obtains real ES256 Auth sessions and discovers their public JWKS keys', async () => {
    const response = await fetch(
      `${state.authUrl}/auth/v1/.well-known/jwks.json`,
      { signal: AbortSignal.timeout(5000) },
    );
    expect(response.status).toBe(200);
    const jwks = await response.json();
    expect(jwks.keys.length).toBeGreaterThan(0);
    expect(jwks.keys.every((key) => !key.d && !key.k)).toBe(true);
    const resolver = jose.createLocalJWKSet(jwks);
    for (const user of fixture.users) {
      const token = sessions.get(user.id).token;
      const header = jose.decodeProtectedHeader(token);
      expect(header.alg).toBe('ES256');
      expect(jwks.keys.some((key) => key.kid === header.kid)).toBe(true);
      const { payload } = await jose.jwtVerify(token, resolver, {
        algorithms: ['ES256'],
        issuer: `${state.authUrl}/auth/v1`,
        audience: 'authenticated',
      });
      expect(payload.sub).toBe(user.id);
    }
  });

  it.each(
    fixture.users.map((user) => [user.role, user.organizationId, user.id]),
  )(
    'allows %s only within their own organization %s',
    async (_role, organizationId, userId) => {
      const user = fixture.users.find((candidate) => candidate.id === userId);
      const token = sessions.get(userId).token;
      const me = await api('/api/v1/me', token);
      expect(me.status).toBe(200);
      expect(me.body.data).toEqual({
        id: userId,
        displayName: user.displayName,
        accountState: 'ACTIVE',
        memberships: [
          {
            organizationId,
            organizationName: fixture.organizations.find(
              (org) => org.id === organizationId,
            ).name,
            organizationState: 'ACTIVE',
            accessMode: 'OPERATE',
            role: user.role,
            state: 'ACTIVE',
          },
        ],
        provisioningGrants: [],
        canProvisionOrganization: false,
      });
      const own = await api(`/api/v1/organizations/${organizationId}`, token);
      expect(own.status).toBe(200);
      expect(own.body.data).toEqual({
        ...fixture.organizations.find((org) => org.id === organizationId),
        revision: 1,
        state: 'ACTIVE',
        archivedAt: null,
      });
      const foreignId = organizationId === orgA.id ? orgB.id : orgA.id;
      const foreign = await api(`/api/v1/organizations/${foreignId}`, token);
      const missing = await api(`/api/v1/organizations/${missingId}`, token);
      expectError(foreign, 404, 'RESOURCE_NOT_FOUND');
      expectError(missing, 404, 'RESOURCE_NOT_FOUND');
      expect(foreign.body.error).toEqual(missing.body.error);
    },
  );

  it('rejects missing, malformed and altered JWTs', async () => {
    expectError(await api('/api/v1/me'), 401, 'UNAUTHENTICATED');
    expectError(await api('/api/v1/me', 'not-a-jwt'), 401, 'UNAUTHENTICATED');
    const parts = sessions.get(studentA.id).token.split('.');
    const signature = Buffer.from(parts[2], 'base64url');
    signature[0] ^= 1;
    parts[2] = signature.toString('base64url');
    expectError(
      await api('/api/v1/me', parts.join('.')),
      401,
      'UNAUTHENTICATED',
    );
  });

  it('rejects validly signed expired tokens and incorrect issuer or audience', async () => {
    const keysPath = path.resolve(
      path.dirname(process.env.ALUNZA_TEST_STATE),
      '../supabase/signing_keys.json',
    );
    const keys = JSON.parse(readFileSync(keysPath, 'utf8'));
    const key = keys.find((candidate) => candidate.alg === 'ES256');
    const privateKey = await jose.importJWK(
      { ...key, key_ops: ['sign'] },
      'ES256',
    );
    const valid = {
      iss: `${state.authUrl}/auth/v1`,
      aud: 'authenticated',
      exp: Math.floor(Date.now() / 1000) + 120,
      session_id: jose.decodeJwt(sessions.get(studentA.id).token).session_id,
    };
    for (const changes of [
      { exp: Math.floor(Date.now() / 1000) - 60 },
      { iss: 'https://other-environment.invalid/auth/v1' },
      { aud: 'different-audience' },
    ]) {
      // These adversarial tokens are locally signed test inputs, not Auth-issued sessions.
      const token = await new jose.SignJWT({
        ...valid,
        ...changes,
        sub: studentA.id,
      })
        .setProtectedHeader({ alg: 'ES256', kid: key.kid })
        .sign(privateKey);
      expectError(await api('/api/v1/me', token), 401, 'UNAUTHENTICATED');
    }
  });

  it.each(['INVITED', 'DISABLED'])(
    'revokes access when the current profile becomes %s despite its existing JWT',
    async (accountState) => {
      const token = sessions.get(studentA.id).token;
      const original = await admin.query(
        'SELECT account_state FROM app.profiles WHERE id=$1',
        [studentA.id],
      );
      try {
        await admin.query(
          'UPDATE app.profiles SET account_state=$1 WHERE id=$2',
          [accountState, studentA.id],
        );
        expectError(await api('/api/v1/me', token), 403, 'ACCOUNT_INACTIVE');
        expectError(
          await api(`/api/v1/organizations/${orgA.id}`, token),
          403,
          'ACCOUNT_INACTIVE',
        );
        const rows = await asApplication(studentA.id, orgA.id, (client) =>
          client.query('SELECT id FROM app.organizations'),
        );
        expect(rows.rowCount).toBe(0);
      } finally {
        await admin.query(
          'UPDATE app.profiles SET account_state=$1 WHERE id=$2',
          [original.rows[0].account_state, studentA.id],
        );
      }
      expect((await api('/api/v1/me', token)).status).toBe(200);
    },
  );

  it.each(['INVITED', 'DISABLED'])(
    'revokes access when the current membership becomes %s',
    async (membershipState) => {
      const token = sessions.get(studentA.id).token;
      const original = await admin.query(
        'SELECT state FROM app.organization_memberships WHERE user_id=$1 AND organization_id=$2',
        [studentA.id, orgA.id],
      );
      try {
        await admin.query(
          'UPDATE app.organization_memberships SET state=$1 WHERE user_id=$2 AND organization_id=$3',
          [membershipState, studentA.id, orgA.id],
        );
        const context = await api('/api/v1/me', token);
        expect(context.status).toBe(200);
        expect(context.body.data.memberships).toEqual([]);
        expectError(
          await api(`/api/v1/organizations/${orgA.id}`, token),
          404,
          'RESOURCE_NOT_FOUND',
        );
        const rows = await asApplication(studentA.id, orgA.id, (client) =>
          client.query('SELECT id FROM app.organizations'),
        );
        expect(rows.rowCount).toBe(0);
      } finally {
        await admin.query(
          'UPDATE app.organization_memberships SET state=$1 WHERE user_id=$2 AND organization_id=$3',
          [original.rows[0].state, studentA.id, orgA.id],
        );
      }
      expect((await api('/api/v1/me', token)).status).toBe(200);
    },
  );

  it('reads a changed role from current membership instead of the older JWT', async () => {
    try {
      await admin.query(
        "UPDATE app.organization_memberships SET role='TEACHER' WHERE user_id=$1 AND organization_id=$2",
        [studentA.id, orgA.id],
      );
      const result = await api('/api/v1/me', sessions.get(studentA.id).token);
      expect(result.status).toBe(200);
      expect(result.body.data.memberships[0].role).toBe('TEACHER');
    } finally {
      await admin.query(
        'UPDATE app.organization_memberships SET role=$1 WHERE user_id=$2 AND organization_id=$3',
        [studentA.role, studentA.id, orgA.id],
      );
    }
  });

  it('does not grant privileges supplied through user_metadata or request headers', async () => {
    const session = sessions.get(studentA.id);
    try {
      const updated = await session.client.auth.updateUser({
        data: {
          role: 'ADMIN',
          organizationId: orgB.id,
          userId: fixture.users[3].id,
        },
      });
      if (updated.error)
        throw new Error(
          'Could not prepare the user-editable metadata negative fixture.',
        );
      const refreshed = await session.client.auth.refreshSession();
      if (refreshed.error || !refreshed.data.session)
        throw new Error(
          'Could not refresh the metadata negative fixture session.',
        );
      const token = refreshed.data.session.access_token;
      const claims = jose.decodeJwt(token);
      expect(claims.user_metadata.role).toBe('ADMIN');
      const me = await api('/api/v1/me', token, {
        'x-user-id': fixture.users[3].id,
        'x-organization-id': orgB.id,
        'x-role': 'ADMIN',
      });
      expect(me.status).toBe(200);
      expect(me.body.data.id).toBe(studentA.id);
      expect(me.body.data.memberships).toEqual([
        {
          organizationId: orgA.id,
          organizationName: orgA.name,
          organizationState: 'ACTIVE',
          accessMode: 'OPERATE',
          role: 'STUDENT',
          state: 'ACTIVE',
        },
      ]);
      expectError(
        await api(`/api/v1/organizations/${orgB.id}`, token),
        404,
        'RESOURCE_NOT_FOUND',
      );
    } finally {
      const restored = await session.client.auth.updateUser({
        data: {
          role: session.metadata.role ?? null,
          organizationId: session.metadata.organizationId ?? null,
          userId: session.metadata.userId ?? null,
        },
      });
      expect(restored.error === null).toBe(true);
    }
  });

  it('denies archived organizations using the existing token and restores the fixture', async () => {
    const original = await admin.query(
      'SELECT archived_at FROM app.organizations WHERE id=$1',
      [orgA.id],
    );
    try {
      await admin.query(
        'UPDATE app.organizations SET archived_at=now() WHERE id=$1',
        [orgA.id],
      );
      expectError(
        await api(
          `/api/v1/organizations/${orgA.id}`,
          sessions.get(studentA.id).token,
        ),
        404,
        'RESOURCE_NOT_FOUND',
      );
      const context = await api('/api/v1/me', sessions.get(studentA.id).token);
      expect(context.status).toBe(200);
      expect(context.body.data.memberships).toEqual([]);
    } finally {
      await admin.query(
        'UPDATE app.organizations SET archived_at=$1 WHERE id=$2',
        [original.rows[0].archived_at, orgA.id],
      );
    }
  });

  it('rejects malformed resource IDs and omits CORS permission for foreign origins', async () => {
    expectError(
      await api(
        '/api/v1/organizations/not-a-uuid',
        sessions.get(studentA.id).token,
      ),
      400,
      'INVALID_REQUEST',
    );
    const result = await api('/api/v1/me', sessions.get(studentA.id).token, {
      Origin: 'https://foreign-origin.invalid',
    });
    expect(result.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('does not expose the private app schema through PostgREST', async () => {
    for (const token of [undefined, sessions.get(studentA.id).token]) {
      const response = await fetch(
        `${state.authUrl}/rest/v1/organizations?select=id`,
        {
          headers: {
            apikey: state.publishableKey,
            'Accept-Profile': 'app',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          signal: AbortSignal.timeout(5000),
        },
      );
      expect(response.status).toBe(406);
      const error = await response.json();
      expect(error.code).toBe('PGRST106');
    }
  });
});

describe('Real PostgreSQL grants, constraints and RLS', () => {
  it('connects as the non-owner application login without bypass privileges', async () => {
    const result =
      await application.query(`SELECT current_user AS name, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolreplication, rolinherit
      FROM pg_roles WHERE rolname=current_user`);
    expect(result.rows).toEqual([
      {
        name: 'alunza_app',
        rolsuper: false,
        rolbypassrls: false,
        rolcreatedb: false,
        rolcreaterole: false,
        rolreplication: false,
        rolinherit: false,
      },
    ]);
    const tables =
      await admin.query(`SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity, r.rolname AS owner
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles r ON r.oid=c.relowner
      WHERE n.nspname='app' AND c.relkind='r' ORDER BY c.relname`);
    expect(tables.rows.map((row) => row.relname)).toEqual([
      'activities',
      'activity_exercises',
      'attempts',
      'audit_events',
      'class_join_codes',
      'class_memberships',
      'classes',
      'concept_tags',
      'concept_versions',
      'course_teacher_grants',
      'courses',
      'executions',
      'exercise_version_concepts',
      'exercise_versions',
      'exercises',
      'feedback_requests',
      'feedback_source_refs',
      'feedbacks',
      'invitation_deliveries',
      'material_jobs',
      'operation_keys',
      'organization_invitations',
      'organization_memberships',
      'organizations',
      'profiles',
      'provisioning_grants',
      'source_chunks',
      'source_index_generations',
      'source_versions',
      'sources',
    ]);
    expect(
      tables.rows.every(
        (row) =>
          row.relrowsecurity &&
          row.relforcerowsecurity &&
          row.owner !== 'alunza_app',
      ),
    ).toBe(true);
  });

  it('returns no rows without an actor or with mismatched actor/organization context', async () => {
    for (const table of [
      'profiles',
      'organization_memberships',
      'organizations',
    ]) {
      const result = await application.query(`SELECT * FROM app.${table}`);
      expect(result.rowCount).toBe(0);
    }
    const wrongScope = await asApplication(studentA.id, orgB.id, (client) =>
      client.query('SELECT id FROM app.organizations'),
    );
    expect(wrongScope.rowCount).toBe(0);
    const ownScope = await asApplication(studentA.id, orgA.id, (client) =>
      client.query('SELECT id FROM app.organizations'),
    );
    expect(ownScope.rows).toEqual([{ id: orgA.id }]);
    const ownIdentity = await asApplication(studentA.id, '', (client) =>
      client.query('SELECT id FROM app.profiles'),
    );
    expect(ownIdentity.rows).toEqual([{ id: studentA.id }]);
    const ownMemberships = await asApplication(studentA.id, '', (client) =>
      client.query(
        'SELECT user_id, organization_id FROM app.organization_memberships',
      ),
    );
    expect(ownMemberships.rows).toEqual([
      { user_id: studentA.id, organization_id: orgA.id },
    ]);
  });

  it('clears transaction context after commit and rollback on the same pooled connection', async () => {
    const pidBefore = (
      await application.query('SELECT pg_backend_pid() AS pid')
    ).rows[0].pid;
    await asApplication(studentA.id, orgA.id, (client) =>
      client.query('SELECT id FROM app.organizations'),
    );
    const afterCommit = await application.query(
      "SELECT pg_backend_pid() AS pid, nullif(current_setting('app.actor_id',true),'') AS actor, nullif(current_setting('app.organization_id',true),'') AS organization",
    );
    expect(afterCommit.rows).toEqual([
      { pid: pidBefore, actor: null, organization: null },
    ]);
    await expect(
      asApplication(studentA.id, orgA.id, async (client) => {
        const rows = await client.query('SELECT id FROM app.organizations');
        expect(rows.rowCount).toBe(1);
        throw new Error('intentional rollback');
      }),
    ).rejects.toThrow('intentional rollback');
    const afterRollback = await application.query(
      "SELECT pg_backend_pid() AS pid, nullif(current_setting('app.actor_id',true),'') AS actor, nullif(current_setting('app.organization_id',true),'') AS organization",
    );
    expect(afterRollback.rows).toEqual([
      { pid: pidBefore, actor: null, organization: null },
    ]);
    const studentB = fixture.users.find(
      (user) => user.role === 'STUDENT' && user.organizationId === orgB.id,
    );
    const nextActor = await asApplication(studentB.id, orgB.id, (client) =>
      client.query('SELECT id FROM app.organizations'),
    );
    expect(nextActor.rows).toEqual([{ id: orgB.id }]);
  });

  it('denies student escalation and profile changes while preserving allowed administrative grants', async () => {
    for (const statement of [
      "UPDATE app.organization_memberships SET role='ADMIN' WHERE user_id=$1",
      "UPDATE app.profiles SET account_state='DISABLED' WHERE id=$1",
    ]) {
      try {
        const result = await asApplication(studentA.id, orgA.id, (client) =>
          client.query(statement, [studentA.id]),
        );
        expect(result.rowCount).toBe(0);
      } catch (error) {
        expect(error.code).toBe('42501');
      }
    }
    await expect(
      asApplication(studentA.id, orgA.id, (client) =>
        client.query(
          'DELETE FROM app.organization_memberships WHERE user_id=$1',
          [studentA.id],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    const unchanged = await admin.query(
      'SELECT role FROM app.organization_memberships WHERE organization_id=$1 AND user_id=$2',
      [orgA.id, studentA.id],
    );
    expect(unchanged.rows).toEqual([{ role: 'STUDENT' }]);
  });

  it.each(['anon', 'authenticated'])(
    'denies direct SQL schema access as %s',
    async (role) => {
      await expect(
        rolledBackAdmin(async (client) => {
          await client.query(`SET LOCAL ROLE ${role}`);
          await client.query('SELECT id FROM app.organizations');
        }),
      ).rejects.toMatchObject({ code: '42501' });
    },
  );

  it.each([
    [
      'duplicate membership',
      "INSERT INTO app.organization_memberships(organization_id,user_id,role,state) VALUES($1,$2,'STUDENT','ACTIVE')",
      [orgA.id, studentA.id],
      '23505',
    ],
    [
      'missing organization FK',
      "INSERT INTO app.organization_memberships(organization_id,user_id,role,state) VALUES($1,$2,'STUDENT','ACTIVE')",
      [missingId, studentA.id],
      '23503',
    ],
    [
      'missing profile FK',
      "INSERT INTO app.organization_memberships(organization_id,user_id,role,state) VALUES($1,$2,'STUDENT','ACTIVE')",
      [orgA.id, missingId],
      '23503',
    ],
    [
      'invalid role',
      "UPDATE app.organization_memberships SET role='SUPERADMIN' WHERE user_id=$1",
      [studentA.id],
      '23514',
    ],
    [
      'invalid account state',
      "UPDATE app.profiles SET account_state='PENDING' WHERE id=$1",
      [studentA.id],
      '23514',
    ],
    [
      'invalid membership state',
      "UPDATE app.organization_memberships SET state='PENDING' WHERE user_id=$1",
      [studentA.id],
      '23514',
    ],
    [
      'invalid revision',
      'UPDATE app.organization_memberships SET revision=0 WHERE user_id=$1',
      [studentA.id],
      '23514',
    ],
    [
      'profile name exceeds API contract',
      'UPDATE app.profiles SET display_name=$1 WHERE id=$2',
      ['A'.repeat(121), studentA.id],
      '23514',
    ],
    [
      'organization code exceeds API contract',
      'UPDATE app.organizations SET code=$1 WHERE id=$2',
      ['A'.repeat(41), orgA.id],
      '23514',
    ],
    [
      'timezone exceeds API contract',
      'UPDATE app.organizations SET timezone=$1 WHERE id=$2',
      ['A'.repeat(65), orgA.id],
      '23514',
    ],
    [
      'deleting a referenced organization',
      'DELETE FROM app.organizations WHERE id=$1',
      [orgA.id],
      '23503',
    ],
  ])('enforces %s in persistence', async (_label, statement, params, code) => {
    await expect(
      rolledBackAdmin((client) => client.query(statement, params)),
    ).rejects.toMatchObject({ code });
  });

  it('verifies PostgreSQL 17 and real pgvector operations without creating a RAG schema', async () => {
    await rolledBackAdmin(async (client) => {
      const version = await client.query(
        "SELECT current_setting('server_version') AS version",
      );
      expect(version.rows[0].version.split('.')[0]).toBe('17');
      await client.query(
        'CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions',
      );
      const vector = await client.query(
        "SELECT extensions.vector_dims('[1,2,3]'::extensions.vector) AS dimensions, '[1,2,3]'::extensions.vector OPERATOR(extensions.<->) '[1,2,3]'::extensions.vector AS distance",
      );
      expect(vector.rows).toEqual([{ dimensions: 3, distance: 0 }]);
      const extension = await client.query(
        "SELECT extversion FROM pg_extension WHERE extname='vector'",
      );
      console.log(
        `Motor real: PostgreSQL ${version.rows[0].version}; pgvector ${extension.rows[0].extversion} (ensayo transaccional con rollback).`,
      );
    });
  });

  it('reconciles interrupted archive and membership changes through the isolated fixture seed', async () => {
    const { context, seed } = await import('../../scripts/local.mjs');
    const testContext = context(
      path.resolve(path.dirname(process.env.ALUNZA_TEST_STATE), '..'),
      true,
    );
    expect(testContext.projectId).toBe('alunza-edu-laboratorio-test');
    expect(testContext.statePath).toBe(
      path.resolve(process.env.ALUNZA_TEST_STATE),
    );
    const originalOrganization = await admin.query(
      'SELECT archived_at FROM app.organizations WHERE id=$1',
      [orgA.id],
    );
    const originalMembership = await admin.query(
      'SELECT joined_at,disabled_at FROM app.organization_memberships WHERE organization_id=$1 AND user_id=$2',
      [orgA.id, studentA.id],
    );
    try {
      await admin.query(
        'UPDATE app.organizations SET archived_at=now() WHERE id=$1',
        [orgA.id],
      );
      await admin.query(
        "UPDATE app.organization_memberships SET disabled_at=now(),joined_at='2000-01-01T00:00:00Z' WHERE organization_id=$1 AND user_id=$2",
        [orgA.id, studentA.id],
      );
      await seed(testContext, { academic: false });
      // The seed synchronizes Auth passwords; authenticate again rather than
      // expecting a session revoked by a credential change to remain valid.
      for (const user of fixture.users) {
        const session = sessions.get(user.id);
        const login = await session.client.auth.signInWithPassword({
          email: user.email,
          password: state.fixturePassword,
        });
        if (login.error || !login.data.session)
          throw new Error('No se restableció la sesión del fixture.');
        session.token = login.data.session.access_token;
      }
      const organization = await admin.query(
        'SELECT archived_at FROM app.organizations WHERE id=$1',
        [orgA.id],
      );
      expect(organization.rows).toEqual([{ archived_at: null }]);
      const membership = await admin.query(
        'SELECT joined_at,disabled_at,state FROM app.organization_memberships WHERE organization_id=$1 AND user_id=$2',
        [orgA.id, studentA.id],
      );
      expect(membership.rows[0].joined_at.toISOString()).toBe(
        fixture.createdAt,
      );
      expect(membership.rows[0].disabled_at).toBeNull();
      expect(membership.rows[0].state).toBe('ACTIVE');
      const counts = await admin.query(`SELECT
        (SELECT count(*)::integer FROM app.organizations) AS organizations,
        (SELECT count(*)::integer FROM app.profiles) AS profiles,
        (SELECT count(*)::integer FROM app.organization_memberships) AS memberships`);
      expect(counts.rows).toEqual([
        { organizations: 2, profiles: 6, memberships: 6 },
      ]);
      expect(
        (await api('/api/v1/me', sessions.get(studentA.id).token)).status,
      ).toBe(200);
    } finally {
      await admin.query(
        'UPDATE app.organizations SET archived_at=$1 WHERE id=$2',
        [originalOrganization.rows[0].archived_at, orgA.id],
      );
      await admin.query(
        'UPDATE app.organization_memberships SET joined_at=$1,disabled_at=$2 WHERE organization_id=$3 AND user_id=$4',
        [
          originalMembership.rows[0].joined_at,
          originalMembership.rows[0].disabled_at,
          orgA.id,
          studentA.id,
        ],
      );
    }
  }, 60000);

  it('preserves the original six-account fixture after adversarial checks', async () => {
    const counts = await admin.query(`SELECT
      (SELECT count(*)::integer FROM app.organizations) AS organizations,
      (SELECT count(*)::integer FROM app.profiles) AS profiles,
      (SELECT count(*)::integer FROM app.organization_memberships) AS memberships`);
    expect(counts.rows).toEqual([
      { organizations: 2, profiles: 6, memberships: 6 },
    ]);
    const memberships = await admin.query(
      'SELECT user_id,organization_id,role,state FROM app.organization_memberships ORDER BY user_id',
    );
    expect(memberships.rows).toEqual(
      fixture.users.map((user) => ({
        user_id: user.id,
        organization_id: user.organizationId,
        role: user.role,
        state: 'ACTIVE',
      })),
    );
    const states = await admin.query(
      "SELECT count(*)::integer AS inactive FROM app.profiles WHERE account_state <> 'ACTIVE'",
    );
    expect(states.rows[0].inactive).toBe(0);
  });
});
