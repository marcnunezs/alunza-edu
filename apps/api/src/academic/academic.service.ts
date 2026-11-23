import { Injectable } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { courseSchema, classSchema, enrollmentSchema } from '@alunza/contracts';
import { DatabaseService } from '../database/database.service';
import { ApiError, notFound } from '../http/errors';
import {
  audit,
  checkRevision,
  digest,
  idempotent,
  iso,
  pageResult,
} from '../governance/governance.shared';
import type { Actor } from '../governance/governance.shared';
import {
  academicContext,
  available,
  classAccess,
  dateOnly,
  forbidden,
  resource,
} from './academic.shared';
import type { AcademicQuery } from './academic.shared';
import type { PoolClient } from 'pg';

type CourseInput = {
  code: string;
  name: string;
  description?: string;
  academicPeriod: string;
  startDate?: string | null;
  endDate?: string | null;
};
type ClassInput = {
  courseId: string;
  code: string;
  name: string;
  description?: string;
  teacherId?: string;
  startDate?: string | null;
  endDate?: string | null;
};
export function projectCourse(row: Record<string, unknown>) {
  return courseSchema.parse({
    id: row.id,
    organizationId: row.organization_id,
    code: row.code,
    name: row.name,
    description: row.description,
    academicPeriod: row.academic_period,
    startDate: dateOnly(row.start_date),
    endDate: dateOnly(row.end_date),
    revision: row.revision,
    state: row.archived_at ? 'ARCHIVED' : 'ACTIVE',
  });
}
export async function projectClass(
  client: PoolClient,
  row: Record<string, unknown>,
) {
  const name =
    row.teacher_name !== undefined
      ? row.teacher_name
      : (
          await client.query(
            'SELECT app_private.academic_teacher_name($1::uuid,$2::uuid) AS name',
            [row.organization_id, row.teacher_id],
          )
        ).rows[0]?.name;
  return classSchema.parse({
    id: row.id,
    organizationId: row.organization_id,
    courseId: row.course_id,
    code: row.code,
    name: row.name,
    description: row.description,
    startDate: dateOnly(row.start_date),
    endDate: dateOnly(row.end_date),
    teacherId: row.teacher_id,
    teacherName: name ?? 'Profesor',
    revision: row.revision,
    state: row.archived_at ? 'ARCHIVED' : 'ACTIVE',
  });
}
function dates(start: unknown, end: unknown) {
  if (start && end && String(start) > String(end))
    throw new ApiError(
      'VALIDATION_FAILED',
      'La fecha de término debe ser posterior al inicio.',
      422,
      false,
      [{ field: 'endDate', message: 'Revisa el intervalo académico.' }],
    );
}
function projectCode(row: Record<string, unknown>) {
  return {
    id: row.id,
    classId: row.class_id,
    expiresAt: iso(row.expires_at as Date),
    revokedAt: iso(row.revoked_at as Date | null),
    revision: row.revision,
  };
}

