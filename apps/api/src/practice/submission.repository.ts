import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  activityProgressSchema,
  attemptSchema,
  attemptSummarySchema,
  submitTechnicalResultSchema,
} from '@alunza/contracts';
import type { AttemptListQuery, SubmitAttemptInput } from '@alunza/contracts';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import { digest } from '../governance/governance.shared';
import type { Actor } from '../governance/governance.shared';
import { ApiError, notFound } from '../http/errors';
import type { CanonicalSubmissionResult } from './submission-execution.port';
import type { AppConfig } from '../config';

const reservationSchema = z.object({
  executionId: z.uuid(),
  exerciseVersionId: z.uuid(),
  organizationId: z.uuid(),
  studentId: z.uuid(),
  admittedAt: z.iso.datetime({ offset: true }),
  leaseToken: z.uuid(),
  visibleTotal: z.number().int().min(1).max(8),
  runnerVersion: z.string().min(1).max(100),
  testsVersion: z.string().regex(/^[a-f0-9]{64}$/),
  attemptNumber: z.number().int().positive(),
  stagedResult: z.boolean().optional(),
});
export type SubmissionReservation = z.infer<typeof reservationSchema>;
const admissionSchema = z.discriminatedUnion('kind', [
  reservationSchema.extend({ kind: z.literal('reserved') }),
  z.object({ kind: z.literal('replay'), response: attemptSchema }),
]);
const suiteSchema = z.strictObject({
  testsVersion: z.string().regex(/^[a-f0-9]{64}$/),
  tests: z
    .array(
      z.strictObject({
        id: z.string().min(1).max(100),
        visibility: z.enum(['visible', 'hidden']),
        args: z.array(z.json()),
        expected: z.json(),
      }),
    )
    .min(1)
    .max(8),
});
const historySchema = z.strictObject({
  items: z.array(attemptSummarySchema).max(20),
  nextCursor: z.string().nullable(),
});
const privateResultsSchema = z
  .array(
    z.strictObject({
      id: z.string().min(1).max(100),
      passed: z.boolean(),
    }),
  )
  .max(8);

@Injectable()
export class SubmissionRepository {
  constructor(private readonly database: DatabaseService) {}

