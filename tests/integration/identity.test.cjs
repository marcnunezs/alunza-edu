const { assertLaboratoryTestState } = require('../laboratory-test-state.cjs');
/* eslint @typescript-eslint/no-require-imports: "off" */
const { randomUUID } = require('node:crypto');
const { URLSearchParams } = require('node:url');
const { readFileSync } = require('node:fs');
const { setTimeout: delay } = require('node:timers/promises');
const pg = require('pg');
const { createClient } = require('@supabase/supabase-js');
const fixture = require('../../fixtures/foundation/identity.json');
const owner = fixture.users.find(
  (u) => u.role === 'ADMIN' && u.organizationId === fixture.organizations[0].id,
);
const secondAdmin = fixture.users.find(
  (u) => u.role === 'ADMIN' && u.id !== owner.id,
);
const student = fixture.users.find((u) => u.role === 'STUDENT');
let state, pool, base, ownerSession;
const client = () =>
  createClient(state.authUrl, state.publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
async function login(user = owner) {
  const auth = client();
  const { data, error } = await auth.auth.signInWithPassword({
    email: user.email,
    password: state.fixturePassword,
  });
  if (error || !data.session)
    throw new Error('No se obtuvo sesión real de fixture.');
  return { auth, token: data.session.access_token };
}
async function api(
  path,
  { token = ownerSession.token, method = 'GET', body, key, revision } = {},
) {
  const r = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(key ? { 'Idempotency-Key': key } : {}),
      ...(revision ? { 'If-Match': `"${revision}"` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(10000),
  });
  const payload = await r.json();
  const text = JSON.stringify(payload);
  for (const value of [
    state.authAdminKey,
    state.applicationPassword,
    state.fixturePassword,
    token,
  ])
    if (value) expect(text.includes(value)).toBe(false);
  expect(r.headers.get('cache-control')).toContain('no-store');
  return {
    status: r.status,
    data: payload.data,
    error: payload.error,
    page: payload.page,
    etag: r.headers.get('etag'),
  };
}
async function grant(userId = owner.id) {
  const id = randomUUID();
  await pool.query(
    "INSERT INTO app.provisioning_grants(id,user_id,granted_by,reason,expires_at) VALUES($1,$2,'automated-test','Fixture IMP-01',now()+interval '1 day')",
    [id, userId],
  );
  return id;
}
async function organization() {
  const grantId = await grant();
  const code = `T-${randomUUID().slice(0, 12).toUpperCase()}`;
  const r = await api('/organizations', {
    method: 'POST',
    key: randomUUID(),
    body: { grantId, code, name: 'Institución de prueba IMP-01' },
  });
  expect(r.status).toBe(201);
  return r.data;
}
async function addMember(orgId, user, role = user.role) {
  await pool.query(
    "INSERT INTO app.organization_memberships(organization_id,user_id,role,state,joined_at) VALUES($1,$2,$3,'ACTIVE',now())",
    [orgId, user.id, role],
  );
}
async function invitation(
  org,
  email = `identity-${randomUUID()}@example.test`,
  role = 'STUDENT',
) {
  const result = await api(`/organizations/${org.id}/invitations`, {
    method: 'POST',
    key: randomUUID(),
    body: { email, role },
  });
  expect(result.status).toBe(202);
  return result.data;
}
async function delivered(org, inv) {
  for (let i = 0; i < 70; i++) {
    const result = await api(`/organizations/${org.id}/invitations/${inv.id}`);
    expect(result.status).toBe(200);
    if (result.data.deliveryState === 'SENT') return result.data;
    if (result.data.deliveryState === 'FAILED')
      throw new Error('Falló la entrega real de invitación.');
    await delay(200);
  }
  throw new Error('La entrega real no terminó dentro del plazo.');
}
async function emailLink(email, generation) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const list = await (
      await fetch('http://127.0.0.1:18424/api/v1/messages')
    ).json();
    for (const message of list.messages ?? []) {
      if (!(message.To ?? []).some((to) => to.Address === email)) continue;
      const detail = await (
        await fetch(`http://127.0.0.1:18424/api/v1/message/${message.ID}`)
      ).json();
      for (const found of (detail.HTML ?? '').matchAll(/href="([^"]+)"/g)) {
        const raw = found[1].replaceAll('&amp;', '&');
        if (!raw.includes('/acceso/invitacion')) continue;
        const url = new URL(raw);
        const params = new URLSearchParams(url.hash.slice(1));
        if (Number(params.get('generation')) === generation) return params;
      }
    }
    await delay(200);
  }
  throw new Error('No se encontró correo local de la generación vigente.');
}
async function authenticateInvitation(inv) {
  const proof = await emailLink(inv.email, inv.generation);
  const auth = client();
  const verified = await auth.auth.verifyOtp({
    token_hash: proof.get('token_hash'),
    type: proof.get('type'),
  });
  if (verified.error || !verified.data.session)
    throw new Error('No se canjeó el enlace Auth capturado.');
  return {
    auth,
    token: verified.data.session.access_token,
    userId: verified.data.user.id,
    proof: { token: proof.get('invitationToken'), generation: inv.generation },
  };
}
beforeAll(async () => {
  state = JSON.parse(readFileSync(process.env.ALUNZA_TEST_STATE, 'utf8'));
  assertLaboratoryTestState(state);
  base = process.env.ALUNZA_TEST_API_URL;
  if (
    state.projectId !== 'alunza-edu-laboratorio-test' ||
    state.authUrl !== 'http://127.0.0.1:18421' ||
    base !== 'http://127.0.0.1:4300'
  )
    throw new Error('Solo fixture local aislado.');
  pool = new pg.Pool({ connectionString: state.migrationUrl, max: 4 });
  ownerSession = await login();
});
afterAll(async () => {
  await pool?.end();
});

