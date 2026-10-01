import { Injectable } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  invitationSchema,
  invitationAcceptanceSchema,
} from '@alunza/contracts';
import type { Invitation, Role } from '@alunza/contracts';
import { DatabaseService } from '../database/database.service';
import { ApiError, inactive, notFound } from '../http/errors';
import {
  activeProfile,
  audit,
  checkRevision,
  digest,
  idempotent,
  iso,
  organizationContext,
  pageResult,
} from './governance.shared';
import type { Actor, PageQuery } from './governance.shared';

export const invitationProjection = `SELECT i.*,d.id AS delivery_id,d.state AS delivery_state FROM app.organization_invitations i LEFT JOIN LATERAL (SELECT id,state FROM app.invitation_deliveries WHERE invitation_id=i.id AND organization_id=i.organization_id ORDER BY created_at DESC,id DESC LIMIT 1) d ON true`;
export function projectInvitation(row: Record<string, unknown>): Invitation {
  return invitationSchema.parse({
    id: row.id,
    organizationId: row.organization_id,
    email: row.email_normalized,
    role: row.role,
    state: row.accepted_at
      ? 'ACCEPTED'
      : row.revoked_at
        ? 'REVOKED'
        : new Date(row.expires_at as Date).getTime() <= Date.now()
          ? 'EXPIRED'
          : 'INVITED',
    expiresAt: iso(row.expires_at as Date),
    acceptedAt: iso(row.accepted_at as Date | null),
    revokedAt: iso(row.revoked_at as Date | null),
    generation: row.generation,
    revision: row.revision,
    deliveryState:
      row.delivery_state === 'RUNNING'
        ? 'SENDING'
        : (row.delivery_state ?? 'QUEUED'),
    operationId: row.delivery_id ?? null,
  });
}
async function invitationRow(client: PoolClient, id: string, lock = false) {
  const row = (
    await client.query(
      `${invitationProjection} WHERE i.id=$1${lock ? ' FOR UPDATE OF i' : ''}`,
      [id],
    )
  ).rows[0];
  if (!row) throw notFound();
  return row;
}
function pending(row: Record<string, unknown>, allowExpired = false) {
  if (row.accepted_at)
    throw new ApiError(
      'INVITATION_INVALID',
      'La invitación ya fue aceptada.',
      409,
    );
  if (row.revoked_at)
    throw new ApiError(
      'INVITATION_REVOKED',
      'La invitación fue revocada.',
      409,
    );
  if (!allowExpired && new Date(row.expires_at as Date).getTime() <= Date.now())
    throw new ApiError('INVITATION_EXPIRED', 'La invitación ha vencido.', 409);
}
export async function invitationProof(
  client: PoolClient,
  id: string,
  token: string,
  generation: number,
) {
  const hash = digest(token);
  const row = (
    await client.query(
      'SELECT * FROM app_private.invitation_context($1::uuid,$2,$3)',
      [id, hash, generation],
    )
  ).rows[0];
  if (!row)
    throw new ApiError(
      'INVITATION_INVALID',
      'El enlace de invitación no es válido.',
      409,
    );
  await client.query(
    "SELECT set_config('app.organization_id',$1,true),set_config('app.invitation_id',$2,true),set_config('app.invitation_token_digest',$3,true),set_config('app.invitation_generation',$4,true)",
    [row.organization_id, id, hash, String(generation)],
  );
  return row;
}
async function queueDelivery(
  client: PoolClient,
  id: string,
  orgId: string,
  requesterId: string,
  kind: string,
  requestId: string,
) {
  const operationId = randomUUID();
  await client.query(
    `INSERT INTO app.invitation_deliveries(id,invitation_id,organization_id,requested_by,kind,correlation_id) VALUES($1,$2,$3,$4,$5,$6)`,
    [operationId, id, orgId, requesterId, kind, requestId],
  );
  return operationId;
}

@Injectable()
export class InvitationService {
  constructor(private readonly database: DatabaseService) {}

