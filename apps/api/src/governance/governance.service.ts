import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { memberSchema, organizationSchema } from '@alunza/contracts';
import type { Member, Organization, Role } from '@alunza/contracts';
import { DatabaseService } from '../database/database.service';
import { ApiError, notFound } from '../http/errors';
import {
  activeProfile,
  audit,
  checkRevision,
  idempotent,
  iso,
  organizationContext,
  organizationProjection,
  pageResult,
  projectOrganization,
} from './governance.shared';
import type { Actor, PageQuery } from './governance.shared';

const memberProjection = `SELECT m.user_id,m.role,m.state,m.revision,m.joined_at,p.display_name,p.email_normalized,p.account_state FROM app.organization_memberships m JOIN app.profiles p ON p.id=m.user_id`;
function projectMember(row: Record<string, unknown>): Member {
  return memberSchema.parse({
    userId: row.user_id,
    role: row.role,
    state: row.state,
    revision: row.revision,
    joinedAt: iso(row.joined_at as Date | null),
    displayName: row.display_name,
    email: row.email_normalized,
    accountState: row.account_state,
  });
}

@Injectable()
export class GovernanceService {
  constructor(private readonly database: DatabaseService) {}

  async organizations(who: Actor, query: PageQuery) {
    return this.database.readAs(
      who.actorId,
      async (client) => {
        await activeProfile(client, who.actorId);
        const rows = await client.query(
          `${organizationProjection} WHERE ($1::uuid IS NULL OR id>$1) AND ($2::text IS NULL OR name ILIKE '%'||$2||'%' OR code ILIKE '%'||$2||'%') AND ($3::text IS NULL OR (CASE WHEN archived_at IS NULL THEN 'ACTIVE' ELSE 'ARCHIVED' END)=$3) ORDER BY id LIMIT $4`,
          [
            query.cursor ?? null,
            query.search ?? null,
            query.state ?? null,
            query.limit + 1,
          ],
        );
        return pageResult(
          rows.rows.map(projectOrganization),
          query.limit,
          (row) => row.id,
        );
      },
      who.sessionId,
    );
  }

  async createOrganization(
    who: Actor,
    input: { grantId: string; code: string; name: string },
    key: string,
  ): Promise<Organization> {
    return this.database.writeAs(
      who.actorId,
      async (client) => {
        await activeProfile(client, who.actorId);
        const created = await idempotent(
          client,
          who,
          null,
          'organization.create',
          key,
          input,
          201,
          async () => {
            await client.query(
              "SELECT set_config('app.provisioning_grant_id',$1,true)",
              [input.grantId],
            );
            const existingGrant = (
              await client.query(
                `SELECT id,consumed_at,revoked_at,expires_at FROM app.provisioning_grants WHERE id=$1 AND user_id=$2`,
                [input.grantId, who.actorId],
              )
            ).rows[0];
            if (
              !existingGrant ||
              existingGrant.revoked_at ||
              (existingGrant.expires_at &&
                new Date(existingGrant.expires_at).getTime() <= Date.now())
            )
              throw new ApiError(
                'FORBIDDEN',
                'No hay un permiso de aprovisionamiento vigente.',
                403,
              );
            if (existingGrant.consumed_at)
              throw new ApiError(
                'IDEMPOTENCY_CONFLICT',
                'El permiso ya se utilizó para crear una organización.',
                409,
              );
            const grant = (
              await client.query(
                `SELECT id FROM app.provisioning_grants WHERE id=$1 AND user_id=$2 FOR UPDATE`,
                [input.grantId, who.actorId],
              )
            ).rows[0];
            if (!grant)
              throw new ApiError(
                'IDEMPOTENCY_CONFLICT',
                'El permiso fue consumido por otra operación.',
                409,
              );
            const id = randomUUID();
            await client.query(
              "SELECT set_config('app.organization_id',$1,true),set_config('app.provisioning_grant_id',$2,true)",
              [id, input.grantId],
            );
            await client.query(
              `INSERT INTO app.organizations(id,code,name) VALUES($1,$2,$3)`,
              [id, input.code, input.name],
            );
            await client.query(
              `INSERT INTO app.organization_memberships(organization_id,user_id,role,state,joined_at) VALUES($1,$2,'ADMIN','ACTIVE',now())`,
              [id, who.actorId],
            );
            await client.query(
              `UPDATE app.provisioning_grants SET consumed_at=now(),consumed_organization_id=$2 WHERE id=$1`,
              [input.grantId, id],
            );
            await audit(
              client,
              who,
              id,
              'organization.created',
              'organization',
              id,
              { grantId: input.grantId },
            );
            const row = (
              await client.query(`${organizationProjection} WHERE id=$1`, [id])
            ).rows[0];
            return {
              data: organizationSchema.parse(projectOrganization(row)),
              resourceId: id,
              resourceType: 'organization',
            };
          },
        );
        await client.query(
          "SELECT set_config('app.provisioning_grant_id','',true)",
        );
        const current = await organizationContext(client, created.id, false);
        return projectOrganization(current);
      },
      who.sessionId,
    );
  }

  async updateOrganization(
    who: Actor,
    organizationId: string,
    input: { code?: string; name?: string },
    expected: number,
  ) {
    return this.database.writeAs(
      who.actorId,
      async (client) => {
        await activeProfile(client, who.actorId);
        const before = await organizationContext(
          client,
          organizationId,
          true,
          true,
        );
        checkRevision(before.revision, expected);
        const row = (
          await client.query(
            `UPDATE app.organizations SET code=coalesce($2,code),name=coalesce($3,name),revision=revision+1,updated_at=now() WHERE id=$1 RETURNING id,code,name,timezone,revision,archived_at`,
            [organizationId, input.code ?? null, input.name ?? null],
          )
        ).rows[0];
        if (!row) throw notFound();
        await audit(
          client,
          who,
          organizationId,
          'organization.updated',
          'organization',
          organizationId,
          { fields: Object.keys(input), revision: row.revision },
        );
        return projectOrganization(row);
      },
      who.sessionId,
    );
  }

