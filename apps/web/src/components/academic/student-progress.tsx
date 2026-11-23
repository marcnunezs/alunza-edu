'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import {
  classResponseSchema,
  organizationResponseSchema,
  progressQuerySchema,
  studentProgressResponseSchema,
  attemptResponseSchema,
  type AcademicClass,
  type ProgressQuery,
  type StudentProgress,
  type ObservedAttempt,
} from '@alunza/contracts';
import { useSession } from '@/components/session-provider';
import { Button } from '@/components/ui/button';
import { FormDialog, Pagination } from '@/components/identity-forms';
import { useApiResource } from '@/lib/use-api-resource';
import { toInstant } from '@/lib/academic-time';
import { ProgressCounters } from './progress-counters';
import { dashboardQuery } from '@/lib/dashboard-view';
import {
  DiagnosesTable,
  ObservationSummaryView,
  ObservedAttemptFacts,
} from './dashboard-observations';
import { AttemptResult } from './attempt-history';
import { AttemptHelpPanel } from './attempt-help-panel';
import { LoadState, Section, inputClass, instantLabel } from './shared';

function EvidenceAttempt({ attemptId }: { attemptId: string }) {
  const resource = useApiResource(
    `/api/v1/attempts/${attemptId}`,
    attemptResponseSchema,
  );
  return (
    <div className="space-y-4" data-cy="progress-attempt-detail">
      <LoadState state={resource.state} reload={resource.reload} />
      {resource.state.status === 'ready' ? (
        <>
          <AttemptResult attempt={resource.state.result.body.data} />
          <AttemptHelpPanel attempt={resource.state.result.body.data} />
        </>
      ) : null}
    </div>
  );
}

function EvidenceRow({
  evidence,
  title,
  timezone,
}: {
  evidence: StudentProgress['evidence'][number];
  title: string;
  timezone: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li
      className="flex flex-wrap items-center justify-between gap-3 rounded border p-3"
      data-cy="progress-evidence-row"
    >
      <div>
        <p className="font-semibold">{title}</p>
        <p className="text-sm">
          Completado al confirmar el intento:{' '}
          <time dateTime={evidence.submittedAt}>
            {instantLabel(evidence.submittedAt, timezone)}
          </time>
        </p>
      </div>
      <FormDialog
        title="Intento que acredita el progreso"
        description="Este intento confirmó todas las pruebas requeridas. La ayuda se consulta por separado y no modifica el logro."
        open={open}
        onOpenChange={setOpen}
        trigger={
          <Button variant="outline" data-cy="progress-show-attempt">
            Ver intento y ayuda
          </Button>
        }
      >
        {open ? <EvidenceAttempt attemptId={evidence.attemptId} /> : null}
      </FormDialog>
    </li>
  );
}

function RecentAttempt({
  attempt,
  timezone,
}: {
  attempt: ObservedAttempt;
  timezone: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li
      className="space-y-3 rounded-lg border p-4"
      data-cy="progress-recent-attempt-row"
    >
      <ObservedAttemptFacts attempt={attempt} timezone={timezone} />
      <FormDialog
        title="Intento confirmado y ayuda"
        description="Consulta el resultado de este intento y sus explicaciones o pistas. La ayuda no cambia el resultado confirmado."
        open={open}
        onOpenChange={setOpen}
        trigger={
          <Button variant="outline" data-cy="progress-open-recent-attempt">
            Ver intento y ayuda
          </Button>
        }
      >
        {open ? <EvidenceAttempt attemptId={attempt.id} /> : null}
      </FormDialog>
    </li>
  );
}

