'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  courseCreateSchema,
  courseResponseSchema,
  courseListResponseSchema,
  classCreateSchema,
  classUpdateSchema,
  academicClassResponseSchema,
  academicClassListResponseSchema,
  memberListResponseSchema,
  classEnrollmentInputSchema,
  classJoinPreviewResponseSchema,
  classEnrollmentResponseSchema,
  type AcademicClass,
  type Course,
} from '@alunza/contracts';
import {
  Field,
  SelectField,
  FormDialog,
  OperationError,
  Pagination,
  useOperation,
  formatDate,
} from '@/components/identity-forms';
import {
  AcademicScope,
  TextAreaField,
  ConfirmAction,
  LoadError,
  RevisionConflict,
  academicBase,
  type AcademicMembership,
} from '@/components/academic-shared';
import { useApiResource } from '@/lib/use-api-resource';
import { useApiCollection } from '@/lib/use-api-collection';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';

function academicValues(form: FormData) {
  return {
    code: String(form.get('code') ?? ''),
    name: String(form.get('name') ?? ''),
    description: String(form.get('description') ?? ''),
    startDate: form.get('startDate') || null,
    endDate: form.get('endDate') || null,
  };
}

function AcademicFields({
  value,
  error,
  disabled,
}: {
  value?: Course | AcademicClass;
  error: ReturnType<typeof useOperation>['error'];
  disabled: boolean;
}) {
  return (
    <fieldset disabled={disabled} className="space-y-4">
      <Field
        label="Código"
        name="code"
        required
        maxLength={40}
        defaultValue={value?.code}
        error={error}
      />
      <Field
        label="Nombre"
        name="name"
        required
        maxLength={160}
        defaultValue={value?.name}
        error={error}
      />
      <TextAreaField
        label="Descripción"
        name="description"
        maxLength={10000}
        defaultValue={value?.description}
        error={error}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Fecha de inicio"
          name="startDate"
          type="date"
          defaultValue={value?.startDate ?? ''}
          error={error}
        />
        <Field
          label="Fecha de término"
          name="endDate"
          type="date"
          defaultValue={value?.endDate ?? ''}
          error={error}
        />
      </div>
    </fieldset>
  );
}

function CourseForm({
  orgId,
  value,
  onSaved,
}: {
  orgId: string;
  value?: Course;
  onSaved: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const operation = useOperation();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = operation.unresolved
      ? {}
      : operation.validate(courseCreateSchema, {
          ...academicValues(form),
          academicPeriod: form.get('academicPeriod'),
        });
    if (!body) return;
    const result = await operation.run(
      value
        ? `/api/v1/courses/${value.id}`
        : `/api/v1/organizations/${orgId}/courses`,
      courseResponseSchema,
      {
        method: value ? 'PATCH' : 'POST',
        body,
        ...(value ? { etag: `"${value.revision}"` } : {}),
      },
    );
    if (result) {
      setOpen(false);
      await onSaved();
    }
  }
  return (
    <FormDialog
      title={value ? 'Editar curso' : 'Crear curso'}
      description="Organiza las clases dentro de un curso y período académico."
      trigger={
        <Button variant={value ? 'outline' : 'default'}>
          {value ? 'Editar curso' : 'Crear curso'}
        </Button>
      }
      open={open}
      onOpenChange={setOpen}
      locked={operation.pending || operation.unresolved}
    >
      <form className="space-y-4" onSubmit={(event) => void submit(event)}>
        <AcademicFields
          value={value}
          error={operation.error}
          disabled={operation.pending || operation.unresolved}
        />
        <Field
          label="Período académico"
          name="academicPeriod"
          required
          maxLength={80}
          defaultValue={value?.academicPeriod}
          error={operation.error}
          disabled={operation.pending || operation.unresolved}
        />
        <OperationError
          error={operation.error}
          unresolved={operation.unresolved}
        />
        <Button type="submit" disabled={operation.pending}>
          {operation.pending
            ? 'Guardando…'
            : operation.unresolved
              ? 'Reintentar solicitud'
              : 'Guardar curso'}
        </Button>
        <RevisionConflict
          error={operation.error}
          reload={async () => {
            setOpen(false);
            await onSaved();
          }}
        />
      </form>
    </FormDialog>
  );
}

