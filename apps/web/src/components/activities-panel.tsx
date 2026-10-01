'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  academicClassResponseSchema,
  joinCodeListResponseSchema,
  joinCodeResponseSchema,
  issuedJoinCodeResponseSchema,
  activityInputSchema,
  activityResponseSchema,
  activityListResponseSchema,
  exerciseListResponseSchema,
  type AcademicClass,
  type Activity,
  type ExerciseSummary,
} from '@alunza/contracts';
import { useSession } from '@/components/session-provider';
import {
  Field,
  SelectField,
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
  activityLabels,
  difficultyLabels,
  type AcademicMembership,
} from '@/components/academic-shared';
import { ClassForm, AssignTeacher } from '@/components/academic-panel';
import { useApiResource } from '@/lib/use-api-resource';
import { useApiCollection } from '@/lib/use-api-collection';
import { apiRequest, ApiError } from '@/lib/api';
import { santiagoInput, santiagoInstant } from '@/lib/academic-local';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { RequestError } from '@/components/request-error';

export const availabilityLabels = {
  DRAFT: 'Todavía no publicada',
  AVAILABLE: 'Disponible para resolver',
  NOT_OPEN: 'Disponible desde la apertura',
  EXPIRED: 'Plazo finalizado',
  CLOSED: 'Actividad cerrada',
  CLASS_ARCHIVED: 'Clase archivada',
};

