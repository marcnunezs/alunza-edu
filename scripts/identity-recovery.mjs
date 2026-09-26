import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { URLSearchParams } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import { testTarget, assertRuntimeTarget } from './local-target.mjs';

const authOptions = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
};
const uuidPattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

async function until(action, message, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await action();
    if (value) return value;
    await delay(200);
  }
  throw new Error(message);
}

async function capturedLinks(email) {
  const response = await fetch(`${testTarget.mailUrl}/api/v1/messages`, {
    signal: AbortSignal.timeout(5000),
  });
  requireCondition(
    response.ok,
    'El correo local de recuperación no está disponible.',
  );
  const list = await response.json();
  const links = [];
  for (const message of list.messages ?? []) {
    if (!(message.To ?? []).some((recipient) => recipient.Address === email))
      continue;
    const detailResponse = await fetch(
      `${testTarget.mailUrl}/api/v1/message/${encodeURIComponent(message.ID)}`,
      { signal: AbortSignal.timeout(5000) },
    );
    requireCondition(
      detailResponse.ok,
      'No se pudo leer el correo ficticio de recuperación.',
    );
    const detail = await detailResponse.json();
    for (const match of (detail.HTML ?? '').matchAll(/href="([^"]+)"/g)) {
      const url = new URL(match[1].replaceAll('&amp;', '&'));
      if (url.pathname !== '/acceso/invitacion') continue;
      const proof = new URLSearchParams(url.hash.slice(1));
      if (proof.has('invitationToken') && proof.has('token_hash'))
        links.push(proof);
    }
  }
  return links;
}

