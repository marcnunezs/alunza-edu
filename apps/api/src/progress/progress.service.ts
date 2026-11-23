import { Injectable } from '@nestjs/common';
import { activityOpenSchema, studentProgressSchema } from '@alunza/contracts';
import type { ProgressQuery } from '@alunza/contracts';
import { DatabaseService } from '../database/database.service';
import type { Actor } from '../governance/governance.shared';
import { phaseAsync, phaseSync } from '../http/phase-diagnostics';

@Injectable()
export class ProgressService {
  constructor(private readonly database: DatabaseService) {}

  read(who: Actor, query: ProgressQuery) {
    return this.database.readAs(
      who.actorId,
      async (client) => {
        const { rows } = await phaseAsync('progress.query', () =>
          client.query(
            'SELECT app_private.student_progress_observed($1::uuid,$2::jsonb) AS progress',
            [query.classId, JSON.stringify({ ...query, classId: undefined })],
          ),
        );
        return phaseSync('progress.parse', () =>
          studentProgressSchema.parse(rows[0]?.progress),
        );
      },
      who.sessionId,
    );
  }

  open(who: Actor, activityId: string, key: string) {
    return this.database.writeAs(
      who.actorId,
      async (client) => {
        const { rows } = await client.query(
          'SELECT app_private.record_activity_open($1::uuid,$2) AS event',
          [activityId, key],
        );
        return activityOpenSchema.parse(rows[0]?.event);
      },
      who.sessionId,
    );
  }
}
