import { Injectable } from '@nestjs/common';
import { meSchema, organizationSchema } from '@alunza/contracts';
import type { Me, Organization } from '@alunza/contracts';
import { DatabaseService } from '../database/database.service';
import { inactive, notFound } from '../http/errors';
import {
  organizationProjection,
  projectOrganization,
} from '../governance/governance.shared';

@Injectable()
export class IdentityRepository {
  constructor(private readonly database: DatabaseService) {}

  async me(actorId: string, sessionId?: string): Promise<Me> {
    return this.database.readAs(
      actorId,
      async (client) => {
        const profile = (
          await client.query(
            'SELECT id, display_name, account_state FROM app.profiles WHERE id=$1',
            [actorId],
          )
        ).rows[0];
        if (!profile || profile.account_state !== 'ACTIVE') throw inactive();
        const contexts = await client.query(
          `
        SELECT m.organization_id, m.role, o.name, o.archived_at
        FROM app.organization_memberships m JOIN app.organizations o ON o.id=m.organization_id
        WHERE m.user_id=$1 AND m.state='ACTIVE' ORDER BY o.name, o.id`,
          [actorId],
        );
        const grants = await client.query(
          `SELECT id FROM app.provisioning_grants WHERE user_id=$1 AND revoked_at IS NULL AND consumed_at IS NULL AND (expires_at IS NULL OR expires_at>now()) ORDER BY granted_at,id`,
          [actorId],
        );
        return meSchema.parse({
          id: profile.id,
          displayName: profile.display_name,
          accountState: 'ACTIVE',
          memberships: contexts.rows.map((row) => ({
            organizationId: row.organization_id,
            organizationName: row.name,
            organizationState: row.archived_at ? 'ARCHIVED' : 'ACTIVE',
            accessMode: row.archived_at ? 'READ_ONLY' : 'OPERATE',
            role: row.role,
            state: 'ACTIVE',
          })),
          provisioningGrants: grants.rows,
          canProvisionOrganization: grants.rowCount !== 0,
        });
      },
      sessionId,
    );
  }

  async organization(
    actorId: string,
    organizationId: string,
    sessionId?: string,
  ): Promise<Organization> {
    return this.database.readAs(
      actorId,
      async (client) => {
        const profile = (
          await client.query(
            'SELECT account_state FROM app.profiles WHERE id=$1',
            [actorId],
          )
        ).rows[0];
        if (profile?.account_state !== 'ACTIVE') throw inactive();
        await client.query("SELECT set_config('app.organization_id',$1,true)", [
          organizationId,
        ]);
        const row = (
          await client.query(`${organizationProjection} WHERE id=$1`, [
            organizationId,
          ])
        ).rows[0];
        if (!row) throw notFound();
        return organizationSchema.parse(projectOrganization(row));
      },
      sessionId,
    );
  }
}
