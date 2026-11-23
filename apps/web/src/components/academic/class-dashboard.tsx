'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { z } from 'zod';
import {
  classResponseSchema,
  dashboardQuerySchema,
  dashboardResponseSchema,
  organizationResponseSchema,
  type AcademicClass,
  type DashboardQuery,
} from '@alunza/contracts';
import { Pagination } from '@/components/identity-forms';
import { useSession } from '@/components/session-provider';
import { Button } from '@/components/ui/button';
import { localDateTime } from '@/lib/academic-time';
import {
  readDashboardQuery,
  selectedInstant,
  studentDetailHref,
} from '@/lib/student-detail-view';
import {
  dashboardQuery,
  dashboardEvidenceScope,
  dashboardSignalLabels,
  dashboardSignalStateLabels,
} from '@/lib/dashboard-view';
import { progressPercentage } from '@/lib/progress-view';
import { useApiResource } from '@/lib/use-api-resource';
import type { ApiError } from '@/lib/api';
import { presentSignalFilters } from '@/lib/signal-review-operation';
import { RequestError } from '@/components/request-error';
import {
  DashboardEvidenceButton,
  DiagnosesTable,
  ObservationSummaryView,
} from './dashboard-observations';
import { DashboardSignalsPanel, SignalProcessing } from './dashboard-signals';
import { DashboardTable } from './dashboard-table';
import { ProgressCounters } from './progress-counters';
import { LoadState, Section, inputClass, instantLabel } from './shared';

type OrganizationResource = ReturnType<
  typeof useApiResource<z.infer<typeof organizationResponseSchema>>
>;