function TeacherField({
  orgId,
  defaultValue,
  disabled,
}: {
  orgId: string;
  defaultValue?: string;
  disabled: boolean;
}) {
  const { state, reload } = useApiCollection(
    `/api/v1/organizations/${orgId}/members?role=TEACHER&state=ACTIVE&limit=100`,
    memberListResponseSchema,
  );
  if (state.status === 'loading')
    return <p role="status">Consultando profesores…</p>;
  if (state.status === 'error')
    return <LoadError error={state.error} reload={reload} />;
  const teachers = state.result.body.data.filter(
    (member) => member.accountState === 'ACTIVE',
  );
  return (
    <SelectField
      label="Profesor asignado"
      name="teacherId"
      required
      defaultValue={defaultValue ?? ''}
      disabled={disabled || teachers.length === 0}
    >
      <option value="">Selecciona un profesor activo</option>
      {teachers.map((teacher) => (
        <option key={teacher.userId} value={teacher.userId}>
          {teacher.displayName} · {teacher.email}
        </option>
      ))}
    </SelectField>
  );
}

export function ClassForm({
  orgId,
  admin,
  courses,
  value,
  onSaved,
}: {
  orgId: string;
  admin: boolean;
  courses: Course[];
  value?: AcademicClass;
  onSaved: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const operation = useOperation();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const values = academicValues(form);
    const input = value
      ? values
      : {
          ...values,
          courseId: form.get('courseId'),
          ...(admin ? { teacherId: form.get('teacherId') } : {}),
        };
    const body = operation.unresolved
      ? {}
      : operation.validate(
          value ? classUpdateSchema : classCreateSchema,
          input,
        );
    if (!body) return;
    const result = await operation.run(
      value
        ? `/api/v1/classes/${value.id}`
        : `/api/v1/organizations/${orgId}/classes`,
      academicClassResponseSchema,
      {
        method: value ? 'PATCH' : 'POST',
        body,
        ...(value ? { etag: `"${value.revision}"` } : {}),
      },
    );
    if (result) {
      setOpen(false);
      await onSaved();
    }
  }
  return (
    <FormDialog
      title={value ? 'Editar clase' : 'Crear clase'}
      description="La clase reúne al profesor, estudiantes y actividades del curso."
      trigger={
        <Button variant={value ? 'outline' : 'default'}>
          {value ? 'Editar clase' : 'Crear clase'}
        </Button>
      }
      open={open}
      onOpenChange={setOpen}
      locked={operation.pending || operation.unresolved}
    >
      <form className="space-y-4" onSubmit={(event) => void submit(event)}>
        {!value && (
          <SelectField
            label="Curso"
            name="courseId"
            required
            defaultValue=""
            disabled={operation.pending || operation.unresolved}
          >
            <option value="">Selecciona un curso activo</option>
            {courses
              .filter((course) => course.state === 'ACTIVE')
              .map((course) => (
                <option key={course.id} value={course.id}>
                  {course.name} · {course.academicPeriod}
                </option>
              ))}
          </SelectField>
        )}
        {!value && admin && (
          <TeacherField
            orgId={orgId}
            disabled={operation.pending || operation.unresolved}
          />
        )}
        <AcademicFields
          value={value}
          error={operation.error}
          disabled={operation.pending || operation.unresolved}
        />
        <OperationError
          error={operation.error}
          unresolved={operation.unresolved}
        />
        <Button type="submit" disabled={operation.pending}>
          {operation.pending
            ? 'Guardando…'
            : operation.unresolved
              ? 'Reintentar solicitud'
              : 'Guardar clase'}
        </Button>
        <RevisionConflict
          error={operation.error}
          reload={async () => {
            setOpen(false);
            await onSaved();
          }}
        />
      </form>
    </FormDialog>
  );
}

