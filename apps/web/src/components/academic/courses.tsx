'use client';

import { useState } from 'react';
import {
  academicArchiveSchema,
  courseCreateSchema,
  courseUpdateSchema,
  courseResponseSchema,
  courseListResponseSchema,
  courseTeacherListResponseSchema,
  memberListResponseSchema,
  type Course,
} from '@alunza/contracts';
import { Field, SelectField } from '@/components/identity-forms';
import { Button } from '@/components/ui/button';
import { useApiResource } from '@/lib/use-api-resource';
import {
  ConfirmAction,
  LoadState,
  RecordForm,
  Section,
  TextAreaField,
  etagFor,
  optionalDate,
  usePagedResource,
} from './shared';

function CourseForm({
  orgId,
  course,
  done,
}: {
  orgId: string;
  course?: Course;
  done: () => unknown;
}) {
  return (
    <RecordForm
      title={course ? 'Editar curso' : 'Crear curso'}
      description="Define el curso y sus fechas académicas, sin hora."
      path={
        course
          ? `/api/v1/courses/${course.id}`
          : `/api/v1/organizations/${orgId}/courses`
      }
      inputSchema={course ? courseUpdateSchema : courseCreateSchema}
      responseSchema={courseResponseSchema}
      method={course ? 'PATCH' : 'POST'}
      etag={course ? etagFor(course.revision) : undefined}
      onDone={done}
      read={(form) => ({
        code: form.get('code'),
        name: form.get('name'),
        description: form.get('description'),
        academicPeriod: form.get('academicPeriod'),
        startDate: optionalDate(form, 'startDate'),
        endDate: optionalDate(form, 'endDate'),
      })}
    >
      {(error) => (
        <>
          <Field
            label="Código del curso"
            name="code"
            required
            maxLength={40}
            defaultValue={course?.code}
            error={error}
          />
          <Field
            label="Nombre del curso"
            name="name"
            required
            maxLength={160}
            defaultValue={course?.name}
            error={error}
          />
          <Field
            label="Período académico"
            name="academicPeriod"
            required
            maxLength={80}
            defaultValue={course?.academicPeriod}
            error={error}
          />
          <TextAreaField
            label="Descripción"
            name="description"
            maxLength={4000}
            defaultValue={course?.description ?? ''}
            error={error}
          />
          <Field
            label="Fecha de inicio"
            name="startDate"
            type="date"
            defaultValue={course?.startDate ?? ''}
            error={error}
          />
          <Field
            label="Fecha de término"
            name="endDate"
            type="date"
            defaultValue={course?.endDate ?? ''}
            error={error}
          />
        </>
      )}
    </RecordForm>
  );
}

