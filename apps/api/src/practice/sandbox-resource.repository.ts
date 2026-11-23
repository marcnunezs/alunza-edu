import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { DatabaseService } from '../database/database.service';
import { executionContextSchema } from './execution.port';

export const sandboxCleanupProofSchema = z.discriminatedUnion('kind', [
  z.strictObject({ creationId: z.uuid(), kind: z.literal('NOT_DISPATCHED') }),
  z.strictObject({
    creationId: z.uuid(),
    kind: z.literal('ABSENT_AND_ZERO_SNAPSHOTS'),
    sandboxId: z.string().min(1).max(200),
    lookupAbsent: z.literal(true),
    snapshotsRemaining: z.literal(0),
    observedAt: z.iso.datetime({ offset: true }),
  }),
]);
export type SandboxCleanupProof = z.infer<typeof sandboxCleanupProofSchema>;
export const sandboxResourceSchema = z.strictObject({
  executionId: z.uuid(),
  creationId: z.uuid(),
  sandboxName: z.string().regex(/^alunza-practice-[a-f0-9-]{36}$/),
  providerResourceId: z.string().min(1).max(200).nullable(),
  creationState: z.enum(['PREPARED', 'UNKNOWN', 'CONFIRMED']),
  cleanupState: z.enum(['PENDING', 'VERIFIED']),
  context: executionContextSchema.options[1],
  cleanupProof: sandboxCleanupProofSchema.nullable(),
});
export type SandboxResource = z.infer<typeof sandboxResourceSchema>;

/** The claim and this read share one transaction; no live config replaces admission. */
export async function loadReservationExecutionContext(
  client: PoolClient,
  executionId: string,
) {
  const { rows } = await client.query(
    'SELECT app_private.read_practice_execution_context($1::uuid) AS context',
    [executionId],
  );
  return rows[0]?.context == null
    ? undefined
    : executionContextSchema.parse(rows[0].context);
}

@Injectable()
export class SandboxResourceRepository {
  constructor(private readonly database: DatabaseService) {}

  loadContext(executionId: string) {
    return this.database.internal((client) =>
      loadReservationExecutionContext(client, executionId),
    );
  }

  load(executionId: string): Promise<SandboxResource | null> {
    return this.database.internal(async (client) => {
      const { rows } = await client.query(
        'SELECT app_private.load_sandbox_resource($1::uuid) AS resource',
        [executionId],
      );
      return rows[0]?.resource == null
        ? null
        : sandboxResourceSchema.parse(rows[0].resource);
    });
  }

  beginCreation(
    executionId: string,
    leaseToken: string,
  ): Promise<SandboxResource> {
    return this.database.internal(async (client) => {
      const { rows } = await client.query(
        'SELECT app_private.begin_sandbox_creation($1::uuid,$2::uuid) AS resource',
        [executionId, leaseToken],
      );
      return sandboxResourceSchema.parse(rows[0]?.resource);
    });
  }

  confirmResource(
    executionId: string,
    creationId: string,
    sandboxId: string,
  ): Promise<SandboxResource> {
    return this.database.internal(async (client) => {
      const { rows } = await client.query(
        'SELECT app_private.confirm_sandbox_resource($1::uuid,$2::uuid,$3) AS resource',
        [executionId, creationId, z.string().min(1).max(200).parse(sandboxId)],
      );
      return sandboxResourceSchema.parse(rows[0]?.resource);
    });
  }

  assertActive(executionId: string, leaseToken: string): Promise<void> {
    return this.database.internal(async (client) => {
      await client.query(
        'SELECT app_private.assert_sandbox_active($1::uuid,$2::uuid)',
        [executionId, leaseToken],
      );
    });
  }

  consumeRequest(
    executionId: string,
    creationId: string,
    cleanup: boolean,
  ): Promise<void> {
    return this.database.internal(async (client) => {
      await client.query(
        'SELECT app_private.consume_sandbox_request($1::uuid,$2::uuid,$3)',
        [executionId, creationId, cleanup],
      );
    });
  }

  verifyCleanup(
    executionId: string,
    proof: SandboxCleanupProof,
  ): Promise<void> {
    const validated = sandboxCleanupProofSchema.parse(proof);
    return this.database.internal(async (client) => {
      await client.query(
        'SELECT app_private.verify_sandbox_cleanup($1::uuid,$2::jsonb)',
        [executionId, JSON.stringify(validated)],
      );
    });
  }
}