function JoinCodes({ classId }: { classId: string }) {
  const { session } = useSession();
  const { state, reload } = useApiCollection(
    `/api/v1/classes/${classId}/join-codes?limit=100`,
    joinCodeListResponseSchema,
  );
  const [pending, setPending] = useState(false);
  const [issued, setIssued] = useState<{
    code: string;
    expiresAt: string;
  } | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [checkedAt, setCheckedAt] = useState(() => Date.now());
  const [expiresAt, setExpiresAt] = useState(() =>
    santiagoInput(new Date(Date.now() + 7 * 86_400_000).toISOString()),
  );
  const activeIssue = useRef<AbortController | null>(null);
  useEffect(() => () => activeIssue.current?.abort(), []);
  async function issue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (activeIssue.current) return;
    const controller = new AbortController();
    activeIssue.current = controller;
    setPending(true);
    setError(null);
    setIssued(null);
    try {
      const expiration = santiagoInstant(expiresAt);
      if (!expiration) throw new Error('Indica la vigencia del código.');
      const result = await apiRequest(
        `/api/v1/classes/${classId}/join-codes`,
        issuedJoinCodeResponseSchema,
        {
          method: 'POST',
          body: { expiresAt: expiration },
          accessToken: session?.access_token,
          signal: controller.signal,
        },
      );
      if (controller.signal.aborted) return;
      setIssued(result.body.data);
      await reload();
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(
        cause instanceof ApiError
          ? cause
          : new ApiError(
              422,
              'VALIDATION_FAILED',
              cause instanceof Error
                ? cause.message
                : 'Revisa la vigencia del código.',
            ),
      );
    } finally {
      if (!controller.signal.aborted) setPending(false);
      if (activeIssue.current === controller) activeIssue.current = null;
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Códigos de incorporación</CardTitle>
        <p className="text-sm text-muted-foreground">
          Un código permite incorporar a varios estudiantes de la organización
          hasta su vencimiento o revocación.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <form className="space-y-4" onSubmit={(event) => void issue(event)}>
          <Field
            label="Vencimiento del código (hora de Santiago)"
            name="expiresAt"
            type="datetime-local"
            required
            value={expiresAt}
            disabled={pending}
            onChange={(event) => setExpiresAt(event.target.value)}
          />
          <Button type="submit" disabled={pending}>
            {pending ? 'Generando…' : 'Generar código'}
          </Button>
        </form>
        {issued && (
          <div role="status" className="space-y-3 rounded-lg bg-secondary p-4">
            <p className="text-sm">
              Copia este código ahora: solo se muestra al generarlo.
            </p>
            <Field
              label="Código generado"
              name="issuedCode"
              value={issued.code}
              readOnly
              className="font-mono"
            />
            <p className="text-sm">Vence: {formatDate(issued.expiresAt)}</p>
          </div>
        )}
        {error && (
          <div className="space-y-2">
            <RequestError error={error} />
            {error.status >= 500 && (
              <p className="text-sm">
                No se confirmó el código. Actualiza la lista y revoca cualquier
                código cuya entrega no reconozcas antes de generar otro.
              </p>
            )}
          </div>
        )}
        <Button
          variant="outline"
          onClick={() => {
            setCheckedAt(Date.now());
            void reload();
          }}
        >
          Actualizar códigos
        </Button>
        {state.status === 'loading' ? (
          <p role="status">Cargando códigos…</p>
        ) : state.status === 'error' ? (
          <LoadError error={state.error} reload={reload} />
        ) : (
          <ul className="divide-y">
            {!state.result.body.data.length && (
              <li>No hay códigos emitidos.</li>
            )}
            {state.result.body.data.map((code) => (
              <li
                key={code.id}
                className="flex flex-wrap items-center justify-between gap-3 py-4"
              >
                <div>
                  <p className="text-sm">Vence: {formatDate(code.expiresAt)}</p>
                  <p className="text-sm">
                    {code.revokedAt
                      ? 'Revocado'
                      : Date.parse(code.expiresAt) <= checkedAt
                        ? 'Vencido'
                        : 'Vigente'}{' '}
                    · {code.usesCount} incorporaciones
                  </p>
                </div>
                {!code.revokedAt && (
                  <ConfirmAction
                    label="Revocar código"
                    description="Este código ya no permitirá nuevas incorporaciones. Las membresías existentes se conservarán."
                    path={`/api/v1/classes/${classId}/join-codes/${code.id}/revoke`}
                    schema={joinCodeResponseSchema}
                    revision={code.revision}
                    onSaved={async () => {
                      setIssued(null);
                      await reload();
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ActivitiesList({
  orgId,
  value,
  teacher,
}: {
  orgId: string;
  value: AcademicClass;
  teacher: boolean;
}) {
  const [cursor, setCursor] = useState<string | null>(null);
  const { state, reload } = useApiResource(
    `/api/v1/classes/${value.id}/activities?limit=20${cursor ? `&cursor=${cursor}` : ''}`,
    activityListResponseSchema,
  );
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <CardTitle>Actividades</CardTitle>
          {teacher && value.state === 'ACTIVE' && (
            <Button asChild>
              <Link
                href={`${academicBase(orgId)}/clases/${value.id}/actividades/nueva`}
              >
                Crear actividad
              </Link>
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {state.status === 'loading' ? (
          <p role="status">Cargando actividades…</p>
        ) : state.status === 'error' ? (
          <LoadError error={state.error} reload={reload} />
        ) : (
          <>
            {!state.result.body.data.length && (
              <p>No hay actividades disponibles en esta clase.</p>
            )}
            <ul className="divide-y">
              {state.result.body.data.map((activity) => (
                <li
                  key={activity.id}
                  data-cy="activity-row"
                  className="space-y-3 py-5 first:pt-0"
                >
                  <h3 className="font-semibold">{activity.title}</h3>
                  <p className="text-sm">
                    {activityLabels[activity.state]} ·{' '}
                    {availabilityLabels[activity.availability]}
                  </p>
                  {activity.closesAt && (
                    <p className="text-sm">
                      Cierre: {formatDate(activity.closesAt)}
                    </p>
                  )}
                  <Button asChild variant="outline">
                    <Link
                      href={`${academicBase(orgId)}/actividades/${activity.id}`}
                    >
                      Abrir actividad
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
  );
}

function ClassDetails({
  membership,
  classId,
}: {
  membership: AcademicMembership;
  classId: string;
}) {
  const { state, reload } = useApiResource(
    `/api/v1/classes/${classId}`,
    academicClassResponseSchema,
  );
  if (state.status === 'loading') return <p role="status">Cargando clase…</p>;
  if (state.status === 'error')
    return <LoadError error={state.error} reload={reload} />;
  const value = state.result.body.data;
  if (value.organizationId !== membership.organizationId)
    return (
      <RequestError
        error={
          new ApiError(
            404,
            'RESOURCE_NOT_FOUND',
            'El recurso no está disponible o no tienes acceso.',
          )
        }
      />
    );
  const canManage =
    membership.role !== 'STUDENT' &&
    membership.accessMode === 'OPERATE' &&
    value.state === 'ACTIVE';
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold">{value.name}</h1>
      <p className="text-sm">
        {value.code} ·{' '}
        {value.state === 'ACTIVE'
          ? 'Clase activa'
          : 'Clase archivada · Solo lectura'}
      </p>
      <p className="whitespace-pre-wrap">{value.description}</p>
      <p className="text-sm">
        {value.startDate ?? 'Sin fecha de inicio'} —{' '}
        {value.endDate ?? 'Sin fecha de término'}
      </p>
      {canManage && (
        <div className="flex flex-wrap gap-3">
          <ClassForm
            orgId={membership.organizationId}
            admin={membership.role === 'ADMIN'}
            courses={[]}
            value={value}
            onSaved={reload}
          />
          {membership.role === 'ADMIN' && (
            <AssignTeacher
              orgId={membership.organizationId}
              value={value}
              onSaved={reload}
            />
          )}
          {membership.role === 'ADMIN' && (
            <ConfirmAction
              label="Archivar clase"
              description="Requiere cerrar todas sus actividades publicadas. Se revocarán los códigos y se conservarán las relaciones históricas."
              path={`/api/v1/classes/${classId}/archive`}
              schema={academicClassResponseSchema}
              revision={value.revision}
              onSaved={reload}
            />
          )}
        </div>
      )}
      {canManage && <JoinCodes classId={classId} />}
      {membership.role !== 'ADMIN' && (
        <ActivitiesList
          orgId={membership.organizationId}
          value={value}
          teacher={membership.role === 'TEACHER' && canManage}
        />
      )}
    </div>
  );
}

export function ClassPanel({
  orgId,
  classId,
}: {
  orgId: string;
  classId: string;
}) {
  return (
    <AcademicScope orgId={orgId}>
      {(membership) => (
        <ClassDetails membership={membership} classId={classId} />
      )}
    </AcademicScope>
  );
}

type SelectedExercise = {
  exerciseVersionId: string;
  title: string;
  required: boolean;
};
function ActivityForm({
  orgId,
  classId,
  value,
  exercises,
  onSaved,
}: {
  orgId: string;
  classId: string;
  value?: Activity;
  exercises: ExerciseSummary[];
  onSaved?: () => Promise<void>;
}) {
  const router = useRouter();
  const operation = useOperation();
  const [selected, setSelected] = useState<SelectedExercise[]>(
    value?.exercises.map((item) => ({
      exerciseVersionId: item.exerciseVersionId,
      title: item.title,
      required: item.required,
    })) ?? [],
  );
  const [choice, setChoice] = useState('');
  const [dateError, setDateError] = useState<string | null>(null);
  function move(index: number, direction: number) {
    setSelected((items) => {
      const next = [...items];
      const item = next[index];
      const other = next[index + direction];
      if (item && other) {
        next[index] = other;
        next[index + direction] = item;
      }
      return next;
    });
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDateError(null);
    const form = new FormData(event.currentTarget);
    let dates;
    try {
      dates = {
        opensAt: santiagoInstant(String(form.get('opensAt') ?? '')),
        closesAt: santiagoInstant(String(form.get('closesAt') ?? '')),
      };
    } catch (cause) {
      setDateError(
        cause instanceof Error ? cause.message : 'Revisa las fechas.',
      );
      return;
    }
    const body = operation.unresolved
      ? {}
      : operation.validate(activityInputSchema, {
          title: form.get('title'),
          instructions: form.get('instructions'),
          type: form.get('type'),
          ...dates,
          exercises: selected.map((item, position) => ({
            exerciseVersionId: item.exerciseVersionId,
            position,
            required: item.required,
          })),
        });
    if (!body) return;
    const result = await operation.run(
      value
        ? `/api/v1/activities/${value.id}`
        : `/api/v1/classes/${classId}/activities`,
      activityResponseSchema,
      {
        method: value ? 'PATCH' : 'POST',
        body,
        ...(value ? { etag: `"${value.revision}"` } : {}),
      },
    );
    if (result) {
      if (onSaved) await onSaved();
      else
        router.push(
          `${academicBase(orgId)}/actividades/${result.body.data.id}`,
        );
    }
  }
  return (
    <form
      aria-label="Composición de actividad"
      className="space-y-5"
      onSubmit={(event) => void submit(event)}
    >
      <fieldset
        disabled={operation.pending || operation.unresolved}
        className="space-y-5"
      >
        <Field
          name="title"
          label="Título de la actividad"
          required
          maxLength={160}
          defaultValue={value?.title}
          error={operation.error}
        />
        <SelectField
          name="type"
          label="Tipo de actividad"
          defaultValue={value?.type ?? 'FORMATIVE'}
        >
          <option value="FORMATIVE">Formativa</option>
          <option value="DIAGNOSTIC">Diagnóstica</option>
        </SelectField>
        <TextAreaField
          name="instructions"
          label="Instrucciones"
          defaultValue={value?.instructions}
          maxLength={10000}
          error={operation.error}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            name="opensAt"
            label="Apertura (hora de Santiago)"
            type="datetime-local"
            defaultValue={value?.opensAt ? santiagoInput(value.opensAt) : ''}
            error={operation.error}
          />
          <Field
            name="closesAt"
            label="Cierre (hora de Santiago)"
            type="datetime-local"
            defaultValue={value?.closesAt ? santiagoInput(value.closesAt) : ''}
            error={operation.error}
          />
        </div>
        <p className="text-sm text-muted-foreground">
          Las fechas son opcionales. La apertura se incluye y el instante de
          cierre deja de admitir resolución.
        </p>
        <div className="space-y-3">
          <SelectField
            name="exerciseChoice"
            label="Ejercicio para agregar"
            value={choice}
            onChange={(event) => setChoice(event.target.value)}
          >
            <option value="">Selecciona un ejercicio activo</option>
            {exercises
              .filter(
                (item) =>
                  item.state === 'ACTIVE' &&
                  !selected.some(
                    (selection) =>
                      selection.exerciseVersionId === item.currentVersionId,
                  ),
              )
              .map((item) => (
                <option key={item.id} value={item.currentVersionId}>
                  {item.title} · Versión {item.version}
                </option>
              ))}
          </SelectField>
          <Button
            variant="outline"
            type="button"
            disabled={!choice}
            onClick={() => {
              const item = exercises.find(
                (entry) => entry.currentVersionId === choice,
              );
              if (item) {
                setSelected((items) => [
                  ...items,
                  {
                    exerciseVersionId: item.currentVersionId,
                    title: item.title,
                    required: true,
                  },
                ]);
                setChoice('');
              }
            }}
          >
            Agregar ejercicio
          </Button>
        </div>
        <ol className="space-y-3" aria-label="Orden de ejercicios">
          {selected.map((item, index) => (
            <li
              data-cy="assigned-exercise-row"
              key={item.exerciseVersionId}
              className="space-y-3 rounded-lg border p-4"
            >
              <p className="font-semibold">
                {index + 1}. {item.title}
              </p>
              <label className="flex min-h-11 items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  className="size-4"
                  checked={item.required}
                  onChange={(event) =>
                    setSelected((items) =>
                      items.map((entry) =>
                        entry.exerciseVersionId === item.exerciseVersionId
                          ? { ...entry, required: event.target.checked }
                          : entry,
                      ),
                    )
                  }
                />
                Ejercicio requerido
              </label>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={index === 0}
                  aria-label={`Subir ${item.title}`}
                  onClick={() => move(index, -1)}
                >
                  Subir
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={index === selected.length - 1}
                  aria-label={`Bajar ${item.title}`}
                  onClick={() => move(index, 1)}
                >
                  Bajar
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={`Quitar ${item.title}`}
                  onClick={() =>
                    setSelected((items) =>
                      items.filter(
                        (entry) =>
                          entry.exerciseVersionId !== item.exerciseVersionId,
                      ),
                    )
                  }
                >
                  Quitar
                </Button>
              </div>
            </li>
          ))}
        </ol>
        {!selected.length && (
          <p>
            El borrador aún no contiene ejercicios. Agrega al menos uno antes de
            publicar.
          </p>
        )}
      </fieldset>
      {dateError && (
        <p role="alert" className="text-destructive">
          {dateError}
        </p>
      )}
      <OperationError
        error={operation.error}
        unresolved={operation.unresolved}
      />
      <Button type="submit" disabled={operation.pending}>
        {operation.pending
          ? 'Guardando…'
          : operation.unresolved
            ? 'Reintentar solicitud'
            : 'Guardar borrador'}
      </Button>
      <RevisionConflict
        error={operation.error}
        reload={onSaved ?? (() => router.refresh())}
      />
    </form>
  );
}

function Composer({
  orgId,
  classId,
  value,
  onSaved,
}: {
  orgId: string;
  classId: string;
  value?: Activity;
  onSaved?: () => Promise<void>;
}) {
  const { state, reload } = useApiCollection(
    `/api/v1/organizations/${orgId}/exercises?state=ACTIVE&limit=100`,
    exerciseListResponseSchema,
  );
  if (state.status === 'loading')
    return <p role="status">Cargando ejercicios del banco…</p>;
  if (state.status === 'error')
    return <LoadError error={state.error} reload={reload} />;
  return (
    <ActivityForm
      key={value?.revision ?? 'new'}
      orgId={orgId}
      classId={classId}
      value={value}
      exercises={state.result.body.data}
      onSaved={onSaved}
    />
  );
}

export function NewActivityPanel({
  orgId,
  classId,
}: {
  orgId: string;
  classId: string;
}) {
  return (
    <AcademicScope orgId={orgId} roles={['TEACHER']}>
      {(membership) =>
        membership.accessMode === 'READ_ONLY' ? (
          <p>Esta organización no permite crear actividades.</p>
        ) : (
          <div className="space-y-6">
            <h1 className="text-3xl font-semibold">Crear actividad</h1>
            <Card>
              <CardHeader>
                <CardTitle>Componer borrador</CardTitle>
              </CardHeader>
              <CardContent>
                <Composer orgId={orgId} classId={classId} />
              </CardContent>
            </Card>
          </div>
        )
      }
    </AcademicScope>
  );
}

function ActivityDetails({
  membership,
  activityId,
}: {
  membership: AcademicMembership;
  activityId: string;
}) {
  const { state, reload } = useApiResource(
    `/api/v1/activities/${activityId}`,
    activityResponseSchema,
  );
  if (state.status === 'loading')
    return <p role="status">Cargando actividad…</p>;
  if (state.status === 'error')
    return <LoadError error={state.error} reload={reload} />;
  const value = state.result.body.data;
  if (value.organizationId !== membership.organizationId)
    return (
      <RequestError
        error={
          new ApiError(
            404,
            'RESOURCE_NOT_FOUND',
            'El recurso no está disponible o no tienes acceso.',
          )
        }
      />
    );
  const teacher =
    membership.role === 'TEACHER' &&
    membership.accessMode === 'OPERATE' &&
    value.availability !== 'CLASS_ARCHIVED';
  return (
    <div className="space-y-6">
      <Link
        href={`${academicBase(membership.organizationId)}/clases/${value.classId}`}
        className="text-sm underline"
      >
        Volver a la clase
      </Link>
      <h1 className="text-3xl font-semibold">{value.title}</h1>
      <p role="status">
        {activityLabels[value.state]} · {availabilityLabels[value.availability]}
      </p>
      <p className="whitespace-pre-wrap">{value.instructions}</p>
      <dl className="grid gap-2 text-sm">
        <div>
          <dt className="inline font-semibold">Apertura: </dt>
          <dd className="inline">
            {value.opensAt ? formatDate(value.opensAt) : 'Al publicar'}
          </dd>
        </div>
        <div>
          <dt className="inline font-semibold">Cierre: </dt>
          <dd className="inline">
            {value.closesAt
              ? formatDate(value.closesAt)
              : 'Sin fecha configurada'}
          </dd>
        </div>
      </dl>
      {teacher && value.state === 'DRAFT' ? (
        <Card>
          <CardHeader>
            <CardTitle>Editar borrador</CardTitle>
          </CardHeader>
          <CardContent>
            <Composer
              orgId={membership.organizationId}
              classId={value.classId}
              value={value}
              onSaved={reload}
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Ejercicios de la actividad</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-5">
              {value.exercises.map((item, index) => (
                <li
                  key={item.id}
                  data-cy="published-exercise-row"
                  className="space-y-3"
                >
                  <h2 className="font-semibold">
                    {index + 1}. {item.title}
                  </h2>
                  <p className="text-sm">
                    {difficultyLabels[item.difficulty]} ·{' '}
                    {item.required ? 'Requerido' : 'Opcional'}
                  </p>
                  {membership.role === 'STUDENT' &&
                    value.availability === 'AVAILABLE' && (
                      <Button asChild variant="outline">
                        <Link
                          href={`${academicBase(membership.organizationId)}/actividades/${value.id}/ejercicios/${item.id}`}
                        >
                          Preparar solución
                        </Link>
                      </Button>
                    )}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}
      <div className="flex flex-wrap gap-3">
        {teacher && value.state === 'DRAFT' && (
          <ConfirmAction
            label="Publicar actividad"
            description="Se fijarán las versiones, el orden y los ejercicios requeridos del último borrador guardado. Revisa y guarda tus cambios antes de confirmar."
            path={`/api/v1/activities/${value.id}/publish`}
            schema={activityResponseSchema}
            revision={value.revision}
            onSaved={reload}
          />
        )}
        {teacher && value.state === 'PUBLISHED' && (
          <ConfirmAction
            label="Cerrar actividad"
            description="El cierre impedirá resolver esta actividad. Sus versiones se conservarán y no podrá reabrirse."
            path={`/api/v1/activities/${value.id}/close`}
            schema={activityResponseSchema}
            revision={value.revision}
            onSaved={reload}
          />
        )}
        <Button variant="outline" onClick={() => void reload()}>
          Actualizar actividad
        </Button>
      </div>
    </div>
  );
}

export function ActivityPanel({
  orgId,
  activityId,
}: {
  orgId: string;
  activityId: string;
}) {
  return (
    <AcademicScope orgId={orgId} roles={['TEACHER', 'STUDENT']}>
      {(membership) => (
        <ActivityDetails membership={membership} activityId={activityId} />
      )}
    </AcademicScope>
  );
}