function DashboardContent({
  classroom,
  organization,
  initialFilters,
}: {
  classroom: AcademicClass;
  organization: OrganizationResource;
  initialFilters: DashboardQuery;
}) {
  const filters = initialFilters;
  const router = useRouter();
  function setFilters(next: DashboardQuery) {
    const query = dashboardQuery(next);
    router.replace(
      `/clases/${classroom.id}/tablero${query ? `?${query}` : ''}`,
      { scroll: false },
    );
  }
  const [formError, setFormError] = useState<string | null>(null);
  const [reviewDenied, setReviewDenied] = useState<ApiError | null>(null);
  const [activityId, setActivityId] = useState(filters.activityId ?? '');
  const [conceptId, setConceptId] = useState(filters.conceptId ?? '');
  const options = useApiResource(
    `/api/v1/classes/${classroom.id}/dashboard`,
    dashboardResponseSchema,
  );
  const query = dashboardQuery(filters);
  const filtered = useApiResource(
    `/api/v1/classes/${classroom.id}/dashboard?${query}`,
    dashboardResponseSchema,
    !!query,
  );
  const resource = query ? filtered : options;
  const dashboard =
    resource.state.status === 'ready' ? resource.state.result.body.data : null;
  const choices =
    options.state.status === 'ready' ? options.state.result.body.data : null;
  if (reviewDenied)
    return (
      <div className="space-y-3">
        <RequestError error={reviewDenied} />
        <Button variant="outline" onClick={() => window.location.reload()}>
          Volver a comprobar acceso
        </Button>
      </div>
    );
  if (organization.state.status !== 'ready')
    return (
      <LoadState
        state={organization.state}
        reload={() => Promise.all([organization.reload(), resource.reload()])}
      />
    );
  const timezone = organization.state.result.body.data.timezone;
  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const from = selectedInstant(
        String(form.get('from') ?? ''),
        filters.from,
        timezone,
      );
      const asOf = selectedInstant(
        String(form.get('asOf') ?? ''),
        filters.asOf,
        timezone,
      );
      const input = dashboardQuerySchema.parse({
        ...(form.get('activityId')
          ? { activityId: form.get('activityId') }
          : {}),
        ...(form.get('conceptId') ? { conceptId: form.get('conceptId') } : {}),
        ...(from ? { from } : {}),
        ...(asOf ? { asOf } : {}),
      });
      setFormError(null);
      if (dashboardQuery(input) === query) void resource.reload();
      else {
        if (!dashboardQuery(input)) void options.reload();
        setFilters(input);
      }
    } catch (cause) {
      setFormError(
        cause instanceof Error && !('issues' in cause)
          ? cause.message
          : 'Revisa los filtros. El inicio del período debe ser anterior o igual a la fecha de corte.',
      );
    }
  }
  return (
    <div className="min-w-0 space-y-6" data-cy="class-dashboard">
      <Link href={`/clases/${classroom.id}`} className="underline">
        Volver a la clase
      </Link>
      <header className="space-y-3">
        <h1 className="text-3xl font-semibold">
          Tablero de clase · {classroom.name}
        </h1>
        <p>
          Actividad y avance de la matrícula activa de esta clase. Los
          resultados describen hechos confirmados y no son una calificación.
        </p>
        {classroom.state === 'ARCHIVED' ? (
          <p role="status">Clase archivada · Consulta histórica autorizada.</p>
        ) : null}
      </header>
      <Section title="Filtros del tablero">
        <form
          className="space-y-4"
          data-cy="dashboard-filters"
          onSubmit={apply}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-2" htmlFor="dashboard-activity">
              <span className="block font-semibold">Actividad</span>
              <select
                id="dashboard-activity"
                name="activityId"
                className={inputClass}
                disabled={!choices}
                value={activityId}
                onChange={(event) => setActivityId(event.target.value)}
              >
                <option value="">Todas las actividades</option>
                {choices?.byActivity.map((activity) => (
                  <option key={activity.activityId} value={activity.activityId}>
                    {activity.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-2" htmlFor="dashboard-concept">
              <span className="block font-semibold">Concepto</span>
              <select
                id="dashboard-concept"
                name="conceptId"
                className={inputClass}
                disabled={!choices}
                value={conceptId}
                onChange={(event) => setConceptId(event.target.value)}
              >
                <option value="">Todos los conceptos</option>
                {choices?.byConcept.map((concept) => (
                  <option key={concept.conceptId} value={concept.conceptId}>
                    {concept.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-2" htmlFor="dashboard-from">
              <span className="block font-semibold">
                Inicio del período observado ({timezone})
              </span>
              <input
                id="dashboard-from"
                name="from"
                type="datetime-local"
                defaultValue={localDateTime(filters.from ?? null, timezone)}
                className={inputClass}
                aria-describedby="dashboard-period-help"
              />
            </label>
            <label className="space-y-2" htmlFor="dashboard-cut">
              <span className="block font-semibold">
                Fecha y hora de corte ({timezone})
              </span>
              <input
                id="dashboard-cut"
                name="asOf"
                type="datetime-local"
                defaultValue={localDateTime(filters.asOf ?? null, timezone)}
                className={inputClass}
                aria-describedby="dashboard-period-help"
              />
            </label>
          </div>
          <p id="dashboard-period-help" className="text-sm">
            El inicio limita la actividad, intentos y pistas observados. El
            progreso conserva todos los logros hasta el corte, incluidos los
            anteriores al período. Deja el corte vacío para consultar el momento
            actual.
          </p>
          {formError ? <p role="alert">{formError}</p> : null}
          <div className="flex flex-wrap gap-3">
            <Button type="submit">Aplicar filtros</Button>
            <Button
              type="reset"
              variant="outline"
              onClick={() => {
                setFormError(null);
                setActivityId('');
                setConceptId('');
                setFilters({});
                void options.reload();
              }}
            >
              Limpiar filtros
            </Button>
          </div>
        </form>
        {!choices && query ? (
          <LoadState state={options.state} reload={options.reload} />
        ) : null}
      </Section>
      <LoadState state={resource.state} reload={resource.reload} />
      {dashboard ? (
        <div
          key={`${query}:${dashboard.asOf}`}
          className="min-w-0 space-y-6"
          data-cy="dashboard-results"
        >
          <Section title="Resumen de clase">
            <div
              className="space-y-4"
              data-cy="dashboard-summary"
              aria-live="polite"
            >
              <p data-cy="dashboard-applied-filters">
                Actividad:{' '}
                {choices?.byActivity.find(
                  (item) => item.activityId === dashboard.filters.activityId,
                )?.title ?? 'Todas'}{' '}
                · Concepto:{' '}
                {choices?.byConcept.find(
                  (item) => item.conceptId === dashboard.filters.conceptId,
                )?.name ?? 'Todos'}
                .
              </p>
              <p>
                Período observado:{' '}
                {dashboard.filters.from
                  ? instantLabel(dashboard.filters.from, timezone)
                  : 'Desde el inicio del historial'}{' '}
                hasta{' '}
                <time dateTime={dashboard.asOf} title={dashboard.asOf}>
                  {instantLabel(dashboard.asOf, timezone)}
                </time>{' '}
                ({timezone}).
              </p>
              <p>
                Estudiantes de la matrícula activa actual:{' '}
                <strong>{dashboard.summary.students}</strong>. El corte
                histórico no reconstruye una matrícula anterior.
              </p>
              <ProgressCounters value={dashboard.summary} />
              <p className="text-sm">
                El denominador suma las asignaciones requeridas de los
                estudiantes incluidos. Los logros son acumulados al corte.
              </p>
              <ObservationSummaryView value={dashboard.summary.period} />
              <p className="text-sm">
                Última actividad observable al corte:{' '}
                {dashboard.summary.lastActivityAt
                  ? instantLabel(dashboard.summary.lastActivityAt, timezone)
                  : 'Sin eventos'}
                .
              </p>
              <div className="flex flex-wrap gap-3">
                <DashboardEvidenceButton
                  classId={classroom.id}
                  filters={dashboardEvidenceScope(dashboard, 'ATTEMPT')}
                  timezone={timezone}
                  label="Ver intentos del período"
                />
                <DashboardEvidenceButton
                  classId={classroom.id}
                  filters={dashboardEvidenceScope(dashboard, 'COMPLETION')}
                  timezone={timezone}
                  label="Ver evidencia de completitud"
                />
                <DashboardEvidenceButton
                  classId={classroom.id}
                  filters={dashboardEvidenceScope(dashboard, 'EVENT')}
                  timezone={timezone}
                  label="Ver actividad registrada"
                />
                <DashboardEvidenceButton
                  classId={classroom.id}
                  filters={dashboardEvidenceScope(dashboard, 'HINT')}
                  timezone={timezone}
                  label="Ver pistas entregadas"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Consulta realizada el{' '}
                {instantLabel(dashboard.observedAt, timezone)} ({timezone}).
              </p>
            </div>
          </Section>
          <Section title="Avance por estudiante">
            {dashboard.students.data.length ? (
              <DashboardTable
                label="Avance acumulado y actividad por estudiante"
                headers={[
                  'Estudiante',
                  'Progreso al corte',
                  'Actividad en el período',
                  'Evidencia',
                ]}
              >
                {dashboard.students.data.map((student) => (
                  <tr key={student.studentId} data-cy="dashboard-student-row">
                    <th scope="row" className="font-semibold">
                      {student.studentName}
                    </th>
                    <td>
                      <ProgressCounters value={student} />
                    </td>
                    <td>
                      <p>Intentos: {student.period.attempts}</p>
                      <p>
                        Fallos verificables: {student.period.technicalFailures}
                      </p>
                      <p>Pistas entregadas: {student.period.hintsDelivered}</p>
                      <p>
                        Última actividad al corte:{' '}
                        {student.lastActivityAt
                          ? instantLabel(student.lastActivityAt, timezone)
                          : 'Sin eventos'}
                      </p>
                      {student.signals.map((signal) => (
                        <p key={`${signal.type}:${signal.state}`}>
                          {dashboardSignalLabels[signal.type]} ·{' '}
                          {dashboardSignalStateLabels[signal.state]}:{' '}
                          {signal.count}
                        </p>
                      ))}
                    </td>
                    <td>
                      <div className="flex flex-col items-start gap-2">
                        <Button asChild variant="outline">
                          <Link
                            data-cy="dashboard-open-student-detail"
                            href={studentDetailHref(
                              classroom.id,
                              student.studentId,
                              filters,
                              dashboard.asOf,
                            )}
                          >
                            Ver detalle del estudiante
                          </Link>
                        </Button>
                        <DashboardEvidenceButton
                          classId={classroom.id}
                          filters={{
                            ...dashboardEvidenceScope(dashboard, 'ATTEMPT'),
                            studentId: student.studentId,
                          }}
                          timezone={timezone}
                          label="Ver intentos"
                        />
                        <DashboardEvidenceButton
                          classId={classroom.id}
                          filters={{
                            ...dashboardEvidenceScope(dashboard, 'COMPLETION'),
                            studentId: student.studentId,
                          }}
                          timezone={timezone}
                          label="Ver logros"
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </DashboardTable>
            ) : (
              <p>Sin estudiantes de la matrícula activa para esta consulta.</p>
            )}
            <Pagination
              cursor={filters.cursor ?? null}
              hasMore={dashboard.students.page.hasMore}
              onFirst={() => setFilters({ ...filters, cursor: undefined })}
              onNext={() => {
                if (dashboard.students.page.nextCursor)
                  setFilters({
                    ...filters,
                    asOf: dashboard.asOf,
                    cursor: dashboard.students.page.nextCursor,
                  });
              }}
            />
          </Section>
          <Section title="Intentos por diagnóstico">
            <p className="text-sm">
              Estos conteos describen los intentos del período. Un diagnóstico
              no concluyente no se interpreta como un error académico.
            </p>
            <DiagnosesTable
              value={dashboard.summary.period}
              evidence={(diagnosisCode) => (
                <DashboardEvidenceButton
                  classId={classroom.id}
                  filters={{
                    ...dashboardEvidenceScope(dashboard, 'ATTEMPT'),
                    diagnosisCode,
                  }}
                  timezone={timezone}
                  label="Ver evidencia"
                />
              )}
            />
          </Section>
          <Section title="Por actividad">
            {dashboard.byActivity.length ? (
              <DashboardTable
                label="Progreso y observaciones por actividad"
                headers={[
                  'Actividad',
                  'Progreso al corte',
                  'Intentos del período',
                  'Fallos verificables',
                  'Pistas entregadas',
                ]}
              >
                {dashboard.byActivity.map((activity) => (
                  <tr key={activity.activityId}>
                    <th scope="row" className="font-semibold">
                      {activity.title}
                    </th>
                    <td>
                      {activity.completed}/{activity.required} ·{' '}
                      {progressPercentage(activity.ratio)}
                    </td>
                    <td>{activity.period.attempts}</td>
                    <td>{activity.period.technicalFailures}</td>
                    <td>{activity.period.hintsDelivered}</td>
                  </tr>
                ))}
              </DashboardTable>
            ) : (
              <p>Sin actividades para estos filtros y corte.</p>
            )}
          </Section>
          <Section title="Por concepto">
            <p className="text-sm">
              Una asignación puede pertenecer a varios conceptos. Sus
              porcentajes y conteos no se suman para obtener el total de clase.
            </p>
            {dashboard.byConcept.length ? (
              <DashboardTable
                label="Progreso y fallas observadas por concepto"
                headers={[
                  'Concepto',
                  'Progreso al corte',
                  'Intentos del período',
                  'Fallos verificables',
                  'Pistas entregadas',
                ]}
              >
                {dashboard.byConcept.map((concept) => (
                  <tr key={concept.conceptId}>
                    <th scope="row" className="font-semibold">
                      {concept.name}
                    </th>
                    <td>
                      {concept.completed}/{concept.required} ·{' '}
                      {progressPercentage(concept.ratio)}
                    </td>
                    <td>{concept.period.attempts}</td>
                    <td>{concept.period.technicalFailures}</td>
                    <td>{concept.period.hintsDelivered}</td>
                  </tr>
                ))}
              </DashboardTable>
            ) : (
              <p>Sin conceptos para estos filtros y corte.</p>
            )}
          </Section>
          <Section title="Señales de la clase">
            <SignalProcessing
              value={dashboard.signals.processing}
              timezone={timezone}
            />
            {dashboard.signals.counts.length ? (
              <DashboardTable
                label="Señales por tipo y estado al corte"
                headers={[
                  'Tipo',
                  'Estado de revisión',
                  'Total de señales',
                  'Señales de matrícula vigente',
                  'Señales de matrícula histórica',
                ]}
              >
                {dashboard.signals.counts.map((signal) => (
                  <tr key={`${signal.type}:${signal.state}`}>
                    <th scope="row">{dashboardSignalLabels[signal.type]}</th>
                    <td>{dashboardSignalStateLabels[signal.state]}</td>
                    <td>{signal.count}</td>
                    <td>{signal.currentStudents}</td>
                    <td>{signal.historicalStudents}</td>
                  </tr>
                ))}
              </DashboardTable>
            ) : null}
            <DashboardSignalsPanel
              key={`${dashboard.asOf}:${dashboard.filters.activityId}:${dashboard.filters.conceptId}`}
              classId={classroom.id}
              asOf={dashboard.asOf}
              activityId={dashboard.filters.activityId ?? undefined}
              conceptId={dashboard.filters.conceptId ?? undefined}
              timezone={timezone}
              writable={classroom.state === 'ACTIVE'}
              onDenied={setReviewDenied}
              onPresent={() => {
                const next = presentSignalFilters(filters);
                setFilters(next);
                if (dashboardQuery(next) === query) void resource.reload();
              }}
            />
          </Section>
        </div>
      ) : null}
    </div>
  );
}

export function ClassDashboardPanel({
  classId,
  initialQuery = '',
}: {
  classId: string;
  initialQuery?: string;
}) {
  const { identity } = useSession();
  const classroom = useApiResource(
    `/api/v1/classes/${classId}`,
    classResponseSchema,
  );
  const organizationId =
    classroom.state.status === 'ready'
      ? classroom.state.result.body.data.organizationId
      : null;
  const organization = useApiResource(
    `/api/v1/organizations/${organizationId ?? ''}`,
    organizationResponseSchema,
    !!organizationId,
  );
  if (classroom.state.status !== 'ready')
    return <LoadState state={classroom.state} reload={classroom.reload} />;
  const value = classroom.state.result.body.data;
  const membership =
    identity.status === 'ready'
      ? identity.data.memberships.find(
          (item) => item.organizationId === organizationId,
        )
      : null;
  if (
    identity.status !== 'ready' ||
    membership?.role !== 'TEACHER' ||
    membership.state !== 'ACTIVE' ||
    value.teacherId !== identity.data.id
  )
    return (
      <p role="alert">El recurso no está disponible o no tienes acceso.</p>
    );
  let initialFilters: DashboardQuery;
  try {
    initialFilters = readDashboardQuery(initialQuery);
  } catch {
    return (
      <div className="space-y-3">
        <p role="alert">
          Revisa los filtros de la dirección. La consulta no se ha aplicado.
        </p>
        <Link className="underline" href={`/clases/${classId}/tablero`}>
          Restablecer filtros
        </Link>
      </div>
    );
  }
  return (
    <DashboardContent
      key={`${identity.data.id}:${classId}:${initialQuery}`}
      classroom={value}
      organization={organization}
      initialFilters={initialFilters}
    />
  );
}
