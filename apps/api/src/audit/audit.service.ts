import { Injectable } from '@nestjs/common';
import type { AuditQuery } from '@alunza/contracts';
import { DatabaseService } from '../database/database.service';
import type { Actor } from '../governance/governance.shared';
import { ApiError } from '../http/errors';

@Injectable()
export class AuditService {
  constructor(private readonly database: DatabaseService) {}

  list(
    who: Actor,
    organizationId: string,
    query: AuditQuery,
  ): Promise<unknown> {
    return this.database.readAs(
      who.actorId,
      async (client) => {
        try {
          const result = await client.query<{ data: unknown }>(
            'SELECT app_private.audit_events_list($1::uuid,$2::jsonb) AS data',
            [organizationId, JSON.stringify(query)],
          );
          return result.rows[0]?.data;
        } catch (error) {
          // This reader uses a field-validation response; existing progress
          // readers retain their historical 400 mapping for the same SQL guard.
          if (
            error instanceof Error &&
            'code' in error &&
            error.code === 'P0001' &&
            error.message === 'INVALID_PROGRESS_CUTOFF'
          ) {
            throw new ApiError(
              'VALIDATION_FAILED',
              'Revisa los campos de la solicitud.',
              422,
              false,
              [
                {
                  field: 'asOf',
                  message: 'La fecha de corte no puede estar en el futuro.',
                },
              ],
            );
          }
          throw error;
        }
      },
      who.sessionId,
    );
  }
}
