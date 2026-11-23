'use client';

import { useState, type FormEvent } from 'react';
import {
  dashboardSignalDetailResponseSchema,
  dashboardSignalQuerySchema,
  dashboardSignalsResponseSchema,
  type Dashboard,
  type DashboardSignal,
  type DashboardSignalQuery,
} from '@alunza/contracts';
import { FormDialog, Pagination } from '@/components/identity-forms';
import { Button } from '@/components/ui/button';
import { useApiResource } from '@/lib/use-api-resource';
import type { ApiError } from '@/lib/api';
import { SignalReviewAction } from './signal-review-action';
import {
  dashboardQuery,
  dashboardSignalScope,
  dashboardSignalLabels,
  dashboardSignalStateLabels,
  signalPresentation,
  signalNarrativeParts,
  signalProcessingPresentation,
} from '@/lib/dashboard-view';
import {
  activityEventLabels,
  ObservedAttemptFacts,
} from './dashboard-observations';
import { LoadState, inputClass, instantLabel } from './shared';

const outcomes = {
  MATCH: 'Se verificó el cumplimiento de la regla en ese cálculo.',
  NO_MATCH: 'La regla no se cumplía en ese cálculo.',
  NOT_EVALUABLE: 'El ámbito no permitía evaluar la regla en ese cálculo.',
  NOT_VERIFIABLE: 'No había evidencia suficiente para verificar la regla.',
} as const;

export function SignalProcessing({
  value,
  timezone,
}: {
  value: Dashboard['signals']['processing'];
  timezone: string;
}) {
  const presentation = signalProcessingPresentation(value);
  return (
    <div
      className="space-y-2 rounded-lg bg-secondary p-4 text-sm"
      role="status"
      data-cy="dashboard-processing"
      data-processing-status={presentation.status}
      data-evaluation-incomplete={presentation.unfinished}
    >
      <p>{presentation.message}</p>
      <p>
        Último cálculo:{' '}
        {value.evaluatedAt
          ? instantLabel(value.evaluatedAt, timezone)
          : 'Sin cálculo disponible'}{' '}
        ({timezone}).
      </p>
      {value.processedThrough ? (
        <p>
          Procesado hasta {instantLabel(value.processedThrough, timezone)} (
          {timezone}).
        </p>
      ) : null}
      {presentation.missingRules ? (
        <p>
          Sin regla configurada para:{' '}
          {value.unconfiguredTypes
            .map((type) => dashboardSignalLabels[type])
            .join(', ')}
          .
        </p>
      ) : null}
    </div>
  );
}

export function SignalNarrative({
  text,
  timezone,
}: {
  text: string;
  timezone: string;
}) {
  return (
    <span data-cy="signal-narrative">
      {signalNarrativeParts(text).map((part, index) =>
        part.kind === 'instant' ? (
          <time key={index} dateTime={part.value} title={part.value}>
            {instantLabel(part.value, timezone)} ({timezone})
          </time>
        ) : (
          part.value
        ),
      )}
    </span>
  );
}

