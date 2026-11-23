import { Injectable } from '@nestjs/common';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type {
  DockerCleanupEvidence,
  DockerPreparedPair,
  DockerPreparedResourcePort,
  PreparedDockerContext,
} from '@alunza/runner';
import { DatabaseService } from '../database/database.service';
import { configuredDockerExecutionContextSchema } from './execution.port';

const uuid = z.uuid();
const containerId = z.string().regex(/^[a-f0-9]{64}$/);
const slotSchema = z
  .strictObject({
    resourceId: uuid,
    name: z.string().regex(/^alunza-laboratorio-runner-[a-f0-9-]{36}$/),
    containerId: containerId.nullable(),
    creationState: z.enum(['PREPARED', 'UNKNOWN', 'CONFIRMED']),
    cleanupState: z.enum(['PENDING', 'VERIFIED']),
  })
  .refine(
    (slot) =>
      (slot.creationState === 'CONFIRMED') === (slot.containerId !== null),
  );
export const dockerPreparedPairSchema = z
  .strictObject({
    pairId: uuid,
    context: configuredDockerExecutionContextSchema,
    ownerToken: uuid,
    creatorToken: uuid,
    recoveryOnly: z.boolean(),
    leaseExpiresAt: z.iso.datetime({ offset: true }),
    expiresAt: z.iso.datetime({ offset: true }),
    state: z.enum(['PREPARING', 'READY', 'ASSIGNED', 'RETIRED']),
    executionId: uuid.nullable(),
    slots: z.tuple([slotSchema, slotSchema]),
  })
  .refine(
    (pair) =>
      pair.slots[0].resourceId !== pair.slots[1].resourceId &&
      (!pair.slots[0].containerId ||
        pair.slots[0].containerId !== pair.slots[1].containerId) &&
      pair.slots.every(
        (slot) => slot.name === `alunza-laboratorio-runner-${slot.resourceId}`,
      ),
    'Prepared capsule identity mismatch',
  );
const cleanupEvidenceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('NOT_DISPATCHED') }),
  z.strictObject({ kind: z.literal('ABSENT'), containerId }),
]);

function requireMatch(value: unknown, expected: unknown) {
  if (!isDeepStrictEqual(value, expected))
    throw new Error('Docker resource context mismatch');
}

/** Each transition commits under the private SQL functions before Docker proceeds. */
@Injectable()
export class DockerPreparedResourceRepository implements DockerPreparedResourcePort {
  constructor(private readonly database: DatabaseService) {}

  private call(sql: string, values: unknown[]) {
    return this.database.internal(async (client) => {
      const { rows } = await client.query<{ value: unknown }>(sql, values);
      return rows[0]?.value;
    });
  }

  async reservePair(context: PreparedDockerContext, ownerToken: string) {
    const supplied = configuredDockerExecutionContextSchema.parse(context);
    const result = await this.call(
      'SELECT app_private.docker_reserve_pair($1::jsonb,$2::uuid) AS value',
      [JSON.stringify(supplied), uuid.parse(ownerToken)],
    );
    if (result == null) return null;
    const pair = dockerPreparedPairSchema.parse(result);
    requireMatch(pair.context, supplied);
    requireMatch(pair.ownerToken, ownerToken);
    requireMatch(pair.creatorToken, ownerToken);
    requireMatch(pair.recoveryOnly, false);
    return pair;
  }

  async authorizeCreate(
    pairId: string,
    resourceId: string,
    ownerToken: string,
  ) {
    await this.call(
      'SELECT app_private.docker_authorize_create($1::uuid,$2::uuid,$3::uuid) AS value',
      [uuid.parse(pairId), uuid.parse(resourceId), uuid.parse(ownerToken)],
    );
  }

  async confirmCreated(pairId: string, resourceId: string, id: string) {
    await this.call(
      'SELECT app_private.docker_confirm_created($1::uuid,$2::uuid,$3) AS value',
      [uuid.parse(pairId), uuid.parse(resourceId), containerId.parse(id)],
    );
  }

  async markPairReady(pairId: string, ownerToken: string) {
    await this.call(
      'SELECT app_private.docker_mark_pair_ready($1::uuid,$2::uuid) AS value',
      [uuid.parse(pairId), uuid.parse(ownerToken)],
    );
  }

