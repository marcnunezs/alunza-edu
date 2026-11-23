'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  organizationResponseSchema,
  classResponseSchema,
  studentDetailProgressResponseSchema,
  studentDetailQuerySchema,
  type StudentDetailProgress,
  type StudentDetailQuery,
} from '@alunza/contracts';
import { useSession } from '@/components/session-provider';
import { Pagination } from '@/components/identity-forms';
import { RequestError } from '@/components/request-error';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import { dashboardQuery } from '@/lib/dashboard-view';
import { presentSignalFilters } from '@/lib/signal-review-operation';
import { localDateTime } from '@/lib/academic-time';
import {
  readStudentDetailQuery,
  selectedInstant,
  studentDetailSearch,
} from '@/lib/student-detail-view';
import { ProgressCounters } from './progress-counters';
import {
  DiagnosesTable,
  ObservationSummaryView,
  ObservedAttemptFacts,
} from './dashboard-observations';
import { DashboardTable } from './dashboard-table';
import { LoadState, Section, inputClass, instantLabel } from './shared';
import {
  useStudentDetailResource,
  type StudentDetailScope,
} from './student-detail-shared';
import { StudentDetailAttemptPanel } from './student-detail-attempt';
import { StudentDetailSignals } from './student-detail-signals';
import { StudentDetailEvidenceButton } from './student-detail-evidence';

function DetailFilters({
  value,
  filters,
  scope,
  onApply,
}: {
  value: StudentDetailProgress;
  filters: StudentDetailQuery;
  scope: StudentDetailScope;
  onApply: (filters: StudentDetailQuery) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [activityId, setActivityId] = useState(filters.activityId ?? '');
  const [conceptId, setConceptId] = useState(filters.conceptId ?? '');
  const needChoices = !!(filters.activityId || filters.conceptId);
  const resource = useStudentDetailResource(
    `${scope.base}/progress?${dashboardQuery({ asOf: scope.asOf })}`,
    studentDetailProgressResponseSchema,
    scope.onDenied,
    needChoices,
  );
  const choices = needChoices
    ? resource.state.status === 'ready'
      ? resource.state.result.body.data.progress
      : null
    : value.progress;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const from = selectedInstant(
        String(form.get('from') ?? ''),
        filters.from,
        scope.timezone,
      );
      const asOf = selectedInstant(
        String(form.get('asOf') ?? ''),
        scope.asOf,
        scope.timezone,
      );
      const next = studentDetailQuerySchema.parse({
        ...(form.get('activityId')
          ? { activityId: form.get('activityId') }
          : {}),
        ...(form.get('conceptId') ? { conceptId: form.get('conceptId') } : {}),
        ...(from ? { from } : {}),
        ...(asOf ? { asOf } : {}),
      });
      setError(null);
      onApply(next);
    } catch (cause) {
      setError(
        cause instanceof Error && !('issues' in cause)
          ? cause.message
          : 'Revisa los filtros. El inicio debe ser anterior o igual al corte.',
      );
    }
  }
  return (
    <Section title="Filtros del estudiante">
      <form
        className="space-y-4"
        data-cy="student-detail-filters"
        onSubmit={submit}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-2" htmlFor="student-detail-activity">
            <span className="block font-semibold">Actividad</span>
            <select
              id="student-detail-activity"
              name="activityId"
              className={inputClass}
              value={activityId}
              onChange={(event) => setActivityId(event.target.value)}
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
          <label className="space-y-2" htmlFor="student-detail-concept">
            <span className="block font-semibold">Concepto</span>
            <select
              id="student-detail-concept"
              name="conceptId"
              className={inputClass}
              value={conceptId}
              onChange={(event) => setConceptId(event.target.value)}
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
          <label className="space-y-2" htmlFor="student-detail-from">
            <span className="block font-semibold">
              Inicio del período ({scope.timezone})
            </span>
            <input
              id="student-detail-from"
              name="from"
              type="datetime-local"
              className={inputClass}
              defaultValue={localDateTime(filters.from ?? null, scope.timezone)}
              aria-describedby="student-detail-period-help"
            />
          </label>
          <label className="space-y-2" htmlFor="student-detail-cut">
            <span className="block font-semibold">
              Fecha y hora de corte ({scope.timezone})
            </span>
            <input
              id="student-detail-cut"
              name="asOf"
              type="datetime-local"
              className={inputClass}
              defaultValue={localDateTime(scope.asOf, scope.timezone)}
              aria-describedby="student-detail-period-help"
            />
          </label>
        </div>
        <p id="student-detail-period-help" className="text-sm">
          El período limita intentos, errores, eventos y pistas observados. El
          progreso conserva los logros anteriores y la última actividad se
          calcula hasta el corte. Deja el corte vacío para consultar el momento
          actual.
        </p>
        {error ? <p role="alert">{error}</p> : null}
        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={!choices}>
            Aplicar filtros
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => onApply({ asOf: scope.asOf })}
          >
            Limpiar filtros
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              const { asOf: _asOf, cursor: _cursor, ...rest } = filters;
              onApply(rest);
            }}
          >
            Consultar momento actual
          </Button>
        </div>
      </form>
      {needChoices ? (
        <LoadState state={resource.state} reload={resource.reload} />
      ) : null}
    </Section>
  );
}