describe('IMP-01 identidad e instituciones reales', () => {
  test('HU-001 E1/E4 · logout invalida token conservado y no elimina otras sesiones', async () => {
    const first = await login(student),
      second = await login(student);
    expect((await api('/me', { token: first.token })).status).toBe(200);
    await first.auth.auth.signOut({ scope: 'local' });
    expect((await api('/me', { token: first.token })).status).toBe(401);
    expect((await api('/me', { token: second.token })).status).toBe(200);
  });
  test('HU-020 E1/E2 · crea una sola organización y conserva idempotencia y permiso consumido', async () => {
    const grantId = await grant(),
      key = randomUUID();
    const body = {
      grantId,
      code: `T-${randomUUID().slice(0, 12)}`,
      name: 'Institución idempotente',
    };
    const first = await api('/organizations', { method: 'POST', body, key });
    expect(first.status).toBe(201);
    const again = await api('/organizations', { method: 'POST', body, key });
    expect(again.status).toBe(201);
    expect(again.data.id).toBe(first.data.id);
    expect(
      (
        await api('/organizations', {
          method: 'POST',
          body: { ...body, name: 'Otro' },
          key,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await api('/organizations', {
          method: 'POST',
          body: { ...body, code: body.code + 'X' },
          key: randomUUID(),
        })
      ).status,
    ).toBe(409);
    const counts = await pool.query(
      'SELECT consumed_organization_id FROM app.provisioning_grants WHERE id=$1',
      [grantId],
    );
    expect(counts.rows[0].consumed_organization_id).toBe(first.data.id);
  });
  test('HU-020 E1 · un permiso concurrente solo crea una institución', async () => {
    const grantId = await grant();
    const results = await Promise.all(
      ['A', 'B'].map((suffix) =>
        api('/organizations', {
          method: 'POST',
          key: randomUUID(),
          body: {
            grantId,
            code: `C-${randomUUID().slice(0, 10)}-${suffix}`,
            name: 'Creación concurrente',
          },
        }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  });
  test('HU-020 E2/E3 · campos, código duplicado, versión y ámbito conservan el recurso', async () => {
    const org = await organization();
    expect(
      (
        await api(`/organizations/${org.id}`, {
          method: 'PATCH',
          revision: org.revision,
          body: { name: '' },
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await api(`/organizations/${org.id}`, {
          method: 'PATCH',
          revision: org.revision,
          body: { code: fixture.organizations[0].code },
        })
      ).status,
    ).toBe(409);
    const changed = await api(`/organizations/${org.id}`, {
      method: 'PATCH',
      revision: org.revision,
      body: { name: 'Actualizada' },
    });
    expect(changed.status).toBe(200);
    expect(changed.data.revision).toBe(org.revision + 1);
    expect(
      (
        await api(`/organizations/${org.id}`, {
          method: 'PATCH',
          revision: org.revision,
          body: { name: 'Obsoleta' },
        })
      ).status,
    ).toBe(412);
    const other = await login(secondAdmin);
    expect(
      (await api(`/organizations/${org.id}`, { token: other.token })).status,
    ).toBe(404);
    expect(
      (
        await api(`/organizations/${org.id}`, {
          token: other.token,
          method: 'PATCH',
          revision: changed.data.revision,
          body: { name: 'Ajena' },
        })
      ).status,
    ).toBe(404);
    expect((await api(`/organizations/${org.id}`)).data.name).toBe(
      'Actualizada',
    );
  });
  test('HU-021 E4 · último administrador protegido en cambios simples y concurrentes', async () => {
    const org = await organization();
    const route = `/organizations/${org.id}/members/${owner.id}`;
    for (const body of [{ role: 'TEACHER' }, { state: 'DISABLED' }])
      expect(
        (await api(route, { method: 'PATCH', revision: 1, body })).error.code,
      ).toBe('LAST_ADMIN');
    await addMember(org.id, secondAdmin);
    const other = await login(secondAdmin);
    const results = await Promise.all([
      api(route, { method: 'PATCH', revision: 1, body: { state: 'DISABLED' } }),
      api(`/organizations/${org.id}/members/${secondAdmin.id}`, {
        token: other.token,
        method: 'PATCH',
        revision: 1,
        body: { state: 'DISABLED' },
      }),
    ]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    const active = await pool.query(
      "SELECT count(*)::int AS count FROM app.organization_memberships WHERE organization_id=$1 AND role='ADMIN' AND state='ACTIVE'",
      [org.id],
    );
    expect(active.rows[0].count).toBe(1);
  });
  test('HU-021 E1/E3 · deshabilitar una membresía conserva la otra institución y contraseña', async () => {
    const org = await organization();
    await addMember(org.id, student);
    const session = await login(student);
    const disabled = await api(
      `/organizations/${org.id}/members/${student.id}`,
      { method: 'PATCH', revision: 1, body: { state: 'DISABLED' } },
    );
    expect(disabled.status).toBe(200);
    expect(
      (await api(`/organizations/${org.id}`, { token: session.token })).status,
    ).toBe(404);
    expect(
      (
        await api(`/organizations/${student.organizationId}`, {
          token: session.token,
        })
      ).status,
    ).toBe(200);
    const fresh = await login(student);
    expect((await api('/me', { token: fresh.token })).status).toBe(200);
  });
  test('HU-020 E4 · archivo bloquea dependencias y conserva acceso ADMIN solo lectura', async () => {
    const org = await organization();
    await addMember(org.id, student);
    const route = `/organizations/${org.id}/archive`;
    expect(
      (
        await api(route, {
          method: 'POST',
          revision: 1,
          key: randomUUID(),
          body: { reason: 'Fin de prueba' },
        })
      ).error.code,
    ).toBe('DEPENDENCIES_ACTIVE');
    await api(`/organizations/${org.id}/members/${student.id}`, {
      method: 'PATCH',
      revision: 1,
      body: { state: 'DISABLED' },
    });
    const archived = await api(route, {
      method: 'POST',
      revision: 1,
      key: randomUUID(),
      body: { reason: 'Fin de prueba' },
    });
    expect(archived.status).toBe(200);
    expect(archived.data.state).toBe('ARCHIVED');
    expect((await api(`/organizations/${org.id}`)).status).toBe(200);
    expect(
      (await api('/me')).data.memberships.find(
        (m) => m.organizationId === org.id,
      ).accessMode,
    ).toBe('READ_ONLY');
    expect(
      (
        await api(`/organizations/${org.id}`, {
          method: 'PATCH',
          revision: archived.data.revision,
          body: { name: 'Prohibido' },
        })
      ).status,
    ).toBe(409);
    expect(
      (await api(`/organizations/${org.id}`, { method: 'DELETE' })).status,
    ).toBe(404);
  });
  test('HU-021 E1/E2 · correo nuevo real, aceptación idempotente y ausencia de reactivación', async () => {
    const org = await organization();
    const inv = await delivered(org, await invitation(org));
    const session = await authenticateInvitation(inv);
    expect((await api('/me', { token: session.token })).status).toBe(403);
    const key = randomUUID(),
      path = `/invitations/${inv.id}/accept`;
    const accepted = await api(path, {
      token: session.token,
      method: 'POST',
      key,
      body: { ...session.proof, displayName: 'Nueva estudiante' },
    });
    expect(accepted.status).toBe(200);
    expect(accepted.data.state).toBe('ACTIVE');
    expect(
      (
        await api(path, {
          token: session.token,
          method: 'POST',
          key,
          body: { ...session.proof, displayName: 'Nueva estudiante' },
        })
      ).status,
    ).toBe(200);
    const members = await api(`/organizations/${org.id}/members`);
    const member = members.data.find((m) => m.userId === session.userId);
    expect(member).toBeDefined();
    expect(
      (
        await api(`/organizations/${org.id}/members/${session.userId}`, {
          method: 'PATCH',
          revision: member.revision,
          body: { state: 'DISABLED' },
        })
      ).status,
    ).toBe(200);
    const replay = await api(path, {
      token: session.token,
      method: 'POST',
      key: randomUUID(),
      body: session.proof,
    });
    expect([200, 403, 409]).toContain(replay.status);
    const rows = await pool.query(
      'SELECT state FROM app.organization_memberships WHERE organization_id=$1 AND user_id=$2',
      [org.id, session.userId],
    );
    expect(rows.rows).toEqual([{ state: 'DISABLED' }]);
    const audit = await pool.query(
      "SELECT count(*)::int count FROM app.audit_events WHERE organization_id=$1 AND entity_id=$2 AND action ILIKE '%accept%'",
      [org.id, inv.id],
    );
    expect(audit.rows[0].count).toBe(1);
  }, 40000);
  test('HU-021 E2/E3 · cuenta existente se incorpora sin perder su identidad anterior', async () => {
    const org = await organization();
    const inv = await delivered(org, await invitation(org, student.email));
    const received = await authenticateInvitation(inv);
    expect(received.userId).toBe(student.id);
    const result = await api(`/invitations/${inv.id}/accept`, {
      token: received.token,
      method: 'POST',
      key: randomUUID(),
      body: received.proof,
    });
    expect(result.status).toBe(200);
    const prior = await api(`/organizations/${student.organizationId}`, {
      token: received.token,
    });
    expect(prior.status).toBe(200);
    const passwordLogin = await login(student);
    expect(
      (await api(`/organizations/${org.id}`, { token: passwordLogin.token }))
        .status,
    ).toBe(200);
  }, 40000);
  test('HU-021 E2 · destinatario ajeno y revocación no conceden acceso', async () => {
    const org = await organization();
    const inv = await delivered(org, await invitation(org));
    const proof = await emailLink(inv.email, inv.generation);
    const body = {
      token: proof.get('invitationToken'),
      generation: inv.generation,
    };
    const wrong = await api(`/invitations/${inv.id}/accept`, {
      method: 'POST',
      key: randomUUID(),
      body,
    });
    expect(wrong.status).toBeGreaterThanOrEqual(400);
    const revoked = await api(
      `/organizations/${org.id}/invitations/${inv.id}/revoke`,
      { method: 'POST', key: randomUUID(), revision: inv.revision },
    );
    expect(revoked.status).toBe(200);
    const received = await authenticateInvitation(inv);
    expect(
      (
        await api(`/invitations/${inv.id}/accept`, {
          token: received.token,
          method: 'POST',
          key: randomUUID(),
          body,
        })
      ).status,
    ).toBeGreaterThanOrEqual(400);
    const rows = await pool.query(
      'SELECT state FROM app.organization_memberships WHERE organization_id=$1 AND user_id=$2',
      [org.id, received.userId],
    );
    expect(rows.rows.some((r) => r.state === 'ACTIVE')).toBe(false);
  }, 40000);
  test('HU-021 E2 · reenvío invalida generación anterior y vencimiento impide aceptar', async () => {
    const org = await organization();
    const first = await delivered(org, await invitation(org));
    const originalProof = await emailLink(first.email, first.generation);
    const requeued = await api(
      `/organizations/${org.id}/invitations/${first.id}/resend`,
      { method: 'POST', key: randomUUID(), revision: first.revision },
    );
    expect(requeued.status).toBe(202);
    const latest = await delivered(org, requeued.data);
    expect(latest.generation).toBeGreaterThan(first.generation);
    const received = await authenticateInvitation(latest);
    const old = await api(`/invitations/${first.id}/accept`, {
      token: received.token,
      method: 'POST',
      key: randomUUID(),
      body: {
        token: originalProof.get('invitationToken'),
        generation: first.generation,
      },
    });
    expect(old.status).toBeGreaterThanOrEqual(400);
    await pool.query(
      "UPDATE app.organization_invitations SET expires_at=now()-interval '1 second' WHERE id=$1",
      [first.id],
    );
    const expired = await api(`/invitations/${first.id}/accept`, {
      token: received.token,
      method: 'POST',
      key: randomUUID(),
      body: received.proof,
    });
    expect(expired.status).toBeGreaterThanOrEqual(400);
    const active = await pool.query(
      "SELECT count(*)::int count FROM app.organization_memberships WHERE organization_id=$1 AND user_id=$2 AND state='ACTIVE'",
      [org.id, received.userId],
    );
    expect(active.rows[0].count).toBe(0);
  }, 40000);
  test('HU-021 E2 · renovación Auth no extiende las 72 horas ni permite destinatario libre', async () => {
    const org = await organization();
    const first = await delivered(org, await invitation(org));
    const proof = await emailLink(first.email, first.generation);
    const renewed = await api(`/invitations/${first.id}/renew-auth`, {
      token: null,
      method: 'POST',
      key: randomUUID(),
      body: {
        token: proof.get('invitationToken'),
        generation: first.generation,
      },
    });
    expect(renewed.status).toBe(202);
    const latest = await delivered(org, renewed.data);
    expect(latest.expiresAt).toBe(first.expiresAt);
    expect(latest.generation).toBeGreaterThan(first.generation);
    const received = await authenticateInvitation(latest);
    expect(
      (
        await api(`/invitations/${first.id}/accept`, {
          token: received.token,
          method: 'POST',
          key: randomUUID(),
          body: received.proof,
        })
      ).status,
    ).toBe(200);
  }, 40000);
  test('HU-020 E1 · permiso explícito permite bootstrap sin una membresía ADMIN anterior', async () => {
    const auth = createClient(state.authUrl, state.authAdminKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const id = randomUUID(),
      email = `bootstrap-${id}@example.test`;
    const created = await auth.auth.admin.createUser({
      id,
      email,
      password: state.fixturePassword,
      email_confirm: true,
    });
    if (created.error)
      throw new Error('No se preparó identidad de aprovisionamiento.');
    await pool.query(
      "INSERT INTO app.profiles(id,email_normalized,display_name,account_state) VALUES($1,$2,'Aprovisionamiento','ACTIVE')",
      [id, email],
    );
    const session = await login({ id, email });
    const me = await api('/me', { token: session.token });
    expect(me.status).toBe(200);
    expect(me.data.memberships).toEqual([]);
    const denied = await api('/organizations', {
      token: session.token,
      method: 'POST',
      key: randomUUID(),
      body: {
        grantId: randomUUID(),
        code: `B-${id.slice(0, 10)}`,
        name: 'Sin permiso',
      },
    });
    expect(denied.status).toBeGreaterThanOrEqual(400);
    const grantId = await grant(id);
    const allowed = await api('/organizations', {
      token: session.token,
      method: 'POST',
      key: randomUUID(),
      body: { grantId, code: `B-${id.slice(0, 10)}`, name: 'Con permiso' },
    });
    expect(allowed.status).toBe(201);
    const context = await api('/me', { token: session.token });
    expect(context.data.memberships).toHaveLength(1);
    expect(context.data.memberships[0].role).toBe('ADMIN');
  });
  test('HU-021 E2 · invitación concurrente y archivo no dejan membresías en organización archivada', async () => {
    const org = await organization();
    const results = await Promise.all([
      api(`/organizations/${org.id}/invitations`, {
        method: 'POST',
        key: randomUUID(),
        body: { email: `race-${randomUUID()}@example.test`, role: 'STUDENT' },
      }),
      api(`/organizations/${org.id}/archive`, {
        method: 'POST',
        key: randomUUID(),
        revision: 1,
        body: { reason: 'Carrera controlada' },
      }),
    ]);
    expect(results.filter((r) => r.status < 300)).toHaveLength(1);
    const check = await pool.query(
      `SELECT EXISTS(SELECT 1 FROM app.organization_invitations i JOIN app.organizations o ON o.id=i.organization_id WHERE o.id=$1 AND o.archived_at IS NOT NULL AND i.revoked_at IS NULL AND i.accepted_at IS NULL AND i.expires_at>now()) AS violation`,
      [org.id],
    );
    expect(check.rows[0].violation).toBe(false);
  });
  test('auditoría y mutación se revierten juntas; eventos no son modificables', async () => {
    const org = await organization();
    await pool.query(
      'INSERT INTO identity_test_faults.flags(org_id) VALUES($1)',
      [org.id],
    );
    try {
      const result = await api(`/organizations/${org.id}`, {
        method: 'PATCH',
        revision: 1,
        body: { name: 'No debe persistir' },
      });
      expect(result.status).toBe(503);
      expect((await api(`/organizations/${org.id}`)).data.name).toBe(org.name);
    } finally {
      await pool.query(
        'DELETE FROM identity_test_faults.flags WHERE org_id=$1',
        [org.id],
      );
    }
    await expect(
      pool.query('DELETE FROM app.audit_events WHERE organization_id=$1', [
        org.id,
      ]),
    ).rejects.toMatchObject({ code: '42501' });
  });
});