@Injectable()
export class AcademicService {
  constructor(private readonly database: DatabaseService) {}
  async courses(who: Actor, org: string, query: AcademicQuery) {
    return this.database.readAs(
      who.actorId,
      async (client) => {
        await academicContext(client, who, org, false, ['ADMIN', 'TEACHER']);
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
      who.sessionId,
    );
  }
  async course(who: Actor, id: string) {
    return this.database.readAs(
      who.actorId,
      async (client) =>
        projectCourse(
          (
            await resource(client, who, 'course', id, false, [
              'ADMIN',
              'TEACHER',
            ])
          ).row,
        ),
      who.sessionId,
    );
  }
  async createCourse(who: Actor, org: string, input: CourseInput, key: string) {
    return this.database.writeAs(
      who.actorId,
      async (client) => {
        await academicContext(client, who, org, true, ['ADMIN']);
        return idempotent(
          client,
          who,
          org,
          'course.create',
          key,
          input,
          201,
          async () => {
            dates(input.startDate, input.endDate);
            const id = randomUUID();
            const row = (
              await client.query(
                'INSERT INTO app.courses(id,organization_id,code,name,description,academic_period,start_date,end_date) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
                [
                  id,
                  org,
                  input.code,
                  input.name,
                  input.description ?? '',
                  input.academicPeriod,
                  input.startDate ?? null,
                  input.endDate ?? null,
                ],
              )
            ).rows[0];
            await audit(client, who, org, 'course.created', 'course', id);
            return {
              data: projectCourse(row),
              resourceId: id,
              resourceType: 'course',
            };
          },
        );
      },
      who.sessionId,
    );
  }
  async updateCourse(
    who: Actor,
    id: string,
    input: Partial<CourseInput>,
    expected: number,
  ) {
    return this.database.writeAs(
      who.actorId,
      async (client) => {
        const { row } = await resource(client, who, 'course', id, true, [
          'ADMIN',
        ]);
        available(row);
        checkRevision(row.revision, expected);
        dates(
          input.startDate === undefined
            ? dateOnly(row.start_date)
            : input.startDate,
          input.endDate === undefined ? dateOnly(row.end_date) : input.endDate,
        );
        const updated = (
          await client.query(
            `UPDATE app.courses SET code=$2,name=$3,description=$4,academic_period=$5,start_date=$6,end_date=$7,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *`,
            [
              id,
              input.code ?? row.code,
              input.name ?? row.name,
              input.description ?? row.description,
              input.academicPeriod ?? row.academic_period,
              input.startDate === undefined ? row.start_date : input.startDate,
              input.endDate === undefined ? row.end_date : input.endDate,
            ],
          )
        ).rows[0];
        await audit(
          client,
          who,
          row.organization_id,
          'course.updated',
          'course',
          id,
          { fields: Object.keys(input) },
        );
        return projectCourse(updated);
      },
      who.sessionId,
    );
  }
  async courseTeachers(who: Actor, id: string, query: AcademicQuery) {
    return this.database.readAs(
      who.actorId,
      async (client) => {
        await resource(client, who, 'course', id, false, ['ADMIN', 'TEACHER']);
        const rows = (
          await client.query(
            `SELECT g.*,app_private.academic_teacher_name(g.organization_id,g.teacher_id) AS teacher_name FROM app.course_teacher_grants g WHERE course_id=$1 AND ($2::uuid IS NULL OR g.teacher_id>$2) ORDER BY g.teacher_id LIMIT $3`,
            [id, query.cursor ?? null, query.limit + 1],
          )
        ).rows;
        return pageResult(
          rows.map((row) => ({
            courseId: id,
            teacherId: String(row.teacher_id),
            teacherName: String(row.teacher_name ?? 'Profesor'),
            enabled: !row.revoked_at,
          })),
          query.limit,
          (row) => row.teacherId,
        );
      },
      who.sessionId,
    );
  }
  async grantTeacher(
    who: Actor,
    id: string,
    teacherId: string,
    enabled: boolean,
    expected: number,
  ) {
    return this.database.writeAs(
      who.actorId,
      async (client) => {
        const { row } = await resource(client, who, 'course', id, true, [
          'ADMIN',
        ]);
        available(row);
        checkRevision(row.revision, expected);
        if (enabled)
          await this.assertTeacher(client, row.organization_id, teacherId);
        await client.query(
          `INSERT INTO app.course_teacher_grants(id,organization_id,course_id,teacher_id,granted_by,revoked_at) VALUES($1,$2,$3,$4,$5,CASE WHEN $6 THEN NULL ELSE now() END) ON CONFLICT(organization_id,course_id,teacher_id) DO UPDATE SET revoked_at=EXCLUDED.revoked_at,granted_by=EXCLUDED.granted_by,revision=app.course_teacher_grants.revision+1`,
          [
            randomUUID(),
            row.organization_id,
            id,
            teacherId,
            who.actorId,
            enabled,
          ],
        );
        const updated = (
          await client.query(
            'UPDATE app.courses SET revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *',
            [id],
          )
        ).rows[0];
        await audit(
          client,
          who,
          row.organization_id,
          'course.teacher.changed',
          'course',
          id,
          { teacherId, enabled },
        );
        return projectCourse(updated);
      },
      who.sessionId,
    );
  }
  private async assertTeacher(client: PoolClient, org: string, id: string) {
    const teacher = (
      await client.query(
        `SELECT m.user_id FROM app.organization_memberships m JOIN app.profiles p ON p.id=m.user_id WHERE m.organization_id=$1 AND m.user_id=$2 AND m.role='TEACHER' AND m.state='ACTIVE' AND p.account_state='ACTIVE'`,
        [org, id],
      )
    ).rows[0];
    if (!teacher)
      throw new ApiError(
        'VALIDATION_FAILED',
        'Selecciona un profesor activo de esta organización.',
        422,
        false,
        [{ field: 'teacherId', message: 'Profesor no disponible.' }],
      );
  }
  async classes(who: Actor, org: string, query: AcademicQuery) {
    return this.database.readAs(
      who.actorId,
      async (client) => {
        const { role } = await academicContext(client, who, org, false);
        const rows = (
          await client.query(
            `SELECT c.*,app_private.academic_teacher_name(c.organization_id,c.teacher_id) AS teacher_name FROM app.classes c WHERE organization_id=$1 AND ($2::uuid IS NULL OR c.id>$2) AND ($3::text IS NULL OR c.name ILIKE '%'||$3||'%' OR c.code ILIKE '%'||$3||'%') AND ($4::text IS NULL OR (CASE WHEN c.archived_at IS NULL THEN 'ACTIVE' ELSE 'ARCHIVED' END)=$4) AND ($6='ADMIN' OR ($6='TEACHER' AND c.teacher_id=$7) OR ($6='STUDENT' AND EXISTS(SELECT 1 FROM app.class_memberships m WHERE m.class_id=c.id AND m.user_id=$7 AND m.ended_at IS NULL))) ORDER BY c.id LIMIT $5`,
            [
              org,
              query.cursor ?? null,
              query.search ?? null,
              query.state ?? null,
              query.limit + 1,
              role,
              who.actorId,
            ],
          )
        ).rows;
        return pageResult(
          await Promise.all(rows.map((row) => projectClass(client, row))),
          query.limit,
          (row) => row.id,
        );
      },
      who.sessionId,
    );
  }
  async class(who: Actor, id: string) {
    return this.database.readAs(
      who.actorId,
      async (client) =>
        projectClass(client, (await classAccess(client, who, id)).row),
      who.sessionId,
    );
  }
  async createClass(who: Actor, org: string, input: ClassInput, key: string) {
    return this.database.writeAs(
      who.actorId,
      async (client) => {
        const { role } = await academicContext(client, who, org, true, [
          'ADMIN',
          'TEACHER',
        ]);
        return idempotent(
          client,
          who,
          org,
          'class.create',
          key,
          input,
          201,
          async () => {
            const course = (
              await client.query(
                'SELECT * FROM app.courses WHERE organization_id=$1 AND id=$2',
                [org, input.courseId],
              )
            ).rows[0];
            if (!course) throw notFound();
            available(course);
            const teacherId =
              role === 'TEACHER' ? who.actorId : input.teacherId;
            if (
              !teacherId ||
              (role === 'TEACHER' &&
                input.teacherId &&
                input.teacherId !== who.actorId)
            )
              forbidden();
            if (role === 'ADMIN')
              await this.assertTeacher(client, org, teacherId);
            else if (
              !(
                await client.query(
                  'SELECT id FROM app.course_teacher_grants WHERE organization_id=$1 AND course_id=$2 AND teacher_id=$3 AND revoked_at IS NULL',
                  [org, input.courseId, who.actorId],
                )
              ).rows[0]
            )
              forbidden();
            dates(input.startDate, input.endDate);
            const id = randomUUID();
            const row = (
              await client.query(
                'INSERT INTO app.classes(id,organization_id,course_id,teacher_id,code,name,description,start_date,end_date) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
                [
                  id,
                  org,
                  input.courseId,
                  teacherId,
                  input.code,
                  input.name,
                  input.description ?? '',
                  input.startDate ?? null,
                  input.endDate ?? null,
                ],
              )
            ).rows[0];
            await audit(client, who, org, 'class.created', 'class', id, {
              courseId: input.courseId,
              teacherId,
            });
            return {
              data: await projectClass(client, row),
              resourceId: id,
              resourceType: 'class',
            };
          },
        );
      },
      who.sessionId,
    );
  }
  async updateClass(
    who: Actor,
    id: string,
    input: Partial<Omit<ClassInput, 'courseId' | 'teacherId'>>,
    expected: number,
  ) {
    return this.database.writeAs(
      who.actorId,
      async (client) => {
        const { row } = await classAccess(client, who, id, true);
        checkRevision(row.revision, expected);
        dates(
          input.startDate === undefined
            ? dateOnly(row.start_date)
            : input.startDate,
          input.endDate === undefined ? dateOnly(row.end_date) : input.endDate,
        );
        const updated = (
          await client.query(
            'UPDATE app.classes SET code=$2,name=$3,description=$4,start_date=$5,end_date=$6,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *',
            [
              id,
              input.code ?? row.code,
              input.name ?? row.name,
              input.description ?? row.description,
              input.startDate === undefined ? row.start_date : input.startDate,
              input.endDate === undefined ? row.end_date : input.endDate,
            ],
          )
        ).rows[0];
        await audit(
          client,
          who,
          row.organization_id,
          'class.updated',
          'class',
          id,
          { fields: Object.keys(input) },
        );
        return projectClass(client, updated);
      },
      who.sessionId,
    );
  }
  async assignTeacher(
    who: Actor,
    id: string,
    teacherId: string,
    expected: number,
  ) {
    return this.database.writeAs(
      who.actorId,
      async (client) => {
        const { row } = await resource(client, who, 'class', id, true, [
          'ADMIN',
        ]);
        available(row);
        checkRevision(row.revision, expected);
        await this.assertTeacher(client, row.organization_id, teacherId);
        if (row.teacher_id === teacherId) return projectClass(client, row);
        const updated = (
          await client.query(
            'UPDATE app.classes SET teacher_id=$2,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *',
            [id, teacherId],
          )
        ).rows[0];
        await client.query(
          'UPDATE app.class_join_codes SET revoked_at=now(),revision=revision+1 WHERE class_id=$1 AND revoked_at IS NULL',
          [id],
        );
        await audit(
          client,
          who,
          row.organization_id,
          'class.teacher.assigned',
          'class',
          id,
          { teacherId },
        );
        return projectClass(client, updated);
      },
      who.sessionId,
    );
  }
  async archive(
    who: Actor,
    kind: 'class' | 'course',
    id: string,
    reason: string,
    expected: number,
    key: string,
  ) {
    return this.database.writeAs(
      who.actorId,
      async (client) => {
        const { row } = await resource(client, who, kind, id, true, ['ADMIN']);
        return idempotent(
          client,
          who,
          row.organization_id,
          `${kind}.archive`,
          key,
          { id, reason, expected },
          200,
          async () => {
            checkRevision(row.revision, expected);
            available(row);
            const dependencies =
              kind === 'class'
                ? await client.query(
                    "SELECT id FROM app.activities WHERE class_id=$1 AND state='PUBLISHED' LIMIT 1",
                    [id],
                  )
                : await client.query(
                    'SELECT id FROM app.classes WHERE course_id=$1 AND archived_at IS NULL LIMIT 1',
                    [id],
                  );
            if (dependencies.rows.length)
              throw new ApiError(
                'DEPENDENCIES_ACTIVE',
                'Existen dependencias activas que impiden archivar.',
                409,
              );
            const updated = (
              await client.query(
                `UPDATE app.${kind === 'class' ? 'classes' : 'courses'} SET archived_at=now(),revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *`,
                [id],
              )
            ).rows[0];
            if (kind === 'class')
              await client.query(
                'UPDATE app.class_join_codes SET revoked_at=now(),revision=revision+1 WHERE class_id=$1 AND revoked_at IS NULL',
                [id],
              );
            await audit(
              client,
              who,
              row.organization_id,
              `${kind}.archived`,
              kind,
              id,
              { reason },
            );
            return {
              data:
                kind === 'class'
                  ? await projectClass(client, updated)
                  : projectCourse(updated),
              resourceId: id,
              resourceType: kind,
            };
          },
        );
      },
      who.sessionId,
    );
  }
  async codes(who: Actor, id: string, query: AcademicQuery) {
    return this.database.readAs(
      who.actorId,
      async (client) => {
        const { role } = await classAccess(client, who, id);
        if (role === 'STUDENT') forbidden();
        const rows = (
          await client.query(
            'SELECT id,class_id,expires_at,revoked_at,revision FROM app.class_join_codes WHERE class_id=$1 AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT $3',
            [id, query.cursor ?? null, query.limit + 1],
          )
        ).rows;
        return pageResult(rows.map(projectCode), query.limit, (row) =>
          String(row.id),
        );
      },
      who.sessionId,
    );
  }
  async issueCode(
    who: Actor,
    id: string,
    expiresAt: string | undefined,
    expected: number,
    key: string,
  ) {
    return this.database.writeAs(
      who.actorId,
      async (client) => {
        const { row } = await classAccess(client, who, id, true);
        let plaintext: string | undefined;
        const data = await idempotent(
          client,
          who,
          row.organization_id,
          'class.code.issue',
          key,
          { id, expiresAt: expiresAt ?? null, expected },
          201,
          async () => {
            checkRevision(row.revision, expected);
            const createdAt = new Date(
              (await client.query('SELECT clock_timestamp() AS now')).rows[0]
                .now,
            );
            const expiry = expiresAt
              ? new Date(expiresAt)
              : new Date(createdAt.getTime() + 7 * 86400_000);
            if (
              expiry.getTime() <= createdAt.getTime() ||
              expiry.getTime() > createdAt.getTime() + 7 * 86400_000
            )
              throw new ApiError(
                'VALIDATION_FAILED',
                'El código debe vencer dentro de los próximos siete días.',
                422,
                false,
                [{ field: 'expiresAt', message: 'Vigencia inválida.' }],
              );
            plaintext = randomBytes(24).toString('base64url');
            const codeId = randomUUID();
            await client.query(
              'UPDATE app.class_join_codes SET revoked_at=now(),revision=revision+1 WHERE class_id=$1 AND revoked_at IS NULL',
              [id],
            );
            const created = (
              await client.query(
                'INSERT INTO app.class_join_codes(id,organization_id,class_id,token_digest,expires_at,created_by,created_at) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,class_id,expires_at,revoked_at,revision',
                [
                  codeId,
                  row.organization_id,
                  id,
                  digest(plaintext),
                  expiry,
                  who.actorId,
                  createdAt,
                ],
              )
            ).rows[0];
            await audit(
              client,
              who,
              row.organization_id,
              'class.code.issued',
              'class_join_code',
              codeId,
              { classId: id },
            );
            return {
              data: projectCode(created),
              resourceId: codeId,
              resourceType: 'class_join_code',
            };
          },
        );
        return plaintext ? { ...data, code: plaintext } : data;
      },
      who.sessionId,
    );
  }
  async revokeCode(
    who: Actor,
    id: string,
    codeId: string,
    expected: number,
    key: string,
  ) {
    return this.database.writeAs(
      who.actorId,
      async (client) => {
        const { row } = await classAccess(client, who, id, true);
        return idempotent(
          client,
          who,
          row.organization_id,
          'class.code.revoke',
          key,
          { id, codeId, expected },
          200,
          async () => {
            const current = (
              await client.query(
                'SELECT * FROM app.class_join_codes WHERE class_id=$1 AND id=$2',
                [id, codeId],
              )
            ).rows[0];
            if (!current) throw notFound();
            checkRevision(current.revision, expected);
            const updated = (
              await client.query(
                'UPDATE app.class_join_codes SET revoked_at=coalesce(revoked_at,now()),revision=revision+1 WHERE id=$1 RETURNING id,class_id,expires_at,revoked_at,revision',
                [codeId],
              )
            ).rows[0];
            await audit(
              client,
              who,
              row.organization_id,
              'class.code.revoked',
              'class_join_code',
              codeId,
            );
            return {
              data: projectCode(updated),
              resourceId: codeId,
              resourceType: 'class_join_code',
            };
          },
        );
      },
      who.sessionId,
    );
  }
  async enrollment(who: Actor, code: string, key?: string) {
    const action = async (client: PoolClient) => {
      const tokenDigest = digest(code);
      await client.query("SELECT set_config('app.join_code_digest',$1,true)", [
        tokenDigest,
      ]);
      if (key) {
        const previous = (
          await client.query(
            'SELECT * FROM app_private.enrollment_replay($1::text,$2::text)',
            [tokenDigest, key],
          )
        ).rows[0];
        if (previous) {
          await academicContext(client, who, previous.organization_id, true, [
            'STUDENT',
          ]);
          const authorized = (
            await client.query(
              'SELECT * FROM app_private.enrollment_replay($1::text,$2::text)',
              [tokenDigest, key],
            )
          ).rows[0];
          if (!authorized) forbidden();
          return idempotent<ReturnType<typeof enrollmentSchema.parse>>(
            client,
            who,
            authorized.organization_id,
            'class.enroll',
            key,
            { digest: tokenDigest },
            200,
            async () => {
              throw new ApiError(
                'IDEMPOTENCY_CONFLICT',
                'La inscripción previa no está disponible.',
                409,
              );
            },
          );
        }
      }
      let row = (
        await client.query(
          'SELECT * FROM app_private.resolve_join_code($1::text)',
          [tokenDigest],
        )
      ).rows[0];
      if (!row)
        throw new ApiError(
          'JOIN_CODE_INVALID',
          'Verifica el código y su vigencia.',
          400,
        );
      await academicContext(client, who, row.organization_id, Boolean(key), [
        'STUDENT',
      ]);
      row = (
        await client.query(
          'SELECT * FROM app_private.resolve_join_code($1::text)',
          [tokenDigest],
        )
      ).rows[0];
      if (!row)
        throw new ApiError(
          'JOIN_CODE_INVALID',
          'Verifica el código y su vigencia.',
          400,
        );
      const existing = (
        await client.query(
          'SELECT * FROM app.class_memberships WHERE class_id=$1 AND user_id=$2',
          [row.class_id, who.actorId],
        )
      ).rows[0];
      if (existing?.ended_at) forbidden();
      const result = {
        organizationId: String(row.organization_id),
        classId: String(row.class_id),
        className: String(row.class_name),
        alreadyEnrolled: Boolean(existing),
      };
      if (!key) return result;
      return idempotent(
        client,
        who,
        row.organization_id,
        'class.enroll',
        key,
        { digest: tokenDigest },
        200,
        async () => {
          if (!existing) {
            await client.query(
              'INSERT INTO app.class_memberships(id,organization_id,class_id,user_id) VALUES($1,$2,$3,$4) ON CONFLICT(organization_id,class_id,user_id) DO NOTHING',
              [randomUUID(), row.organization_id, row.class_id, who.actorId],
            );
            await audit(
              client,
              who,
              row.organization_id,
              'class.enrolled',
              'class',
              row.class_id,
            );
          }
          return {
            data: result,
            resourceId: row.class_id,
            resourceType: 'class',
          };
        },
      );
    };
    return key
      ? this.database.writeAs(who.actorId, action, who.sessionId)
      : this.database.readAs(who.actorId, action, who.sessionId);
  }
  async students(who: Actor, id: string, query: AcademicQuery) {
    return this.database.readAs(
      who.actorId,
      async (client) => {
        const { role } = await classAccess(client, who, id);
        if (role === 'STUDENT') forbidden();
        const rows = (
          await client.query(
            `SELECT m.id,m.user_id,m.enrolled_at,app_private.academic_student_name(m.organization_id,m.class_id,m.user_id) AS display_name FROM app.class_memberships m WHERE m.class_id=$1 AND m.ended_at IS NULL AND ($2::uuid IS NULL OR m.user_id>$2) ORDER BY m.user_id LIMIT $3`,
            [id, query.cursor ?? null, query.limit + 1],
          )
        ).rows;
        return pageResult(
          rows.map((row) => ({
            userId: String(row.user_id),
            displayName: String(row.display_name),
            enrolledAt: iso(row.enrolled_at),
          })),
          query.limit,
          (row) => row.userId,
        );
      },
      who.sessionId,
    );
  }
}
