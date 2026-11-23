'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  studentDetailSignalsResponseSchema,
  studentDetailSignalResponseSchema,
  studentDetailSignalsQuerySchema,
  type StudentDetailQuery,
  type StudentDetailSignalsQuery,
} from '@alunza/contracts';
import {
  FormDialog,
  Pagination,
  SelectField,
} from '@/components/identity-forms';
import { Button } from '@/components/ui/button';
import {
  dashboardQuery,
  dashboardSignalLabels,
  dashboardSignalStateLabels,
} from '@/lib/dashboard-view';
import {
  SignalFacts,
  SignalNarrative,
  SignalProcessing,
} from './dashboard-signals';
import {
  activityEventLabels,
  ObservedAttemptFacts,
} from './dashboard-observations';
import { LoadState, instantLabel } from './shared';
import { SignalReviewAction } from './signal-review-action';
import {
  useStudentDetailResource,
  type StudentDetailScope,
} from './student-detail-shared';

function SignalDetail({
  scope,
  signalId,
  onAttempt,
  onPresent,
}: {
  scope: StudentDetailScope;
  signalId: string;
  onAttempt: (id: string, returnFocus?: HTMLElement | null) => void;
  onPresent: () => void;
}) {
  const resource = useStudentDetailResource(
    `${scope.base}/signals/${signalId}?${dashboardQuery({ asOf: scope.asOf })}`,
    studentDetailSignalResponseSchema,
    scope.onDenied,
  );
  const value =
    resource.state.status === 'ready' ? resource.state.result.body.data : null;
  return (
    <div className="space-y-4" data-cy="student-detail-signal">
      <LoadState state={resource.state} reload={resource.reload} />
      {value ? (
        <>
          <p className="font-semibold">{value.signal.activityTitle}</p>
          <SignalFacts signal={value.signal} timezone={scope.timezone} />
          <h3 className="text-lg font-semibold">Evidencia de la señal</h3>
          <p>
            <SignalNarrative
              text={value.evidence.explanation}
              timezone={scope.timezone}
            />
          </p>
          {value.evidence.baselineAt ? (
            <p>
              Referencia inicial:{' '}
              {instantLabel(value.evidence.baselineAt, scope.timezone)}.
            </p>
          ) : null}
          {value.evidence.observableSince ? (
            <p>
              Actividad observable desde:{' '}
              {instantLabel(value.evidence.observableSince, scope.timezone)}.
            </p>
          ) : null}
          {value.evidence.lastAt ? (
            <p>
              Última actividad usada:{' '}
              {instantLabel(value.evidence.lastAt, scope.timezone)}.
            </p>
          ) : null}
          {value.evidence.attempts.length ? (
            <ul className="space-y-3">
              {value.evidence.attempts.map((attempt) => (
                <li key={attempt.id} className="space-y-3 rounded border p-3">
                  <ObservedAttemptFacts
                    attempt={attempt}
                    timezone={scope.timezone}
                  />
                  <Button
                    variant="outline"
                    data-cy="student-detail-signal-attempt"
                    onClick={() => onAttempt(attempt.id)}
                  >
                    Abrir intento de la evidencia
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
          {value.evidence.events.length ? (
            <ul className="space-y-2">
              {value.evidence.events.map((event) => (
                <li key={event.id}>
                  {activityEventLabels[event.eventType]} ·{' '}
                  {instantLabel(event.occurredAt, scope.timezone)} (
                  {scope.timezone}).
                </li>
              ))}
            </ul>
          ) : null}
          <SignalReviewAction
            signal={value.signal}
            classId={scope.classId}
            studentId={scope.studentId}
            timezone={scope.timezone}
            writable={scope.writable}
            onDenied={scope.onDenied}
            onPresent={onPresent}
          />
        </>
      ) : null}
    </div>
  );
}

export function StudentDetailSignals({
  scope,
  filters,
  onAttempt,
  onReady,
  onPresent,
}: {
  scope: StudentDetailScope;
  filters: StudentDetailQuery;
  onAttempt: (id: string, returnFocus?: HTMLElement | null) => void;
  onReady: (ready: boolean) => void;
  onPresent: () => void;
}) {
  const [signalFilters, setSignalFilters] = useState<StudentDetailSignalsQuery>(
    { state: 'ACTIVE' },
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const pendingAttempt = useRef<string | null>(null);
  const signalTriggers = useRef(new Map<string, HTMLButtonElement>());
  const query = {
    ...signalFilters,
    asOf: scope.asOf,
    activityId: filters.activityId,
    conceptId: filters.conceptId,
  };
  const resource = useStudentDetailResource(
    `${scope.base}/signals?${dashboardQuery(query)}`,
    studentDetailSignalsResponseSchema,
    scope.onDenied,
  );
  const value =
    resource.state.status === 'ready' ? resource.state.result.body.data : null;
  const ready = resource.state.status === 'ready';
  useEffect(() => {
    onReady(ready);
  }, [ready, onReady]);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = studentDetailSignalsQuerySchema.safeParse({
      state: form.get('state'),
      ...(form.get('type') ? { type: form.get('type') } : {}),
    });
    if (!parsed.success) {
      setFormError('Revisa el tipo y el estado de señal.');
      return;
    }
    setFormError(null);
    setSelected(null);
    setSignalFilters(parsed.data);
    if (dashboardQuery(parsed.data) === dashboardQuery(signalFilters))
      void resource.reload();
  }
  return (
    <section
      className="space-y-4 rounded-xl border bg-card p-5"
      data-cy="student-detail-signals"
      aria-labelledby="student-detail-signals-title"
    >
      <h2 id="student-detail-signals-title" className="text-xl font-semibold">
        Señales del estudiante
      </h2>
      <p className="text-sm">
        Episodios registrados hasta el corte, según actividad y concepto. El
        inicio del período no limita las señales. Esta vista conserva su estado
        de revisión.
      </p>
      <form className="space-y-3" onSubmit={submit}>
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField label="Tipo de señal" name="type" defaultValue="">
            <option value="">Todos los tipos</option>
            {Object.entries(dashboardSignalLabels).map(([type, label]) => (
              <option key={type} value={type}>
                {label}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Estado de señal"
            name="state"
            defaultValue="ACTIVE"
          >
            {Object.entries(dashboardSignalStateLabels).map(
              ([state, label]) => (
                <option key={state} value={state}>
                  {label}
                </option>
              ),
            )}
            <option value="ALL">Todos los estados</option>
          </SelectField>
        </div>
        {formError ? <p role="alert">{formError}</p> : null}
        <Button type="submit">Filtrar señales</Button>
      </form>
      <LoadState state={resource.state} reload={resource.reload} />
      {value ? (
        <>
          <SignalProcessing
            value={value.processing}
            timezone={scope.timezone}
          />
          {value.data.length ? (
            <ul className="space-y-3">
              {value.data.map((signal) => (
                <li
                  className="space-y-4 rounded border p-4"
                  key={signal.id}
                  data-signal-id={signal.id}
                  data-cy="student-detail-signal-row"
                >
                  <h3 className="font-semibold">
                    {dashboardSignalLabels[signal.type]} ·{' '}
                    {signal.activityTitle}
                  </h3>
                  <SignalFacts signal={signal} timezone={scope.timezone} />
                  <FormDialog
                    title="Evidencia de la señal"
                    description="Hechos y regla persistidos de este estudiante. Abrir la evidencia no cambia su revisión."
                    open={selected === signal.id}
                    onOpenChange={(open) =>
                      setSelected(open ? signal.id : null)
                    }
                    onCloseAutoFocus={(event) => {
                      if (!pendingAttempt.current) return;
                      event.preventDefault();
                      const id = pendingAttempt.current;
                      pendingAttempt.current = null;
                      onAttempt(id, signalTriggers.current.get(signal.id));
                    }}
                    trigger={
                      <Button
                        ref={(element) => {
                          if (element)
                            signalTriggers.current.set(signal.id, element);
                          else signalTriggers.current.delete(signal.id);
                        }}
                        variant="outline"
                        data-cy="student-detail-open-signal"
                      >
                        Ver evidencia de la señal
                      </Button>
                    }
                  >
                    {selected === signal.id ? (
                      <SignalDetail
                        scope={scope}
                        signalId={signal.id}
                        onPresent={onPresent}
                        onAttempt={(id) => {
                          pendingAttempt.current = id;
                          setSelected(null);
                        }}
                      />
                    ) : null}
                  </FormDialog>
                </li>
              ))}
            </ul>
          ) : (
            <p>
              Sin señales registradas para estos filtros y corte. Comprueba el
              estado del procesamiento antes de interpretar la ausencia.
            </p>
          )}
          <Pagination
            cursor={signalFilters.cursor ?? null}
            hasMore={value.page.hasMore}
            onFirst={() => {
              const { cursor: _cursor, ...rest } = signalFilters;
              setSignalFilters(rest);
              setSelected(null);
            }}
            onNext={() => {
              if (value.page.nextCursor)
                setSignalFilters({
                  ...signalFilters,
                  cursor: value.page.nextCursor,
                });
              setSelected(null);
            }}
          />
        </>
      ) : null}
    </section>
  );
}