export function AssignTeacher({
  orgId,
  value,
  onSaved,
}: {
  orgId: string;
  value: AcademicClass;
  onSaved: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const operation = useOperation();
  return (
    <FormDialog
      title="Asignar profesor"
      description="Selecciona un profesor activo de esta organización. La nueva asignación cambia el acceso docente a la clase."
      trigger={<Button variant="outline">Asignar profesor</Button>}
      open={open}
      onOpenChange={setOpen}
      locked={operation.pending || operation.unresolved}
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void operation
            .run(
              `/api/v1/classes/${value.id}/teacher`,
              academicClassResponseSchema,
              {
                method: 'PUT',
                etag: `"${value.revision}"`,
                body: { teacherId: form.get('teacherId') },
              },
            )
            .then(async (result) => {
              if (result) {
                setOpen(false);
                await onSaved();
              }
            });
        }}
      >
        <TeacherField
          orgId={orgId}
          defaultValue={value.teacherId}
          disabled={operation.pending || operation.unresolved}
        />
        <OperationError
          error={operation.error}
          unresolved={operation.unresolved}
        />
        <Button type="submit" disabled={operation.pending}>
          {operation.unresolved ? 'Reintentar solicitud' : 'Guardar asignación'}
        </Button>
        <RevisionConflict
          error={operation.error}
          reload={async () => {
            setOpen(false);
            await onSaved();
          }}
        />
      </form>
    </FormDialog>
  );
}

