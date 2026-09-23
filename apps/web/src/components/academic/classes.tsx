'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  classCreateSchema,
  classResponseSchema,
  classListResponseSchema,
  courseListResponseSchema,
  memberListResponseSchema,
  enrollmentInputSchema,
  enrollmentResponseSchema,
  type Enrollment,
} from '@alunza/contracts';
import {
  Field,
  FormDialog,
  OperationError,
  SelectField,
  useOperation,
} from '@/components/identity-forms';
import { Button } from '@/components/ui/button';
import {
  LoadState,
  RecordForm,
  Section,
  TextAreaField,
  optionalDate,
  usePagedResource,
} from './shared';

export function TeacherSelect({
  orgId,
  defaultValue = '',
}: {
  orgId: string;
  defaultValue?: string;
}) {
  const resource = usePagedResource(
    `/api/v1/organizations/${orgId}/members?role=TEACHER&state=ACTIVE`,
    memberListResponseSchema,
  );
  return (
    <>
      <LoadState state={resource.state} reload={resource.reload} />
      {resource.state.status === 'ready' ? (
        <>
          <SelectField
            label="Profesor asignado"
            name="teacherId"
            required
            defaultValue={defaultValue}
          >
            <option value="">Seleccionar profesor</option>
            {resource.state.result.body.data
              .filter(
                (item) => item.role === 'TEACHER' && item.state === 'ACTIVE',
              )
              .map((teacher) => (
                <option key={teacher.userId} value={teacher.userId}>
                  {teacher.displayName}
                </option>
              ))}
          </SelectField>
          {resource.pagination(resource.state.result.body.page)}
        </>
      ) : null}
    </>
  );
}

function ClassForm({
  orgId,
  admin,
  done,
}: {
  orgId: string;
  admin: boolean;
  done: () => unknown;
}) {
  const courses = usePagedResource(
    `/api/v1/organizations/${orgId}/courses?state=ACTIVE`,
    courseListResponseSchema,
  );
  return (
    <RecordForm
      title="Crear clase"
      description={
        admin
          ? 'Asigna un profesor activo de tu organización.'
          : 'Puedes crear tu propia clase dentro de un curso habilitado por tu administrador.'
      }
      path={`/api/v1/organizations/${orgId}/classes`}
      inputSchema={classCreateSchema}
      responseSchema={classResponseSchema}
      onDone={done}
      read={(form) => ({
        courseId: form.get('courseId'),
        code: form.get('code'),
        name: form.get('name'),
        description: form.get('description'),
        startDate: optionalDate(form, 'startDate'),
        endDate: optionalDate(form, 'endDate'),
        ...(admin ? { teacherId: form.get('teacherId') } : {}),
      })}
    >
      {(error) => (
        <>
          <LoadState state={courses.state} reload={courses.reload} />
          {courses.state.status === 'ready' ? (
            <>
              <SelectField name="courseId" label="Curso" required error={error}>
                <option value="">Seleccionar curso</option>
                {courses.state.result.body.data.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.name} · {course.code}
                  </option>
                ))}
              </SelectField>
              {courses.pagination(courses.state.result.body.page)}
            </>
          ) : null}
          <Field
            name="code"
            label="Código de la clase"
            required
            maxLength={40}
            error={error}
          />
          <Field
            name="name"
            label="Nombre de la clase"
            required
            maxLength={160}
            error={error}
          />
          <TextAreaField
            name="description"
            label="Descripción"
            maxLength={4000}
            defaultValue=""
            error={error}
          />
          <Field
            name="startDate"
            label="Fecha de inicio"
            type="date"
            error={error}
          />
          <Field
            name="endDate"
            label="Fecha de término"
            type="date"
            error={error}
          />
          {admin ? <TeacherSelect orgId={orgId} /> : null}
        </>
      )}
    </RecordForm>
  );
}

