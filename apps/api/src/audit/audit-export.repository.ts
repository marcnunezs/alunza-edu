import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { AuditExportRequest } from '@alunza/contracts';
import { DatabaseService } from '../database/database.service';
import type { Actor } from '../governance/governance.shared';
import { auditExportError } from './audit-export-errors';

@Injectable()
export class AuditExportRepository {
  constructor(private readonly database: DatabaseService) {}
  private async scalar(
    client: PoolClient,
    sql: string,
    values: unknown[],
  ): Promise<unknown> {
    try {
      return (await client.query<{ data: unknown }>(sql, values)).rows[0]?.data;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'P0001') {
        const safe = auditExportError(error.message);
        if (safe) throw safe;
      }
      throw error;
    }
  }
  private as(who: Actor, sql: string, values: unknown[], readOnly = false) {
    const action = (client: PoolClient) => this.scalar(client, sql, values);
    return readOnly
      ? this.database.readAs(who.actorId, action, who.sessionId)
      : this.database.writeAs(who.actorId, action, who.sessionId);
  }
  authorize(who: Actor, org: string) {
    return this.as(
      who,
      'SELECT app_private.audit_export_authorize($1::uuid) AS data',
      [org],
      true,
    );
  }
  reserve(who: Actor, org: string, key: string, filters: AuditExportRequest) {
    return this.as(
      who,
      'SELECT app_private.audit_export_reserve($1::uuid,$2::text,$3::jsonb) AS data',
      [org, key, JSON.stringify(filters)],
    );
  }
  capture(who: Actor, org: string, id: string, token: string) {
    return this.as(
      who,
      'SELECT app_private.audit_export_capture($1::uuid,$2::uuid,$3::uuid) AS data',
      [org, id, token],
    );
  }
  finish(
    who: Actor,
    org: string,
    id: string,
    token: string,
    snapshotAt: string,
    bytes: Buffer,
    rowCount: number,
    sha256: string,
  ) {
    return this.as(
      who,
      'SELECT app_private.audit_export_finish($1::uuid,$2::uuid,$3::uuid,$4::timestamptz,$5::bytea,$6::integer,$7::text) AS data',
      [org, id, token, snapshotAt, bytes, rowCount, sha256],
    );
  }
  metadata(who: Actor, org: string, id: string) {
    return this.as(
      who,
      'SELECT app_private.audit_export_metadata($1::uuid,$2::uuid) AS data',
      [org, id],
      true,
    );
  }
  content(who: Actor, org: string, id: string) {
    return this.database.readAs(
      who.actorId,
      async (client) => {
        try {
          return (
            await client.query<{ metadata: unknown; content: Buffer }>(
              'SELECT * FROM app_private.audit_export_content($1::uuid,$2::uuid)',
              [org, id],
            )
          ).rows[0];
        } catch (error) {
          if (
            error instanceof Error &&
            'code' in error &&
            error.code === 'P0001'
          ) {
            const safe = auditExportError(error.message);
            if (safe) throw safe;
          }
          throw error;
        }
      },
      who.sessionId,
    );
  }
  beginDelivery(who: Actor, org: string, id: string) {
    return this.as(
      who,
      'SELECT app_private.audit_export_delivery_begin($1::uuid,$2::uuid) AS data',
      [org, id],
    );
  }
  fail(id: string, token: string, code: string, status: number) {
    return this.database.internal((client) =>
      this.scalar(
        client,
        'SELECT app_private.audit_export_fail($1::uuid,$2::uuid,$3::text,$4::integer) AS data',
        [id, token, code, status],
      ),
    );
  }
  finishDelivery(
    ticketId: string,
    ticketToken: string,
    outcome: 'FINISHED' | 'ABORTED',
  ) {
    return this.database.internal((client) =>
      this.scalar(
        client,
        'SELECT app_private.audit_export_delivery_finish($1::uuid,$2::uuid,$3::text) AS data',
        [ticketId, ticketToken, outcome],
      ),
    );
  }
  maintain() {
    return this.database.internal((client) =>
      this.scalar(
        client,
        'SELECT app_private.audit_export_maintain() AS data',
        [],
      ),
    );
  }
}
