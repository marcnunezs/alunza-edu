'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  academicArchiveSchema,
  activityListResponseSchema,
  classResponseSchema,
  classUpdateSchema,
  joinCodeCreateSchema,
  joinCodeResponseSchema,
  joinCodeListResponseSchema,
  organizationResponseSchema,
  teacherAssignmentSchema,
  type AcademicClass,
  type JoinCode,
} from '@alunza/contracts';
import { useApiResource } from '@/lib/use-api-resource';
import { useSession } from '@/components/session-provider';
import {
  Field,
  OperationError,
  useOperation,
} from '@/components/identity-forms';
import { Button } from '@/components/ui/button';
import { TeacherSelect } from './classes';
import { ActivityFormDialog, activityLabels } from './activity-panel';
import { ActivityProgress } from './activity-progress';
import { MaterialsPanel } from './materials-panel';
import {
  ConfirmAction,
  LoadState,
  RecordForm,
  Section,
  TextAreaField,
  etagFor,
  instantLabel,
  optionalDate,
  usePagedResource,
} from './shared';

function JoinCodes({
  classroom,
  timezone,
  done,
}: {
  classroom: AcademicClass;
  timezone: string;
  done: () => unknown;
}) {
  const codes = useApiResource(
    `/api/v1/classes/${classroom.id}/join-codes?limit=100`,
    joinCodeListResponseSchema,
  );
  const operation = useOperation();
  const [generated, setGenerated] = useState<JoinCode | null>(null);
  const [hours, setHours] = useState('168');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <Section title="Código de incorporación">
      <p className="text-sm">
        Cada código puede incorporar a varios estudiantes durante un máximo de 7
        días. Generar uno nuevo invalida el anterior.
      </p>
      <OperationError
        error={operation.error}
        unresolved={operation.unresolved}
      />
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const count = Number(hours);
          const body = operation.validate(
            joinCodeCreateSchema,
            count === 168
              ? {}
              : {
                  expiresAt: new Date(
                    Date.now() + count * 3600000,
                  ).toISOString(),
                },
          );
          if (!body) return;
          void operation
            .run(
              `/api/v1/classes/${classroom.id}/join-codes`,
              joinCodeResponseSchema,
              { method: 'POST', body, etag: etagFor(classroom.revision) },
            )
            .then((response) => {
              if (response) {
                setGenerated(response.body.data);
                void codes.reload();
                void done();
              }
            });
        }}
      >
        <Field
          label="Vigencia en horas (1 a 168)"
          name="validityHours"
          type="number"
          required
          min={1}
          max={168}
          value={hours}
          disabled={operation.pending || operation.unresolved}
          onChange={(event) => setHours(event.target.value)}
        />
        <Button type="submit" disabled={operation.pending}>
          {operation.pending
            ? 'Generando…'
            : operation.unresolved
              ? 'Comprobar solicitud'
              : 'Generar código'}
        </Button>
      </form>
      {generated?.code ? (
        <div className="space-y-3 rounded-lg bg-secondary p-4">
          <p role="status">Código generado. Se muestra una sola vez.</p>
          <label
            htmlFor="generated-join-code"
            className="text-sm font-semibold"
          >
            Código para compartir con tu clase
          </label>
          <input
            id="generated-join-code"
            data-cy="generated-join-code"
            value={generated.code}
            readOnly
            className="w-full rounded-md border bg-card p-3 font-mono text-sm"
            onFocus={(event) => event.target.select()}
          />
          <p className="text-sm">
            Vence: {instantLabel(generated.expiresAt, timezone)}
          </p>
        </div>
      ) : generated ? (
        <p role="status" className="rounded-lg bg-secondary p-4">
          La emisión quedó registrada, pero el código solo se entrega una vez.
          Si no conservaste el valor, genera un código nuevo para sustituirlo.
        </p>
      ) : null}
      <LoadState state={codes.state} reload={codes.reload} />
      {codes.state.status === 'ready' ? (
        <ul className="space-y-3">
          {codes.state.result.body.data.length === 0 ? (
            <li>No hay códigos emitidos.</li>
          ) : null}
          {codes.state.result.body.data.map((code) => (
            <li
              key={code.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
            >
              <p className="text-sm">
                {code.revokedAt
                  ? 'Revocado'
                  : Date.parse(code.expiresAt) <= now
                    ? 'Vencido'
                    : 'Vigente'}{' '}
                · Vence {instantLabel(code.expiresAt, timezone)}
              </p>
              {!code.revokedAt && Date.parse(code.expiresAt) > now ? (
                <ConfirmAction
                  label="Revocar código"
                  description="El código dejará de admitir nuevas incorporaciones. Las membresías existentes se conservan."
                  path={`/api/v1/classes/${classroom.id}/join-codes/${code.id}/revoke`}
                  schema={joinCodeResponseSchema}
                  etag={etagFor(code.revision)}
                  onDone={() => {
                    setGenerated(null);
                    void codes.reload();
                    void done();
                  }}
                />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </Section>
  );
}

function ClassContent({
  classroom,
  reload,
}: {
  classroom: AcademicClass;
  reload: () => unknown;
}) {
  const { identity } = useSession();
  const organization = useApiResource(
    `/api/v1/organizations/${classroom.organizationId}`,
    organizationResponseSchema,
  );
  const activities = usePagedResource(
    `/api/v1/classes/${classroom.id}/activities`,
    activityListResponseSchema,
    identity.status === 'ready' &&
      identity.data.memberships.some(
        (item) =>
          item.organizationId === classroom.organizationId &&
          item.role !== 'ADMIN',
      ),
    10,
  );
  const membership =
    identity.status === 'ready'
      ? identity.data.memberships.find(
          (item) => item.organizationId === classroom.organizationId,
        )
      : undefined;
  const admin = membership?.role === 'ADMIN';
  const teacher =
    membership?.role === 'TEACHER' &&
    identity.status === 'ready' &&
    identity.data.id === classroom.teacherId;
  const active = classroom.state === 'ACTIVE';
  const timezone =
    organization.state.status === 'ready'
      ? organization.state.result.body.data.timezone
      : 'America/Santiago';
  return (
    <div className="space-y-7">
      <Link
        href={`/academia?org=${classroom.organizationId}`}
        className="underline"
      >
        Volver a clases
      </Link>
      <header className="space-y-3">
        <h1 className="text-3xl font-semibold">{classroom.name}</h1>
        <p>
          {classroom.code} · {active ? 'Activa' : 'Archivada · Solo lectura'}
        </p>
        <p>Profesor: {classroom.teacherName}</p>
        <p className="whitespace-pre-wrap">{classroom.description}</p>
        <p className="text-sm">
          {classroom.startDate ?? 'Sin fecha inicial'} —{' '}
          {classroom.endDate ?? 'Sin fecha final'}
        </p>
      </header>
      {!active ? (
        <p role="status" className="rounded-lg bg-secondary p-4">
          Esta clase está archivada. Se conserva el contenido autorizado y se
          bloquean las operaciones.
        </p>
      ) : null}
      {active && (teacher || admin) ? (
        <div className="flex flex-wrap gap-3">
          <RecordForm
            title="Configurar clase"
            description="Modifica los datos de la clase sin cambiar su asignación docente."
            path={`/api/v1/classes/${classroom.id}`}
            inputSchema={classUpdateSchema}
            responseSchema={classResponseSchema}
            method="PATCH"
            etag={etagFor(classroom.revision)}
            onDone={reload}
            read={(form) => ({
              code: form.get('code'),
              name: form.get('name'),
              description: form.get('description'),
              startDate: optionalDate(form, 'startDate'),
              endDate: optionalDate(form, 'endDate'),
            })}
          >
            {(error) => (
              <>
                <Field
                  label="Código"
                  name="code"
                  required
                  maxLength={40}
                  defaultValue={classroom.code}
                  error={error}
                />
                <Field
                  label="Nombre"
                  name="name"
                  required
                  maxLength={160}
                  defaultValue={classroom.name}
                  error={error}
                />
                <TextAreaField
                  label="Descripción"
                  name="description"
                  maxLength={4000}
                  defaultValue={classroom.description}
                  error={error}
                />
                <Field
                  label="Fecha de inicio"
                  name="startDate"
                  type="date"
                  defaultValue={classroom.startDate ?? ''}
                  error={error}
                />
                <Field
                  label="Fecha de término"
                  name="endDate"
                  type="date"
                  defaultValue={classroom.endDate ?? ''}
                  error={error}
                />
              </>
            )}
          </RecordForm>
          {admin ? (
            <>
              <RecordForm
                title="Reasignar profesor"
                description="El profesor debe estar activo en esta organización. La nueva asignación sustituirá a la anterior."
                path={`/api/v1/classes/${classroom.id}/teacher`}
                inputSchema={teacherAssignmentSchema}
                responseSchema={classResponseSchema}
                method="PUT"
                etag={etagFor(classroom.revision)}
                read={(form) => ({ teacherId: form.get('teacherId') })}
                onDone={reload}
              >
                {() => (
                  <TeacherSelect
                    orgId={classroom.organizationId}
                    defaultValue={classroom.teacherId}
                  />
                )}
              </RecordForm>
              <RecordForm
                title="Archivar clase"
                description="Primero cierra las actividades publicadas. Se conservará la consulta y se invalidarán sus códigos de incorporación."
                path={`/api/v1/classes/${classroom.id}/archive`}
                inputSchema={academicArchiveSchema}
                responseSchema={classResponseSchema}
                etag={etagFor(classroom.revision)}
                onDone={reload}
                read={(form) => ({ reason: form.get('reason') })}
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
            </>
          ) : null}
        </div>
      ) : null}
      {teacher && active ? (
        <JoinCodes classroom={classroom} timezone={timezone} done={reload} />
      ) : null}
      <MaterialsPanel
        classId={classroom.id}
        canUpload={active && (admin || teacher)}
        manage={admin || teacher}
      />
      {membership?.role !== 'ADMIN' ? (
        <Section
          title="Actividades"
          action={
            teacher && active ? (
              <ActivityFormDialog
                classId={classroom.id}
                orgId={classroom.organizationId}
                timezone={timezone}
                done={activities.reload}
              />
            ) : null
          }
        >
          <LoadState state={activities.state} reload={activities.reload} />
          {activities.state.status === 'ready' ? (
            <>
              <div className="space-y-4">
                {activities.state.result.body.data.length === 0 ? (
                  <p>No hay actividades disponibles en esta clase.</p>
                ) : null}
                {activities.state.result.body.data.map((activity) => (
                  <article
                    key={activity.id}
                    data-cy="activity-card"
                    className="space-y-3 rounded-lg border p-4"
                  >
                    <h2 className="font-semibold">{activity.title}</h2>
                    <p className="text-sm">
                      {activityLabels[activity.state]} ·{' '}
                      {activity.type === 'FORMATIVE'
                        ? 'Formativa'
                        : 'Diagnóstica'}
                    </p>
                    <p className="text-sm">
                      Apertura: {instantLabel(activity.opensAt, timezone)} ·
                      Cierre: {instantLabel(activity.closesAt, timezone)}
                    </p>
                    <Button asChild variant="outline">
                      <Link href={`/actividades/${activity.id}`}>
                        Abrir actividad
                      </Link>
                    </Button>
                    {membership?.role === 'STUDENT' ? (
                      <ActivityProgress activityId={activity.id} />
                    ) : null}
                  </article>
                ))}
              </div>
              {activities.pagination(activities.state.result.body.page)}
            </>
          ) : null}
        </Section>
      ) : null}
    </div>
  );
}

export function ClassPanel({ classId }: { classId: string }) {
  const resource = useApiResource(
    `/api/v1/classes/${encodeURIComponent(classId)}`,
    classResponseSchema,
  );
  if (resource.state.status !== 'ready')
    return <LoadState state={resource.state} reload={resource.reload} />;
  return (
    <ClassContent
      classroom={resource.state.result.body.data}
      reload={resource.refresh}
    />
  );
}
