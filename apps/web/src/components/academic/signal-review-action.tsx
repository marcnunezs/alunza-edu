'use client';

import { useEffect, useRef, useState } from 'react';
import {
  dashboardSignalDetailResponseSchema,
  studentDetailSignalResponseSchema,
  signalReviewResponseSchema,
  type DashboardSignal,
  type SignalReview,
} from '@alunza/contracts';
import { FormDialog } from '@/components/identity-forms';
import { RequestError } from '@/components/request-error';
import { useSession } from '@/components/session-provider';
import { Button } from '@/components/ui/button';
import { apiRequest, asApiError, ApiError } from '@/lib/api';
import {
  signalReviewDenied,
  signalReviewFromCurrent,
  signalReviewRequest,
} from '@/lib/signal-review-operation';
import { instantLabel } from './shared';

type Props = {
  signal: DashboardSignal;
  classId: string;
  studentId?: string;
  timezone: string;
  writable: boolean;
  onDenied: (error: ApiError) => void;
  onPresent: () => void;
};

function ReviewAction({
  signal,
  classId,
  studentId,
  timezone,
  writable,
  onDenied,
  onPresent,
}: Props) {
  const { session } = useSession();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [result, setResult] = useState<SignalReview | null>(null);
  const [checked, setChecked] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  async function perform(check: boolean) {
    if (active.current || !session) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError(null);
    setChecked(false);
    try {
      const options = {
        accessToken: session.access_token,
        signal: controller.signal,
      };
      let confirmed: SignalReview | null;
      if (check) {
        // No historical cut: recover the currently committed state. The detail
        // route also rechecks the student's current enrollment.
        const current = studentId
          ? (
              await apiRequest(
                `/api/v1/classes/${classId}/students/${studentId}/signals/${signal.id}`,
                studentDetailSignalResponseSchema,
                options,
              )
            ).body.data.signal
          : (
              await apiRequest(
                `/api/v1/classes/${classId}/signals/${signal.id}`,
                dashboardSignalDetailResponseSchema,
                options,
              )
            ).body.data.signal;
        if (!current.currentMember) {
          onDenied(
            new ApiError(
              404,
              'RESOURCE_NOT_FOUND',
              'El recurso no está disponible o no tienes acceso.',
            ),
          );
          return;
        }
        confirmed = signalReviewFromCurrent(current, classId);
      } else {
        const request = signalReviewRequest(signal.id);
        confirmed = (
          await apiRequest(request.path, signalReviewResponseSchema, {
            ...options,
            method: request.method,
            body: request.body,
          })
        ).body.data;
      }
      if (controller.signal.aborted) return;
      setResult(confirmed);
      setUncertain(false);
      setChecked(check && !confirmed);
    } catch (cause) {
      if (controller.signal.aborted) return;
      const failure = asApiError(cause);
      if (signalReviewDenied(failure)) {
        setOpen(false);
        onDenied(failure);
        return;
      }
      setError(failure);
      if (
        ['ACADEMIC_ARCHIVED', 'ORGANIZATION_ARCHIVED'].includes(failure.code)
      ) {
        setBlocked(true);
        return;
      }
      // A lost reply cannot establish whether the server committed. Recover
      // first; the permanent episode identity makes a later retry safe.
      if (!check) setUncertain(true);
    } finally {
      if (active.current === controller) active.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  if (signal.state === 'REVIEWED') return null;
  if (!writable || !signal.currentMember)
    return (
      <p className="text-sm">
        Esta señal conserva consulta histórica. La revisión requiere clase
        operativa y matrícula activa.
      </p>
    );
  return (
    <div className="space-y-3" data-cy="signal-review-action">
      {result && !open ? (
        <p role="status">
          Revisión registrada por {result.reviewedByName ?? result.reviewedBy}.{' '}
          <Button variant="outline" onClick={onPresent}>
            Actualizar al presente
          </Button>
        </p>
      ) : null}
      <FormDialog
        title="Confirmar revisión de señal"
        description="Registrarás que revisaste esta causa, regla y evidencia. La revisión conserva la evidencia y no indica que la situación esté resuelta."
        open={open}
        onOpenChange={setOpen}
        locked={busy}
        trigger={
          <Button variant="outline" data-cy="signal-review-open">
            {result ? 'Ver revisión registrada' : 'Marcar revisada'}
          </Button>
        }
      >
        <div className="space-y-4" data-cy="signal-review-confirmation">
          {result ? (
            <div
              className="space-y-3"
              role="status"
              data-cy="signal-review-confirmed"
              data-reviewed-at={result.reviewedAt}
            >
              <p className="font-semibold">Revisión registrada (REVIEWED).</p>
              <p>Responsable: {result.reviewedByName ?? result.reviewedBy}.</p>
              <p>
                <time dateTime={result.reviewedAt}>
                  {instantLabel(result.reviewedAt, timezone)}
                </time>{' '}
                ({timezone}).
              </p>
              <p>
                La consulta histórica mantiene su corte anterior. Actualiza al
                presente para consultar el estado posterior a esta revisión.
              </p>
              <Button data-cy="signal-review-present" onClick={onPresent}>
                Actualizar al presente
              </Button>
            </div>
          ) : (
            <>
              <p>
                {signal.studentName} · {signal.activityTitle}
              </p>
              <p>
                Regla versión {signal.rule.version}. La fecha y el responsable
                los registra el servidor.
              </p>
              {error ? <RequestError error={error} /> : null}
              {uncertain ? (
                <p role="status">
                  El resultado de la solicitud todavía no está confirmado.
                  Comprueba la revisión antes de volver a enviarla.
                </p>
              ) : null}
              {checked ? (
                <p role="status">
                  La señal sigue pendiente de revisión. Puedes confirmar de
                  nuevo.
                </p>
              ) : null}
              {busy ? (
                <p role="status">Comprobando y guardando revisión…</p>
              ) : null}
              <div className="flex flex-wrap gap-3">
                <Button
                  data-cy="signal-review-confirm"
                  disabled={busy || blocked}
                  onClick={() => void perform(uncertain)}
                >
                  {uncertain ? 'Comprobar revisión' : 'Confirmar revisión'}
                </Button>
                <Button
                  variant="outline"
                  data-cy="signal-review-cancel"
                  disabled={busy}
                  onClick={() => setOpen(false)}
                >
                  {uncertain ? 'Cerrar' : 'Cancelar'}
                </Button>
              </div>
              {blocked ? (
                <p role="status">
                  Este ámbito permite únicamente consulta. La revisión no se ha
                  guardado.
                </p>
              ) : null}
            </>
          )}
        </div>
      </FormDialog>
    </div>
  );
}

export function SignalReviewAction(props: Props) {
  const { revision } = useSession();
  return (
    <ReviewAction
      key={`${revision}:${props.classId}:${props.signal.id}`}
      {...props}
    />
  );
}
