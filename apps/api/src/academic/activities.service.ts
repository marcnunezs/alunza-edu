import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  activityInputSchema,
  activityUpdateSchema,
  activitySchema,
  studentExerciseSchema,
} from '@alunza/contracts';
import {
  audit,
  checkRevision,
  idempotent,
  iso,
  pageResult,
} from '../governance/governance.shared';
import type { Actor } from '../governance/governance.shared';
import { ApiError, notFound } from '../http/errors';
import {
  AcademicAccess,
  classRow,
  invalid,
  teacherClass,
} from './academic.shared';
import type { AcademicQuery, Context } from './academic.shared';

type ActivityInput = z.infer<typeof activityInputSchema>;
const activityUnavailable = (message: string) =>
  new ApiError('ACTIVITY_UNAVAILABLE', message, 409);
export function activityAvailability(
  row: {
    state: string;
    opens_at?: Date | string | null;
    closes_at?: Date | string | null;
    class_archived_at?: unknown;
  },
  now = Date.now(),
):
  'DRAFT' | 'CLOSED' | 'CLASS_ARCHIVED' | 'NOT_OPEN' | 'EXPIRED' | 'AVAILABLE' {
  if (row.class_archived_at) return 'CLASS_ARCHIVED';
  if (row.state === 'DRAFT') return 'DRAFT';
  if (row.state === 'CLOSED') return 'CLOSED';
  if (row.opens_at && new Date(row.opens_at).getTime() > now) return 'NOT_OPEN';
  if (row.closes_at && new Date(row.closes_at).getTime() <= now)
    return 'EXPIRED';
  return 'AVAILABLE';
}
export function validateActivity(input: ActivityInput, publishing = false) {
  if (
    input.opensAt &&
    input.closesAt &&
    new Date(input.opensAt).getTime() >= new Date(input.closesAt).getTime()
  )
    throw invalid('El cierre debe ser posterior a la apertura.', 'closesAt');
  if (
    new Set(input.exercises.map((e) => e.position)).size !==
      input.exercises.length ||
    new Set(input.exercises.map((e) => e.exerciseVersionId)).size !==
      input.exercises.length
  )
    throw invalid(
      'Los ejercicios y sus posiciones no pueden repetirse.',
      'exercises',
    );
  if (publishing && !input.exercises.some((e) => e.required))
    throw invalid(
      'Añade al menos un ejercicio requerido antes de publicar.',
      'exercises',
    );
}

@Injectable()
export class ActivitiesService {
  constructor(private readonly access: AcademicAccess) {}

