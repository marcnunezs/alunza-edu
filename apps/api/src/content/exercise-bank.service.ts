import { Injectable } from '@nestjs/common';
import type {
  ExerciseBankGovernanceInput,
  ExerciseBankQuery,
  ExerciseBankUsesQuery,
  ExerciseBankVersionsQuery,
} from '@alunza/contracts';
import { exerciseBankDetailResponseSchema } from '@alunza/contracts';
import { DatabaseService } from '../database/database.service';
import { available, resource } from '../academic/academic.shared';
import {
  audit,
  checkRevision,
  idempotent,
} from '../governance/governance.shared';
import type { Actor } from '../governance/governance.shared';
import { ApiError, notFound } from '../http/errors';
import { projectVersion } from './content.service';

@Injectable()
export class ExerciseBankService {
  constructor(private readonly database: DatabaseService) {}

  private read(who: Actor, sql: string, values: unknown[]): Promise<unknown> {
    return this.database.readAs(
      who.actorId,
      async (client) => {
        const result = await client.query<{ data: unknown }>(sql, values);
        return result.rows[0]?.data;
      },
      who.sessionId,
    );
  }

  list(who: Actor, organizationId: string, query: ExerciseBankQuery) {
    return this.read(
      who,
      'SELECT app_private.exercise_bank_list($1::uuid,$2::jsonb) AS data',
      [organizationId, JSON.stringify(query)],
    );
  }

  detail(who: Actor, exerciseId: string) {
    return this.read(
      who,
      'SELECT app_private.exercise_bank_detail($1::uuid) AS data',
      [exerciseId],
    );
  }

  content(who: Actor, exerciseId: string) {
    return this.database.readAs(
      who.actorId,
      async (client) => {
        const { row } = await resource(
          client,
          who,
          'exercise',
          exerciseId,
          false,
          ['ADMIN'],
        );
        const version = (
          await client.query(
            'SELECT * FROM app.exercise_versions WHERE id=$1 AND exercise_id=$2',
            [row.current_version_id, exerciseId],
          )
        ).rows[0];
        if (!version) throw notFound();
        return projectVersion(client, version);
      },
      who.sessionId,
    );
  }

  govern(
    who: Actor,
    exerciseId: string,
    input: ExerciseBankGovernanceInput,
    expected: number,
    key: string,
  ) {
    return this.database.writeAs(
      who.actorId,
      async (client) => {
        // The organization lock is shared with authoring and membership changes.
        // Reauthorize before replaying a stored response, including after revocation.
        const { row } = await resource(
          client,
          who,
          'exercise',
          exerciseId,
          true,
          ['ADMIN'],
        );
        return idempotent(
          client,
          who,
          row.organization_id,
          'exercise.governance',
          key,
          { id: exerciseId, input, expected },
          200,
          async () => {
            checkRevision(row.revision, expected);
            available(row);
            if (input.ownerId !== undefined && input.ownerId !== row.owner_id) {
              const destination = (
                await client.query(
                  `SELECT m.user_id FROM app.organization_memberships m JOIN app.profiles p ON p.id=m.user_id
               WHERE m.organization_id=$1 AND m.user_id=$2 AND m.state='ACTIVE'
               AND m.role IN ('ADMIN','TEACHER') AND p.account_state='ACTIVE'`,
                  [row.organization_id, input.ownerId],
                )
              ).rows[0];
              if (!destination)
                throw new ApiError(
                  'VALIDATION_FAILED',
                  'El propietario debe estar activo y autorizado en esta organización.',
                  422,
                  false,
                  [
                    {
                      field: 'ownerId',
                      message:
                        'Selecciona un administrador o docente activo de la organización.',
                    },
                  ],
                );
            }
            const ownerId = input.ownerId ?? row.owner_id;
            const visibility = input.visibility ?? row.visibility;
            if (ownerId !== row.owner_id || visibility !== row.visibility) {
              await client.query(
                'UPDATE app.exercises SET owner_id=$2,visibility=$3,revision=revision+1,updated_at=now() WHERE id=$1',
                [exerciseId, ownerId, visibility],
              );
              await audit(
                client,
                who,
                row.organization_id,
                'exercise.governance.updated',
                'exercise',
                exerciseId,
                {
                  ownerId: { before: row.owner_id, after: ownerId },
                  visibility: { before: row.visibility, after: visibility },
                },
              );
            }
            const result = await client.query<{ data: unknown }>(
              'SELECT app_private.exercise_bank_detail($1::uuid) AS data',
              [exerciseId],
            );
            const data = exerciseBankDetailResponseSchema.shape.data.parse(
              result.rows[0]?.data,
            );
            return { data, resourceId: exerciseId, resourceType: 'exercise' };
          },
        );
      },
      who.sessionId,
    );
  }

  versions(who: Actor, exerciseId: string, query: ExerciseBankVersionsQuery) {
    return this.read(
      who,
      'SELECT app_private.exercise_bank_versions($1::uuid,$2::jsonb) AS data',
      [exerciseId, JSON.stringify(query)],
    );
  }

  uses(who: Actor, exerciseId: string, query: ExerciseBankUsesQuery) {
    return this.read(
      who,
      'SELECT app_private.exercise_bank_uses($1::uuid,$2::jsonb) AS data',
      [exerciseId, JSON.stringify(query)],
    );
  }
}