function ProgressContent({
  classroom,
  timezone,
}: {
  classroom: AcademicClass;
  timezone: string;
}) {
  const [filters, setFilters] = useState<ProgressQuery>({
    classId: classroom.id,
  });
  const [formError, setFormError] = useState<string | null>(null);
  const options = useApiResource(
    `/api/v1/me/progress?classId=${classroom.id}`,
    studentProgressResponseSchema,
  );
  const hasFilters = !!(
    filters.activityId ||
    filters.conceptId ||
    filters.asOf ||
    filters.from ||
    filters.cursor
  );
  const query = dashboardQuery(filters);
  const filtered = useApiResource(
    `/api/v1/me/progress?${query}`,
    studentProgressResponseSchema,
    hasFilters,
  );
  const resource = hasFilters ? filtered : options;
  const progress =
    resource.state.status === 'ready' ? resource.state.result.body.data : null;
  const choices =
    options.state.status === 'ready' ? options.state.result.body.data : null;

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const asOf = toInstant(String(form.get('asOf') ?? ''), timezone);
      const from = toInstant(String(form.get('from') ?? ''), timezone);
      const input = progressQuerySchema.parse({
        classId: classroom.id,
        ...(form.get('activityId')
          ? { activityId: form.get('activityId') }
          : {}),
        ...(form.get('conceptId') ? { conceptId: form.get('conceptId') } : {}),
        ...(asOf ? { asOf } : {}),
        ...(from ? { from } : {}),
      });
      setFormError(null);
      if (JSON.stringify(input) === JSON.stringify(filters))
        void resource.reload();
      else {
        if (!input.activityId && !input.conceptId && !input.asOf && !input.from)
          void options.reload();
        setFilters(input);
      }
    } catch (cause) {
      setFormError(
        cause instanceof Error && !('issues' in cause)
          ? cause.message
          : 'Revisa los filtros seleccionados y la fecha de corte.',
      );
    }
  }

  return (
    <div className="space-y-6" data-cy="student-progress">
      <Link href={`/clases/${classroom.id}`} className="underline">
        Volver a la clase
      </Link>
      <header className="space-y-3">
        <h1 className="text-3xl font-semibold">
          Mi progreso · {classroom.name}
        </h1>
        <p>
          Avance acumulado de ejercicios requeridos. Un éxito previo se conserva
          aunque después falle otro intento. Este avance no es una nota.
        </p>
      </header>
      <Section title="Filtros">
        <form onSubmit={apply} className="space-y-4" data-cy="progress-filters">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-2" htmlFor="progress-activity">
              <span className="block font-semibold">Actividad</span>
              <select
                id="progress-activity"
                name="activityId"
                className={inputClass}
                disabled={!choices}
              >
                <option value="">Todas las actividades</option>
                {choices?.byActivity.map((item) => (
                  <option key={item.activityId} value={item.activityId}>
                    {item.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-2" htmlFor="progress-concept">
              <span className="block font-semibold">Concepto</span>
              <select
                id="progress-concept"
                name="conceptId"
                className={inputClass}
                disabled={!choices}
              >
                <option value="">Todos los conceptos</option>
                {choices?.byConcept.map((item) => (
                  <option key={item.conceptId} value={item.conceptId}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-2" htmlFor="progress-cut">
              <span className="block font-semibold">
                Fecha y hora de corte ({timezone})
              </span>
              <input
                id="progress-cut"
                name="asOf"
                type="datetime-local"
                className={inputClass}
                aria-describedby="progress-cut-help"
              />
            </label>
            <label className="space-y-2" htmlFor="progress-from">
              <span className="block font-semibold">
                Inicio del período observado ({timezone})
              </span>
              <input
                id="progress-from"
                name="from"
                type="datetime-local"
                className={inputClass}
                aria-describedby="progress-cut-help"
              />
            </label>
          </div>
          <p id="progress-cut-help" className="text-sm">
            Deja el corte vacío para consultar el momento actual. Se incluyen
            todos los logros confirmados hasta ese instante. El inicio del
            período limita los intentos, errores y pistas observados; no elimina
            logros anteriores del progreso acumulado.
          </p>
          {formError ? <p role="alert">{formError}</p> : null}
          <div className="flex flex-wrap gap-3">
            <Button type="submit">Aplicar filtros</Button>
            <Button
              type="reset"
              variant="outline"
              onClick={() => {
                setFormError(null);
                setFilters({ classId: classroom.id });
                void options.reload();
              }}
            >
              Limpiar filtros
            </Button>
          </div>
        </form>
        {!choices && hasFilters ? (
          <LoadState state={options.state} reload={options.reload} />
        ) : null}
      </Section>
      <LoadState state={resource.state} reload={resource.reload} />
      {progress ? (
        <div
          key={JSON.stringify(filters)}
          className="space-y-6"
          data-cy="progress-results"
          aria-live="polite"
        >
          <Section title="Avance al corte">
            <p data-cy="progress-applied-filters">
              Actividad:{' '}
              {choices?.byActivity.find(
                (item) => item.activityId === progress.filters.activityId,
              )?.title ?? 'Todas'}{' '}
              · Concepto:{' '}
              {choices?.byConcept.find(
                (item) => item.conceptId === progress.filters.conceptId,
              )?.name ?? 'Todos'}
            </p>
            <p>
              Progreso acumulado al{' '}
              <time dateTime={progress.asOf}>
                {instantLabel(progress.asOf, timezone)}
              </time>{' '}
              ({timezone}).
            </p>
            <div data-cy="progress-summary">
              <ProgressCounters value={progress.summary} />
            </div>
          </Section>
          <Section title="Por actividad">
            {progress.byActivity.length ? (
              <ul className="space-y-3">
                {progress.byActivity.map((item) => (
                  <li
                    key={item.activityId}
                    className="space-y-2 rounded border p-3"
                    data-cy="progress-activity-row"
                  >
                    <h3 className="font-semibold">{item.title}</h3>
                    <ProgressCounters value={item} />
                  </li>
                ))}
              </ul>
            ) : (
              <p>Sin actividades para estos filtros y corte.</p>
            )}
          </Section>
          <Section title="Por concepto">
            <p className="text-sm">
              Una asignación puede aportar a varios conceptos. Sus porcentajes
              no se suman para obtener el avance total.
            </p>
            {progress.byConcept.length ? (
              <ul className="space-y-3">
                {progress.byConcept.map((item) => (
                  <li
                    key={item.conceptId}
                    className="space-y-2 rounded border p-3"
                    data-cy="progress-concept-row"
                  >
                    <h3 className="font-semibold">{item.name}</h3>
                    <ProgressCounters value={item} />
                  </li>
                ))}
              </ul>
            ) : (
              <p>Sin conceptos para estos filtros y corte.</p>
            )}
          </Section>
          <Section title="Intentos que acreditan el avance">
            {progress.evidence.length ? (
              <ul className="space-y-3">
                {progress.evidence.map((item) => (
                  <EvidenceRow
                    key={item.attemptId}
                    evidence={item}
                    title={
                      progress.byActivity.find(
                        (activity) => activity.activityId === item.activityId,
                      )?.title ?? 'Actividad'
                    }
                    timezone={timezone}
                  />
                ))}
              </ul>
            ) : (
              <p>
                Sin intentos que acrediten completitud para estos filtros y
                corte.
              </p>
            )}
          </Section>
          <Section title="Actividad, errores y pistas del período">
            <div className="space-y-5" data-cy="progress-observation">
              <p>
                Desde{' '}
                {progress.observation.from
                  ? instantLabel(progress.observation.from, timezone)
                  : 'el inicio del historial'}{' '}
                hasta {instantLabel(progress.asOf, timezone)} ({timezone}).
              </p>
              <p>
                Última actividad observable al corte:{' '}
                {progress.observation.lastActivityAt
                  ? instantLabel(progress.observation.lastActivityAt, timezone)
                  : 'Sin eventos al corte'}
                .
              </p>
              <ObservationSummaryView value={progress.observation.summary} />
              <DiagnosesTable value={progress.observation.summary} />
              <h3 className="text-lg font-semibold">Intentos del período</h3>
              {progress.observation.attempts.length ? (
                <ul className="space-y-3">
                  {progress.observation.attempts.map((attempt) => (
                    <RecentAttempt
                      key={attempt.id}
                      attempt={attempt}
                      timezone={timezone}
                    />
                  ))}
                </ul>
              ) : (
                <p>Sin intentos confirmados para estos filtros y período.</p>
              )}
              <Pagination
                cursor={filters.cursor ?? null}
                hasMore={progress.observation.page.hasMore}
                onFirst={() =>
                  setFilters(({ cursor: _cursor, ...previous }) => previous)
                }
                onNext={() => {
                  const cursor = progress.observation.page.nextCursor;
                  if (cursor)
                    setFilters({ ...filters, asOf: progress.asOf, cursor });
                }}
              />
            </div>
          </Section>
        </div>
      ) : null}
    </div>
  );
}

export function StudentProgressPanel({ classId }: { classId: string }) {
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
  const membership =
    identity.status === 'ready'
      ? identity.data.memberships.find(
          (item) => item.organizationId === organizationId,
        )
      : null;
  if (membership?.role !== 'STUDENT' || membership.state !== 'ACTIVE')
    return (
      <p role="alert">El recurso no está disponible o no tienes acceso.</p>
    );
  if (organization.state.status !== 'ready')
    return (
      <LoadState state={organization.state} reload={organization.reload} />
    );
  return (
    <ProgressContent
      key={`${identity.status === 'ready' ? identity.data.id : ''}:${classId}`}
      classroom={classroom.state.result.body.data}
      timezone={organization.state.result.body.data.timezone}
    />
  );
}
