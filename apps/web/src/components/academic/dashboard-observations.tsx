'use client';

import { useState, type ReactNode } from 'react';
import {
  dashboardEvidenceResponseSchema,
  type DashboardEvidenceQuery,
  type ObservationSummary,
  type ObservedAttempt,
} from '@alunza/contracts';
import { FormDialog, Pagination } from '@/components/identity-forms';
import { Button } from '@/components/ui/button';
import { useApiResource } from '@/lib/use-api-resource';
import { dashboardDiagnosisLabels, dashboardQuery } from '@/lib/dashboard-view';
import { DashboardTable } from './dashboard-table';
import { LoadState, instantLabel } from './shared';

export function ObservationSummaryView({
  value,
}: {
  value: ObservationSummary;
}) {
  return (
    <dl className="grid gap-3 text-sm sm:grid-cols-2">
      <div>
        <dt>Intentos confirmados</dt>
        <dd className="font-semibold" data-cy="dashboard-period-attempts">
          {value.attempts}
        </dd>
      </div>
      <div>
        <dt>Fallos técnicos verificables</dt>
        <dd className="font-semibold">{value.technicalFailures}</dd>
      </div>
      <div>
        <dt>Intentos sin resultado verificable</dt>
        <dd className="font-semibold">{value.unverifiableAttempts}</dd>
      </div>
      <div>
        <dt>Pistas entregadas</dt>
        <dd className="font-semibold" data-cy="dashboard-period-hints">
          {value.hintsDelivered}
        </dd>
      </div>
      <div>
        <dt>Eventos de actividad registrados</dt>
        <dd className="font-semibold">{value.activityEvents}</dd>
      </div>
    </dl>
  );
}

export function ObservedAttemptFacts({
  attempt,
  timezone,
}: {
  attempt: ObservedAttempt;
  timezone: string;
}) {
  return (
    <div className="space-y-2 text-sm">
      <p className="font-semibold">{attempt.activityTitle}</p>
      <p>
        <time dateTime={attempt.submittedAt} title={attempt.submittedAt}>
          {instantLabel(attempt.submittedAt, timezone)}
        </time>{' '}
        ({timezone})
      </p>
      <p>
        {attempt.diagnosisCode} ·{' '}
        {dashboardDiagnosisLabels[attempt.diagnosisCode]}
      </p>
      {attempt.verification === 'UNVERIFIABLE' ? (
        <p>
          El resultado de este intento no se puede verificar. No permite
          concluir un fallo académico.
        </p>
      ) : null}
      <p>
        Pruebas visibles superadas:{' '}
        {attempt.visiblePassed === null || attempt.visibleTotal === null
          ? 'Sin conteo verificable'
          : `${attempt.visiblePassed}/${attempt.visibleTotal}`}
        .
      </p>
      <p>
        {attempt.allRequiredPassed
          ? 'Acredita completitud de esta asignación.'
          : 'Este intento no acredita completitud.'}
      </p>
      <details>
        <summary className="cursor-pointer underline">
          Referencias de la evidencia
        </summary>
        <dl className="mt-2 space-y-1 break-all">
          <dt>Intento</dt>
          <dd>{attempt.id}</dd>
          <dt>Asignación</dt>
          <dd>{attempt.activityExerciseId}</dd>
          <dt>Versión del ejercicio</dt>
          <dd>{attempt.exerciseVersionId}</dd>
        </dl>
      </details>
    </div>
  );
}

export const activityEventLabels = {
  CLASS_JOINED: 'Incorporación a la clase',
  ACTIVITY_OPENED: 'Apertura explícita de actividad',
  EXECUTION_COMPLETED: 'Ejecución de práctica terminada',
  ATTEMPT_SUBMITTED: 'Intento confirmado',
  HINT_DELIVERED: 'Pista entregada',
  FEEDBACK_VIEWED: 'Lectura explícita de ayuda',
} as const;