function JoinClass({
  orgId,
  onSaved,
}: {
  orgId: string;
  onSaved: () => Promise<void>;
}) {
  const router = useRouter();
  const operation = useOperation();
  const [code, setCode] = useState('');
  const [preview, setPreview] = useState<{
    classId: string;
    className: string;
    courseName: string;
    expiresAt: string;
    alreadyEnrolled: boolean;
  } | null>(null);
  const [joined, setJoined] = useState<string | null>(null);
  async function previewCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = operation.unresolved
      ? {}
      : operation.validate(classEnrollmentInputSchema, {
          organizationId: orgId,
          code,
        });
    if (!body) return;
    const result = await operation.run(
      '/api/v1/class-enrollments/preview',
      classJoinPreviewResponseSchema,
      { method: 'POST', body },
    );
    if (result) setPreview(result.body.data);
  }
  async function confirm() {
    const result = await operation.run(
      '/api/v1/class-enrollments',
      classEnrollmentResponseSchema,
      { method: 'POST', body: { organizationId: orgId, code } },
    );
    if (result) {
      setJoined(result.body.data.classId);
      setPreview(null);
      setCode('');
      await onSaved();
      router.push(`${academicBase(orgId)}/clases/${result.body.data.classId}`);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Incorporarme a una clase</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="space-y-4"
          onSubmit={(event) => void previewCode(event)}
        >
          <Field
            label="Código de incorporación"
            name="code"
            required
            minLength={8}
            maxLength={80}
            value={code}
            autoComplete="off"
            error={operation.error}
            disabled={!!preview || operation.pending || operation.unresolved}
            onChange={(event) => {
              setCode(event.target.value);
              setJoined(null);
            }}
          />
          {!preview && (
            <Button type="submit" disabled={operation.pending}>
              {operation.pending
                ? 'Comprobando…'
                : operation.unresolved
                  ? 'Reintentar solicitud'
                  : 'Verificar código'}
            </Button>
          )}
        </form>
        {preview && (
          <section
            aria-label="Confirmar incorporación"
            className="space-y-3 rounded-lg bg-secondary p-4"
          >
            <h3 className="font-semibold">{preview.className}</h3>
            <p>{preview.courseName}</p>
            <p className="text-sm">
              Código vigente hasta {formatDate(preview.expiresAt)}.
            </p>
            {preview.alreadyEnrolled && (
              <p>Ya formas parte de esta clase. Puedes abrirla.</p>
            )}
            <div className="flex flex-wrap gap-3">
              <Button
                disabled={operation.pending}
                onClick={() => void confirm()}
              >
                {operation.unresolved
                  ? 'Reintentar solicitud'
                  : preview.alreadyEnrolled
                    ? 'Abrir clase existente'
                    : 'Confirmar incorporación'}
              </Button>
              <Button
                variant="ghost"
                disabled={operation.pending || operation.unresolved}
                onClick={() => setPreview(null)}
              >
                Cancelar
              </Button>
            </div>
          </section>
        )}
        <OperationError
          error={operation.error}
          unresolved={operation.unresolved}
        />
        {joined && (
          <p role="status">
            Tu incorporación está confirmada.{' '}
            <Link
              className="font-semibold underline"
              href={`${academicBase(orgId)}/clases/${joined}`}
            >
              Abrir clase
            </Link>
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Courses({
  orgId,
  readOnly,
  onChanged,
}: {
  orgId: string;
  readOnly: boolean;
  onChanged: () => void;
}) {
  const [cursor, setCursor] = useState<string | null>(null);
  const { state, reload: reloadCourses } = useApiResource(
    `/api/v1/organizations/${orgId}/courses?limit=20${cursor ? `&cursor=${cursor}` : ''}`,
    courseListResponseSchema,
  );
  async function reload() {
    await reloadCourses();
    onChanged();
  }
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <CardTitle>Cursos</CardTitle>
          {!readOnly && <CourseForm orgId={orgId} onSaved={reload} />}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {state.status === 'loading' ? (
          <p role="status">Cargando cursos…</p>
        ) : state.status === 'error' ? (
          <LoadError error={state.error} reload={reload} />
        ) : (
          <>
            {!state.result.body.data.length && (
              <p>No hay cursos registrados.</p>
            )}
            <ul className="divide-y">
              {state.result.body.data.map((course) => (
                <li
                  key={course.id}
                  data-cy="course-row"
                  className="space-y-3 py-5 first:pt-0"
                >
                  <h3 className="font-semibold">{course.name}</h3>
                  <p className="text-sm">
                    {course.code} · {course.academicPeriod} ·{' '}
                    {course.state === 'ACTIVE' ? 'Activo' : 'Archivado'}
                  </p>
                  <p className="text-sm">
                    {course.startDate ?? 'Sin fecha de inicio'} —{' '}
                    {course.endDate ?? 'Sin fecha de término'}
                  </p>
                  <p className="whitespace-pre-wrap text-sm">
                    {course.description}
                  </p>
                  {!readOnly && course.state === 'ACTIVE' && (
                    <div className="flex flex-wrap gap-3">
                      <CourseForm
                        orgId={orgId}
                        value={course}
                        onSaved={reload}
                      />
                      <ConfirmAction
                        label="Archivar curso"
                        description="Solo se archivará si no tiene clases activas. Se conservará la historia."
                        path={`/api/v1/courses/${course.id}/archive`}
                        schema={courseResponseSchema}
                        revision={course.revision}
                        onSaved={reload}
                      />
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <Pagination
              cursor={cursor}
              hasMore={state.result.body.page.hasMore}
              onFirst={() => setCursor(null)}
              onNext={() => setCursor(state.result.body.page.nextCursor)}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ClassCreation({
  orgId,
  admin,
  onSaved,
}: {
  orgId: string;
  admin: boolean;
  onSaved: () => Promise<void>;
}) {
  const { state, reload } = useApiCollection(
    `/api/v1/organizations/${orgId}/courses?state=ACTIVE&limit=100`,
    courseListResponseSchema,
  );
  if (state.status === 'error')
    return <LoadError error={state.error} reload={reload} />;
  if (state.status === 'loading')
    return <p role="status">Cargando cursos disponibles…</p>;
  if (!state.result.body.data.length)
    return (
      <p className="text-sm">
        Se necesita un curso activo para crear una clase.{' '}
        {admin
          ? 'Crea el curso y actualiza esta vista.'
          : 'Solicita un curso a tu administrador.'}
      </p>
    );
  return (
    <ClassForm
      orgId={orgId}
      admin={admin}
      courses={state.result.body.data}
      onSaved={onSaved}
    />
  );
}

function Classes({ membership }: { membership: AcademicMembership }) {
  const orgId = membership.organizationId;
  const [cursor, setCursor] = useState<string | null>(null);
  const [creationRevision, setCreationRevision] = useState(0);
  const { state, reload } = useApiResource(
    `/api/v1/organizations/${orgId}/classes?limit=20${cursor ? `&cursor=${cursor}` : ''}`,
    academicClassListResponseSchema,
  );
  const student = membership.role === 'STUDENT';
  const readOnly = membership.accessMode === 'READ_ONLY';
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold">
        {student ? 'Mis clases' : 'Cursos y clases'}
      </h1>
      {student && !readOnly && <JoinClass orgId={orgId} onSaved={reload} />}
      {membership.role === 'ADMIN' && (
        <Courses
          orgId={orgId}
          readOnly={readOnly}
          onChanged={() => setCreationRevision((value) => value + 1)}
        />
      )}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <CardTitle>{student ? 'Clases inscritas' : 'Clases'}</CardTitle>
            <Button
              variant="outline"
              onClick={() => {
                void reload();
                setCreationRevision((value) => value + 1);
              }}
            >
              Actualizar clases
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {!student && !readOnly && (
            <ClassCreation
              key={creationRevision}
              orgId={orgId}
              admin={membership.role === 'ADMIN'}
              onSaved={reload}
            />
          )}
          {state.status === 'loading' ? (
            <p role="status">Cargando clases…</p>
          ) : state.status === 'error' ? (
            <LoadError error={state.error} reload={reload} />
          ) : (
            <>
              {!state.result.body.data.length && (
                <p>
                  {student
                    ? 'Todavía no estás inscrito en ninguna clase.'
                    : 'No hay clases disponibles.'}
                </p>
              )}
              <ul className="divide-y">
                {state.result.body.data.map((item) => (
                  <li
                    key={item.id}
                    data-cy="class-row"
                    className="flex flex-wrap items-center justify-between gap-4 py-5 first:pt-0"
                  >
                    <div>
                      <h3 className="font-semibold">{item.name}</h3>
                      <p className="mt-1 text-sm">
                        {item.code} ·{' '}
                        {item.state === 'ACTIVE' ? 'Activa' : 'Archivada'}
                      </p>
                    </div>
                    <Button asChild variant="outline">
                      <Link href={`${academicBase(orgId)}/clases/${item.id}`}>
                        Abrir clase
                      </Link>
                    </Button>
                  </li>
                ))}
              </ul>
              <Pagination
                cursor={cursor}
                hasMore={state.result.body.page.hasMore}
                onFirst={() => setCursor(null)}
                onNext={() => setCursor(state.result.body.page.nextCursor)}
              />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function AcademicPanel({ orgId }: { orgId: string }) {
  return (
    <AcademicScope orgId={orgId}>
      {(membership) => <Classes membership={membership} />}
    </AcademicScope>
  );
}

export function StudentHomeClasses({ orgId }: { orgId: string }) {
  const { state, reload } = useApiCollection(
    `/api/v1/organizations/${orgId}/classes?state=ACTIVE&limit=100`,
    academicClassListResponseSchema,
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Mis clases</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {state.status === 'loading' ? (
          <p role="status">Cargando tus clases…</p>
        ) : state.status === 'error' ? (
          <LoadError error={state.error} reload={reload} />
        ) : (
          <ul className="divide-y">
            {!state.result.body.data.length && (
              <li className="text-sm">
                Todavía no estás inscrito en ninguna clase. Usa un código de tu
                profesor para incorporarte.
              </li>
            )}
            {state.result.body.data.map((item) => (
              <li
                key={item.id}
                data-cy="home-class-row"
                className="flex flex-wrap items-center justify-between gap-4 py-4"
              >
                <span className="font-semibold">{item.name}</span>
                <Button asChild variant="outline">
                  <Link href={`${academicBase(orgId)}/clases/${item.id}`}>
                    Abrir clase
                  </Link>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
