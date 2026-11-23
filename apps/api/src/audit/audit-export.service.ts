import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  auditEventSchema,
  auditExportMetadataSchema,
  AUDIT_EXPORT_MAX_ROWS,
} from '@alunza/contracts';
import type { AuditExportRequest } from '@alunza/contracts';
import type { Actor } from '../governance/governance.shared';
import { ApiError, databaseUnavailable } from '../http/errors';
import { AuditExportRepository } from './audit-export.repository';
import { AuditExportAdmission } from './audit-export-admission';
import { auditCsv } from './audit-export-csv';
import { auditExportError } from './audit-export-errors';

const claimSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('CLAIMED'),
    exportId: z.uuid(),
    leaseToken: z.uuid(),
  }),
  z.object({ kind: z.literal('READY'), metadata: auditExportMetadataSchema }),
  z.object({
    kind: z.literal('FAILED'),
    error: z.object({ code: z.string() }),
  }),
]);
const captureSchema = z.strictObject({
  snapshotAt: z.iso.datetime({ precision: 6 }),
  items: z.array(auditEventSchema).max(AUDIT_EXPORT_MAX_ROWS + 1),
});
const ticketSchema = z.strictObject({
  ticketId: z.uuid(),
  ticketToken: z.uuid(),
});

@Injectable()
export class AuditExportService {
  constructor(
    private readonly repository: AuditExportRepository,
    private readonly admission: AuditExportAdmission,
  ) {}
  async create(
    who: Actor,
    org: string,
    key: string,
    filters: AuditExportRequest,
  ) {
    await this.repository.authorize(who, org);
    const release = this.admission.acquire();
    try {
      const claim = claimSchema.parse(
        await this.repository.reserve(who, org, key, filters),
      );
      if (claim.kind === 'READY') return claim.metadata;
      if (claim.kind === 'FAILED')
        throw (
          auditExportError(claim.error.code) ??
          auditExportError('AUDIT_EXPORT_FAILED')!
        );
      try {
        const snapshot = captureSchema.parse(
          await this.repository.capture(
            who,
            org,
            claim.exportId,
            claim.leaseToken,
          ),
        );
        const csv = auditCsv(snapshot.items);
        return auditExportMetadataSchema.parse(
          await this.repository.finish(
            who,
            org,
            claim.exportId,
            claim.leaseToken,
            snapshot.snapshotAt,
            csv.bytes,
            csv.rowCount,
            csv.sha256,
          ),
        );
      } catch (error) {
        // Resolve a lost COMMIT response before attempting a terminal transition.
        try {
          return auditExportMetadataSchema.parse(
            await this.repository.metadata(who, org, claim.exportId),
          );
        } catch (observation) {
          if (
            observation instanceof ApiError &&
            observation.code === 'PERSISTENCE_UNAVAILABLE'
          )
            throw observation;
          if (
            observation instanceof ApiError &&
            [
              'AUDIT_EXPORT_FAILED',
              'AUDIT_EXPORT_INTERRUPTED',
              'AUDIT_EXPORT_LIMIT_EXCEEDED',
            ].includes(observation.code)
          )
            throw observation;
          if (
            observation instanceof ApiError &&
            [401, 403, 404, 410].includes(observation.getStatus())
          ) {
            await this.repository
              .fail(
                claim.exportId,
                claim.leaseToken,
                'AUDIT_EXPORT_FAILED',
                503,
              )
              .catch(() => undefined);
            throw observation;
          }
        }
        const failure =
          error instanceof ApiError &&
          error.code === 'AUDIT_EXPORT_LIMIT_EXCEEDED'
            ? error
            : auditExportError('AUDIT_EXPORT_FAILED')!;
        try {
          await this.repository.fail(
            claim.exportId,
            claim.leaseToken,
            failure.code,
            failure.getStatus(),
          );
        } catch {
          throw databaseUnavailable();
        }
        // Maintenance may have won the lease race. Return the durable terminal
        // result, never the locally proposed failure if the fence changed.
        try {
          return auditExportMetadataSchema.parse(
            await this.repository.metadata(who, org, claim.exportId),
          );
        } catch (observation) {
          if (
            observation instanceof ApiError &&
            [
              'AUDIT_EXPORT_FAILED',
              'AUDIT_EXPORT_INTERRUPTED',
              'AUDIT_EXPORT_LIMIT_EXCEEDED',
              'AUDIT_EXPORT_EXPIRED',
              'PERSISTENCE_UNAVAILABLE',
              'UNAUTHENTICATED',
              'ACCOUNT_INACTIVE',
              'FORBIDDEN',
              'RESOURCE_NOT_FOUND',
            ].includes(observation.code)
          )
            throw observation;
          throw databaseUnavailable();
        }
      }
    } finally {
      release();
    }
  }
  async metadata(who: Actor, org: string, id: string) {
    return auditExportMetadataSchema.parse(
      await this.repository.metadata(who, org, id),
    );
  }
  async content(who: Actor, org: string, id: string) {
    await this.repository.authorize(who, org);
    const release = this.admission.acquire();
    try {
      const stored = await this.repository.content(who, org, id);
      if (!stored) throw databaseUnavailable();
      const metadata = auditExportMetadataSchema.parse(stored.metadata);
      if (
        !Buffer.isBuffer(stored.content) ||
        stored.content.length !== metadata.byteLength ||
        createHash('sha256').update(stored.content).digest('hex') !==
          metadata.sha256
      )
        throw databaseUnavailable();
      // This transaction reauthorizes after all buffer I/O and verification.
      const ticket = ticketSchema.parse(
        await this.repository.beginDelivery(who, org, id),
      );
      return { metadata, bytes: stored.content, ticket, release };
    } catch (error) {
      release();
      throw error;
    }
  }
  finishDelivery(
    ticket: { ticketId: string; ticketToken: string },
    outcome: 'FINISHED' | 'ABORTED',
  ) {
    return this.repository.finishDelivery(
      ticket.ticketId,
      ticket.ticketToken,
      outcome,
    );
  }
}