  async list(who: Actor, orgId: string, query: PageQuery) {
    return this.database.readAs(
      who.actorId,
      async (client) => {
        await activeProfile(client, who.actorId);
        await organizationContext(client, orgId, false, true, true);
        const rows = await client.query(
          `${invitationProjection} WHERE i.organization_id=$1 AND ($2::uuid IS NULL OR i.id>$2) AND ($3::text IS NULL OR i.email_normalized ILIKE '%'||$3||'%') AND ($4::text IS NULL OR (CASE WHEN i.accepted_at IS NOT NULL THEN 'ACCEPTED' WHEN i.revoked_at IS NOT NULL THEN 'REVOKED' WHEN i.expires_at<=now() THEN 'EXPIRED' ELSE 'INVITED' END)=$4) AND ($5::text IS NULL OR i.role=$5) ORDER BY i.id LIMIT $6`,
          [
            orgId,
            query.cursor ?? null,
            query.search ?? null,
            query.state ?? null,
            query.role ?? null,
            query.limit + 1,
          ],
        );
        return pageResult(
          rows.rows.map(projectInvitation),
          query.limit,
          (row) => row.id,
        );
      },
      who.sessionId,
    );
  }

  async get(who: Actor, orgId: string, id: string) {
    return this.database.readAs(
      who.actorId,
      async (client) => {
        await activeProfile(client, who.actorId);
        await organizationContext(client, orgId, false, true, true);
        return projectInvitation(await invitationRow(client, id));
      },
      who.sessionId,
    );
  }

  async create(
    who: Actor,
    orgId: string,
    input: { email: string; role: Role },
    key: string,
  ) {
    return this.database.writeAs(
      who.actorId,
      async (client) => {
        await activeProfile(client, who.actorId);
        await organizationContext(client, orgId, true, true);
        return idempotent(
          client,
          who,
          orgId,
          'invitation.create',
          key,
          input,
          202,
          async () => {
            const existingMember = await client.query(
              `SELECT m.user_id FROM app.organization_memberships m JOIN app.profiles p ON p.id=m.user_id WHERE m.organization_id=$1 AND p.email_normalized=$2`,
              [orgId, input.email],
            );
            if (existingMember.rowCount)
              throw new ApiError(
                'DUPLICATE',
                'El usuario ya tiene una membresía en esta organización.',
                409,
              );
            const existing = await client.query(
              `SELECT id FROM app.organization_invitations WHERE organization_id=$1 AND email_normalized=$2 AND accepted_at IS NULL AND revoked_at IS NULL`,
              [orgId, input.email],
            );
            if (existing.rowCount)
              throw new ApiError(
                'DUPLICATE',
                'Ya existe una invitación para este correo. Puedes reenviarla o revocarla.',
                409,
              );
            const id = randomUUID();
            await client.query(
              `INSERT INTO app.organization_invitations(id,organization_id,email_normalized,role,invited_by) VALUES($1,$2,$3,$4,$5)`,
              [id, orgId, input.email, input.role, who.actorId],
            );
            await queueDelivery(
              client,
              id,
              orgId,
              who.actorId,
              'INITIAL',
              who.requestId,
            );
            await audit(
              client,
              who,
              orgId,
              'invitation.created',
              'invitation',
              id,
              { role: input.role },
            );
            return {
              data: projectInvitation(await invitationRow(client, id)),
              resourceId: id,
              resourceType: 'invitation',
            };
          },
        );
      },
      who.sessionId,
    );
  }

  async change(
    who: Actor,
    orgId: string,
    id: string,
    action: 'resend' | 'revoke',
    expected: number,
    key: string,
  ) {
    return this.database.writeAs(
      who.actorId,
      async (client) => {
        await activeProfile(client, who.actorId);
        await organizationContext(client, orgId, true, true);
        return idempotent(
          client,
          who,
          orgId,
          `invitation.${action}`,
          key,
          { id, revision: expected },
          action === 'resend' ? 202 : 200,
          async () => {
            const row = await invitationRow(client, id, true);
            checkRevision(row.revision, expected);
            pending(row, true);
            await client.query(
              `UPDATE app.invitation_deliveries SET state='CANCELLED',lease_until=NULL,updated_at=now() WHERE invitation_id=$1 AND state IN ('QUEUED','RUNNING','UNCERTAIN')`,
              [id],
            );
            if (action === 'revoke') {
              await client.query(
                `UPDATE app.organization_invitations SET revoked_at=now(),revoked_by=$2,revision=revision+1,updated_at=now() WHERE id=$1`,
                [id, who.actorId],
              );
            } else {
              // The discarded random digest invalidates every old link immediately.
              await client.query(
                `UPDATE app.organization_invitations SET token_digest=$2,generation=generation+1,expires_at=now()+interval '72 hours',revision=revision+1,updated_at=now() WHERE id=$1`,
                [id, digest(randomBytes(32).toString('base64url'))],
              );
              await queueDelivery(
                client,
                id,
                orgId,
                who.actorId,
                'RESEND',
                who.requestId,
              );
            }
            await audit(
              client,
              who,
              orgId,
              `invitation.${action === 'resend' ? 'resent' : 'revoked'}`,
              'invitation',
              id,
            );
            return {
              data: projectInvitation(await invitationRow(client, id)),
              resourceId: id,
              resourceType: 'invitation',
            };
          },
        );
      },
      who.sessionId,
    );
  }