  async assignPair(
    pairId: string,
    ownerToken: string,
    executionId: string,
    executionLeaseToken: string,
  ): Promise<DockerPreparedPair> {
    const pair = dockerPreparedPairSchema.parse(
      await this.call(
        'SELECT app_private.docker_assign_pair($1::uuid,$2::uuid,$3::uuid,$4::uuid) AS value',
        [
          uuid.parse(pairId),
          uuid.parse(ownerToken),
          uuid.parse(executionId),
          uuid.parse(executionLeaseToken),
        ],
      ),
    );
    requireMatch(
      [pair.pairId, pair.ownerToken, pair.executionId, pair.state],
      [pairId, ownerToken, executionId, 'ASSIGNED'],
    );
    requireMatch(pair.recoveryOnly, false);
    return pair;
  }

  async assertAssignment(
    pairId: string,
    resourceId: string,
    ownerToken: string,
    executionId: string,
    executionLeaseToken: string,
  ) {
    await this.call(
      'SELECT app_private.docker_assert_assignment($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid) AS value',
      [pairId, resourceId, ownerToken, executionId, executionLeaseToken].map(
        (value) => uuid.parse(value),
      ),
    );
  }

  async markClean(
    pairId: string,
    resourceId: string,
    evidence: DockerCleanupEvidence,
  ) {
    await this.call(
      'SELECT app_private.docker_mark_clean($1::uuid,$2::uuid,$3::jsonb) AS value',
      [
        uuid.parse(pairId),
        uuid.parse(resourceId),
        JSON.stringify(cleanupEvidenceSchema.parse(evidence)),
      ],
    );
  }

  async releasePair(pairId: string, ownerToken: string) {
    await this.call(
      'SELECT app_private.docker_release_pair($1::uuid,$2::uuid) AS value',
      [uuid.parse(pairId), uuid.parse(ownerToken)],
    );
  }

  async listExecutionPairs(
    executionId: string,
    context: PreparedDockerContext,
  ) {
    const supplied = configuredDockerExecutionContextSchema.parse(context);
    const pairs = z
      .array(dockerPreparedPairSchema)
      .parse(
        await this.call(
          'SELECT app_private.docker_list_execution_pairs($1::uuid,$2::jsonb) AS value',
          [uuid.parse(executionId), JSON.stringify(supplied)],
        ),
      );
    for (const pair of pairs) {
      requireMatch(pair.context, supplied);
      requireMatch(pair.executionId, executionId);
    }
    return pairs;
  }

  async claimRecovery(context: PreparedDockerContext, ownerToken: string) {
    const supplied = configuredDockerExecutionContextSchema.parse(context);
    const pairs = z
      .array(dockerPreparedPairSchema)
      .parse(
        await this.call(
          'SELECT app_private.docker_claim_recovery($1::jsonb,$2::uuid) AS value',
          [JSON.stringify(supplied), uuid.parse(ownerToken)],
        ),
      );
    for (const pair of pairs) {
      requireMatch(pair.context.engineId, supplied.engineId);
      requireMatch(pair.ownerToken, ownerToken);
      requireMatch(pair.recoveryOnly, true);
    }
    return pairs;
  }

  async assertActive(
    executionId: string,
    leaseToken: string,
    context: PreparedDockerContext,
  ) {
    await this.call(
      'SELECT app_private.docker_assert_execution($1::uuid,$2::uuid,$3::jsonb) AS value',
      [
        uuid.parse(executionId),
        uuid.parse(leaseToken),
        JSON.stringify(configuredDockerExecutionContextSchema.parse(context)),
      ],
    );
  }

  async recoveryContexts(engineId: string) {
    const engine =
      configuredDockerExecutionContextSchema.shape.engineId.parse(engineId);
    const contexts = z
      .array(configuredDockerExecutionContextSchema)
      .max(1)
      .parse(
        await this.call(
          'SELECT app_private.docker_recovery_contexts($1) AS value',
          [engine],
        ),
      );
    for (const context of contexts) requireMatch(context.engineId, engine);
    return contexts;
  }
}
