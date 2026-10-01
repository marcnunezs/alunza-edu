import { Injectable } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  academicClassSchema,
  courseSchema,
  courseCreateSchema,
  courseUpdateSchema,
  classCreateSchema,
  classUpdateSchema,
  joinCodeSchema,
  classEnrollmentSchema,
  classJoinPreviewSchema,
} from '@alunza/contracts';
import {
  audit,
  checkRevision,
  digest,
  idempotent,
  iso,
  pageResult,
} from '../governance/governance.shared';
import type { Actor } from '../governance/governance.shared';
import { notFound } from '../http/errors';
import {
  AcademicAccess,
  classRow,
  conflict,
  dateValue,
  forbidden,
  invalid,
  operational,
  validateDates,
} from './academic.shared';
import type { AcademicQuery, Context } from './academic.shared';

function projectCourse(row: Record<string, unknown>) {
  return courseSchema.parse({
    id: row.id,
    organizationId: row.organization_id,
    code: row.code,
    name: row.name,
    description: row.description,
    academicPeriod: row.academic_period,
    startDate: dateValue(row.start_date),
    endDate: dateValue(row.end_date),
    revision: Number(row.revision),
    state: row.archived_at ? 'ARCHIVED' : 'ACTIVE',
    archivedAt: iso(row.archived_at as Date | null),
  });
}
function projectClass(row: Record<string, unknown>) {
  return academicClassSchema.parse({
    id: row.id,
    organizationId: row.organization_id,
    courseId: row.course_id,
    teacherId: row.teacher_id,
    code: row.code,
    name: row.name,
    description: row.description,
    startDate: dateValue(row.start_date),
    endDate: dateValue(row.end_date),
    revision: Number(row.revision),
    state: row.archived_at ? 'ARCHIVED' : 'ACTIVE',
    archivedAt: iso(row.archived_at as Date | null),
  });
}
function projectCode(row: Record<string, unknown>) {
  return joinCodeSchema.parse({
    id: row.id,
    classId: row.class_id,
    expiresAt: iso(row.expires_at as Date),
    revokedAt: iso(row.revoked_at as Date | null),
    revision: Number(row.revision),
    usesCount: Number(row.uses_count),
  });
}

@Injectable()
export class AcademicService {
  constructor(private readonly access: AcademicAccess) {}

