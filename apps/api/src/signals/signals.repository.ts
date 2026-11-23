import { Injectable } from '@nestjs/common';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { Actor } from '../governance/governance.shared';
import { DatabaseService } from '../database/database.service';
import {
  signalLeaseSchema,
  signalSnapshotSchema,
  signalFinalizationSchema,
  signalMaintenanceScopeSchema,
  signalBoundarySchema,
  signalEpisodeEvidenceSchema,
} from './signals.schemas';
import { evaluateSignalBoundary } from './signal-processing';
import type {
  SignalLease,
  SignalSnapshot,
  SignalEvaluationBatch,
  SignalEpisodeEvidence,
} from './signals.types';

@Injectable()
export class SignalsRepository {
  constructor(private readonly database: DatabaseService) {}

  async claim(laneId?: string): Promise<SignalLease | null> {
    return this.database.internal(async (client) => {
      const { rows } = await client.query(
        'SELECT app_private.signal_claim_job($1::uuid) AS data',
        [laneId ?? null],
      );
      return rows[0]?.data === null
        ? null
        : signalLeaseSchema.parse(rows[0]?.data);
    });
  }

  async renew(job: SignalLease): Promise<boolean> {
    return this.database.internal(async (client) => {
      const { rows } = await client.query(
        'SELECT app_private.signal_renew_job($1::uuid,$2::uuid) AS valid',
        [job.laneId, job.leaseToken],
      );
      return rows[0]?.valid === true;
    });
  }

  async capture(job: SignalLease): Promise<SignalSnapshot | null> {
    // Coverage publication finishes in its own transaction before acquiring
    // shared source clocks. Never upgrade a shared vector lock mid-capture.
    await this.database.internal(async (client) => {
      await client.query('SELECT app_private.signal_verify_capture()');
    });
    let clockRegression = false;
    try {
      return await this.database.internal(async (client) => {
        const { rows } = await client
          .query(
            'SELECT app_private.signal_capture_snapshot($1::uuid,$2::uuid) AS data',
            [job.laneId, job.leaseToken],
          )
          .catch((error: unknown) => {
            clockRegression =
              error instanceof Error &&
              'code' in error &&
              error.code === 'P0001' &&
              error.message === 'CLOCK_REGRESSION';
            throw error;
          });
        if (rows[0]?.data === null) return null;
        const parsed = signalSnapshotSchema.parse(rows[0]?.data);
        if (
          parsed.lane.laneId !== job.laneId ||
          parsed.lane.organizationId !== job.organizationId ||
          parsed.lane.studentId !== job.studentId ||
          parsed.lane.classId !== job.classId ||
          parsed.lane.activityId !== job.activityId ||
          parsed.lane.assignmentId !== job.assignmentId ||
          parsed.lane.type !== job.type
        )
          throw new Error('SIGNAL_CAPTURE_SCOPE_MISMATCH');
        return parsed as SignalSnapshot;
      });
    } catch (error) {
      // The DB service has already rolled back and sanitized SQL failures.
      // Preserve only this allowlisted operational condition for the worker.
      if (clockRegression)
        throw new Error('SIGNAL_CLOCK_REGRESSION', { cause: error });
      throw error;
    }
  }

  async finalize(
    job: SignalLease,
    snapshotId: string,
    batch: SignalEvaluationBatch,
  ) {
    return this.database.internal(async (client) => {
      const { rows } = await client.query(
        'SELECT app_private.signal_finalize_batch($1::uuid,$2::uuid,$3::uuid,$4::jsonb,$5::jsonb) AS data',
        [
          job.laneId,
          job.leaseToken,
          snapshotId,
          JSON.stringify(batch.evaluations),
          JSON.stringify(batch.checkpoint),
        ],
      );
      return signalFinalizationSchema.parse(rows[0]?.data);
    });
  }

  async fail(job: SignalLease, code: 'PROCESSING_FAILED' | 'CLOCK_REGRESSION') {
    await this.database.internal(async (client) => {
      await client.query(
        'SELECT app_private.signal_fail_job($1::uuid,$2::uuid,$3::text)',
        [job.laneId, job.leaseToken, code],
      );
    });
  }

  readEvidence(who: Actor, signalId: string): Promise<SignalEpisodeEvidence> {
    return this.database.readAs(
      who.actorId,
      async (client) => {
        const { rows } = await client.query(
          'SELECT app_private.signal_read_evidence($1::uuid) AS data',
          [signalId],
        );
        return signalEpisodeEvidenceSchema.parse(
          rows[0]?.data,
        ) as SignalEpisodeEvidence;
      },
      who.sessionId,
    );
  }

  async maintenance(mode: 'check' | 'rebuild' | 'report', input: unknown) {
    const scope = signalMaintenanceScopeSchema.parse(input);
    let verifiedEvaluations = 0;
    if (mode !== 'report') {
      const inputs = await this.database.internal(async (client) => {
        const { rows } = await client.query(
          'SELECT app_private.signal_replay_inputs($1::jsonb) AS data',
          [JSON.stringify(scope)],
        );
        return z
          .array(
            z
              .object({
                snapshot: signalSnapshotSchema,
                evaluations: z.array(
                  z
                    .object({
                      identityKey: z.string(),
                      publicationAllowed: z.boolean(),
                      boundary: signalBoundarySchema,
                      result: z.unknown(),
                    })
                    .strict(),
                ),
              })
              .strict(),
          )
          .parse(rows[0]?.data);
      });
      // Replay canonical immutable snapshots, not current domain state. A
      // disagreement stops reconstruction before any derived projection write.
      for (const input of inputs) {
        for (const evaluation of input.evaluations) {
          const actual = evaluateSignalBoundary(
            input.snapshot as SignalSnapshot,
            evaluation.boundary,
          );
          if (!isDeepStrictEqual(actual, evaluation.result))
            throw new Error('SIGNAL_HISTORICAL_RESULT_MISMATCH');
          verifiedEvaluations++;
        }
      }
    }
    return this.database.internal(async (client) => {
      const { rows } = await client.query(
        'SELECT app_private.signal_rebuild($1::text,$2::jsonb) AS data',
        [mode, JSON.stringify(scope)],
      );
      return { ...rows[0]?.data, verifiedEvaluations };
    });
  }

  async resumeFailed(laneId: string): Promise<boolean> {
    const lane = z.uuid().parse(laneId);
    return this.database.internal(async (client) => {
      const { rows } = await client.query(
        'SELECT app_private.signal_resume_job($1::uuid) AS resumed',
        [lane],
      );
      return rows[0]?.resumed === true;
    });
  }
}