export function SignalFacts({
  signal,
  timezone,
}: {
  signal: DashboardSignal;
  timezone: string;
}) {
  const configuration = signal.rule.configuration;
  const presentation = signalPresentation(signal);
  const parameters =
    configuration.type === 'INACTIVITY'
      ? `${configuration.parameters.inactivityDays} días consecutivos observables.`
      : configuration.type === 'REPEATED_ERROR'
        ? `${configuration.parameters.repeatedErrorAttempts} intentos consecutivos dentro de ${configuration.parameters.repeatedErrorWindowDays} días.`
        : `${configuration.parameters.stagnationAttempts} intentos consecutivos sin aumentar las pruebas visibles superadas.`;
  return (
    <div className="space-y-3 text-sm">
      <p>
        <SignalNarrative text={signal.cause} timezone={timezone} />
      </p>
      <p>
        <strong>{presentation.reviewLabel}</strong> ({presentation.reviewState}
        ).
      </p>
      {presentation.historical ? (
        <p className="rounded border p-3">
          Episodio histórico: la acumulación terminó el{' '}
          {instantLabel(signal.stoppedAt, timezone)} ({timezone}). El estado de
          revisión se conserva y no indica que la condición siga ocurriendo.
        </p>
      ) : (
        <p>
          Acumulación abierta al corte; consulta la fecha y el resultado del
          último cálculo antes de interpretar la condición actual.
        </p>
      )}
      {!presentation.currentMember ? (
        <p>
          El estudiante ya no forma parte de la matrícula activa de esta clase.
          Esta evidencia histórica se conserva separada de los agregados
          actuales.
        </p>
      ) : null}
      {!presentation.verifiable ? (
        <p role="status">
          La evidencia asociada no se puede verificar con la información
          disponible. No permite una conclusión sobre la condición actual.
        </p>
      ) : null}
      <dl className="space-y-2">
        <div>
          <dt className="font-semibold">Regla aplicada</dt>
          <dd>
            {dashboardSignalLabels[signal.type]} · versión {signal.rule.version}
            . {parameters}
          </dd>
        </div>
        <div>
          <dt className="font-semibold">Primer cumplimiento</dt>
          <dd>
            <time dateTime={signal.qualifiedAt} title={signal.qualifiedAt}>
              {instantLabel(signal.qualifiedAt, timezone)}
            </time>{' '}
            ({timezone})
          </dd>
        </div>
        <div>
          <dt className="font-semibold">Cálculo inicial</dt>
          <dd>
            <time dateTime={signal.calculatedAt} title={signal.calculatedAt}>
              {instantLabel(signal.calculatedAt, timezone)}
            </time>{' '}
            ({timezone})
          </dd>
        </div>
        <div>
          <dt className="font-semibold">Última evaluación registrada</dt>
          <dd>
            {signal.lastEvaluation ? (
              <>
                {instantLabel(signal.lastEvaluation.evaluationTime, timezone)} (
                {timezone}). {outcomes[signal.lastEvaluation.outcome]}
              </>
            ) : (
              'Sin evaluación verificable disponible.'
            )}
          </dd>
        </div>
        {signal.reviewedAt ? (
          <div>
            <dt className="font-semibold">Revisión registrada</dt>
            <dd>
              {instantLabel(signal.reviewedAt, timezone)} ({timezone})
              <span className="block">
                Responsable: {signal.reviewedByName ?? signal.reviewedBy}
              </span>
            </dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}

function SignalDetail({
  classId,
  id,
  asOf,
  timezone,
  writable,
  onDenied,
  onPresent,
}: {
  classId: string;
  id: string;
  asOf: string;
  timezone: string;
  writable: boolean;
  onDenied: (error: ApiError) => void;
  onPresent: () => void;
}) {
  const resource = useApiResource(
    `/api/v1/classes/${classId}/signals/${id}?${dashboardQuery({ asOf })}`,
    dashboardSignalDetailResponseSchema,
  );
  const detail =
    resource.state.status === 'ready' ? resource.state.result.body.data : null;
  return (
    <div className="space-y-5" data-cy="dashboard-signal-details">
      <LoadState state={resource.state} reload={resource.reload} />
      {detail ? (
        <>
          <p className="font-semibold">
            {detail.signal.studentName} · {detail.signal.activityTitle}
          </p>
          <SignalFacts signal={detail.signal} timezone={timezone} />
          <h3 className="text-lg font-semibold">Evidencia mínima</h3>
          <p className="text-sm">
            <SignalNarrative
              text={detail.evidence.explanation}
              timezone={timezone}
            />
          </p>
          {detail.evidence.baselineAt ? (
            <p>
              Referencia inicial:{' '}
              {instantLabel(detail.evidence.baselineAt, timezone)} ({timezone}).
            </p>
          ) : null}
          {detail.evidence.observableSince ? (
            <p>
              Actividad observable desde:{' '}
              {instantLabel(detail.evidence.observableSince, timezone)} (
              {timezone}).
            </p>
          ) : null}
          {detail.evidence.lastAt ? (
            <p>
              Última referencia de actividad:{' '}
              {instantLabel(detail.evidence.lastAt, timezone)} ({timezone}).
            </p>
          ) : null}
          {detail.evidence.attempts.length ? (
            <ul className="space-y-3">
              {detail.evidence.attempts.map((attempt) => (
                <li key={attempt.id} className="rounded border p-3">
                  <ObservedAttemptFacts attempt={attempt} timezone={timezone} />
                </li>
              ))}
            </ul>
          ) : null}
          {detail.evidence.events.length ? (
            <ul className="space-y-3">
              {detail.evidence.events.map((event) => (
                <li key={event.id} className="rounded border p-3 text-sm">
                  {activityEventLabels[event.eventType]} ·{' '}
                  <time dateTime={event.occurredAt} title={event.occurredAt}>
                    {instantLabel(event.occurredAt, timezone)}
                  </time>{' '}
                  ({timezone})
                  <span className="mt-1 block break-all text-xs">
                    Referencia: {event.id}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="text-sm">
            Consulta al {instantLabel(detail.asOf, timezone)} ({timezone}).
          </p>
          <SignalReviewAction
            signal={detail.signal}
            classId={classId}
            timezone={timezone}
            writable={writable}
            onDenied={onDenied}
            onPresent={onPresent}
          />
        </>
      ) : null}
    </div>
  );
}

function SignalRow({
  signal,
  classId,
  asOf,
  timezone,
  writable,
  onDenied,
  onPresent,
}: {
  signal: DashboardSignal;
  classId: string;
  asOf: string;
  timezone: string;
  writable: boolean;
  onDenied: (error: ApiError) => void;
  onPresent: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li
      className="space-y-4 rounded-lg border p-4"
      data-cy="dashboard-signal-row"
      data-signal-id={signal.id}
    >
      <h3 className="font-semibold">
        {dashboardSignalLabels[signal.type]} · {signal.studentName}
      </h3>
      <p className="text-sm">{signal.activityTitle}</p>
      <SignalFacts signal={signal} timezone={timezone} />
      <FormDialog
        title="Evidencia de la señal"
        description="La señal describe hechos y una regla determinista. Su consulta no cambia el estado de revisión."
        open={open}
        onOpenChange={setOpen}
        trigger={
          <Button variant="outline" data-cy="dashboard-open-signal">
            Ver evidencia de la señal
          </Button>
        }
      >
        {open ? (
          <SignalDetail
            classId={classId}
            id={signal.id}
            asOf={asOf}
            timezone={timezone}
            writable={writable}
            onDenied={onDenied}
            onPresent={onPresent}
          />
        ) : null}
      </FormDialog>
    </li>
  );
}

export function DashboardSignalsPanel({
  classId,
  asOf,
  activityId,
  conceptId,
  timezone,
  writable,
  onDenied,
  onPresent,
}: {
  classId: string;
  asOf: string;
  activityId?: string;
  conceptId?: string;
  timezone: string;
  writable: boolean;
  onDenied: (error: ApiError) => void;
  onPresent: () => void;
}) {
  const [filters, setFilters] = useState<DashboardSignalQuery>({
    state: 'ACTIVE',
  });
  const [error, setError] = useState<string | null>(null);
  const resource = useApiResource(
    `/api/v1/classes/${classId}/signals?${dashboardQuery(dashboardSignalScope({ asOf, filters: { activityId: activityId ?? null, conceptId: conceptId ?? null, from: null } }, filters))}`,
    dashboardSignalsResponseSchema,
  );
  const signals =
    resource.state.status === 'ready' ? resource.state.result.body.data : null;
  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = dashboardSignalQuerySchema.safeParse({
      state: form.get('state'),
      ...(form.get('type') ? { type: form.get('type') } : {}),
    });
    if (!parsed.success) {
      setError('Revisa el tipo y estado de señal seleccionados.');
      return;
    }
    setError(null);
    if (dashboardQuery(parsed.data) === dashboardQuery(filters))
      void resource.reload();
    else setFilters(parsed.data);
  }
  return (
    <div className="space-y-5" data-cy="dashboard-signals">
      <p>
        Las señales se consultan al corte y conservan su historia, aunque la
        condición haya dejado de cumplirse. El inicio del período no elimina
        episodios.
      </p>
      <form className="space-y-4" onSubmit={apply}>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-2" htmlFor="signals-type">
            <span className="block font-semibold">Tipo de señal</span>
            <select id="signals-type" name="type" className={inputClass}>
              <option value="">Todos los tipos</option>
              {Object.entries(dashboardSignalLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-2" htmlFor="signals-state">
            <span className="block font-semibold">Estado de revisión</span>
            <select
              id="signals-state"
              name="state"
              className={inputClass}
              defaultValue="ACTIVE"
            >
              <option value="ACTIVE">Pendientes de revisión (ACTIVE)</option>
              <option value="REVIEWED">Revisadas (REVIEWED)</option>
              <option value="ALL">Todos los estados</option>
            </select>
          </label>
        </div>
        {error ? <p role="alert">{error}</p> : null}
        <Button type="submit">Filtrar señales</Button>
      </form>
      <LoadState state={resource.state} reload={resource.reload} />
      {signals ? (
        <div className="space-y-5" aria-live="polite">
          <p className="text-sm">
            Filtro aplicado:{' '}
            {signals.filters.type
              ? dashboardSignalLabels[signals.filters.type]
              : 'Todos los tipos'}{' '}
            ·{' '}
            {signals.filters.state === 'ALL'
              ? 'Todos los estados'
              : dashboardSignalStateLabels[signals.filters.state]}
            .
          </p>
          <SignalProcessing value={signals.processing} timezone={timezone} />
          {signals.data.length ? (
            <ul className="space-y-4">
              {signals.data.map((signal) => (
                <SignalRow
                  key={signal.id}
                  signal={signal}
                  classId={classId}
                  asOf={signals.asOf}
                  timezone={timezone}
                  writable={writable}
                  onDenied={onDenied}
                  onPresent={onPresent}
                />
              ))}
            </ul>
          ) : (
            <p>
              Sin episodios registrados que coincidan con estos filtros y corte.
              Consulta el estado de evaluación antes de concluir ausencia de
              señales.
            </p>
          )}
          <Pagination
            cursor={filters.cursor ?? null}
            hasMore={signals.page.hasMore}
            onFirst={() => setFilters({ ...filters, cursor: undefined })}
            onNext={() => {
              if (signals.page.nextCursor)
                setFilters({ ...filters, cursor: signals.page.nextCursor });
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
