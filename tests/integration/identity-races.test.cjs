/* eslint @typescript-eslint/no-require-imports: "off" */
const { randomUUID } = require('node:crypto');
const { URLSearchParams } = require('node:url');
const { readFileSync } = require('node:fs');
const { setTimeout: delay } = require('node:timers/promises');
const pg = require('pg');
const { createClient } = require('@supabase/supabase-js');
const fixture = require('../../fixtures/foundation/identity.json');
const owner = fixture.users.find(
  (user) =>
    user.role === 'ADMIN' &&
    user.organizationId === fixture.organizations[0].id,
);
const administratorB = fixture.users.find(
  (user) => user.role === 'ADMIN' && user.id !== owner.id,
);
let state, base, pool, runtimePool, ownerSession, secondSession;
const authClient = () =>
  createClient(state.authUrl, state.publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

async function login(user) {
  const auth = authClient();
  const result = await auth.auth.signInWithPassword({
    email: user.email,
    password: state.fixturePassword,
  });
  if (result.error || !result.data.session)
    throw new Error(
      'No se obtuvo la sesión ficticia para probar concurrencia.',
    );
  return { auth, token: result.data.session.access_token };
}
async function request(
  path,
  { token = ownerSession.token, method = 'GET', body, key, revision } = {},
) {
  const response = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(key ? { 'Idempotency-Key': key } : {}),
      ...(revision ? { 'If-Match': `"${revision}"` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(10000),
  });
  const payload = await response.json();
  expect(response.headers.get('cache-control')).toContain('no-store');
  for (const secret of [
    token,
    state.authAdminKey,
    state.applicationPassword,
    state.fixturePassword,
  ])
    expect(JSON.stringify(payload)).not.toContain(secret);
  return { status: response.status, ...payload };
}
async function organization() {
  const grantId = randomUUID(),
    key = randomUUID();
  await pool.query(
    "INSERT INTO app.provisioning_grants(id,user_id,granted_by,reason,expires_at) VALUES($1,$2,'identity-races-test','Fixture adversarial de concurrencia',now()+interval '1 hour')",
    [grantId, owner.id],
  );
  const body = {
    grantId,
    code: `RACE-${randomUUID().slice(0, 12).toUpperCase()}`,
    name: 'Institución ficticia de concurrencia',
  };
  const result = await request('/organizations', { method: 'POST', key, body });
  expect(result.status).toBe(201);
  return { ...result.data, requestBody: body, createKey: key };
}
async function addAdministrator(orgId) {
  await pool.query(
    "INSERT INTO app.organization_memberships(organization_id,user_id,role,state,joined_at) VALUES($1,$2,'ADMIN','ACTIVE',now())",
    [orgId, administratorB.id],
  );
}
async function delivered(orgId, id, token = ownerSession.token) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await request(`/organizations/${orgId}/invitations/${id}`, {
      token,
    });
    expect(result.status).toBe(200);
    if (result.data.deliveryState === 'SENT') return result.data;
    if (['FAILED', 'CANCELLED'].includes(result.data.deliveryState))
      throw new Error('La invitación ficticia no alcanzó entrega real.');
    await delay(150);
  }
  throw new Error(
    'Venció la espera de correo real para la prueba concurrente.',
  );
}
async function invitation(org) {
  const result = await request(`/organizations/${org.id}/invitations`, {
    method: 'POST',
    key: randomUUID(),
    body: { email: `race-${randomUUID()}@example.test`, role: 'STUDENT' },
  });
  expect(result.status).toBe(202);
  return delivered(org.id, result.data.id);
}
async function mailProof(inv) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const list = await (
      await fetch('http://127.0.0.1:16424/api/v1/messages', {
        signal: AbortSignal.timeout(5000),
      })
    ).json();
    for (const message of list.messages ?? []) {
      if (
        !(message.To ?? []).some((recipient) => recipient.Address === inv.email)
      )
        continue;
      const detail = await (
        await fetch(
          `http://127.0.0.1:16424/api/v1/message/${encodeURIComponent(message.ID)}`,
          { signal: AbortSignal.timeout(5000) },
        )
      ).json();
      for (const match of (detail.HTML ?? '').matchAll(/href="([^"]+)"/g)) {
        const url = new URL(match[1].replaceAll('&amp;', '&'));
        if (url.pathname !== '/acceso/invitacion') continue;
        const proof = new URLSearchParams(url.hash.slice(1));
        if (Number(proof.get('generation')) === inv.generation) return proof;
      }
    }
    await delay(150);
  }
  throw new Error('No se capturó el correo de la generación esperada.');
}
async function recipient(inv) {
  const proof = await mailProof(inv);
  const auth = authClient();
  const verified = await auth.auth.verifyOtp({
    token_hash: proof.get('token_hash'),
    type: proof.get('type'),
  });
  if (verified.error || !verified.data.session)
    throw new Error('No se verificó al destinatario ficticio.');
  return {
    token: verified.data.session.access_token,
    userId: verified.data.user.id,
    proof: { token: proof.get('invitationToken'), generation: inv.generation },
  };
}
async function acceptanceCounts(orgId, invitationId, userId) {
  return (
    await pool.query(
      "SELECT (SELECT count(*)::int FROM app.organization_memberships WHERE organization_id=$1 AND user_id=$3 AND state='ACTIVE') AS memberships,(SELECT count(*)::int FROM app.audit_events WHERE organization_id=$1 AND entity_id=$2 AND action='invitation.accepted') AS acceptances",
      [orgId, invitationId, userId],
    )
  ).rows[0];
}

