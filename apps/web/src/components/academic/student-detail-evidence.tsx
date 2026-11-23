'use client';

import { useRef, useState } from 'react';
import {
  studentDetailEvidenceResponseSchema,
  type StudentDetailQuery,
} from '@alunza/contracts';
import { FormDialog, Pagination } from '@/components/identity-forms';
import { Button } from '@/components/ui/button';
import { dashboardQuery } from '@/lib/dashboard-view';
import {
  activityEventLabels,
  ObservedAttemptFacts,
} from './dashboard-observations';
import { LoadState, instantLabel } from './shared';
import {
  useStudentDetailResource,
  type StudentDetailScope,
} from './student-detail-shared';

type EvidenceProps = {
  scope: StudentDetailScope;
  filters: StudentDetailQuery;
  kind: 'EVENT' | 'HINT' | 'COMPLETION';
  onAttempt: (id: string, returnFocus?: HTMLElement | null) => void;
};
function Evidence({ scope, filters, kind, onAttempt }: EvidenceProps) {
  const [cursor, setCursor] = useState<string | null>(null);
  const query = {
    kind,
    asOf: scope.asOf,
    activityId: filters.activityId,
    conceptId: filters.conceptId,
    from: kind === 'COMPLETION' ? undefined : filters.from,
    cursor,
    limit: 20,
  };
  const resource = useStudentDetailResource(
    `${scope.base}/evidence?${dashboardQuery(query)}`,
    studentDetailEvidenceResponseSchema,
    scope.onDenied,
  );
  const value =
    resource.state.status === 'ready' ? resource.state.result.body.data : null;
  return (
    <div className="space-y-4" data-cy="student-detail-evidence">
      <LoadState state={resource.state} reload={resource.reload} />
      {value ? (
        <>
          {value.data.length ? (
            <ul className="space-y-3">
              {value.data.map((item) => (
                <li
                  className="space-y-3 rounded border p-3"
                  key={'attempt' in item ? item.attempt.id : item.event.id}
                >
                  {'attempt' in item ? (
                    <>
                      <ObservedAttemptFacts
                        attempt={item.attempt}
                        timezone={scope.timezone}
                      />
                      <Button
                        variant="outline"
                        onClick={() => onAttempt(item.attempt.id)}
                      >
                        Ver intento que acredita el logro
                      </Button>
                    </>
                  ) : (
                    <>
                      <p>{activityEventLabels[item.event.eventType]}</p>
                      <p>
                        {instantLabel(item.event.occurredAt, scope.timezone)} (
                        {scope.timezone}).
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
            hasMore={value.page.hasMore}
            onFirst={() => setCursor(null)}
            onNext={() => setCursor(value.page.nextCursor)}
          />
        </>
      ) : null}
    </div>
  );
}
export function StudentDetailEvidenceButton({
  label,
  ...props
}: EvidenceProps & { label: string }) {
  const [open, setOpen] = useState(false);
  const pendingAttempt = useRef<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <FormDialog
      title={label}
      description="Hechos confirmados de este estudiante y esta clase al corte seleccionado. Consultar no modifica su actividad ni su progreso."
      open={open}
      onOpenChange={setOpen}
      onCloseAutoFocus={(event) => {
        if (!pendingAttempt.current) return;
        event.preventDefault();
        const id = pendingAttempt.current;
        pendingAttempt.current = null;
        props.onAttempt(id, trigger.current);
      }}
      trigger={
        <Button
          ref={trigger}
          variant="outline"
          data-cy="student-detail-open-evidence"
          data-kind={props.kind}
        >
          {label}
        </Button>
      }
    >
      {open ? (
        <Evidence
          {...props}
          onAttempt={(id) => {
            pendingAttempt.current = id;
            setOpen(false);
          }}
        />
      ) : null}
    </FormDialog>
  );
}