  list(who: Actor, classId: string, query: AcademicQuery) {
    return this.access.resource(
      who,
      'class',
      classId,
      false,
      ['TEACHER', 'STUDENT'],
      async (ctx) => {
        const schoolClass = await classRow(ctx, classId);
        if (ctx.role === 'TEACHER') await teacherClass(ctx, classId);
        const rows = await ctx.client.query(
          `SELECT * FROM app.activities WHERE class_id=$1 AND ($2::uuid IS NULL OR id>$2) AND ($3::text IS NULL OR title ILIKE '%'||$3||'%') AND ($4::boolean=false OR state='PUBLISHED') ORDER BY id LIMIT $5`,
          [
            classId,
            query.cursor ?? null,
            query.search ?? null,
            ctx.role === 'STUDENT',
            query.limit + 1,
          ],
        );
        const projected = [];
        for (const row of rows.rows)
          projected.push(
            await this.project(ctx, {
              ...row,
              class_archived_at: schoolClass.archived_at,
            }),
          );
        return pageResult(projected, query.limit, (row) => row.id);
      },
    );
  }
  get(who: Actor, id: string) {
    return this.access.resource(
      who,
      'activity',
      id,
      false,
      ['TEACHER', 'STUDENT'],
      async (ctx) => {
        const row = await this.row(ctx, id);
        if (ctx.role === 'TEACHER') await teacherClass(ctx, row.class_id);
        if (ctx.role === 'STUDENT' && row.state !== 'PUBLISHED')
          throw activityUnavailable(
            'La actividad no está disponible para preparar soluciones.',
          );
        return this.project(ctx, row);
      },
    );
  }
  create(who: Actor, classId: string, input: ActivityInput, key: string) {
    validateActivity(input);
    return this.access.resource(
      who,
      'class',
      classId,
      true,
      ['TEACHER'],
      async (ctx) => {
        await teacherClass(ctx, classId, true);
        return idempotent(
          ctx.client,
          who,
          ctx.organizationId,
          'activity.create',
          key,
          { ...input, classId },
          201,
          async () => {
            await this.validAssignments(ctx, input.exercises);
            const id = randomUUID();
            await ctx.client.query(
              `INSERT INTO app.activities(id,organization_id,class_id,title,type,instructions,state,opens_at,closes_at,created_by) VALUES($1,$2,$3,$4,$5,$6,'DRAFT',$7,$8,$9)`,
              [
                id,
                ctx.organizationId,
                classId,
                input.title,
                input.type,
                input.instructions,
                input.opensAt,
                input.closesAt,
                who.actorId,
              ],
            );
            await this.saveAssignments(ctx, id, input.exercises);
            await audit(
              ctx.client,
              who,
              ctx.organizationId,
              'activity.created',
              'activity',
              id,
            );
            return {
              data: await this.project(ctx, await this.row(ctx, id)),
              resourceId: id,
              resourceType: 'activity',
            };
          },
        );
      },
    );
  }
  update(
    who: Actor,
    id: string,
    input: z.infer<typeof activityUpdateSchema>,
    expected: number,
  ) {
    return this.access.resource(
      who,
      'activity',
      id,
      true,
      ['TEACHER'],
      async (ctx) => {
        const row = await this.row(ctx, id);
        await teacherClass(ctx, row.class_id, true);
        checkRevision(row.revision, expected);
        if (row.state !== 'DRAFT')
          throw activityUnavailable(
            'Una actividad publicada o cerrada conserva su contenido.',
          );
        const prior = await this.project(ctx, row);
        const value: ActivityInput = {
          title: input.title ?? prior.title,
          type: input.type ?? prior.type,
          instructions: input.instructions ?? prior.instructions,
          opensAt: input.opensAt === undefined ? prior.opensAt : input.opensAt,
          closesAt:
            input.closesAt === undefined ? prior.closesAt : input.closesAt,
          exercises:
            input.exercises ??
            prior.exercises.map((e) => ({
              exerciseVersionId: e.exerciseVersionId,
              position: e.position,
              required: e.required,
            })),
        };
        validateActivity(value);
        await this.validAssignments(ctx, value.exercises);
        await ctx.client.query(
          'UPDATE app.activities SET title=$2,type=$3,instructions=$4,opens_at=$5,closes_at=$6,revision=revision+1,updated_at=now() WHERE id=$1',
          [
            id,
            value.title,
            value.type,
            value.instructions,
            value.opensAt,
            value.closesAt,
          ],
        );
        if (input.exercises !== undefined) {
          await ctx.client.query(
            'DELETE FROM app.activity_exercises WHERE activity_id=$1',
            [id],
          );
          await this.saveAssignments(ctx, id, value.exercises);
        }
        await audit(
          ctx.client,
          who,
          ctx.organizationId,
          'activity.updated',
          'activity',
          id,
        );
        return this.project(ctx, await this.row(ctx, id));
      },
    );
  }
  transition(
    who: Actor,
    id: string,
    action: 'publish' | 'close',
    expected: number,
  ) {
    return this.access.resource(
      who,
      'activity',
      id,
      true,
      ['TEACHER'],
      async (ctx) => {
        const row = await this.row(ctx, id);
        await teacherClass(ctx, row.class_id, true);
        checkRevision(row.revision, expected);
        const wanted = action === 'publish' ? 'DRAFT' : 'PUBLISHED';
        if (row.state !== wanted)
          throw activityUnavailable(
            'La transición de estado solicitada no está permitida.',
          );
        if (action === 'publish') {
          const current = await this.project(ctx, row);
          validateActivity(current, true);
          await this.validAssignments(ctx, current.exercises);
          await ctx.client.query(
            "UPDATE app.activities SET state='PUBLISHED',revision=revision+1,updated_at=now() WHERE id=$1",
            [id],
          );
        } else
          await ctx.client.query(
            "UPDATE app.activities SET state='CLOSED',revision=revision+1,updated_at=now() WHERE id=$1",
            [id],
          );
        await audit(
          ctx.client,
          who,
          ctx.organizationId,
          action === 'publish' ? 'activity.published' : 'activity.closed',
          'activity',
          id,
        );
        return this.project(ctx, await this.row(ctx, id));
      },
    );
  }
  studentExercise(who: Actor, activityId: string, assignmentId: string) {
    return this.access.resource(
      who,
      'activity',
      activityId,
      false,
      ['STUDENT'],
      async (ctx) => {
        const activity = await this.row(ctx, activityId);
        if (activityAvailability(activity) !== 'AVAILABLE')
          throw activityUnavailable(
            'El ejercicio no está disponible: revisa las fechas o el cierre de la actividad.',
          );
        const row = (
          await ctx.client.query(
            `SELECT v.*,a.id AS assignment_id FROM app.activity_exercises a JOIN app.exercise_versions v ON v.id=a.exercise_version_id WHERE a.id=$1 AND a.activity_id=$2`,
            [assignmentId, activityId],
          )
        ).rows[0];
        if (!row) throw notFound();
        const concepts = await ctx.client.query(
          `SELECT c.concept_id AS id,c.concept_version_id AS version_id,v.name FROM app.exercise_version_concepts c JOIN app.concept_versions v ON v.id=c.concept_version_id WHERE c.exercise_version_id=$1 ORDER BY v.name,c.concept_id`,
          [row.id],
        );
        // Explicit predicate and response schema defend the student boundary in addition to RLS.
        const tests = await ctx.client.query(
          "SELECT id,visibility,args,expected,comparator FROM app_private.exercise_tests WHERE exercise_version_id=$1 AND visibility='VISIBLE' ORDER BY position",
          [row.id],
        );
        return studentExerciseSchema.parse({
          activityId,
          activityExerciseId: assignmentId,
          organizationId: ctx.organizationId,
          classId: activity.class_id,
          exerciseVersionId: row.id,
          title: row.title,
          statement: row.statement,
          starterCode: row.starter_code,
          language: row.language,
          difficulty: row.difficulty,
          entrypoint: row.entrypoint,
          executionLimits: row.execution_limits,
          tests: tests.rows,
          concepts: concepts.rows.map((c) => ({
            id: c.id,
            versionId: c.version_id,
            name: c.name,
          })),
        });
      },
    );
  }
  private async row(ctx: Context, id: string) {
    const row = (
      await ctx.client.query(
        'SELECT a.*,c.archived_at AS class_archived_at FROM app.activities a JOIN app.classes c ON c.id=a.class_id WHERE a.id=$1 AND a.organization_id=$2',
        [id, ctx.organizationId],
      )
    ).rows[0];
    if (!row) throw notFound();
    return row;
  }
  private async project(ctx: Context, row: Record<string, unknown>) {
    const exercises = await ctx.client.query(
      'SELECT a.*,v.title,v.difficulty FROM app.activity_exercises a JOIN app.exercise_versions v ON v.id=a.exercise_version_id WHERE a.activity_id=$1 ORDER BY a.position,a.id',
      [row.id],
    );
    return activitySchema.parse({
      id: row.id,
      organizationId: row.organization_id,
      classId: row.class_id,
      revision: Number(row.revision),
      title: row.title,
      type: row.type,
      instructions: row.instructions,
      state: row.state,
      opensAt: iso(row.opens_at as Date | null),
      closesAt: iso(row.closes_at as Date | null),
      publishedAt: iso(row.published_at as Date | null),
      closedAt: iso(row.closed_at as Date | null),
      availability: activityAvailability({
        state: String(row.state),
        opens_at: row.opens_at as Date | null,
        closes_at: row.closes_at as Date | null,
        class_archived_at: row.class_archived_at,
      }),
      exercises: exercises.rows.map((e) => ({
        id: e.id,
        exerciseVersionId: e.exercise_version_id,
        position: e.position,
        required: e.required,
        title: e.title,
        difficulty: e.difficulty,
      })),
    });
  }
  private async validAssignments(
    ctx: Context,
    assignments: ActivityInput['exercises'],
  ) {
    if (!assignments.length) return;
    const ids = assignments.map((a) => a.exerciseVersionId);
    const rows = await ctx.client.query(
      `SELECT v.id,e.id AS exercise_id FROM app.exercise_versions v JOIN app.exercises e ON e.id=v.exercise_id WHERE v.id=ANY($1::uuid[]) AND v.organization_id=$2 AND e.archived_at IS NULL AND NOT EXISTS (SELECT 1 FROM app.exercise_version_concepts ec JOIN app.concepts c ON c.id=ec.concept_id WHERE ec.exercise_version_id=v.id AND c.archived_at IS NOT NULL)`,
      [ids, ctx.organizationId],
    );
    if (
      rows.rowCount !== ids.length ||
      new Set(rows.rows.map((r) => r.exercise_id)).size !== ids.length
    )
      throw invalid(
        'Selecciona ejercicios válidos, distintos y conceptos activos de esta organización.',
        'exercises',
      );
  }
  private async saveAssignments(
    ctx: Context,
    id: string,
    assignments: ActivityInput['exercises'],
  ) {
    for (const assignment of assignments)
      await ctx.client.query(
        'INSERT INTO app.activity_exercises(id,organization_id,activity_id,exercise_version_id,position,required) VALUES($1,$2,$3,$4,$5,$6)',
        [
          randomUUID(),
          ctx.organizationId,
          id,
          assignment.exerciseVersionId,
          assignment.position,
          assignment.required,
        ],
      );
  }
}
