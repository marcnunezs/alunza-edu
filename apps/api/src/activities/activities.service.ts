import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  activityInputSchema,
  activitySchema,
  exerciseVersionInputSchema,
  studentExerciseSchema,
} from '@alunza/contracts';
import type { ActivityInput } from '@alunza/contracts';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import { ApiError, notFound } from '../http/errors';
import {
  audit,
  checkRevision,
  idempotent,
  iso,
  pageResult,
  parse,
} from '../governance/governance.shared';
import type { Actor } from '../governance/governance.shared';
import { classAccess, forbidden, resource } from '../academic/academic.shared';
import { projectVersion } from '../content/content.service';

type ActivityQuery = {
  cursor?: string;
  limit: number;
  search?: string;
  state?: 'DRAFT' | 'PUBLISHED' | 'CLOSED';
};
export function editableWindow(
  state: string,
  archived: boolean,
  opensAt: string | null,
  closesAt: string | null,
  now: number,
): boolean {
  return (
    state === 'PUBLISHED' &&
    !archived &&
    (!opensAt || Date.parse(opensAt) <= now) &&
    (!closesAt || now < Date.parse(closesAt))
  );
}
function transition(state: string, action: 'publish' | 'close') {
  if (state !== (action === 'publish' ? 'DRAFT' : 'PUBLISHED'))
    throw new ApiError(
      'INVALID_TRANSITION',
      'El estado de la actividad no permite esta operación.',
      409,
    );
}
export async function projectActivity(
  client: PoolClient,
  row: Record<string, unknown>,
) {
  const items = (
    await client.query(
      'SELECT ae.id,ae.exercise_version_id,ae.position,ae.required,v.exercise_id,v.title FROM app.activity_exercises ae JOIN app.exercise_versions v ON v.id=ae.exercise_version_id WHERE ae.activity_id=$1 ORDER BY ae.position',
      [row.id],
    )
  ).rows;
  return activitySchema.parse({
    id: row.id,
    organizationId: row.organization_id,
    classId: row.class_id,
    title: row.title,
    instructions: row.instructions,
    type: row.type,
    state: row.state,
    opensAt: iso(row.opens_at as Date | null),
    closesAt: iso(row.closes_at as Date | null),
    publishedAt: iso(row.published_at as Date | null),
    closedAt: iso(row.closed_at as Date | null),
    revision: row.revision,
    exercises: items.map((item) => ({
      id: item.id,
      exerciseId: item.exercise_id,
      exerciseVersionId: item.exercise_version_id,
      title: item.title,
      position: item.position,
      required: item.required,
    })),
  });
}
@Injectable()
export class ActivitiesService {
  constructor(private readonly database: DatabaseService) {}
  private async context(
    client: PoolClient,
    who: Actor,
    id: string,
    write = false,
  ) {
    const { row } = await resource(client, who, 'activity', id, write);
    const classroom = await classAccess(
      client,
      who,
      row.class_id,
      write,
      write,
    );
    if (classroom.role === 'ADMIN') forbidden();
    if (classroom.role === 'STUDENT' && row.state === 'DRAFT') throw notFound();
    return { row, classroom };
  }
  async activities(who: Actor, id: string, query: ActivityQuery) {
    return this.database.readAs(
      who.actorId,
      async (client) => {
        const { role } = await classAccess(client, who, id);
        if (role === 'ADMIN') forbidden();
        const rows = (
          await client.query(
            `SELECT * FROM app.activities WHERE class_id=$1 AND ($2::uuid IS NULL OR id>$2) AND ($3::text IS NULL OR title ILIKE '%'||$3||'%') AND ($4::text IS NULL OR state=$4) AND ($6<>'STUDENT' OR state IN ('PUBLISHED','CLOSED')) ORDER BY id LIMIT $5`,
            [
              id,
              query.cursor ?? null,
              query.search ?? null,
              query.state ?? null,
              query.limit + 1,
              role,
            ],
          )
        ).rows;
        return pageResult(
          await Promise.all(rows.map((row) => projectActivity(client, row))),
          query.limit,
          (row) => row.id,
        );
      },
      who.sessionId,
    );
  }
  async activity(who: Actor, id: string) {
    return this.database.readAs(
      who.actorId,
      async (client) =>
        projectActivity(client, (await this.context(client, who, id)).row),
      who.sessionId,
    );
  }
  private async validateItems(
    client: PoolClient,
    org: string,
    items: ActivityInput['exercises'],
  ) {
    if (!items.length) return;
    const versions = (
      await client.query(
        'SELECT v.id,v.exercise_id FROM app.exercise_versions v JOIN app.exercises e ON e.id=v.exercise_id WHERE v.organization_id=$1 AND v.id=ANY($2::uuid[]) AND e.archived_at IS NULL',
        [org, items.map((item) => item.exerciseVersionId)],
      )
    ).rows;
    if (versions.length !== items.length)
      throw new ApiError(
        'VALIDATION_FAILED',
        'Revisa los ejercicios: deben estar activos y disponibles en esta organización.',
        422,
        false,
        [{ field: 'exercises', message: 'Ejercicio no disponible.' }],
      );
    if (new Set(versions.map((row) => row.exercise_id)).size !== items.length)
      throw new ApiError(
        'VALIDATION_FAILED',
        'No repitas un ejercicio en la actividad.',
        422,
        false,
        [{ field: 'exercises', message: 'Ejercicio duplicado.' }],
      );
    const archivedConcept = (
      await client.query(
        'SELECT link.exercise_version_id FROM app.exercise_version_concepts link JOIN app.concept_versions cv ON cv.id=link.concept_version_id JOIN app.concept_tags t ON t.id=cv.concept_id WHERE link.exercise_version_id=ANY($1::uuid[]) AND t.archived_at IS NOT NULL LIMIT 1',
        [items.map((item) => item.exerciseVersionId)],
      )
    ).rows[0];
    if (archivedConcept)
      throw new ApiError(
        'VALIDATION_FAILED',
        'Un ejercicio utiliza conceptos archivados.',
        422,
        false,
        [
          {
            field: 'exercises',
            message: 'Crea una versión con conceptos activos.',
          },
        ],
      );
  }
  private async saveItems(
    client: PoolClient,
    org: string,
    id: string,
    items: ActivityInput['exercises'],
  ) {
    await client.query(
      'DELETE FROM app.activity_exercises WHERE activity_id=$1',
      [id],
    );
    for (const item of items)
      await client.query(
        'INSERT INTO app.activity_exercises(id,organization_id,activity_id,exercise_version_id,position,required) VALUES($1,$2,$3,$4,$5,$6)',
        [
          randomUUID(),
          org,
          id,
          item.exerciseVersionId,
          item.position,
          item.required,
        ],
      );
  }
  async create(who: Actor, classId: string, input: ActivityInput, key: string) {
    return this.database.writeAs(
      who.actorId,
      async (client) => {
        const { row: classroom } = await classAccess(
          client,
          who,
          classId,
          true,
          true,
        );
        return idempotent(
          client,
          who,
          classroom.organization_id,
          'activity.create',
          key,
          { classId, input },
          201,
          async () => {
            await this.validateItems(
              client,
              classroom.organization_id,
              input.exercises,
            );
            const id = randomUUID();
            const row = (
              await client.query(
                'INSERT INTO app.activities(id,organization_id,class_id,created_by,title,type,instructions,opens_at,closes_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
                [
                  id,
                  classroom.organization_id,
                  classId,
                  who.actorId,
                  input.title,
                  input.type,
                  input.instructions,
                  input.opensAt,
                  input.closesAt,
                ],
              )
            ).rows[0];
            await this.saveItems(
              client,
              classroom.organization_id,
              id,
              input.exercises,
            );
            await audit(
              client,
              who,
              classroom.organization_id,
              'activity.created',
              'activity',
              id,
            );
            return {
              data: await projectActivity(client, row),
              resourceId: id,
              resourceType: 'activity',
            };
          },
        );
      },
      who.sessionId,
    );
  }
  async update(
    who: Actor,
    id: string,
    input: Partial<ActivityInput>,
    expected: number,
  ) {
    return this.database.writeAs(
      who.actorId,
      async (client) => {
        const { row } = await this.context(client, who, id, true);
        checkRevision(row.revision, expected);
        if (row.state !== 'DRAFT')
          throw new ApiError(
            'INVALID_TRANSITION',
            'Solo se puede editar una actividad en borrador.',
            409,
          );
        const before = await projectActivity(client, row);
        const effective = parse(activityInputSchema, {
          title: input.title ?? before.title,
          instructions: input.instructions ?? before.instructions,
          type: input.type ?? before.type,
          opensAt: input.opensAt === undefined ? before.opensAt : input.opensAt,
          closesAt:
            input.closesAt === undefined ? before.closesAt : input.closesAt,
          exercises:
            input.exercises ??
            before.exercises.map((item) => ({
              exerciseVersionId: item.exerciseVersionId,
              position: item.position,
              required: item.required,
            })),
        });
        await this.validateItems(
          client,
          row.organization_id,
          effective.exercises,
        );
        const updated = (
          await client.query(
            'UPDATE app.activities SET title=$2,instructions=$3,type=$4,opens_at=$5,closes_at=$6,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *',
            [
              id,
              effective.title,
              effective.instructions,
              effective.type,
              effective.opensAt,
              effective.closesAt,
            ],
          )
        ).rows[0];
        if (input.exercises)
          await this.saveItems(
            client,
            row.organization_id,
            id,
            effective.exercises,
          );
        await audit(
          client,
          who,
          row.organization_id,
          'activity.updated',
          'activity',
          id,
          { fields: Object.keys(input) },
        );
        return projectActivity(client, updated);
      },
      who.sessionId,
    );
  }
  async changeState(
    who: Actor,
    id: string,
    action: 'publish' | 'close',
    expected: number,
    key: string,
  ) {
    return this.database.writeAs(
      who.actorId,
      async (client) => {
        const { row } = await this.context(client, who, id, true);
        return idempotent(
          client,
          who,
          row.organization_id,
          `activity.${action}`,
          key,
          { id, expected },
          200,
          async () => {
            checkRevision(row.revision, expected);
            transition(row.state, action);
            if (action === 'publish') {
              const activity = await projectActivity(client, row);
              if (!activity.exercises.some((item) => item.required))
                throw new ApiError(
                  'VALIDATION_FAILED',
                  'Incluye al menos un ejercicio requerido para publicar.',
                  422,
                  false,
                  [
                    {
                      field: 'exercises',
                      message: 'Falta un ejercicio requerido.',
                    },
                  ],
                );
              await this.validateItems(
                client,
                row.organization_id,
                activity.exercises,
              );
              const versions = (
                await client.query(
                  'SELECT v.* FROM app.exercise_versions v JOIN app.activity_exercises ae ON ae.exercise_version_id=v.id WHERE ae.activity_id=$1',
                  [id],
                )
              ).rows;
              for (const version of versions) {
                const complete = await projectVersion(client, version);
                const {
                  id: versionId,
                  exerciseId,
                  version: number,
                  createdAt,
                  ...definition
                } = complete;
                void versionId;
                void exerciseId;
                void number;
                void createdAt;
                parse(exerciseVersionInputSchema, definition);
              }
            }
            const updated = (
              await client.query(
                `UPDATE app.activities SET state=$2,${action === 'publish' ? 'published_at' : 'closed_at'}=now(),revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *`,
                [id, action === 'publish' ? 'PUBLISHED' : 'CLOSED'],
              )
            ).rows[0];
            await audit(
              client,
              who,
              row.organization_id,
              `activity.${action === 'publish' ? 'published' : 'closed'}`,
              'activity',
              id,
            );
            return {
              data: await projectActivity(client, updated),
              resourceId: id,
              resourceType: 'activity',
            };
          },
        );
      },
      who.sessionId,
    );
  }
  async studentExercise(who: Actor, id: string, assignmentId: string) {
    return this.database.readAs(
      who.actorId,
      async (client) => {
        const { row, classroom } = await this.context(client, who, id);
        const exercise = (
          await client.query(
            'SELECT v.*,ae.id AS assignment_id FROM app.activity_exercises ae JOIN app.exercise_versions v ON v.id=ae.exercise_version_id WHERE ae.activity_id=$1 AND ae.id=$2',
            [id, assignmentId],
          )
        ).rows[0];
        if (!exercise) throw notFound();
        const concepts = (
          await client.query(
            'SELECT cv.id,cv.concept_id,cv.name,cv.description FROM app.exercise_version_concepts link JOIN app.concept_versions cv ON cv.id=link.concept_version_id WHERE link.exercise_version_id=$1 ORDER BY cv.name,cv.id',
            [exercise.id],
          )
        ).rows;
        const tests = (
          await client.query(
            "SELECT test_id,args,expected FROM app_private.exercise_tests WHERE exercise_version_id=$1 AND visibility='visible' ORDER BY position",
            [exercise.id],
          )
        ).rows;
        const now = new Date(),
          opensAt = iso(row.opens_at),
          closesAt = iso(row.closes_at);
        return studentExerciseSchema.parse({
          organizationId: row.organization_id,
          classId: row.class_id,
          activityId: id,
          activityExerciseId: assignmentId,
          exerciseVersionId: exercise.id,
          activityState: row.state,
          canEdit: editableWindow(
            row.state,
            Boolean(classroom.row.archived_at),
            opensAt,
            closesAt,
            now.getTime(),
          ),
          opensAt,
          closesAt,
          serverNow: now.toISOString(),
          title: exercise.title,
          statement: exercise.statement,
          starterCode: exercise.starter_code,
          difficulty: exercise.difficulty,
          executionLimits: exercise.execution_limits,
          concepts: concepts.map((concept) => ({
            id: concept.concept_id,
            versionId: concept.id,
            name: concept.name,
            description: concept.description,
          })),
          tests: tests.map((test) => ({
            id: test.test_id,
            visibility: 'visible',
            args: test.args,
            expected: test.expected,
          })),
        });
      },
      who.sessionId,
    );
  }
}
