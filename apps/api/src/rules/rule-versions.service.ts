import { Injectable } from '@nestjs/common';
import {
  signalRuleVersionListSchema,
  signalRuleEffectiveSchema,
  signalRuleVersionSchema,
} from '@alunza/contracts';
import type {
  SignalRuleActivate,
  SignalRuleCreate,
  SignalRuleListQuery,
} from '@alunza/contracts';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import {
  activeProfile,
  organizationContext,
} from '../governance/governance.shared';
import type { Actor } from '../governance/governance.shared';
import { notFound } from '../http/errors';

@Injectable()
export class RuleVersionsService {
  constructor(private readonly database: DatabaseService) {}

  private async authorize(
    client: PoolClient,
    who: Actor,
    organizationId: string,
  ) {
    await activeProfile(client, who.actorId);
    // Mutation RPCs lock their own organization/type and revalidate access.
    // Taking the generic organization UPDATE lock here would serialize types.
    await organizationContext(client, organizationId, false, true);
  }

  private async resourceOrganization(
    client: PoolClient,
    who: Actor,
    id: string,
  ): Promise<string> {
    await activeProfile(client, who.actorId);
    const { rows } = await client.query<{ organization_id: string }>(
      'SELECT app_private.signal_rule_organization($1::uuid) AS organization_id',
      [id],
    );
    const organizationId = rows[0]?.organization_id;
    if (!organizationId) throw notFound();
    await organizationContext(client, organizationId, false, true);
    return organizationId;
  }

  list(who: Actor, organizationId: string, query: SignalRuleListQuery) {
    return this.database.readAs(
      who.actorId,
      async (client) => {
        await this.authorize(client, who, organizationId);
        const { rows } = await client.query(
          'SELECT app_private.list_rule_versions($1::uuid,$2::text,$3::uuid,$4::integer) AS result',
          [
            organizationId,
            query.type ?? null,
            query.cursor ?? null,
            query.limit,
          ],
        );
        return signalRuleVersionListSchema.parse(rows[0]?.result);
      },
      who.sessionId,
    );
  }

  effective(who: Actor, organizationId: string) {
    return this.database.readAs(
      who.actorId,
      async (client) => {
        await this.authorize(client, who, organizationId);
        // The STABLE RPC revalidates authorization and observes all three types
        // in the calling statement's snapshot, even under READ COMMITTED.
        const { rows } = await client.query(
          'SELECT app_private.effective_signal_rules($1::uuid) AS result',
          [organizationId],
        );
        return signalRuleEffectiveSchema.parse(rows[0]?.result);
      },
      who.sessionId,
    );
  }

  create(
    who: Actor,
    organizationId: string,
    input: SignalRuleCreate,
    key: string,
  ) {
    return this.database.writeAs(
      who.actorId,
      async (client) => {
        await this.authorize(client, who, organizationId);
        await client.query("SELECT set_config('app.request_id',$1,true)", [
          who.requestId,
        ]);
        const { rows } = await client.query(
          'SELECT app_private.create_rule_version($1::uuid,$2::jsonb,$3::text) AS result',
          [organizationId, JSON.stringify(input), key],
        );
        return signalRuleVersionSchema.parse(rows[0]?.result);
      },
      who.sessionId,
    );
  }

  get(who: Actor, id: string) {
    return this.database.readAs(
      who.actorId,
      async (client) => {
        const organizationId = await this.resourceOrganization(client, who, id);
        const { rows } = await client.query(
          'SELECT app_private.get_rule_version($1::uuid,$2::uuid) AS result',
          [organizationId, id],
        );
        return signalRuleVersionSchema.parse(rows[0]?.result);
      },
      who.sessionId,
    );
  }

  activate(who: Actor, id: string, input: SignalRuleActivate, key: string) {
    return this.database.writeAs(
      who.actorId,
      async (client) => {
        const organizationId = await this.resourceOrganization(client, who, id);
        await client.query("SELECT set_config('app.request_id',$1,true)", [
          who.requestId,
        ]);
        const { rows } = await client.query(
          'SELECT app_private.activate_rule_version($1::uuid,$2::uuid,$3::uuid,$4::text) AS result',
          [organizationId, id, input.expectedCurrentVersionId, key],
        );
        return signalRuleVersionSchema.parse(rows[0]?.result);
      },
      who.sessionId,
    );
  }
}