  async accept(
    who: Actor,
    id: string,
    input: { token: string; generation: number; displayName?: string },
    key: string,
  ) {
    return this.database.writeAs(
      who.actorId,
      async (client) => {
        let proof = await invitationProof(
          client,
          id,
          input.token,
          input.generation,
        );
        const email = (
          await client.query('SELECT app_private.current_auth_email() AS email')
        ).rows[0]?.email;
        if (!email || email !== proof.email_normalized)
          throw new ApiError(
            'INVITATION_INVALID',
            'La sesión no corresponde al destinatario de la invitación.',
            409,
          );
        const org = (
          await client.query(
            'SELECT * FROM app_private.lock_invitation_organization($1::uuid,$2,$3)',
            [id, digest(input.token), input.generation],
          )
        ).rows[0];
        if (!org) throw notFound();
        proof = await invitationProof(
          client,
          id,
          input.token,
          input.generation,
        );
        const profile = (
          await client.query(
            'SELECT id,display_name,account_state FROM app.profiles WHERE id=$1',
            [who.actorId],
          )
        ).rows[0];
        if (profile?.account_state === 'DISABLED') throw inactive();
        const operationPayload = {
          id,
          generation: input.generation,
          tokenHash: digest(input.token),
          displayName: input.displayName,
        };
        // Accepted invitations are observations, never another activation command.
        if (proof.accepted_at) {
          if (proof.accepted_by !== who.actorId)
            throw new ApiError(
              'INVITATION_INVALID',
              'La invitación no corresponde a esta sesión.',
              409,
            );
          const member = (
            await client.query(
              'SELECT role,state FROM app.organization_memberships WHERE organization_id=$1 AND user_id=$2',
              [proof.organization_id, who.actorId],
            )
          ).rows[0];
          if (!member) throw notFound();
          const observed = invitationAcceptanceSchema.parse({
            organizationId: proof.organization_id,
            userId: who.actorId,
            role: member.role,
            state: member.state,
          });
          // Validate replay payload even after consumption, but always report
          // the current membership rather than replaying an old ACTIVE state.
          await idempotent(
            client,
            who,
            proof.organization_id,
            'invitation.accept',
            key,
            operationPayload,
            200,
            async () => ({
              data: observed,
              resourceId: id,
              resourceType: 'invitation',
            }),
            { observed },
          );
          return observed;
        }
        pending(proof);
        if (org.archived_at)
          throw new ApiError(
            'ORGANIZATION_ARCHIVED',
            'La organización está archivada.',
            409,
          );
        const row = await invitationRow(client, id, true);
        pending(row);
        return idempotent(
          client,
          who,
          proof.organization_id,
          'invitation.accept',
          key,
          operationPayload,
          200,
          async () => {
            const existing = (
              await client.query(
                'SELECT role,state,joined_at FROM app.organization_memberships WHERE organization_id=$1 AND user_id=$2 FOR UPDATE',
                [proof.organization_id, who.actorId],
              )
            ).rows[0];
            if (existing?.joined_at || existing?.state === 'DISABLED')
              throw new ApiError(
                'DUPLICATE',
                'Ya existe una membresía aceptada. Su estado se administra por separado.',
                409,
              );
            if (!profile)
              await client.query(
                `INSERT INTO app.profiles(id,email_normalized,display_name,account_state) VALUES($1,$2,$3,'ACTIVE')`,
                [
                  who.actorId,
                  email,
                  input.displayName ?? email.split('@')[0].slice(0, 120),
                ],
              );
            else if (profile.account_state === 'INVITED')
              await client.query(
                `UPDATE app.profiles SET account_state='ACTIVE',display_name=coalesce($2,display_name),updated_at=now() WHERE id=$1`,
                [who.actorId, input.displayName ?? null],
              );
            if (existing)
              await client.query(
                `UPDATE app.organization_memberships SET role=$3,state='ACTIVE',joined_at=now(),disabled_at=NULL,revision=revision+1 WHERE organization_id=$1 AND user_id=$2`,
                [proof.organization_id, who.actorId, row.role],
              );
            else
              await client.query(
                `INSERT INTO app.organization_memberships(organization_id,user_id,role,state,joined_at) VALUES($1,$2,$3,'ACTIVE',now())`,
                [proof.organization_id, who.actorId, row.role],
              );
            await client.query(
              `UPDATE app.organization_invitations SET accepted_at=now(),accepted_by=$2,revision=revision+1,updated_at=now() WHERE id=$1`,
              [id, who.actorId],
            );
            await audit(
              client,
              who,
              proof.organization_id,
              'invitation.accepted',
              'invitation',
              id,
              { role: row.role },
            );
            return {
              data: invitationAcceptanceSchema.parse({
                organizationId: proof.organization_id,
                userId: who.actorId,
                role: row.role,
                state: 'ACTIVE',
              }),
              resourceId: id,
              resourceType: 'invitation',
            };
          },
        );
      },
      who.sessionId,
    );
  }