function EvidenceContent({
  classId,
  filters,
  timezone,
}: {
  classId: string;
  filters: DashboardEvidenceQuery;
  timezone: string;
}) {
  const [cursor, setCursor] = useState<string | null>(null);
  const resource = useApiResource(
    `/api/v1/classes/${classId}/dashboard/evidence?${dashboardQuery({ ...filters, cursor })}`,
    dashboardEvidenceResponseSchema,
  );
  const evidence =
    resource.state.status === 'ready' ? resource.state.result.body.data : null;
  return (
    <div className="space-y-4" data-cy="dashboard-evidence">
      <LoadState state={resource.state} reload={resource.reload} />
      {evidence ? (
        <>
          <p className="text-sm">
            Evidencia al{' '}
            <time dateTime={evidence.asOf}>
              {instantLabel(evidence.asOf, timezone)}
            </time>{' '}
            ({timezone}).
          </p>
          {evidence.data.length ? (
            <ul className="space-y-4">
              {evidence.data.map((item) => (
                <li
                  key={'attempt' in item ? item.attempt.id : item.event.id}
                  className="space-y-2 rounded-lg border p-3"
                  data-cy="dashboard-evidence-row"
                >
                  {'attempt' in item ? (
                    <>
                      <p className="font-semibold">
                        {item.attempt.studentName}
                      </p>
                      <ObservedAttemptFacts
                        attempt={item.attempt}
                        timezone={timezone}
                      />
                    </>
                  ) : (
                    <>
                      <p className="font-semibold">{item.event.studentName}</p>
                      <p>{activityEventLabels[item.event.eventType]}</p>
                      <p>
                        <time
                          dateTime={item.event.occurredAt}
                          title={item.event.occurredAt}
                        >
                          {instantLabel(item.event.occurredAt, timezone)}
                        </time>{' '}
                        ({timezone})
                      </p>
                      <p className="break-all text-xs">
                        Referencia del evento: {item.event.id}
                      </p>
                    </>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p>Sin evidencia para estos filtros y corte.</p>
          )}
          <Pagination
            cursor={cursor}
            hasMore={evidence.page.hasMore}
            onFirst={() => setCursor(null)}
            onNext={() => setCursor(evidence.page.nextCursor)}
          />
        </>
      ) : null}
    </div>
  );
}

export function DashboardEvidenceButton({
  classId,
  filters,
  timezone,
  label,
}: {
  classId: string;
  filters: DashboardEvidenceQuery;
  timezone: string;
  label: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <FormDialog
      title="Evidencia del tablero"
      description="Hechos confirmados del ámbito y corte seleccionados. Esta consulta no modifica el progreso ni registra actividad del estudiante."
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button
          variant="outline"
          data-cy="dashboard-show-evidence"
          data-kind={filters.kind}
        >
          {label}
        </Button>
      }
    >
      {open ? (
        <EvidenceContent
          key={dashboardQuery(filters)}
          classId={classId}
          filters={filters}
          timezone={timezone}
        />
      ) : null}
    </FormDialog>
  );
}

export function DiagnosesTable({
  value,
  evidence,
}: {
  value: ObservationSummary;
  evidence?: (diagnosis: ObservedAttempt['diagnosisCode']) => ReactNode;
}) {
  return (
    <DashboardTable
      label="Intentos por diagnóstico en el período"
      headers={
        evidence
          ? ['Diagnóstico', 'Intentos', 'Evidencia']
          : ['Diagnóstico', 'Intentos']
      }
    >
      {value.byDiagnosis.map((row) => (
        <tr key={row.diagnosisCode}>
          <th scope="row" className="font-medium">
            {dashboardDiagnosisLabels[row.diagnosisCode]}{' '}
            <span className="block text-xs text-muted-foreground">
              {row.diagnosisCode}
            </span>
          </th>
          <td>{row.count}</td>
          {evidence ? <td>{evidence(row.diagnosisCode)}</td> : null}
        </tr>
      ))}
    </DashboardTable>
  );
}