function DetailContent({
  value,
  filters,
  scope,
  returnQuery,
  onApply,
}: {
  value: StudentDetailProgress;
  filters: StudentDetailQuery;
  scope: StudentDetailScope;
  returnQuery: string;
  onApply: (filters: StudentDetailQuery) => void;
}) {
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [attemptActivation, setAttemptActivation] = useState(0);
  const [signalsReady, setSignalsReady] = useState(false);
  const attemptTrigger = useRef<HTMLElement | null>(null);
  const progress = value.progress;
  function openAttempt(id: string, returnFocus?: HTMLElement | null) {
    attemptTrigger.current =
      returnFocus ??
      (document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null);
    setAttemptId(id);
    setAttemptActivation((previous) => previous + 1);
  }
  return (
    <div className="min-w-0 space-y-6" data-cy="student-detail">
      <Link
        data-cy="student-detail-back"
        className="underline"
        href={`/clases/${scope.classId}/tablero${returnQuery ? `?${returnQuery}` : ''}`}
      >
        Volver al tablero de clase
      </Link>
      <header className="space-y-3">
        <h1 className="text-3xl font-semibold">
          Detalle del estudiante · {value.studentName}
        </h1>
        <p>{value.className} · Matrícula activa actual.</p>
        <p className="text-sm">
          Incorporación: {instantLabel(value.enrolledAt, scope.timezone)} (
          {scope.timezone}).
        </p>
        <p>
          Consulta al{' '}
          <time dateTime={scope.asOf}>
            {instantLabel(scope.asOf, scope.timezone)}
          </time>{' '}
          ({scope.timezone}). Las observaciones describen hechos confirmados y
          no son una calificación.
        </p>
      </header>
      <DetailFilters
        value={value}
        filters={filters}
        scope={scope}
        onApply={onApply}
      />
      <div
        className="space-y-6"
        data-cy={
          signalsReady ? 'student-detail-ready' : 'student-detail-results'
        }
        data-testid={signalsReady ? 'student-detail-ready' : undefined}
      >
        <Section title="Progreso y última actividad">
          <div className="space-y-4" data-cy="student-detail-summary">
            <ProgressCounters value={progress.summary} />
            <p>
              Última actividad al corte:{' '}
              {progress.observation.lastActivityAt
                ? instantLabel(
                    progress.observation.lastActivityAt,
                    scope.timezone,
                  )
                : 'Sin eventos al corte'}
              .
            </p>
            <ObservationSummaryView value={progress.observation.summary} />
            <DiagnosesTable value={progress.observation.summary} />
          </div>
          <p className="text-sm">
            El progreso es acumulado. El período observado comienza{' '}
            {progress.observation.from
              ? instantLabel(progress.observation.from, scope.timezone)
              : 'al inicio del historial'}
            .
          </p>
          <div className="flex flex-wrap gap-3">
            <StudentDetailEvidenceButton
              scope={scope}
              filters={filters}
              kind="EVENT"
              label="Ver actividad registrada"
              onAttempt={openAttempt}
            />
            <StudentDetailEvidenceButton
              scope={scope}
              filters={filters}
              kind="HINT"
              label="Ver entregas de pistas"
              onAttempt={openAttempt}
            />
          </div>
        </Section>
        <Section title="Progreso por actividad y concepto">
          {progress.byActivity.length ? (
            <DashboardTable
              label="Avance por actividad del estudiante"
              headers={['Actividad', 'Completados / requeridos']}
            >
              {progress.byActivity.map((item) => (
                <tr key={item.activityId}>
                  <th scope="row">{item.title}</th>
                  <td>
                    <ProgressCounters value={item} />
                  </td>
                </tr>
              ))}
            </DashboardTable>
          ) : (
            <p>Sin actividades para estos filtros y corte.</p>
          )}
          {progress.byConcept.length ? (
            <DashboardTable
              label="Avance por concepto del estudiante"
              headers={['Concepto', 'Completados / requeridos']}
            >
              {progress.byConcept.map((item) => (
                <tr key={item.conceptId}>
                  <th scope="row">{item.name}</th>
                  <td>
                    <ProgressCounters value={item} />
                  </td>
                </tr>
              ))}
            </DashboardTable>
          ) : (
            <p>Sin conceptos para estos filtros y corte.</p>
          )}
          <p className="text-sm">
            Una asignación puede pertenecer a varios conceptos; sus porcentajes
            no se suman.
          </p>
          <StudentDetailEvidenceButton
            scope={scope}
            filters={filters}
            kind="COMPLETION"
            label="Ver intentos que acreditan logros"
            onAttempt={openAttempt}
          />
        </Section>
        <section
          className="space-y-4 rounded-xl border bg-card p-5"
          data-cy="student-detail-attempts"
          aria-labelledby="student-detail-attempts-title"
        >
          <h2
            id="student-detail-attempts-title"
            className="text-xl font-semibold"
          >
            Intentos del período
          </h2>
          {progress.observation.attempts.length ? (
            <ol className="space-y-3">
              {progress.observation.attempts.map((attempt) => (
                <li
                  className="space-y-3 rounded border p-4"
                  key={attempt.id}
                  data-cy="student-detail-attempt-row"
                  data-attempt-id={attempt.id}
                >
                  <ObservedAttemptFacts
                    attempt={attempt}
                    timezone={scope.timezone}
                  />
                  <Button
                    variant="outline"
                    data-cy="student-detail-open-attempt"
                    onClick={() => openAttempt(attempt.id)}
                  >
                    Ver intento
                  </Button>
                </li>
              ))}
            </ol>
          ) : (
            <p>
              {filters.activityId || filters.conceptId || filters.from
                ? 'Sin intentos confirmados para estos filtros y período.'
                : 'Este estudiante no tiene intentos confirmados en esta clase hasta el corte.'}
            </p>
          )}
          <Pagination
            cursor={filters.cursor ?? null}
            hasMore={progress.observation.page.hasMore}
            onFirst={() => {
              const { cursor: _cursor, ...rest } = filters;
              onApply({ ...rest, asOf: scope.asOf });
            }}
            onNext={() => {
              if (progress.observation.page.nextCursor)
                onApply({
                  ...filters,
                  asOf: scope.asOf,
                  cursor: progress.observation.page.nextCursor,
                });
            }}
          />
        </section>
        {attemptId ? (
          <StudentDetailAttemptPanel
            key={attemptId}
            scope={scope}
            attemptId={attemptId}
            activation={attemptActivation}
            onClose={() => {
              setAttemptId(null);
              attemptTrigger.current?.focus();
            }}
          />
        ) : null}
        <StudentDetailSignals
          scope={scope}
          filters={filters}
          onAttempt={openAttempt}
          onReady={setSignalsReady}
          onPresent={() => onApply(presentSignalFilters(filters))}
        />
      </div>
    </div>
  );
}

