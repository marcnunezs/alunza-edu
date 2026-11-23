import { Injectable } from '@nestjs/common';
import {
  dashboardSchema,
  dashboardEvidenceSchema,
  dashboardSignalsSchema,
  dashboardSignalDetailSchema,
} from '@alunza/contracts';
import type {
  DashboardQuery,
  DashboardEvidenceQuery,
  DashboardSignalQuery,
  DashboardSignalDetailQuery,
} from '@alunza/contracts';
import type { ZodType } from 'zod';
import { DatabaseService } from '../database/database.service';
import type { Actor } from '../governance/governance.shared';
import { phaseAsync, phaseSync } from '../http/phase-diagnostics';

@Injectable()
export class DashboardService {
  constructor(private readonly database: DatabaseService) {}

  private read<T>(
    who: Actor,
    sql: string,
    values: unknown[],
    schema: ZodType<T>,
  ) {
    return this.database.readAs(
      who.actorId,
      async (client) => {
        const { rows } = await phaseAsync('dashboard.query', () =>
          client.query(sql, values),
        );
        return phaseSync('dashboard.parse', () => schema.parse(rows[0]?.data));
      },
      who.sessionId,
    );
  }

  dashboard(who: Actor, classId: string, query: DashboardQuery) {
    return this.read(
      who,
      'SELECT app_private.dashboard_read($1::uuid,$2::jsonb) AS data',
      [classId, JSON.stringify(query)],
      dashboardSchema,
    );
  }

  evidence(who: Actor, classId: string, query: DashboardEvidenceQuery) {
    return this.read(
      who,
      'SELECT app_private.dashboard_evidence($1::uuid,$2::jsonb) AS data',
      [classId, JSON.stringify(query)],
      dashboardEvidenceSchema,
    );
  }

  signals(who: Actor, classId: string, query: DashboardSignalQuery) {
    return this.read(
      who,
      'SELECT app_private.dashboard_signals($1::uuid,$2::jsonb) AS data',
      [classId, JSON.stringify(query)],
      dashboardSignalsSchema,
    );
  }

  signal(
    who: Actor,
    classId: string,
    signalId: string,
    query: DashboardSignalDetailQuery,
  ) {
    return this.read(
      who,
      'SELECT app_private.dashboard_signal($1::uuid,$2::uuid,$3::jsonb) AS data',
      [classId, signalId, JSON.stringify(query)],
      dashboardSignalDetailSchema,
    );
  }
}