  async archiveOrganization(
    who: Actor,
    organizationId: string,
    input: { reason: string },
    expected: number,
    key: string,
  ) {
    return this.database.writeAs(
      who.actorId,
      async (client) => {
        await activeProfile(client, who.actorId);
        await organizationContext(client, organizationId, false, true, true);
        return idempotent(
          client,
          who,
          organizationId,
          'organization.archive',
          key,
          { ...input, revision: expected },
          200,
          async () => {
            const org = await organizationContext(
              client,
              organizationId,
              true,
              true,
            );
            checkRevision(org.revision, expected);
            const dependencies = (
              await client.query(
                `SELECT
          (SELECT count(*)::int FROM app.organization_memberships WHERE organization_id=$1 AND state='ACTIVE' AND user_id<>$2) AS members,
          (SELECT count(*)::int FROM app.organization_invitations WHERE organization_id=$1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>now()) AS invitations,
          (SELECT count(*)::int FROM app.invitation_deliveries WHERE organization_id=$1 AND state IN ('QUEUED','RUNNING','UNCERTAIN')) AS jobs`,
                [organizationId, who.actorId],
              )
            ).rows[0];
            if (
              dependencies.members ||
              dependencies.invitations ||
              dependencies.jobs
            )
              throw new ApiError(
                'DEPENDENCIES_ACTIVE',
                'No se puede archivar mientras existan miembros, invitaciones o entregas activas.',
                409,
                false,
                Object.entries(dependencies)
                  .filter(([, count]) => Number(count) > 0)
                  .map(([field, count]) => ({
                    field,
                    message: `${count} dependencias activas.`,
                  })),
              );
            const row = (
              await client.query(
                `UPDATE app.organizations SET archived_at=now(),archived_by=$2,archive_reason=$3,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING id,code,name,timezone,revision,archived_at`,
                [organizationId, who.actorId, input.reason],
              )
            ).rows[0];
            await audit(
              client,
              who,
              organizationId,
              'organization.archived',
              'organization',
              organizationId,
              { reason: input.reason },
            );
            return {
              data: projectOrganization(row),
              resourceId: organizationId,
              resourceType: 'organization',
            };
          },
        );
      },
      who.sessionId,
    );
  }

  async members(who: Actor, organizationId: string, query: PageQuery) {
    return this.database.readAs(
      who.actorId,
      async (client) => {
        await activeProfile(client, who.actorId);
        await organizationContext(client, organizationId, false, true, true);
        const rows = await client.query(
          `${memberProjection} WHERE m.organization_id=$1 AND ($2::uuid IS NULL OR m.user_id>$2) AND ($3::text IS NULL OR p.display_name ILIKE '%'||$3||'%' OR p.email_normalized ILIKE '%'||$3||'%') AND ($4::text IS NULL OR m.state=$4) AND ($5::text IS NULL OR m.role=$5) ORDER BY m.user_id LIMIT $6`,
          [
            organizationId,
            query.cursor ?? null,
            query.search ?? null,
            query.state ?? null,
            query.role ?? null,
            query.limit + 1,
          ],
        );
        return pageResult(
          rows.rows.map(projectMember),
          query.limit,
          (row) => row.userId,
        );
      },
      who.sessionId,
    );
  }

  async updateMember(
    who: Actor,
    organizationId: string,
    userId: string,
    input: { role?: Role; state?: 'ACTIVE' | 'DISABLED' },
    expected: number,
  ) {
    return this.database.writeAs(
      who.actorId,
      async (client) => {
        await activeProfile(client, who.actorId);
        await organizationContext(client, organizationId, true, true);
        const before = (
          await client.query(
            `${memberProjection} WHERE m.organization_id=$1 AND m.user_id=$2 FOR UPDATE OF m`,
            [organizationId, userId],
          )
        ).rows[0];
        if (!before) throw notFound();
        checkRevision(before.revision, expected);
        if (!before.joined_at || before.state === 'INVITED')
          throw new ApiError(
            'INVITATION_INVALID',
            'La membresía requiere aceptar su invitación.',
            409,
          );
        const role = input.role ?? before.role;
        const state = input.state ?? before.state;
        if (
          before.role === 'ADMIN' &&
          before.state === 'ACTIVE' &&
          (role !== 'ADMIN' || state !== 'ACTIVE')
        ) {
          const count = (
            await client.query(
              `SELECT count(*)::int AS total FROM app.organization_memberships m JOIN app.profiles p ON p.id=m.user_id WHERE m.organization_id=$1 AND m.role='ADMIN' AND m.state='ACTIVE' AND p.account_state='ACTIVE'`,
              [organizationId],
            )
          ).rows[0]?.total;
          if (count <= 1)
            throw new ApiError(
              'LAST_ADMIN',
              'La organización debe conservar un administrador activo.',
              409,
            );
        }
        await client.query(
          `UPDATE app.organization_memberships SET role=$3,state=$4,disabled_at=CASE WHEN $4='DISABLED' THEN now() ELSE NULL END,revision=revision+1 WHERE organization_id=$1 AND user_id=$2`,
          [organizationId, userId, role, state],
        );
        await audit(
          client,
          who,
          organizationId,
          'membership.updated',
          'membership',
          userId,
          { role, state, revision: before.revision + 1 },
        );
        return projectMember({
          ...before,
          role,
          state,
          revision: before.revision + 1,
        });
      },
      who.sessionId,
    );
  }
}