export function EnrollmentForm({ done }: { done: () => unknown }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [preview, setPreview] = useState<Enrollment | null>(null);
  const [joined, setJoined] = useState<Enrollment | null>(null);
  const operation = useOperation();
  return (
    <FormDialog
      title="Incorporarme a una clase"
      description="Revisa la clase antes de confirmar tu incorporación."
      trigger={<Button>Incorporarme a una clase</Button>}
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (!value) {
          setPreview(null);
          setJoined(null);
          setCode('');
        }
      }}
      locked={operation.pending || operation.unresolved}
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          const body = operation.validate(enrollmentInputSchema, { code });
          if (!body) return;
          void operation
            .run(
              preview
                ? '/api/v1/class-enrollments'
                : '/api/v1/class-enrollments/preview',
              enrollmentResponseSchema,
              { method: 'POST', body },
            )
            .then((response) => {
              if (!response) return;
              if (preview) {
                setJoined(response.body.data);
                void done();
              } else setPreview(response.body.data);
            });
        }}
      >
        <OperationError
          error={operation.error}
          unresolved={operation.unresolved}
        />
        {joined ? (
          <div className="space-y-4">
            <p role="status">
              {joined.alreadyEnrolled
                ? 'Ya perteneces a esta clase.'
                : 'Incorporación confirmada.'}
            </p>
            <Button asChild>
              <Link href={`/clases/${joined.classId}`}>
                Abrir {joined.className}
              </Link>
            </Button>
          </div>
        ) : (
          <>
            <Field
              label="Código de incorporación"
              name="joinCode"
              required
              maxLength={128}
              autoComplete="off"
              value={code}
              disabled={!!preview || operation.pending || operation.unresolved}
              onChange={(event) => setCode(event.target.value)}
              error={operation.error}
            />
            {preview ? (
              <p>
                Clase: <strong>{preview.className}</strong>
                {preview.alreadyEnrolled ? ' · Ya tienes una membresía.' : ''}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-3">
              <Button type="submit" disabled={operation.pending}>
                {operation.pending
                  ? 'Comprobando…'
                  : preview
                    ? 'Confirmar incorporación'
                    : 'Revisar código'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={operation.pending || operation.unresolved}
                onClick={() => {
                  setOpen(false);
                  setPreview(null);
                  setCode('');
                }}
              >
                Cancelar
              </Button>
            </div>
          </>
        )}
      </form>
    </FormDialog>
  );
}

export function Classes({
  orgId,
  role,
}: {
  orgId: string;
  role: 'ADMIN' | 'TEACHER' | 'STUDENT';
}) {
  const resource = usePagedResource(
    `/api/v1/organizations/${orgId}/classes`,
    classListResponseSchema,
  );
  return (
    <Section
      title={role === 'STUDENT' ? 'Mis clases' : 'Clases'}
      action={
        role === 'STUDENT' ? (
          <EnrollmentForm done={resource.reload} />
        ) : (
          <ClassForm
            orgId={orgId}
            admin={role === 'ADMIN'}
            done={resource.reload}
          />
        )
      }
    >
      <LoadState state={resource.state} reload={resource.reload} />
      {resource.state.status === 'ready' ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            {resource.state.result.body.data.length === 0 ? (
              <p>No tienes clases disponibles.</p>
            ) : null}
            {resource.state.result.body.data.map((item) => (
              <article
                key={item.id}
                data-cy="class-card"
                className="space-y-3 rounded-lg border p-4"
              >
                <h3 className="text-lg font-semibold">{item.name}</h3>
                <p className="text-sm">
                  {item.code} ·{' '}
                  {item.state === 'ACTIVE'
                    ? 'Activa'
                    : 'Archivada · Solo lectura'}
                </p>
                <p className="text-sm">Profesor: {item.teacherName}</p>
                <Button asChild variant="outline">
                  <Link href={`/clases/${item.id}`}>Abrir clase</Link>
                </Button>
              </article>
            ))}
          </div>
          {resource.pagination(resource.state.result.body.page)}
        </>
      ) : null}
    </Section>
  );
}