  private async context(
    client: PoolClient,
    activityId: string,
    assignmentId: string,
    versionId: string,
  ) {
    // RLS on both relations and academic_student validate the current session,
    // active profile, institution role and class membership in one statement.
    // No permission result survives the transaction or is cached across requests.
    const { rows } = await client.query<{
      organization_id: string;
      exercise_version_id: string;
    }>(
      `SELECT a.organization_id,ae.exercise_version_id
       FROM app.activities a
       JOIN app.activity_exercises ae ON ae.activity_id=a.id AND ae.organization_id=a.organization_id
       WHERE a.id=$1 AND ae.id=$2 AND app_private.academic_student(a.class_id)`,
      [activityId, assignmentId],
    );
    const assigned = rows[0];
    if (!assigned) throw notFound();
    if (assigned.exercise_version_id !== versionId)
      throw new ApiError(
        'VERSION_CONFLICT',
        'La versión del ejercicio cambió. Recarga la actividad.',
        409,
      );
    return assigned.organization_id;
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
    input: SubmitAttemptInput,
    key: string,
    runner: { available: boolean; runnerVersion: string },
    quotas: AppConfig['practiceQuotas'],
  ) {
    return this.database.writeAs(
      who.actorId,
      async (client) => {
        // Each transaction starts with an empty organization context. Resolve
        // it again here; the earlier read-only authorization cannot carry it.
        const organizationId = await this.context(
          client,
          activityId,
          assignmentId,
          input.exerciseVersionId,
        );
        await client.query("SELECT set_config('app.organization_id',$1,true)", [
          organizationId,
        ]);
        const { rows } = await client.query(
          'SELECT app_private.admit_practice_submit($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8::uuid,$9,$10::uuid,$11,$12,$13,$14) AS admission',
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
                previousAttemptId: input.previousAttemptId ?? null,
              }),
            ),
            input.code,
            input.previousAttemptId ?? null,
            runner.runnerVersion,
            who.requestId,
            runner.available,
            quotas.submitActorConcurrency,
            quotas.organizationConcurrency,
            quotas.actorRequestsPerMinute,
          ],
        );
        return admissionSchema.parse(rows[0]?.admission);
      },
      who.sessionId,
    );
  }

  suite(reservation: SubmissionReservation) {
    return this.database.internal(async (client) => {
      const { rows } = await client.query(
        'SELECT app_private.load_practice_submit_suite($1::uuid,$2::uuid) AS suite',
        [reservation.executionId, reservation.leaseToken],
      );
      const suite = suiteSchema.parse(rows[0]?.suite);
      if (
        suite.testsVersion !== reservation.testsVersion ||
        suite.tests.filter((test) => test.visibility === 'visible').length !==
          reservation.visibleTotal ||
        new Set(suite.tests.map((test) => test.id)).size !== suite.tests.length
      )
        throw new ApiError(
          'DEPENDENCY_UNAVAILABLE',
          'No se pudo validar la ejecución.',
          503,
          true,
        );
      return suite;
    });
  }

  stage(reservation: SubmissionReservation, result: CanonicalSubmissionResult) {
    const technical = submitTechnicalResultSchema.parse(result.technicalResult);
    const privateResults = privateResultsSchema.parse(
      result.privateTestResults,
    );
    return this.database.internal(async (client) => {
      const { rows } = await client.query(
        'SELECT app_private.stage_practice_submit_result($1::uuid,$2::uuid,$3::jsonb,$4::jsonb) AS stored',
        [
          reservation.executionId,
          reservation.leaseToken,
          JSON.stringify(technical),
          JSON.stringify(privateResults),
        ],
      );
      return rows[0]?.stored === true;
    });
  }

  finish(reservation: SubmissionReservation, cleanupVerified: boolean) {
    return this.database.internal(async (client) => {
      const { rows } = await client.query(
        'SELECT app_private.finish_practice_submit($1::uuid,$2::uuid,$3) AS response',
        [reservation.executionId, reservation.leaseToken, cleanupVerified],
      );
      return rows[0]?.response == null
        ? null
        : attemptSchema.parse(rows[0].response);
    });
  }

  claimExpired() {
    return this.database.internal(async (client) => {
      const { rows } = await client.query(
        'SELECT app_private.claim_expired_practice_submit() AS reservation',
      );
      return rows[0]?.reservation == null
        ? null
        : reservationSchema.parse(rows[0].reservation);
    });
  }

  purgeExpired() {
    return this.database.internal(async (client) => {
      await client.query('SELECT app_private.purge_submit_responses()');
    });
  }

  detail(who: Actor, attemptId: string) {
    return this.database.readAs(
      who.actorId,
      async (client) => {
        const { rows } = await client.query(
          'SELECT app_private.read_practice_attempt($1::uuid) AS attempt',
          [attemptId],
        );
        if (rows[0]?.attempt == null) throw notFound();
        return attemptSchema.parse(rows[0].attempt);
      },
      who.sessionId,
    );
  }

  list(
    who: Actor,
    activityId: string,
    assignmentId: string,
    query: AttemptListQuery,
  ) {
    return this.database.readAs(
      who.actorId,
      async (client) => {
        const { rows } = await client.query(
          'SELECT app_private.list_practice_attempts($1::uuid,$2::uuid,$3::bigint,$4) AS history',
          [activityId, assignmentId, query.cursor ?? null, query.limit],
        );
        const history = historySchema.parse(rows[0]?.history);
        return {
          data: history.items,
          page: {
            nextCursor: history.nextCursor,
            hasMore: history.nextCursor !== null,
          },
        };
      },
      who.sessionId,
    );
  }

  progress(who: Actor, activityId: string) {
    return this.database.readAs(
      who.actorId,
      async (client) => {
        const { rows } = await client.query(
          'SELECT app_private.practice_activity_progress($1::uuid) AS progress',
          [activityId],
        );
        return activityProgressSchema.parse(rows[0]?.progress);
      },
      who.sessionId,
    );
  }
}