function AuthorizedDetail({
  classId,
  studentId,
  filters,
  returnQuery,
  onDenied,
}: {
  classId: string;
  studentId: string;
  filters: StudentDetailQuery;
  returnQuery: string;
  onDenied: StudentDetailScope['onDenied'];
}) {
  const router = useRouter();
  const base = `/api/v1/classes/${classId}/students/${studentId}`;
  const resource = useStudentDetailResource(
    `${base}/progress?${dashboardQuery(filters)}`,
    studentDetailProgressResponseSchema,
    onDenied,
  );
  const value =
    resource.state.status === 'ready' ? resource.state.result.body.data : null;
  const organization = useStudentDetailResource(
    `/api/v1/organizations/${value?.organizationId ?? ''}`,
    organizationResponseSchema,
    onDenied,
    !!value,
  );
  const classroom = useStudentDetailResource(
    `/api/v1/classes/${classId}`,
    classResponseSchema,
    onDenied,
  );
  const path = `/clases/${classId}/estudiantes/${studentId}`;
  const resolvedCut = value?.asOf;
  useEffect(() => {
    if (!filters.asOf && resolvedCut)
      router.replace(
        `${path}?${studentDetailSearch({ ...filters, asOf: resolvedCut }, returnQuery)}`,
        { scroll: false },
      );
  }, [filters, resolvedCut, path, returnQuery, router]);
  if (!value)
    return <LoadState state={resource.state} reload={resource.reload} />;
  if (!filters.asOf)
    return <p role="status">Preparando el corte de la consulta…</p>;
  if (organization.state.status !== 'ready')
    return (
      <LoadState state={organization.state} reload={organization.reload} />
    );
  if (classroom.state.status !== 'ready')
    return <LoadState state={classroom.state} reload={classroom.reload} />;
  const scope = {
    base,
    classId,
    studentId,
    asOf: value.asOf,
    timezone: organization.state.result.body.data.timezone,
    writable: classroom.state.result.body.data.state === 'ACTIVE',
    onDenied,
  };
  return (
    <DetailContent
      value={value}
      filters={filters}
      scope={scope}
      returnQuery={returnQuery}
      onApply={(next) => {
        const search = studentDetailSearch(next, returnQuery);
        if (dashboardQuery(next) === dashboardQuery(filters))
          void resource.reload();
        else
          router.push(`${path}${search ? `?${search}` : ''}`, {
            scroll: false,
          });
      }}
    />
  );
}