function CourseTeachers({
  course,
  done,
}: {
  course: Course;
  done: () => unknown;
}) {
  const grants = useApiResource(
    `/api/v1/courses/${course.id}/teachers?limit=100`,
    courseTeacherListResponseSchema,
  );
  const members = usePagedResource(
    `/api/v1/organizations/${course.organizationId}/members?role=TEACHER&state=ACTIVE`,
    memberListResponseSchema,
  );
  const [teacherId, setTeacherId] = useState('');
  const teachers =
    members.state.status === 'ready'
      ? members.state.result.body.data.filter(
          (member) => member.role === 'TEACHER' && member.state === 'ACTIVE',
        )
      : [];
  return (
    <div className="space-y-4 border-t pt-4">
      <h4 className="font-semibold">
        Profesores habilitados para crear clases
      </h4>
      <p className="text-sm text-muted-foreground">
        Revocar una habilitación no retira clases ya asignadas.
      </p>
      <LoadState state={grants.state} reload={grants.reload} />
      <LoadState state={members.state} reload={members.reload} />
      {grants.state.status === 'ready' ? (
        <ul className="space-y-3">
          {grants.state.result.body.data.map((grant) => (
            <li
              key={grant.teacherId}
              className="flex flex-wrap items-center gap-3"
            >
              <span>
                {grant.teacherName} ·{' '}
                {grant.enabled ? 'Habilitado' : 'Revocado'}
              </span>
              {grant.enabled ? (
                <ConfirmAction
                  label="Revocar habilitación"
                  description={`Retirar a ${grant.teacherName} el permiso para crear nuevas clases de este curso. Sus clases existentes se conservan.`}
                  path={`/api/v1/courses/${course.id}/teachers/${grant.teacherId}`}
                  method="PUT"
                  body={{ enabled: false }}
                  schema={courseResponseSchema}
                  etag={etagFor(course.revision)}
                  onDone={() => {
                    void grants.reload();
                    void done();
                  }}
                />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {members.state.status === 'ready' ? (
        <>
          <SelectField
            label="Profesor para habilitar"
            name="teacherGrantId"
            value={teacherId}
            onChange={(event) => setTeacherId(event.target.value)}
          >
            <option value="">Seleccionar profesor</option>
            {teachers.map((teacher) => (
              <option key={teacher.userId} value={teacher.userId}>
                {teacher.displayName}
              </option>
            ))}
          </SelectField>
          {members.pagination(members.state.result.body.page)}
          <ConfirmAction
            label="Habilitar profesor"
            description="El profesor podrá crear y administrar sus propias clases de este curso."
            disabled={!teacherId}
            path={`/api/v1/courses/${course.id}/teachers/${teacherId}`}
            schema={courseResponseSchema}
            method="PUT"
            body={{ enabled: true }}
            etag={etagFor(course.revision)}
            onDone={() => {
              void grants.reload();
              void done();
            }}
          />
        </>
      ) : null}
    </div>
  );
}

export function Courses({ orgId }: { orgId: string }) {
  const resource = usePagedResource(
    `/api/v1/organizations/${orgId}/courses`,
    courseListResponseSchema,
  );
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <Section
      title="Cursos"
      action={<CourseForm orgId={orgId} done={resource.reload} />}
    >
      <LoadState state={resource.state} reload={resource.reload} />
      {resource.state.status === 'ready' ? (
        <>
          <div className="space-y-4">
            {resource.state.result.body.data.length === 0 ? (
              <p>No hay cursos. Crea uno para habilitar clases.</p>
            ) : null}
            {resource.state.result.body.data.map((course) => (
              <article
                key={course.id}
                data-cy="course-card"
                className="space-y-3 rounded-lg border p-4"
              >
                <h3 className="font-semibold">{course.name}</h3>
                <p className="text-sm">
                  {course.code} · {course.academicPeriod} ·{' '}
                  {course.state === 'ACTIVE' ? 'Activo' : 'Archivado'}
                </p>
                <p className="whitespace-pre-wrap text-sm">
                  {course.description}
                </p>
                <p className="text-sm">
                  {course.startDate ?? 'Sin fecha inicial'} —{' '}
                  {course.endDate ?? 'Sin fecha final'}
                </p>
                {course.state === 'ACTIVE' ? (
                  <div className="flex flex-wrap gap-2">
                    <CourseForm
                      orgId={orgId}
                      course={course}
                      done={resource.reload}
                    />
                    <Button
                      variant="outline"
                      aria-expanded={expanded === course.id}
                      onClick={() =>
                        setExpanded(expanded === course.id ? null : course.id)
                      }
                    >
                      Habilitaciones docentes
                    </Button>
                    <RecordForm
                      title="Archivar curso"
                      description="El curso archivado conserva su historia. Resuelve sus dependencias activas antes de confirmar."
                      path={`/api/v1/courses/${course.id}/archive`}
                      inputSchema={academicArchiveSchema}
                      responseSchema={courseResponseSchema}
                      etag={etagFor(course.revision)}
                      read={(form) => ({ reason: form.get('reason') })}
                      onDone={resource.reload}
                    >
                      {(error) => (
                        <Field
                          label="Motivo"
                          name="reason"
                          required
                          maxLength={500}
                          error={error}
                        />
                      )}
                    </RecordForm>
                  </div>
                ) : null}
                {expanded === course.id && course.state === 'ACTIVE' ? (
                  <CourseTeachers course={course} done={resource.reload} />
                ) : null}
              </article>
            ))}
          </div>
          {resource.pagination(resource.state.result.body.page)}
        </>
      ) : null}
    </Section>
  );
}