  async renew(
    id: string,
    input: { token: string; generation: number },
    key: string,
    requestId: string,
  ) {
    return this.database.internal(async (client) => {
      let proof = await invitationProof(
        client,
        id,
        input.token,
        input.generation,
      );
      pending(proof);
      const org = (
        await client.query(
          'SELECT * FROM app_private.lock_invitation_organization($1::uuid,$2,$3)',
          [id, digest(input.token), input.generation],
        )
      ).rows[0];
      if (!org || org.archived_at)
        throw new ApiError(
          'INVITATION_INVALID',
          'La invitación no está disponible.',
          409,
        );
      proof = await invitationProof(client, id, input.token, input.generation);
      pending(proof);
      if (!proof.authorized_by)
        throw new ApiError(
          'INVITATION_INVALID',
          'La invitación no tiene una autorización vigente.',
          409,
        );
      await client.query("SELECT set_config('app.actor_id',$1,true)", [
        proof.authorized_by,
      ]);
      const who = { actorId: proof.authorized_by, sessionId: '', requestId };
      const row = await invitationRow(client, id, true);
      pending(row);
      return idempotent(
        client,
        who,
        proof.organization_id,
        'invitation.renew',
        key,
        { id, generation: input.generation, tokenHash: digest(input.token) },
        202,
        async () => {
          const recent = await client.query(
            `SELECT id FROM app.invitation_deliveries WHERE invitation_id=$1 AND (state IN ('QUEUED','RUNNING','UNCERTAIN') OR (kind='RENEW' AND created_at>now()-interval '1 minute')) LIMIT 1`,
            [id],
          );
          if (recent.rowCount)
            throw new ApiError(
              'RATE_LIMITED',
              'Espera un minuto antes de solicitar otro enlace.',
              429,
              true,
            );
          await queueDelivery(
            client,
            id,
            proof.organization_id,
            proof.authorized_by,
            'RENEW',
            requestId,
          );
          await client.query(
            `INSERT INTO app.audit_events(organization_id,actor_id,actor_kind,action,entity_type,entity_id,result,correlation_id,request_id) VALUES($1,$2,'SYSTEM','invitation.auth_renew_requested','invitation',$3,'QUEUED',$4,$4)`,
            [proof.organization_id, proof.authorized_by, id, requestId],
          );
          return {
            data: projectInvitation(await invitationRow(client, id)),
            resourceId: id,
            resourceType: 'invitation',
          };
        },
      );
    });
  }
}