/** Runs only inside the already-owned, real, isolated Supabase integration stack. */
export async function verifyIdentityRecovery({ ctx, state, api }) {
  assertRuntimeTarget(state, testTarget);
  requireCondition(
    ctx.projectId === testTarget.projectId &&
      state.projectId === ctx.projectId &&
      ctx.apiPort === testTarget.apiPort &&
      state.authUrl === testTarget.authUrl,
    'La recuperación solo admite el entorno local exclusivo de pruebas.',
  );
  const database = new URL(state.migrationUrl);
  requireCondition(
    database.hostname === '127.0.0.1' &&
      database.port === String(testTarget.dbPort),
    'La recuperación no puede modificar otra base de datos.',
  );
  const base = testTarget.apiUrl;
  const fixture = JSON.parse(
    await readFile(
      new URL('../fixtures/foundation/identity.json', import.meta.url),
      'utf8',
    ),
  );
  const owner = fixture.users.find(
    (user) =>
      user.role === 'ADMIN' &&
      user.organizationId === fixture.organizations[0].id,
  );
  requireCondition(
    owner,
    'No existe el administrador ficticio de recuperación.',
  );
  const auth = createClient(state.authUrl, state.publishableKey, authOptions);
  const session = await auth.auth.signInWithPassword({
    email: owner.email,
    password: state.fixturePassword,
  });
  requireCondition(
    !session.error && session.data.session,
    'No se obtuvo la sesión ficticia de recuperación.',
  );
  const ownerToken = session.data.session.access_token;
  const pool = new pg.Pool({ connectionString: state.migrationUrl, max: 2 });
  const suffix = randomUUID().replaceAll('-', '');
  let faultOrganizationId;
  let stopped = false;
  const request = async (
    path,
    { token = ownerToken, method = 'GET', body, key } = {},
  ) => {
    const response = await fetch(`${base}/api/v1${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(key ? { 'Idempotency-Key': key } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(8000),
    });
    const payload = await response.json();
    return {
      status: response.status,
      data: payload.data,
      error: payload.error,
    };
  };
  const removeFailure = async () => {
    if (faultOrganizationId) {
      await pool.query(
        'DELETE FROM identity_test_faults.flags WHERE org_id=$1',
        [faultOrganizationId],
      );
      faultOrganizationId = undefined;
    }
  };
  try {
    const grantId = randomUUID();
    await pool.query(
      "INSERT INTO app.provisioning_grants(id,user_id,granted_by,reason,expires_at) VALUES($1,$2,'identity-recovery-test','Fixture de recuperación durable',now()+interval '1 hour')",
      [grantId, owner.id],
    );
    const created = await request('/organizations', {
      method: 'POST',
      key: randomUUID(),
      body: {
        grantId,
        code: `REC-${suffix.slice(0, 12).toUpperCase()}`,
        name: 'Institución ficticia de recuperación',
      },
    });
    requireCondition(
      created.status === 201 && uuidPattern.test(created.data?.id),
      'No se confirmó la institución ficticia de recuperación.',
    );
    const organizationId = created.data.id;
    await pool.query(
      "INSERT INTO identity_test_faults.flags(org_id,action,result) VALUES($1,'invitation.delivery_finished','SENT')",
      [organizationId],
    );
    faultOrganizationId = organizationId;
    const email = `recovery-${suffix}@example.test`;
    const invited = await request(
      `/organizations/${organizationId}/invitations`,
      { method: 'POST', key: randomUUID(), body: { email, role: 'STUDENT' } },
    );
    requireCondition(
      invited.status === 202 && uuidPattern.test(invited.data?.id),
      'La invitación de recuperación no quedó confirmada.',
    );
    const invitationId = invited.data.id;
    const invitationPath = `/organizations/${organizationId}/invitations/${invitationId}`;
    const uncertain = await until(async () => {
      const result = await request(invitationPath);
      requireCondition(
        result.status === 200,
        'No se pudo consultar la entrega incierta.',
      );
      requireCondition(
        result.data.deliveryState !== 'FAILED',
        'La entrega ficticia falló antes de producir el resultado incierto.',
      );
      return result.data.deliveryState === 'UNCERTAIN' ? result.data : null;
    }, 'No se observó la entrega incierta después del fallo de auditoría.');
    await api.stop();
    stopped = true;
    const oldProof = await until(
      async () =>
        (await capturedLinks(email)).find(
          (proof) => Number(proof.get('generation')) === uncertain.generation,
        ),
      'Auth no entregó el correo anterior al fallo simulado.',
    );
    requireCondition(
      uuidPattern.test(uncertain.operationId),
      'La entrega incierta no conserva su identificador durable.',
    );
    await removeFailure();
    const advanced = await pool.query(
      "UPDATE app.invitation_deliveries SET available_at=now()-interval '1 second' WHERE id=$1 AND organization_id=$2 AND state='UNCERTAIN'",
      [uncertain.operationId, organizationId],
    );
    requireCondition(
      advanced.rowCount === 1,
      'No se conservó la entrega incierta durante el reinicio.',
    );
    await api.start(`${base}/health/ready`);
    stopped = false;
    const recovered = await until(async () => {
      const result = await request(invitationPath);
      requireCondition(
        result.status === 200,
        'No se pudo consultar la recuperación de la entrega.',
      );
      requireCondition(
        result.data.deliveryState !== 'FAILED',
        'La entrega no se recuperó después de reiniciar la API.',
      );
      return result.data.deliveryState === 'SENT' ? result.data : null;
    }, 'No se entregó la invitación recuperada después del reinicio.');
    requireCondition(
      recovered.generation > uncertain.generation &&
        recovered.expiresAt === uncertain.expiresAt,
      'La recuperación debe rotar la prueba sin extender la vigencia institucional.',
    );
    const newProof = await until(
      async () =>
        (await capturedLinks(email)).find(
          (proof) => Number(proof.get('generation')) === recovered.generation,
        ),
      'No se capturó el correo de la generación recuperada.',
    );
    const receiver = createClient(
      state.authUrl,
      state.publishableKey,
      authOptions,
    );
    const verified = await receiver.auth.verifyOtp({
      token_hash: newProof.get('token_hash'),
      type: newProof.get('type'),
    });
    requireCondition(
      !verified.error && verified.data.session,
      'No se canjeó el enlace Auth recuperado.',
    );
    const receiverToken = verified.data.session.access_token;
    const acceptPath = `/invitations/${invitationId}/accept`;
    const obsolete = await request(acceptPath, {
      token: receiverToken,
      method: 'POST',
      key: randomUUID(),
      body: {
        token: oldProof.get('invitationToken'),
        generation: uncertain.generation,
      },
    });
    requireCondition(
      obsolete.status === 409,
      'La prueba anterior al fallo no debe activar la membresía.',
    );
    const accepted = await request(acceptPath, {
      token: receiverToken,
      method: 'POST',
      key: randomUUID(),
      body: {
        token: newProof.get('invitationToken'),
        generation: recovered.generation,
        displayName: 'Estudiante ficticio de recuperación',
      },
    });
    requireCondition(
      accepted.status === 200 && accepted.data.state === 'ACTIVE',
      'La invitación recuperada no activó su única membresía.',
    );
    const counts = async () =>
      (
        await pool.query(
          "SELECT (SELECT count(*)::int FROM app.organization_memberships WHERE organization_id=$1 AND user_id=$2 AND state='ACTIVE') AS memberships,(SELECT count(*)::int FROM app.audit_events WHERE organization_id=$1 AND entity_id=$3 AND action='invitation.accepted') AS acceptances",
          [organizationId, verified.data.user.id, invitationId],
        )
      ).rows[0];
    const firstCounts = await counts();
    requireCondition(
      firstCounts.memberships === 1 && firstCounts.acceptances === 1,
      'La recuperación duplicó una membresía o su auditoría de aceptación.',
    );
    const deliveredMailCount = (await capturedLinks(email)).length;
    // An interrupted lease whose invitation was accepted must be reconciled
    // without issuing another credential or sending another email.
    await api.stop();
    stopped = true;
    await pool.query(
      "UPDATE app.invitation_deliveries SET state='RUNNING',attempt_count=1,lease_token=$2,lease_until=now()-interval '1 second' WHERE id=$1 AND organization_id=$3",
      [uncertain.operationId, randomUUID(), organizationId],
    );
    await api.start(`${base}/health/ready`);
    stopped = false;
    await until(
      async () =>
        (await request(invitationPath)).data?.deliveryState === 'CANCELLED',
      'El lease interrumpido de una invitación consumida no se reconcilió.',
    );
    const finalCounts = await counts();
    requireCondition(
      finalCounts.memberships === 1 &&
        finalCounts.acceptances === 1 &&
        (await capturedLinks(email)).length === deliveredMailCount,
      'Reclamar un lease consumido produjo un efecto duplicado.',
    );
    for (const secret of [
      ownerToken,
      receiverToken,
      oldProof.get('invitationToken'),
      newProof.get('invitationToken'),
      state.authAdminKey,
      state.fixturePassword,
    ])
      requireCondition(
        !api.output.includes(secret),
        'Un secreto apareció en los logs de recuperación.',
      );
    return {
      status: 'passed',
      infrastructure: 'real-local-supabase-mailpit',
      scenarios: [
        'auth-success-database-audit-failure',
        'uncertain-delivery-api-restart',
        'obsolete-generation-rejected',
        'one-membership-one-acceptance',
        'expired-lease-after-acceptance-no-redelivery',
      ],
    };
  } catch (error) {
    // All deliberate assertions are safe. SQL/provider exceptions can contain
    // connection details; never expose their message in the report.
    if (error instanceof Error && !('code' in error) && !('cause' in error))
      throw error;
    // eslint-disable-next-line preserve-caught-error -- Private SQL/provider causes can contain credentials or invitation proofs.
    throw new Error(
      'Falló la comprobación de recuperación institucional; revisar el entorno local con credenciales redactadas.',
    );
  } finally {
    try {
      await removeFailure();
    } finally {
      await pool.end();
      if (stopped) await api.start(`${base}/health/ready`);
    }
  }
}
