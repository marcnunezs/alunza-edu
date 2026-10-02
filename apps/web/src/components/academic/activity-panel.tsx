'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import {
  activityInputSchema,
  activityResponseSchema,
  classResponseSchema,
  exerciseListResponseSchema,
  organizationResponseSchema,
  type Activity,
  type ActivityInput,
} from '@alunza/contracts';
import {
  Field,
  FormDialog,
  OperationError,
  SelectField,
  useOperation,
} from '@/components/identity-forms';
import { Button } from '@/components/ui/button';
import { useApiResource } from '@/lib/use-api-resource';
import { useSession } from '@/components/session-provider';
import { localDateTime, toInstant } from '@/lib/academic-time';
import { ActivityProgress } from './activity-progress';
import { MaterialsPanel } from './materials-panel';
import {
  ConfirmAction,
  LoadState,
  Section,
  TextAreaField,
  etagFor,
  instantLabel,
  usePagedResource,
} from './shared';

export const activityLabels = {
  DRAFT: 'Borrador',
  PUBLISHED: 'Publicada',
  CLOSED: 'Cerrada',
} as const;
type SelectedExercise = ActivityInput['exercises'][number] & { title: string };

function ActivityFormBody({
  classId,
  orgId,
  timezone,
  activity,
  done,
  onBusy,
}: {
  classId: string;
  orgId: string;
  timezone: string;
  activity?: Activity;
  done: () => unknown;
  onBusy: (busy: boolean) => void;
}) {
  const exercises = usePagedResource(
    `/api/v1/organizations/${orgId}/exercises?state=ACTIVE`,
    exerciseListResponseSchema,
  );
  const operation = useOperation();
  useEffect(() => {
    onBusy(operation.pending || operation.unresolved);
  }, [onBusy, operation.pending, operation.unresolved]);
  const [selected, setSelected] = useState<SelectedExercise[]>(
    activity?.exercises
      .map((item) => ({
        exerciseVersionId: item.exerciseVersionId,
        position: item.position,
        required: item.required,
        title: item.title,
      }))
      .sort((a, b) => a.position - b.position) ?? [],
  );
  const [pick, setPick] = useState('');
  const [dateError, setDateError] = useState<string | null>(null);
  function move(index: number, delta: number) {
    setSelected((items) => {
      const next = [...items];
      const other = index + delta;
      if (!next[index] || !next[other]) return items;
      [next[index], next[other]] = [next[other]!, next[index]!];
      return next;
    });
  }
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (operation.unresolved) {
      void operation
        .run(
          activity
            ? `/api/v1/activities/${activity.id}`
            : `/api/v1/classes/${classId}/activities`,
          activityResponseSchema,
          { method: activity ? 'PATCH' : 'POST' },
        )
        .then((result) => {
          if (result) void done();
        });
      return;
    }
    const form = new FormData(event.currentTarget);
    let opensAt: string | null, closesAt: string | null;
    try {
      opensAt = toInstant(String(form.get('opensAt') ?? ''), timezone);
      closesAt = toInstant(String(form.get('closesAt') ?? ''), timezone);
    } catch (error) {
      setDateError(
        error instanceof Error
          ? error.message
          : 'Revisa las fechas de disponibilidad.',
      );
      return;
    }
    setDateError(null);
    const body = operation.validate(activityInputSchema, {
      title: form.get('title'),
      instructions: form.get('instructions'),
      type: form.get('type'),
      opensAt,
      closesAt,
      exercises: selected.map((item, position) => ({
        exerciseVersionId: item.exerciseVersionId,
        position,
        required: item.required,
      })),
    });
    if (!body) return;
    void operation
      .run(
        activity
          ? `/api/v1/activities/${activity.id}`
          : `/api/v1/classes/${classId}/activities`,
        activityResponseSchema,
        {
          method: activity ? 'PATCH' : 'POST',
          body,
          etag: activity ? etagFor(activity.revision) : undefined,
        },
      )
      .then((result) => {
        if (result) void done();
      });
  }
  return (
    <form className="space-y-5" onSubmit={save}>
      <OperationError
        error={operation.error}
        unresolved={operation.unresolved}
      />
      {operation.error?.fields.some((field) =>
        field.field.startsWith('exercises'),
      ) ? (
        <p role="alert" className="text-sm text-destructive">
          Revisa los ejercicios seleccionados: no repitas una versión ni una
          posición.
        </p>
      ) : null}
      {dateError ? (
        <p role="alert" className="text-destructive">
          {dateError}
        </p>
      ) : null}
      <fieldset
        disabled={operation.pending || operation.unresolved}
        className="space-y-5"
      >
        <Field
          label="Título de la actividad"
          name="title"
          required
          maxLength={160}
          defaultValue={activity?.title ?? ''}
          error={operation.error}
        />
        <TextAreaField
          label="Instrucciones"
          name="instructions"
          maxLength={4000}
          defaultValue={activity?.instructions ?? ''}
          error={operation.error}
        />
        <SelectField
          label="Tipo"
          name="type"
          defaultValue={activity?.type ?? 'FORMATIVE'}
        >
          <option value="FORMATIVE">Formativa</option>
          <option value="DIAGNOSTIC">Diagnóstica</option>
        </SelectField>
        <Field
          label={`Disponible desde (${timezone})`}
          name="opensAt"
          type="datetime-local"
          defaultValue={localDateTime(activity?.opensAt ?? null, timezone)}
          error={operation.error}
        />
        <Field
          label={`Disponible hasta (${timezone})`}
          name="closesAt"
          type="datetime-local"
          defaultValue={localDateTime(activity?.closesAt ?? null, timezone)}
          error={operation.error}
        />
        <p className="text-sm">
          Sin fechas, la actividad publicada admite edición hasta su cierre.
          Fuera de la ventana el contenido y el borrador propio siguen en
          lectura.
        </p>
        <div className="space-y-3">
          <h3 className="font-semibold">Ejercicios y orden</h3>
          <LoadState state={exercises.state} reload={exercises.reload} />
          {exercises.state.status === 'ready' ? (
            <>
              <SelectField
                label="Ejercicio para agregar"
                name="exerciseToAdd"
                value={pick}
                onChange={(event) => setPick(event.target.value)}
              >
                <option value="">Seleccionar ejercicio</option>
                {exercises.state.result.body.data
                  .filter(
                    (item) =>
                      !selected.some(
                        (row) =>
                          row.exerciseVersionId === item.currentVersionId,
                      ),
                  )
                  .map((item) => (
                    <option key={item.id} value={item.currentVersionId}>
                      {item.title}
                    </option>
                  ))}
              </SelectField>
              <Button
                type="button"
                variant="outline"
                disabled={!pick}
                onClick={() => {
                  const item =
                    exercises.state.status === 'ready'
                      ? exercises.state.result.body.data.find(
                          (exercise) => exercise.currentVersionId === pick,
                        )
                      : undefined;
                  if (item)
                    setSelected((items) => [
                      ...items,
                      {
                        exerciseVersionId: pick,
                        title: item.title,
                        position: items.length,
                        required: true,
                      },
                    ]);
                  setPick('');
                }}
              >
                Agregar ejercicio
              </Button>
              {exercises.pagination(exercises.state.result.body.page)}
            </>
          ) : null}
          <ol className="space-y-3">
            {selected.map((item, index) => (
              <li
                key={item.exerciseVersionId}
                data-cy="activity-exercise-selected"
                className="space-y-3 rounded-lg border p-3"
              >
                <p className="font-semibold">
                  {index + 1}. {item.title}
                </p>
                <label className="flex min-h-11 items-center gap-3">
                  <input
                    type="checkbox"
                    checked={item.required}
                    onChange={(event) =>
                      setSelected((items) =>
                        items.map((row, i) =>
                          i === index
                            ? { ...row, required: event.target.checked }
                            : row,
                        ),
                      )
                    }
                  />
                  Requerido
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    aria-label={`Subir ${item.title}`}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    Subir
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    aria-label={`Bajar ${item.title}`}
                    disabled={index === selected.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    Bajar
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() =>
                      setSelected((items) =>
                        items.filter((_, i) => i !== index),
                      )
                    }
                  >
                    Quitar {item.title}
                  </Button>
                </div>
              </li>
            ))}
          </ol>
          {selected.length === 0 ? (
            <p>
              El borrador puede guardarse vacío. Para publicar necesitarás al
              menos un ejercicio requerido.
            </p>
          ) : null}
        </div>
      </fieldset>
      <Button type="submit" disabled={operation.pending}>
        {operation.pending
          ? 'Guardando…'
          : operation.unresolved
            ? 'Comprobar solicitud'
            : 'Guardar borrador'}
      </Button>
    </form>
  );
}