  courses(who: Actor, org: string, query: AcademicQuery) {
    return this.access.organization(
      who,
      org,
      false,
      ['ADMIN', 'TEACHER'],
      async ({ client }) => {
        const rows = await client.query(
          `SELECT * FROM app.courses WHERE organization_id=$1 AND ($2::uuid IS NULL OR id>$2) AND ($3::text IS NULL OR name ILIKE '%'||$3||'%' OR code ILIKE '%'||$3||'%') AND ($4::text IS NULL OR (CASE WHEN archived_at IS NULL THEN 'ACTIVE' ELSE 'ARCHIVED' END)=$4) ORDER BY id LIMIT $5`,
          [
            org,
            query.cursor ?? null,
            query.search ?? null,
            query.state ?? null,
            query.limit + 1,
          ],
        );
        return pageResult(
          rows.rows.map(projectCourse),
          query.limit,
          (row) => row.id,
        );
      },
    );
  }
  course(who: Actor, id: string) {
    return this.access.resource(
      who,
      'course',
      id,
      false,
      ['ADMIN', 'TEACHER'],
      async (ctx) => projectCourse(await this.findCourse(ctx, id)),
    );
  }
  createCourse(
    who: Actor,
    org: string,
    input: z.infer<typeof courseCreateSchema>,
    key: string,
  ) {
    validateDates(input.startDate, input.endDate);
    return this.access.organization(who, org, true, ['ADMIN'], (ctx) =>
      idempotent(
        ctx.client,
        who,
        org,
        'course.create',
        key,
        input,
        201,
        async () => {
          const id = randomUUID();
          const result = await ctx.client.query(
            `INSERT INTO app.courses(id,organization_id,code,name,description,academic_period,start_date,end_date) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
            [
              id,
              org,
              input.code,
              input.name,
              input.description,
              input.academicPeriod,
              input.startDate,
              input.endDate,
            ],
          );
          await audit(ctx.client, who, org, 'course.created', 'course', id);
          return {
            data: projectCourse(result.rows[0]),
            resourceId: id,
            resourceType: 'course',
          };
        },
      ),
    );
  }
  updateCourse(
    who: Actor,
    id: string,
    input: z.infer<typeof courseUpdateSchema>,
    expected: number,
  ) {
    return this.access.resource(
      who,
      'course',
      id,
      true,
      ['ADMIN'],
      async (ctx) => {
        const row = await this.findCourse(ctx, id);
        operational(row);
        checkRevision(row.revision, expected);
        const value = { ...projectCourse(row), ...input };
        validateDates(value.startDate, value.endDate);
        const outside = await ctx.client.query(
          `SELECT id FROM app.classes WHERE course_id=$1 AND (($2::date IS NOT NULL AND start_date<$2) OR ($3::date IS NOT NULL AND end_date>$3)) LIMIT 1`,
          [id, value.startDate, value.endDate],
        );
        if (outside.rowCount)
          throw invalid(
            'Las fechas excluirían una clase existente.',
            'startDate',
          );
        const updated = await ctx.client.query(
          `UPDATE app.courses SET code=$2,name=$3,description=$4,academic_period=$5,start_date=$6,end_date=$7,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *`,
          [
            id,
            value.code,
            value.name,
            value.description,
            value.academicPeriod,
            value.startDate,
            value.endDate,
          ],
        );
        await audit(
          ctx.client,
          who,
          ctx.organizationId,
          'course.updated',
          'course',
          id,
        );
        return projectCourse(updated.rows[0]);
      },
    );
  }
  archiveCourse(who: Actor, id: string, expected: number) {
    return this.access.resource(
      who,
      'course',
      id,
      true,
      ['ADMIN'],
      async (ctx) => {
        const row = await this.findCourse(ctx, id);
        checkRevision(row.revision, expected);
        operational(row);
        if (
          (
            await ctx.client.query(
              'SELECT id FROM app.classes WHERE course_id=$1 AND archived_at IS NULL LIMIT 1',
              [id],
            )
          ).rowCount
        )
          throw conflict('Archiva primero las clases activas del curso.');
        const result = await ctx.client.query(
          'UPDATE app.courses SET archived_at=now(),revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *',
          [id],
        );
        await audit(
          ctx.client,
          who,
          ctx.organizationId,
          'course.archived',
          'course',
          id,
        );
        return projectCourse(result.rows[0]);
      },
    );
  }
  classes(who: Actor, org: string, query: AcademicQuery) {
    return this.access.organization(
      who,
      org,
      false,
      ['ADMIN', 'TEACHER', 'STUDENT'],
      async (ctx) => {
        const rows = await ctx.client.query(
          `SELECT * FROM app.classes WHERE organization_id=$1 AND ($2::uuid IS NULL OR id>$2) AND ($3::text IS NULL OR name ILIKE '%'||$3||'%' OR code ILIKE '%'||$3||'%') AND ($4::text IS NULL OR (CASE WHEN archived_at IS NULL THEN 'ACTIVE' ELSE 'ARCHIVED' END)=$4) ORDER BY id LIMIT $5`,
          [
            org,
            query.cursor ?? null,
            query.search ?? null,
            query.state ?? null,
            query.limit + 1,
          ],
        );
        return pageResult(
          rows.rows.map(projectClass),
          query.limit,
          (row) => row.id,
        );
      },
    );
  }
  class(who: Actor, id: string) {
    return this.access.resource(
      who,
      'class',
      id,
      false,
      ['ADMIN', 'TEACHER', 'STUDENT'],
      async (ctx) => projectClass(await classRow(ctx, id)),
    );
  }
  createClass(
    who: Actor,
    org: string,
    input: z.infer<typeof classCreateSchema>,
    key: string,
  ) {
    return this.access.organization(
      who,
      org,
      true,
      ['ADMIN', 'TEACHER'],
      async (ctx) => {
        const teacherId =
          ctx.role === 'TEACHER' ? who.actorId : input.teacherId;
        if (
          !teacherId ||
          (ctx.role === 'TEACHER' &&
            input.teacherId &&
            input.teacherId !== who.actorId)
        )
          throw invalid(
            'Selecciona un profesor activo autorizado.',
            'teacherId',
          );
        return idempotent(
          ctx.client,
          who,
          org,
          'class.create',
          key,
          input,
          201,
          async () => {
            const course = await this.findCourse(ctx, input.courseId);
            operational(course);
            validateDates(input.startDate, input.endDate, {
              start: dateValue(course.start_date),
              end: dateValue(course.end_date),
            });
            await this.activeTeacher(ctx, teacherId);
            const id = randomUUID();
            const result = await ctx.client.query(
              `INSERT INTO app.classes(id,organization_id,course_id,teacher_id,code,name,description,start_date,end_date) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
              [
                id,
                org,
                input.courseId,
                teacherId,
                input.code,
                input.name,
                input.description,
                input.startDate,
                input.endDate,
              ],
            );
            await audit(ctx.client, who, org, 'class.created', 'class', id, {
              teacherId,
              courseId: input.courseId,
            });
            return {
              data: projectClass(result.rows[0]),
              resourceId: id,
              resourceType: 'class',
            };
          },
        );
      },
    );
  }
  updateClass(
    who: Actor,
    id: string,
    input: z.infer<typeof classUpdateSchema>,
    expected: number,
  ) {
    return this.access.resource(
      who,
      'class',
      id,
      true,
      ['ADMIN', 'TEACHER'],
      async (ctx) => {
        const row = await classRow(ctx, id, true);
        this.manageClass(ctx, row);
        checkRevision(row.revision, expected);
        const course = await this.findCourse(ctx, row.course_id);
        operational(course);
        const value = { ...projectClass(row), ...input };
        validateDates(value.startDate, value.endDate, {
          start: dateValue(course.start_date),
          end: dateValue(course.end_date),
        });
        const result = await ctx.client.query(
          `UPDATE app.classes SET code=$2,name=$3,description=$4,start_date=$5,end_date=$6,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *`,
          [
            id,
            value.code,
            value.name,
            value.description,
            value.startDate,
            value.endDate,
          ],
        );
        await audit(
          ctx.client,
          who,
          ctx.organizationId,
          'class.updated',
          'class',
          id,
        );
        return projectClass(result.rows[0]);
      },
    );
  }
  assignTeacher(who: Actor, id: string, teacherId: string, expected: number) {
    return this.access.resource(
      who,
      'class',
      id,
      true,
      ['ADMIN'],
      async (ctx) => {
        const row = await classRow(ctx, id, true);
        checkRevision(row.revision, expected);
        await this.activeTeacher(ctx, teacherId);
        const result = await ctx.client.query(
          'UPDATE app.classes SET teacher_id=$2,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *',
          [id, teacherId],
        );
        await audit(
          ctx.client,
          who,
          ctx.organizationId,
          'class.teacher_assigned',
          'class',
          id,
          { teacherId },
        );
        return projectClass(result.rows[0]);
      },
    );
  }
  archiveClass(who: Actor, id: string, expected: number) {
    return this.access.resource(
      who,
      'class',
      id,
      true,
      ['ADMIN'],
      async (ctx) => {
        const row = await classRow(ctx, id, true);
        checkRevision(row.revision, expected);
        if (
          (
            await ctx.client.query(
              "SELECT id FROM app.activities WHERE class_id=$1 AND state='PUBLISHED' LIMIT 1",
              [id],
            )
          ).rowCount
        )
          throw conflict(
            'Cierra las actividades publicadas antes de archivar la clase.',
          );
        await ctx.client.query(
          'UPDATE app.class_join_codes SET revoked_at=now(),revision=revision+1 WHERE class_id=$1 AND revoked_at IS NULL',
          [id],
        );
        const result = await ctx.client.query(
          'UPDATE app.classes SET archived_at=now(),revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *',
          [id],
        );
        await audit(
          ctx.client,
          who,
          ctx.organizationId,
          'class.archived',
          'class',
          id,
        );
        return projectClass(result.rows[0]);
      },
    );
  }
  codes(who: Actor, id: string, query: AcademicQuery) {
    return this.access.resource(
      who,
      'class',
      id,
      false,
      ['ADMIN', 'TEACHER'],
      async (ctx) => {
        this.manageClass(ctx, await classRow(ctx, id));
        const rows = await ctx.client.query(
          'SELECT * FROM app.class_join_codes WHERE class_id=$1 AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT $3',
          [id, query.cursor ?? null, query.limit + 1],
        );
        return pageResult(
          rows.rows.map(projectCode),
          query.limit,
          (row) => row.id,
        );
      },
    );
  }
  issueCode(who: Actor, id: string, expiresAt?: string) {
    return this.access.resource(
      who,
      'class',
      id,
      true,
      ['ADMIN', 'TEACHER'],
      async (ctx) => {
        this.manageClass(ctx, await classRow(ctx, id, true));
        const expiry = expiresAt
          ? new Date(expiresAt)
          : new Date(Date.now() + 7 * 86400000);
        if (expiry.getTime() <= Date.now())
          throw invalid(
            'La vigencia del código debe terminar en el futuro.',
            'expiresAt',
          );
        const token = randomBytes(16).toString('hex').toUpperCase();
        const codeId = randomUUID();
        const result = await ctx.client.query(
          'INSERT INTO app.class_join_codes(id,organization_id,class_id,token_digest,expires_at,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
          [codeId, ctx.organizationId, id, digest(token), expiry, who.actorId],
        );
        await audit(
          ctx.client,
          who,
          ctx.organizationId,
          'class.join_code_created',
          'class_join_code',
          codeId,
        );
        return { ...projectCode(result.rows[0]), code: token };
      },
    );
  }
  revokeCode(who: Actor, id: string, codeId: string, expected: number) {
    return this.access.resource(
      who,
      'class',
      id,
      true,
      ['ADMIN', 'TEACHER'],
      async (ctx) => {
        this.manageClass(ctx, await classRow(ctx, id, true));
        const row = (
          await ctx.client.query(
            'SELECT * FROM app.class_join_codes WHERE id=$1 AND class_id=$2',
            [codeId, id],
          )
        ).rows[0];
        if (!row) throw notFound();
        if (ctx.role !== 'ADMIN' && row.created_by !== who.actorId)
          throw forbidden();
        checkRevision(row.revision, expected);
        if (row.revoked_at) return projectCode(row);
        const result = await ctx.client.query(
          'UPDATE app.class_join_codes SET revoked_at=now(),revision=revision+1 WHERE id=$1 RETURNING *',
          [codeId],
        );
        await audit(
          ctx.client,
          who,
          ctx.organizationId,
          'class.join_code_revoked',
          'class_join_code',
          codeId,
        );
        return projectCode(result.rows[0]);
      },
    );
  }
  previewEnrollment(who: Actor, org: string, token: string) {
    return this.access.organization(
      who,
      org,
      false,
      ['STUDENT'],
      async (ctx) => {
        const row = await this.preview(ctx, token);
        return classJoinPreviewSchema.parse({
          classId: row.class_id,
          className: row.class_name,
          courseName: row.course_name,
          expiresAt: iso(row.expires_at),
          alreadyEnrolled: row.already_enrolled,
        });
      },
    );
  }
  enroll(who: Actor, org: string, token: string, key: string) {
    return this.access.organization(
      who,
      org,
      true,
      ['STUDENT'],
      async (ctx) => {
        const preview = await this.preview(ctx, token);
        return idempotent(
          ctx.client,
          who,
          org,
          'class.enroll',
          key,
          { digest: digest(token) },
          201,
          async () => {
            await ctx.client.query(
              "SELECT set_config('app.class_join_digest',$1,true)",
              [digest(token)],
            );
            const inserted = await ctx.client.query(
              `INSERT INTO app.class_memberships(id,organization_id,class_id,user_id,joined_at) VALUES($1,$2,$3,$4,now()) ON CONFLICT (organization_id,class_id,user_id) DO NOTHING RETURNING *`,
              [randomUUID(), org, preview.class_id, who.actorId],
            );
            const existing =
              inserted.rows[0] ??
              (
                await ctx.client.query(
                  'SELECT * FROM app.class_memberships WHERE organization_id=$1 AND class_id=$2 AND user_id=$3',
                  [org, preview.class_id, who.actorId],
                )
              ).rows[0];
            if (!existing || existing.state !== 'ACTIVE') throw forbidden();
            if (inserted.rowCount)
              await audit(
                ctx.client,
                who,
                org,
                'class.enrolled',
                'class_membership',
                existing.id,
                { classId: preview.class_id },
              );
            const data = classEnrollmentSchema.parse({
              id: existing.id,
              organizationId: org,
              classId: existing.class_id,
              userId: who.actorId,
              joinedAt: iso(existing.joined_at),
              alreadyEnrolled: !inserted.rowCount,
            });
            return {
              data,
              resourceId: existing.id,
              resourceType: 'class_membership',
            };
          },
        );
      },
    );
  }
  private async preview(ctx: Context, token: string) {
    const row = (
      await ctx.client.query(
        'SELECT * FROM app_private.preview_class_join_code($1)',
        [digest(token)],
      )
    ).rows[0];
    if (!row || row.organization_id !== ctx.organizationId)
      throw invalid(
        'El código no está disponible. Verifica su vigencia y organización.',
        'code',
      );
    return row;
  }
  private async findCourse(ctx: Context, id: string) {
    const row = (
      await ctx.client.query(
        'SELECT * FROM app.courses WHERE id=$1 AND organization_id=$2',
        [id, ctx.organizationId],
      )
    ).rows[0];
    if (!row) throw notFound();
    return row;
  }
  private manageClass(ctx: Context, row: Record<string, unknown>) {
    if (ctx.role !== 'ADMIN' && row.teacher_id !== ctx.who.actorId)
      throw forbidden();
  }
  private async activeTeacher(ctx: Context, id: string) {
    const valid = await ctx.client.query(
      `SELECT m.user_id FROM app.organization_memberships m JOIN app.profiles p ON p.id=m.user_id WHERE m.organization_id=$1 AND m.user_id=$2 AND m.role='TEACHER' AND m.state='ACTIVE' AND p.account_state='ACTIVE'`,
      [ctx.organizationId, id],
    );
    if (!valid.rowCount)
      throw invalid(
        'El profesor debe estar activo y pertenecer a la organización.',
        'teacherId',
      );
  }
}