beforeAll(async () => {
  state = JSON.parse(readFileSync(process.env.ALUNZA_TEST_STATE, 'utf8'));
  base = process.env.ALUNZA_TEST_API_URL;
  const migration = new URL(state.migrationUrl);
  if (
    state.projectId !== 'alunza-edu-foundation-test' ||
    state.authUrl !== 'http://127.0.0.1:16421' ||
    base !== 'http://127.0.0.1:4100' ||
    migration.hostname !== '127.0.0.1' ||
    migration.port !== '16422'
  )
    throw new Error(
      'Estas pruebas solo admiten la infraestructura local aislada.',
    );
  pool = new pg.Pool({ connectionString: state.migrationUrl, max: 4 });
  const runtime = new URL(state.migrationUrl);
  runtime.username = 'alunza_app';
  runtime.password = state.applicationPassword;
  runtimePool = new pg.Pool({ connectionString: runtime.toString(), max: 1 });
  ownerSession = await login(owner);
  secondSession = await login(administratorB);
});
afterAll(async () => {
  await Promise.all([pool?.end(), runtimePool?.end()]);
});

describe('IMP-01 carreras y revocación de autoridad reales', () => {
  test('aceptación frente a archivo conserva una organización activa y una única membresía', async () => {
    const org = await organization(),
      inv = await invitation(org),
      receiver = await recipient(inv);
    const [accepted, archived] = await Promise.all([
      request(`/invitations/${inv.id}/accept`, {
        token: receiver.token,
        method: 'POST',
        key: randomUUID(),
        body: receiver.proof,
      }),
      request(`/organizations/${org.id}/archive`, {
        method: 'POST',
        key: randomUUID(),
        revision: org.revision,
        body: { reason: 'Carrera con aceptación' },
      }),
    ]);
    expect(accepted.status).toBe(200);
    expect(archived.status).toBe(409);
    expect(archived.error.code).toBe('DEPENDENCIES_ACTIVE');
    const current = await pool.query(
      'SELECT archived_at FROM app.organizations WHERE id=$1',
      [org.id],
    );
    expect(current.rows).toEqual([{ archived_at: null }]);
    expect(await acceptanceCounts(org.id, inv.id, receiver.userId)).toEqual({
      memberships: 1,
      acceptances: 1,
    });
  }, 40000);

  test('reenvío frente a aceptación tiene un solo ganador y nunca admite la generación obsoleta', async () => {
    const org = await organization(),
      inv = await invitation(org),
      receiver = await recipient(inv);
    const [resent, accepted] = await Promise.all([
      request(`/organizations/${org.id}/invitations/${inv.id}/resend`, {
        method: 'POST',
        key: randomUUID(),
        revision: inv.revision,
      }),
      request(`/invitations/${inv.id}/accept`, {
        token: receiver.token,
        method: 'POST',
        key: randomUUID(),
        body: receiver.proof,
      }),
    ]);
    if (accepted.status === 200) {
      expect([409, 412]).toContain(resent.status);
      const current = (
        await request(`/organizations/${org.id}/invitations/${inv.id}`)
      ).data;
      expect(current.generation).toBe(inv.generation);
      expect(current.state).toBe('ACCEPTED');
    } else {
      expect(resent.status).toBe(202);
      expect([404, 409]).toContain(accepted.status);
      expect(await acceptanceCounts(org.id, inv.id, receiver.userId)).toEqual({
        memberships: 0,
        acceptances: 0,
      });
      const latest = await delivered(org.id, inv.id);
      expect(latest.generation).toBeGreaterThan(inv.generation);
      const obsolete = await request(`/invitations/${inv.id}/accept`, {
        token: receiver.token,
        method: 'POST',
        key: randomUUID(),
        body: receiver.proof,
      });
      expect(obsolete.status).toBe(409);
      const proof = await mailProof(latest);
      const current = await request(`/invitations/${inv.id}/accept`, {
        token: receiver.token,
        method: 'POST',
        key: randomUUID(),
        body: {
          token: proof.get('invitationToken'),
          generation: latest.generation,
        },
      });
      expect(current.status).toBe(200);
    }
    expect(await acceptanceCounts(org.id, inv.id, receiver.userId)).toEqual({
      memberships: 1,
      acceptances: 1,
    });
  }, 40000);

  test('ADMIN B reautoriza por reenvío después de deshabilitar a ADMIN A', async () => {
    const org = await organization();
    await addAdministrator(org.id);
    const inv = await invitation(org),
      receiver = await recipient(inv);
    const disabled = await request(
      `/organizations/${org.id}/members/${owner.id}`,
      {
        token: secondSession.token,
        method: 'PATCH',
        revision: 1,
        body: { state: 'DISABLED' },
      },
    );
    expect(disabled.status).toBe(200);
    const denied = await request(`/invitations/${inv.id}/accept`, {
      token: receiver.token,
      method: 'POST',
      key: randomUUID(),
      body: receiver.proof,
    });
    expect([403, 404, 409]).toContain(denied.status);
    expect(await acceptanceCounts(org.id, inv.id, receiver.userId)).toEqual({
      memberships: 0,
      acceptances: 0,
    });
    const resent = await request(
      `/organizations/${org.id}/invitations/${inv.id}/resend`,
      {
        token: secondSession.token,
        method: 'POST',
        key: randomUUID(),
        revision: inv.revision,
      },
    );
    expect(resent.status).toBe(202);
    const latest = await delivered(org.id, inv.id, secondSession.token),
      proof = await mailProof(latest);
    const accepted = await request(`/invitations/${inv.id}/accept`, {
      token: receiver.token,
      method: 'POST',
      key: randomUUID(),
      body: {
        token: proof.get('invitationToken'),
        generation: latest.generation,
      },
    });
    expect(accepted.status).toBe(200);
    const author = (
      await pool.query(
        'SELECT i.invited_by,i.accepted_by,(SELECT requested_by FROM app.invitation_deliveries WHERE invitation_id=i.id ORDER BY created_at DESC,id DESC LIMIT 1) AS authorized_by FROM app.organization_invitations i WHERE i.id=$1',
        [inv.id],
      )
    ).rows[0];
    expect(author).toEqual({
      invited_by: owner.id,
      accepted_by: receiver.userId,
      authorized_by: administratorB.id,
    });
    expect(await acceptanceCounts(org.id, inv.id, receiver.userId)).toEqual({
      memberships: 1,
      acceptances: 1,
    });
  }, 40000);

  test('repetir creación con un permiso consumido no filtra una organización tras perder membresía', async () => {
    const org = await organization();
    await addAdministrator(org.id);
    const disabled = await request(
      `/organizations/${org.id}/members/${owner.id}`,
      {
        token: secondSession.token,
        method: 'PATCH',
        revision: 1,
        body: { state: 'DISABLED' },
      },
    );
    expect(disabled.status).toBe(200);
    const replay = await request('/organizations', {
      method: 'POST',
      key: org.createKey,
      body: org.requestBody,
    });
    expect(replay.status).toBe(404);
    expect(replay.error.code).toBe('RESOURCE_NOT_FOUND');
    expect(replay.data).toBeUndefined();
    for (const privateValue of [org.id, org.name, org.code])
      expect(JSON.stringify(replay)).not.toContain(privateValue);
    const persisted = await pool.query(
      'SELECT count(*)::int count FROM app.organizations WHERE id=$1',
      [org.id],
    );
    expect(persisted.rows[0].count).toBe(1);
  }, 40000);

  test('una clave vencida rechaza replay sin duplicar y la purga conserva su vínculo permanente', async () => {
    const org = await organization();
    const previous = (
      await pool.query(
        "UPDATE app.operation_keys SET expires_at=now()-interval '1 second' WHERE actor_id=$1 AND operation='organization.create' AND key=$2 RETURNING id,payload_hash,resource_id,response_body",
        [owner.id, org.createKey],
      )
    ).rows[0];
    expect(previous.resource_id).toBe(org.id);
    expect(previous.response_body).not.toBeNull();
    const expired = await request('/organizations', {
      method: 'POST',
      key: org.createKey,
      body: org.requestBody,
    });
    expect(expired.status).toBe(409);
    expect(expired.error.code).toBe('IDEMPOTENCY_CONFLICT');
    await runtimePool.query(
      'SELECT app_private.purge_expired_operation_responses()',
    );
    const retained = (
      await pool.query(
        'SELECT payload_hash,resource_id,response_body,state FROM app.operation_keys WHERE id=$1',
        [previous.id],
      )
    ).rows[0];
    expect(retained).toEqual({
      payload_hash: previous.payload_hash,
      resource_id: org.id,
      response_body: null,
      state: 'COMPLETED',
    });
    expect(
      (
        await request('/organizations', {
          method: 'POST',
          key: org.createKey,
          body: org.requestBody,
        })
      ).status,
    ).toBe(409);
    const persisted = await pool.query(
      'SELECT count(*)::int count FROM app.organizations WHERE id=$1',
      [org.id],
    );
    expect(persisted.rows[0].count).toBe(1);
    expect((await request(`/organizations/${org.id}`)).status).toBe(200);
  }, 40000);
});
