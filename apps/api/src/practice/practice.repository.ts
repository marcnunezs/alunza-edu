import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  runExecutionSchema,
  runTechnicalResultSchema,
} from '@alunza/contracts';
import type { RunExecutionInput, RunTechnicalResult } from '@alunza/contracts';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import { digest } from '../governance/governance.shared';
import type { Actor } from '../governance/governance.shared';
import { ApiError, notFound } from '../http/errors';
import type { VisibleTest } from './execution.port';
import { runContextSchema } from './practice-context';

const reservationSchema = z.object({
  executionId: z.uuid(),
  exerciseVersionId: z.uuid(),
  organizationId: z.uuid(),
  studentId: z.uuid(),
  admittedAt: z.iso.datetime({ offset: true }),
  leaseToken: z.uuid(),
  visibleTotal: z.number().int().min(1).max(8),
  runnerVersion: z.string().min(1).max(100),
});
export type RunReservation = z.infer<typeof reservationSchema>;
const admissionSchema = z.discriminatedUnion('kind', [
  reservationSchema.extend({ kind: z.literal('reserved') }),
  z.object({ kind: z.literal('replay'), response: runExecutionSchema }),
]);
export interface RunContext {
  organizationId: string;
  tests: VisibleTest[];
  suiteHash: string;
  limits: { memoryBytes: number; runtimeMs: number; outputBytes: number };
}
export interface RunQuotas {
  actorConcurrency: number;
  organizationConcurrency: number;
  actorRequestsPerMinute: number;
}

@Injectable()
export class PracticeRepository {
  constructor(private readonly database: DatabaseService) {}

  private async context(
    client: PoolClient,
    activityId: string,
    assignmentId: string,
    versionId: string,
  ): Promise<RunContext> {
    const { rows } = await client.query(
      'SELECT app_private.practice_run_context($1::uuid,$2::uuid) AS context',
      [activityId, assignmentId],
    );
    if (!rows[0]?.context) throw notFound();
    const context = runContextSchema.parse(rows[0].context);
    if (context.exerciseVersionId !== versionId)
      throw new ApiError(
        'VERSION_CONFLICT',
        'La versión del ejercicio cambió. Recarga la actividad.',
        409,
      );
    return {
      organizationId: context.organizationId,
      tests: context.tests,
      limits: context.limits,
      suiteHash: digest(JSON.stringify(context.tests)),
    };
  }

  authorize(
    who: Actor,
    activityId: string,
    assignmentId: string,
    versionId: string,
  ) {
    return this.database.readAs(
      who.actorId,
      (client) => this.context(client, activityId, assignmentId, versionId),
      who.sessionId,
    );
  }

  admit(
    who: Actor,
    activityId: string,
    assignmentId: string,
    input: RunExecutionInput,
    key: string,
    runner: { available: boolean; runnerVersion: string },
    quotas: RunQuotas,
  ) {
    return this.database.writeAs(
      who.actorId,
      async (client) => {
        const context = await this.context(
          client,
          activityId,
          assignmentId,
          input.exerciseVersionId,
        );
        await client.query("SELECT set_config('app.organization_id',$1,true)", [
          context.organizationId,
        ]);
        const { rows } = await client.query(
          'SELECT app_private.admit_practice_run($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8,$9,$10,$11::uuid,$12,$13,$14,$15) AS admission',
          [
            randomUUID(),
            activityId,
            assignmentId,
            input.exerciseVersionId,
            key,
            digest(
              JSON.stringify({
                activityId,
                assignmentId,
                exerciseVersionId: input.exerciseVersionId,
                code: input.code,
              }),
            ),
            digest(input.code),
            context.suiteHash,
            context.tests.length,
            runner.runnerVersion,
            who.requestId,
            runner.available,
            quotas.actorConcurrency,
            quotas.organizationConcurrency,
            quotas.actorRequestsPerMinute,
          ],
        );
        return {
          admission: admissionSchema.parse(rows[0]?.admission),
          context,
        };
      },
      who.sessionId,
    );
  }

  finish(
    reservation: RunReservation,
    result: RunTechnicalResult,
    cleanupVerified: boolean,
  ) {
    const validatedResult = runTechnicalResultSchema.parse(result);
    return this.database.internal(async (client) => {
      const { rows } = await client.query(
        'SELECT app_private.finish_practice_run($1::uuid,$2::uuid,$3::jsonb,$4) AS response',
        [
          reservation.executionId,
          reservation.leaseToken,
          JSON.stringify(validatedResult),
          cleanupVerified,
        ],
      );
      return rows[0]?.response == null
        ? null
        : runExecutionSchema.parse(rows[0].response);
    });
  }

  claimExpired() {
    return this.database.internal(async (client) => {
      const { rows } = await client.query(
        'SELECT app_private.claim_expired_practice_run() AS reservation',
      );
      return rows[0]?.reservation == null
        ? null
        : reservationSchema.parse(rows[0].reservation);
    });
  }

  purgeExpired() {
    return this.database.internal(async (client) => {
      await client.query('SELECT app_private.purge_practice_responses()');
    });
  }
}