function DetailGate({
  classId,
  studentId,
  initialQuery,
}: {
  classId: string;
  studentId: string;
  initialQuery: string;
}) {
  const [denied, setDenied] = useState<ApiError | null>(null);
  const { refreshIdentity } = useSession();
  let location: ReturnType<typeof readStudentDetailQuery>;
  try {
    location = readStudentDetailQuery(initialQuery);
  } catch {
    return (
      <div className="space-y-3">
        <RequestError
          error={
            new ApiError(
              422,
              'VALIDATION_FAILED',
              'Revisa los filtros de la dirección. La consulta no se ha aplicado.',
            )
          }
        />
        <Link
          href={`/clases/${classId}/estudiantes/${studentId}`}
          className="underline"
        >
          Restablecer filtros
        </Link>
      </div>
    );
  }
  if (denied)
    return (
      <div className="space-y-3">
        <RequestError error={denied} />
        <Link className="underline" href={`/clases/${classId}/tablero`}>
          Volver a la clase
        </Link>
        <Button variant="outline" onClick={() => void refreshIdentity()}>
          Volver a comprobar acceso
        </Button>
      </div>
    );
  return (
    <AuthorizedDetail
      classId={classId}
      studentId={studentId}
      {...location}
      onDenied={setDenied}
    />
  );
}

export function TeacherStudentDetailPanel(props: {
  classId: string;
  studentId: string;
  initialQuery: string;
}) {
  const { revision } = useSession();
  return (
    <DetailGate
      key={`${revision}:${props.classId}:${props.studentId}:${props.initialQuery}`}
      {...props}
    />
  );
}