export function ActivityFormDialog({
  classId,
  orgId,
  timezone,
  activity,
  done,
}: {
  classId: string;
  orgId: string;
  timezone: string;
  activity?: Activity;
  done: () => unknown;
}) {
  const [open, setOpen] = useState(false);
  const [locked, setLocked] = useState(false);
  return (
    <FormDialog
      title={activity ? 'Editar actividad' : 'Crear actividad'}
      description="Prepara el contenido y su orden. La publicación se confirma por separado."
      trigger={
        <Button>{activity ? 'Editar actividad' : 'Crear actividad'}</Button>
      }
      open={open}
      onOpenChange={setOpen}
      locked={locked}
    >
      <ActivityFormBody
        classId={classId}
        orgId={orgId}
        timezone={timezone}
        activity={activity}
        onBusy={setLocked}
        done={() => {
          setOpen(false);
          void done();
        }}
      />
    </FormDialog>
  );
}

function ActivityContent({
  activity,
  reload,
}: {
  activity: Activity;
  reload: () => unknown;
}) {
  const { identity } = useSession();
  const classResource = useApiResource(
    `/api/v1/classes/${activity.classId}`,
    classResponseSchema,
  );
  const organization = useApiResource(
    `/api/v1/organizations/${activity.organizationId}`,
    organizationResponseSchema,
  );
  const role =
    identity.status === 'ready'
      ? identity.data.memberships.find(
          (item) => item.organizationId === activity.organizationId,
        )?.role
      : undefined;
  const teacher =
    role === 'TEACHER' &&
    identity.status === 'ready' &&
    classResource.state.status === 'ready' &&
    classResource.state.result.body.data.teacherId === identity.data.id &&
    classResource.state.result.body.data.state === 'ACTIVE';
  const timezone =
    organization.state.status === 'ready'
      ? organization.state.result.body.data.timezone
      : 'America/Santiago';
  return (
    <div className="space-y-6">
      <Link href={`/clases/${activity.classId}`} className="underline">
        Volver a la clase
      </Link>
      <header className="space-y-3">
        <h1 className="text-3xl font-semibold">{activity.title}</h1>
        <p>
          {activityLabels[activity.state]} ·{' '}
          {activity.type === 'FORMATIVE' ? 'Formativa' : 'Diagnóstica'}
        </p>
        <p className="whitespace-pre-wrap">{activity.instructions}</p>
        <p className="text-sm">
          Desde {instantLabel(activity.opensAt, timezone)} · Hasta{' '}
          {instantLabel(activity.closesAt, timezone)} ({timezone})
        </p>
      </header>
      {teacher ? (
        <div className="flex flex-wrap gap-3">
          {activity.state === 'DRAFT' ? (
            <>
              <ActivityFormDialog
                classId={activity.classId}
                orgId={activity.organizationId}
                timezone={timezone}
                activity={activity}
                done={reload}
              />
              <ConfirmAction
                label="Publicar actividad"
                description="La publicación fija las versiones y el orden de los ejercicios para los estudiantes inscritos. Comprueba el contenido antes de confirmar."
                path={`/api/v1/activities/${activity.id}/publish`}
                schema={activityResponseSchema}
                etag={etagFor(activity.revision)}
                onDone={reload}
              />
            </>
          ) : null}
          {activity.state === 'PUBLISHED' ? (
            <ConfirmAction
              label="Cerrar actividad"
              description="El cierre es irreversible. Se conservarán las consultas autorizadas, pero no se podrá seguir editando para resolver."
              path={`/api/v1/activities/${activity.id}/close`}
              schema={activityResponseSchema}
              etag={etagFor(activity.revision)}
              onDone={reload}
            />
          ) : null}
        </div>
      ) : null}
      {activity.state === 'CLOSED' ? (
        <p role="status" className="rounded-lg bg-secondary p-4">
          Actividad cerrada. El contenido y tu borrador conservado están
          disponibles en modo de lectura.
        </p>
      ) : null}
      {role === 'STUDENT' ? (
        <ActivityProgress activityId={activity.id} />
      ) : null}
      <MaterialsPanel
        classId={activity.classId}
        activityId={activity.id}
        canUpload={teacher}
        manage={role === 'TEACHER'}
      />
      <Section title="Ejercicios">
        {activity.exercises.length === 0 ? (
          <p>No se han agregado ejercicios.</p>
        ) : (
          <ol className="space-y-4">
            {[...activity.exercises]
              .sort((a, b) => a.position - b.position)
              .map((item, index) => (
                <li
                  key={item.id}
                  data-cy="published-exercise"
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"
                >
                  <div>
                    <h2 className="font-semibold">
                      {index + 1}. {item.title}
                    </h2>
                    <p className="text-sm">
                      {item.required ? 'Requerido' : 'Opcional'}
                    </p>
                  </div>
                  {role === 'STUDENT' ? (
                    <Button asChild variant="outline">
                      <Link
                        href={`/actividades/${activity.id}/ejercicios/${item.id}`}
                      >
                        Abrir ejercicio
                      </Link>
                    </Button>
                  ) : (
                    <Button asChild variant="outline">
                      <Link href={`/ejercicios/${item.exerciseId}`}>
                        Consultar en el banco
                      </Link>
                    </Button>
                  )}
                </li>
              ))}
          </ol>
        )}
      </Section>
    </div>
  );
}

export function ActivityPanel({ activityId }: { activityId: string }) {
  const resource = useApiResource(
    `/api/v1/activities/${encodeURIComponent(activityId)}`,
    activityResponseSchema,
  );
  if (resource.state.status !== 'ready')
    return <LoadState state={resource.state} reload={resource.reload} />;
  return (
    <ActivityContent
      key={`${activityId}:${resource.state.result.body.data.revision}`}
      activity={resource.state.result.body.data}
      reload={resource.reload}
    />
  );
}
