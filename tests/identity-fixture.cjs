/* eslint @typescript-eslint/no-require-imports: "off" */
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { createClient } = require('@supabase/supabase-js');
const { Client } = require('pg');
const fixture = require('../fixtures/foundation/identity.json');

module.exports.identityTasks = function identityTasks(state) {
  const target = new URL(state.migrationUrl);
  if (
    state.projectId !== 'alunza-edu-foundation-test' ||
    state.authUrl !== 'http://127.0.0.1:16421' ||
    target.hostname !== '127.0.0.1' ||
    target.port !== '16422'
  )
    throw new Error('Las tareas de identidad solo operan fixtures aislados.');
  const owner = fixture.users.find(
    (u) =>
      u.role === 'ADMIN' && u.organizationId === fixture.organizations[0].id,
  );
  const student = fixture.users.find(
    (u) =>
      u.role === 'STUDENT' && u.organizationId === fixture.organizations[0].id,
  );
  return {
    'identity:prepare': async () => {
      const db = new Client({ connectionString: state.migrationUrl });
      await db.connect();
      const id = randomUUID(),
        grantId = randomUUID(),
        code = `E2E-${id.slice(0, 8).toUpperCase()}`,
        email = `e2e-${id}@example.test`;
      try {
        await db.query('BEGIN');
        await db.query(
          'INSERT INTO app.organizations(id,code,name) VALUES($1,$2,$3)',
          [id, code, `Institución ${code}`],
        );
        await db.query(
          "INSERT INTO app.organization_memberships(organization_id,user_id,role,state,joined_at) VALUES($1,$2,'ADMIN','ACTIVE',now())",
          [id, owner.id],
        );
        await db.query(
          "INSERT INTO app.provisioning_grants(id,user_id,granted_by,reason,expires_at) VALUES($1,$2,'cypress','Fixture local IMP-01',now()+interval '1 day')",
          [grantId, owner.id],
        );
        await db.query('COMMIT');
        return {
          id,
          code,
          name: `Institución ${code}`,
          grantId,
          email,
          ownerId: owner.id,
          studentId: student.id,
          foreignId: fixture.organizations[1].id,
        };
      } catch {
        await db.query('ROLLBACK');
        throw new Error('No se preparó el fixture institucional.');
      } finally {
        await db.end();
      }
    },
    'identity:login': async (role) => {
      if (!['ADMIN', 'TEACHER', 'STUDENT'].includes(role))
        throw new Error('Rol de fixture inválido.');
      const account = fixture.users.find(
        (u) =>
          u.role === role && u.organizationId === fixture.organizations[0].id,
      );
      const auth = createClient(state.authUrl, state.publishableKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const result = await auth.auth.signInWithPassword({
        email: account.email,
        password: state.fixturePassword,
      });
      if (result.error || !result.data.session)
        throw new Error('No se obtuvo sesión del fixture.');
      return result.data.session;
    },
    'identity:mail': async ({ email }) => {
      if (
        typeof email !== 'string' ||
        !/^e2e-[a-f0-9-]+@example\.test$/.test(email)
      )
        throw new Error('Solo correo de fixture Cypress.');
      for (let attempt = 0; attempt < 100; attempt++) {
        const list = await (
          await fetch('http://127.0.0.1:16424/api/v1/messages')
        ).json();
        for (const message of list.messages ?? []) {
          if (!(message.To ?? []).some((to) => to.Address === email)) continue;
          const detail = await (
            await fetch(`http://127.0.0.1:16424/api/v1/message/${message.ID}`)
          ).json();
          for (const found of (detail.HTML ?? '').matchAll(/href="([^"]+)"/g)) {
            const raw = found[1].replaceAll('&amp;', '&');
            if (!raw.includes('/acceso/invitacion')) continue;
            const url = new URL(raw);
            if (
              url.origin !== 'http://127.0.0.1:3100' ||
              url.pathname !== '/acceso/invitacion'
            )
              throw new Error('Destino de correo fuera del fixture.');
            return { url: url.href };
          }
        }
        await delay(200);
      }
      throw new Error('Correo de invitación no recibido en capturador local.');
    },
    'identity:delivered': async ({ organizationId, email, kind }) => {
      if (
        typeof organizationId !== 'string' ||
        !/^[a-f0-9-]{36}$/.test(organizationId) ||
        typeof email !== 'string' ||
        !/^e2e-[a-f0-9-]+@example\.test$/.test(email) ||
        !['INITIAL', 'RESEND'].includes(kind)
      )
        throw new Error('Entrega fuera del fixture Cypress.');
      const db = new Client({
        connectionString: state.migrationUrl,
        connectionTimeoutMillis: 5000,
        query_timeout: 2000,
      });
      try {
        await db.connect();
        const deadline = Date.now() + 20_000;
        while (Date.now() < deadline) {
          // Read only: delivery preparation rotates the credential and ETag.
          // Waiting for the requested delivery avoids observing the old SENT row.
          const result = await db.query(
            `SELECT d.kind,d.state FROM app.organization_invitations i
             JOIN LATERAL (
               SELECT kind,state FROM app.invitation_deliveries
               WHERE invitation_id=i.id AND organization_id=i.organization_id
               ORDER BY created_at DESC,id DESC LIMIT 1
             ) d ON true
             WHERE i.organization_id=$1 AND i.email_normalized=$2`,
            [organizationId, email],
          );
          const delivery = result.rows[0];
          if (delivery?.kind === kind) {
            if (delivery.state === 'SENT') return null;
            if (['FAILED', 'CANCELLED'].includes(delivery.state))
              throw new Error('La entrega real terminó sin enviar el correo.');
          }
          await delay(200);
        }
        throw new Error('La entrega real no alcanzó SENT dentro del plazo.');
      } catch {
        throw new Error('No se confirmó la entrega real del fixture Cypress.');
      } finally {
        await db.end();
      }
    },
    'identity:inactiveAccount': async (accountState) => {
      if (!['INVITED', 'DISABLED'].includes(accountState))
        throw new Error('Estado de fixture inválido.');
      const id = randomUUID(),
        email = `e2e-${id}@example.test`;
      const auth = createClient(state.authUrl, state.authAdminKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const result = await auth.auth.admin.createUser({
        id,
        email,
        password: state.fixturePassword,
        email_confirm: true,
      });
      if (result.error) throw new Error('No se creó la identidad ficticia.');
      const db = new Client({ connectionString: state.migrationUrl });
      await db.connect();
      try {
        await db.query(
          'INSERT INTO app.profiles(id,email_normalized,display_name,account_state) VALUES($1,$2,$3,$4)',
          [id, email, 'Cuenta inactiva de prueba', accountState],
        );
      } finally {
        await db.end();
      }
      return { email };
    },
  };
};
