import { Inject, Injectable } from '@nestjs/common';
import type { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import { APP_CONFIG } from '../config';
import type { AppConfig } from '../config';
import { digest } from './governance.shared';
import {
  InvitationAuthAdapter,
  InvitationDeliveryError,
} from './invitation-auth.adapter';

interface Delivery {
  id: string;
  organization_id: string;
  invitation_id: string;
  requested_by: string;
  lease_token: string;
  attempt_count: number;
  correlation_id: string;
  kind: string;
}
interface Prepared {
  email: string;
  token: string;
  generation: number;
}

@Injectable()
export class InvitationWorker implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | undefined;
  private maintenanceTimer: NodeJS.Timeout | undefined;
  private maintenance: Promise<void> | undefined;
  private stopped = false;
  private running: Promise<void> | undefined;
  constructor(
    private readonly database: DatabaseService,
    private readonly auth: InvitationAuthAdapter,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}
  onModuleInit() {
    this.maintenanceTimer = setInterval(() => {
      if (this.stopped || this.maintenance) return;
      this.maintenance = this.database
        .internal(async (client) => {
          await client.query(
            'SELECT app_private.purge_expired_operation_responses()',
          );
        })
        .catch(() => undefined)
        .finally(() => {
          this.maintenance = undefined;
        });
    }, 60_000);
    this.maintenanceTimer.unref();
    if (this.config.invitationWorkerEnabled) this.schedule();
  }
  private schedule() {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.running = this.tick()
        .catch(() => undefined)
        .finally(() => {
          this.running = undefined;
          this.schedule();
        });
    }, 500);
    this.timer.unref();
  }
  async onModuleDestroy() {
    this.stopped = true;
    clearTimeout(this.timer);
    clearInterval(this.maintenanceTimer);
    await this.running;
    await this.maintenance;
  }
  private async context(client: PoolClient, job: Delivery) {
    await client.query(
      "SELECT set_config('app.actor_id',$1,true),set_config('app.organization_id',$2,true),set_config('app.worker','true',true),set_config('app.delivery_id',$3,true),set_config('app.delivery_lease_token',$4,true)",
      [job.requested_by, job.organization_id, job.id, job.lease_token],
    );
  }
  async tick(): Promise<void> {
    const job = await this.database.internal(
      async (client) =>
        (
          await client.query<Delivery>(
            'SELECT * FROM app_private.claim_invitation_delivery()',
          )
        ).rows[0],
    );
    if (!job) return;
    let prepared: Prepared | undefined;
    try {
      prepared = await this.prepare(job);
      if (!prepared) return;
      const userId = await this.auth.deliver(
        prepared.email,
        job.invitation_id,
        prepared.token,
        prepared.generation,
      );
      await this.finish(job, 'SENT', null, userId, prepared.generation);
    } catch (error) {
      const deliveryError =
        error instanceof InvitationDeliveryError
          ? error
          : new InvitationDeliveryError(
              'DELIVERY_RECONCILE_REQUIRED',
              true,
              true,
            );
      const retry = deliveryError.retryable && job.attempt_count < 3;
      try {
        await this.finish(
          job,
          retry ? (deliveryError.uncertain ? 'UNCERTAIN' : 'QUEUED') : 'FAILED',
          deliveryError.code,
          null,
          prepared?.generation,
        );
      } catch {
        /* An expired lease is recovered by the next claimant, never by this worker. */
      }
    }
  }
  private async prepare(job: Delivery): Promise<Prepared | undefined> {
    return this.database.internal(async (client) => {
      await this.context(client, job);
      const allowed = (
        await client.query(
          'SELECT app_private.can_admin($1::uuid) AS allowed',
          [job.organization_id],
        )
      ).rows[0]?.allowed;
      if (!allowed) {
        await this.terminal(client, job, 'CANCELLED', 'PERMISSION_REVOKED');
        return undefined;
      }
      // Same lock order as archive, invitation edits and acceptance.
      await client.query(
        'SELECT id FROM app.organizations WHERE id=$1 FOR UPDATE',
        [job.organization_id],
      );
      const invitation = (
        await client.query(
          'SELECT * FROM app.organization_invitations WHERE id=$1 FOR UPDATE',
          [job.invitation_id],
        )
      ).rows[0];
      const current = (
        await client.query(
          'SELECT state,lease_token FROM app.invitation_deliveries WHERE id=$1 FOR UPDATE',
          [job.id],
        )
      ).rows[0];
      if (
        !current ||
        current.state !== 'RUNNING' ||
        current.lease_token !== job.lease_token
      )
        return undefined;
      if (
        !invitation ||
        invitation.accepted_at ||
        invitation.revoked_at ||
        new Date(invitation.expires_at).getTime() <= Date.now()
      ) {
        await this.terminal(client, job, 'CANCELLED', 'INVITATION_UNAVAILABLE');
        return undefined;
      }
      if (job.attempt_count > 3) {
        await this.terminal(client, job, 'FAILED', 'RETRY_LIMIT');
        return undefined;
      }
      // Reconciliation of uncertain/lost work precedes retry: observe current
      // invitation and authority, then invalidate the earlier credential. The
      // provider may deliver two emails; only the latest generation can act.
      const token = randomBytes(32).toString('base64url');
      const generation = Number(invitation.generation) + 1;
      await client.query(
        `UPDATE app.organization_invitations SET token_digest=$2,generation=$3,revision=revision+1,updated_at=now() WHERE id=$1`,
        [job.invitation_id, digest(token), generation],
      );
      return { email: invitation.email_normalized, token, generation };
    });
  }
  private async terminal(
    client: PoolClient,
    job: Delivery,
    state: string,
    code: string | null,
    userId: string | null = null,
  ) {
    // Update predicates fence a slow worker after a lease is reclaimed.
    const updated = await client.query(
      `UPDATE app.invitation_deliveries SET state=$3,last_error_code=$4,auth_user_id=coalesce($5,auth_user_id),lease_until=NULL,updated_at=now() WHERE id=$1 AND lease_token=$2 AND state='RUNNING'`,
      [job.id, job.lease_token, state, code, userId],
    );
    if (updated.rowCount) await this.recordOutcome(client, job, state, code);
  }
  private async recordOutcome(
    client: PoolClient,
    job: Delivery,
    state: string,
    code: string | null,
  ) {
    await client.query(
      `INSERT INTO app.audit_events(organization_id,actor_id,actor_kind,action,entity_type,entity_id,result,correlation_id,safe_changes) VALUES($1,$2,'SYSTEM','invitation.delivery_finished','invitation',$3,$4,$5,$6::jsonb)`,
      [
        job.organization_id,
        job.requested_by,
        job.invitation_id,
        state,
        job.correlation_id,
        JSON.stringify({ attempt: job.attempt_count, code }),
      ],
    );
  }
  private async finish(
    job: Delivery,
    state: string,
    code: string | null,
    userId: string | null,
    generation?: number,
  ) {
    await this.database.internal(async (client) => {
      await this.context(client, job);
      const permission = (
        await client.query(
          'SELECT app_private.can_admin($1::uuid) AS allowed',
          [job.organization_id],
        )
      ).rows[0]?.allowed;
      if (!permission) {
        await this.terminal(
          client,
          job,
          'CANCELLED',
          'PERMISSION_REVOKED',
          userId,
        );
        return;
      }
      await client.query(
        'SELECT id FROM app.organizations WHERE id=$1 FOR UPDATE',
        [job.organization_id],
      );
      const invitation = (
        await client.query(
          'SELECT accepted_at,revoked_at,expires_at,generation FROM app.organization_invitations WHERE id=$1 FOR UPDATE',
          [job.invitation_id],
        )
      ).rows[0];
      const unavailable =
        !invitation ||
        invitation.accepted_at ||
        invitation.revoked_at ||
        new Date(invitation.expires_at).getTime() <= Date.now() ||
        (generation !== undefined && invitation.generation !== generation);
      if (unavailable) {
        await this.terminal(
          client,
          job,
          'CANCELLED',
          'INVITATION_UNAVAILABLE',
          userId,
        );
        return;
      }
      if (state === 'QUEUED' || state === 'UNCERTAIN') {
        const updated = await client.query(
          `UPDATE app.invitation_deliveries SET state=$3,last_error_code=$4,available_at=now()+interval '1 minute',lease_until=NULL,updated_at=now() WHERE id=$1 AND lease_token=$2 AND state='RUNNING'`,
          [job.id, job.lease_token, state, code],
        );
        if (updated.rowCount)
          await this.recordOutcome(client, job, state, code);
      } else await this.terminal(client, job, state, code, userId);
    });
  }
}
