'use client';

import { useEffect, useRef, useState } from 'react';
import {
  attemptResponseSchema,
  submitAttemptInputSchema,
  type Attempt,
} from '@alunza/contracts';
import { useSession } from '@/components/session-provider';
import { FormDialog } from '@/components/identity-forms';
import { RequestError } from '@/components/request-error';
import { Button } from '@/components/ui/button';
import { ApiError, apiRequest, asApiError } from '@/lib/api';
import {
  readPendingAttempts,
  savePendingAttempts,
  type PendingAttempt,
} from '@/lib/attempt-state';
import type { DraftScope } from '@/lib/exercise-draft';
import { AttemptHistory, AttemptResult } from './attempt-history';
import { ActivityProgress } from './activity-progress';
import { AttemptHelpPanel, AttemptHelpScope } from './attempt-help-panel';

type Operation = PendingAttempt & {
  status: 'pending' | 'recover';
  error?: ApiError;
  retryAt?: number;
};

export function SubmitAttemptPanel({
  activityId,
  scope,
  code,
  previousAttemptId,
  canSubmit,
  verified,
  reload,
  onCopy,
}: {
  activityId: string;
  scope: DraftScope;
  code: string;
  previousAttemptId?: string;
  canSubmit: boolean;
  verified: boolean;
  reload: () => unknown;
  onCopy: (attempt: Attempt) => void;
}) {
  const { session } = useSession();
  const [initial] = useState(() => {
    try {
      return readPendingAttempts(window.localStorage, scope);
    } catch {
      return { operations: [], unavailable: true };
    }
  });
  const [operations, setOperations] = useState<Operation[]>(() =>
    initial.operations.map((item) => ({ ...item, status: 'recover' })),
  );
  const operationState = useRef(operations);
  const [storageUnavailable, setStorageUnavailable] = useState(
    initial.unavailable,
  );
  const [open, setOpen] = useState(false);
  const confirmation = useRef(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [result, setResult] = useState<Attempt | null>(null);
  const [historyRevision, setHistoryRevision] = useState(0);
  const [retryClock, setRetryClock] = useState(() => Date.now());
  const active = useRef(new Map<string, AbortController>());
  useEffect(() => {
    const requests = active.current;
    return () => {
      for (const controller of requests.values()) controller.abort();
      requests.clear();
    };
  }, []);
  useEffect(() => {
    const next = operations
      .map((item) => item.retryAt ?? 0)
      .filter((value) => value > retryClock);
    if (!next.length) return;
    const timer = window.setTimeout(
      () => setRetryClock(Date.now()),
      Math.max(1, Math.min(...next) - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [operations, retryClock]);

  function changeConfirmation(value: boolean) {
    confirmation.current = value && canSubmit;
    setOpen(confirmation.current);
  }

  function updateOperations(change: (previous: Operation[]) => Operation[]) {
    const previous = operationState.current;
    const next = change(previous);
    const removedKeys = previous
      .filter((item) => !next.some((other) => other.key === item.key))
      .map((item) => item.key);
    operationState.current = next;
    setOperations(next);
    try {
      setStorageUnavailable(
        !savePendingAttempts(
          window.localStorage,
          scope,
          next.map(({ key, input, createdAt }) => ({ key, input, createdAt })),
          removedKeys,
        ),
      );
    } catch {
      setStorageUnavailable(true);
    }
  }

  async function submit(previous?: Operation) {
    if (
      !verified ||
      !session ||
      active.current.size >= 2 ||
      (!previous &&
        (!confirmation.current ||
          !canSubmit ||
          operationState.current.length >= 2)) ||
      (previous &&
        (active.current.has(previous.key) ||
          (previous.retryAt ?? 0) > Date.now()))
    )
      return;
    // One explicit confirmation represents exactly one intentional admission.
    // Consume it synchronously before state updates or transport can yield.
    if (!previous) confirmation.current = false;
    const parsed = submitAttemptInputSchema.safeParse({
      code,
      exerciseVersionId: scope.exerciseVersionId,
      ...(previousAttemptId ? { previousAttemptId } : {}),
    });
    if (!previous && !parsed.success) {
      setError(
        new ApiError(
          422,
          'INVALID_CODE',
          'Escribe código de hasta 65.536 bytes UTF-8 antes de enviar.',
        ),
      );
      setOpen(false);
      return;
    }
    const operation: Operation = previous
      ? { ...previous, status: 'pending', error: undefined }
      : {
          key: crypto.randomUUID(),
          input: parsed.data!,
          createdAt: Date.now(),
          status: 'pending',
        };
    const controller = new AbortController();
    active.current.set(operation.key, controller);
    updateOperations((items) =>
      previous
        ? items.map((item) => (item.key === operation.key ? operation : item))
        : [...items, operation],
    );
    setOpen(false);
    setError(null);
    try {
      const response = await apiRequest(
        `/api/v1/activities/${encodeURIComponent(activityId)}/exercises/${encodeURIComponent(scope.assignmentId)}/attempts`,
        attemptResponseSchema,
        {
          method: 'POST',
          accessToken: session.access_token,
          idempotencyKey: operation.key,
          body: operation.input,
          timeoutMs: 45_000,
          signal: controller.signal,
        },
      );
      if (controller.signal.aborted) return;
      const attempt = response.body.data;
      if (
        attempt.exerciseVersionId !== operation.input.exerciseVersionId ||
        attempt.assignmentId !== scope.assignmentId ||
        attempt.activityId !== activityId ||
        attempt.code !== operation.input.code ||
        attempt.previousAttemptId !==
          (operation.input.previousAttemptId ?? null)
      )
        throw new ApiError(
          502,
          'INVALID_RESPONSE',
          'No se pudo verificar el intento. Recupera la misma solicitud.',
          undefined,
          [],
          true,
        );
      setResult((current) =>
        !current || attempt.attemptNumber > current.attemptNumber
          ? attempt
          : current,
      );
      updateOperations((items) =>
        items.filter((item) => item.key !== operation.key),
      );
      setHistoryRevision((value) => value + 1);
    } catch (cause: unknown) {
      if (controller.signal.aborted) return;
      const failure = asApiError(cause);
      setRetryClock(Date.now());
      // A known admission rejection permits a fresh intention. Uncertain delivery
      // retains its key and exact snapshot, including during token renewal.
      const definitive =
        [400, 413, 422].includes(failure.status) ||
        (failure.status === 429 && !previous) ||
        [
          'ACTIVITY_CLOSED',
          'ACTIVITY_NOT_AVAILABLE',
          'VERSION_CONFLICT',
          'IDEMPOTENCY_EXPIRED',
        ].includes(failure.code);
      if (definitive) {
        updateOperations((items) =>
          items.filter((item) => item.key !== operation.key),
        );
        setError(failure);
        if (failure.code === 'IDEMPOTENCY_EXPIRED')
          setHistoryRevision((value) => value + 1);
      } else
        updateOperations((items) =>
          items.map((item) =>
            item.key === operation.key
              ? {
                  ...item,
                  status: 'recover',
                  error: failure,
                  retryAt: failure.retryAfter
                    ? Date.now() + Math.min(failure.retryAfter, 3600) * 1000
                    : undefined,
                }
              : item,
          ),
        );
      if (
        [401, 403, 404].includes(failure.status) ||
        ['ACTIVITY_CLOSED', 'VERSION_CONFLICT'].includes(failure.code)
      )
        void reload();
    } finally {
      active.current.delete(operation.key);
    }
  }

  const pendingCount = operations.filter(
    (operation) => operation.status === 'pending',
  ).length;

  return (
    <div className="space-y-5">
      <FormDialog
        title="Confirmar envío de intento"
        description="Se enviará el código actual y se comprobarán las pruebas requeridas. El intento se anunciará como guardado solo cuando el servidor confirme su persistencia. Cancelar conserva tu borrador."
        trigger={
          <Button
            data-cy="submit-code"
            disabled={!canSubmit || !session || operations.length >= 2}
          >
            Enviar intento
          </Button>
        }
        open={open && canSubmit}
        onOpenChange={changeConfirmation}
      >
        {operations.length ? (
          <p className="mb-4" role="alert">
            Hay otro envío en curso o pendiente de recuperación. Esta
            confirmación creará un intento distinto, aunque el código sea igual.
            Para recuperar el anterior, cancela y usa «Recuperar envío».
          </p>
        ) : null}
        {previousAttemptId ? (
          <p className="mb-4">
            Este nuevo intento conservará el vínculo con el intento copiado.
          </p>
        ) : null}
        <div className="flex flex-wrap gap-3">
          <Button
            data-cy="confirm-submit"
            disabled={!canSubmit || operations.length >= 2}
            onClick={() => void submit()}
          >
            Confirmar envío
          </Button>
          <Button
            data-cy="cancel-submit"
            variant="ghost"
            onClick={() => changeConfirmation(false)}
          >
            Cancelar
          </Button>
        </div>
      </FormDialog>
      <p className="text-sm">
        Enviar guarda un intento independiente. Puedes seguir editando mientras
        se evalúa: esos cambios no alteran el código enviado.
      </p>
      {storageUnavailable ? (
        <p role="status" className="text-sm">
          No se pudo conservar o recuperar la solicitud en este navegador.
          Mantén esta vista abierta y consulta el historial antes de enviar de
          nuevo tras salir. Tu borrador visible sigue disponible.
        </p>
      ) : null}
      {error && verified ? <RequestError error={error} /> : null}
      <div role="status" aria-live="polite" data-cy="submit-status">
        {operations.length
          ? `${operations.length} envío(s) pendiente(s) de confirmar.`
          : result && verified
            ? 'Intento guardado y disponible en el historial.'
            : 'La confirmación de envío registra un intento; ejecutar solo realiza una práctica.'}
      </div>
      {operations.map((operation, index) => (
        <div
          key={operation.key}
          data-cy="pending-attempt"
          className="space-y-2 rounded border p-3"
        >
          <p>
            {operation.status === 'pending'
              ? `Envío ${index + 1} en curso. Esperando confirmación del servidor.`
              : `Envío ${index + 1} sin confirmación en esta vista. Recupera la misma solicitud antes de decidir otro envío.`}
          </p>
          {operation.error && verified ? (
            <RequestError error={operation.error} />
          ) : null}
          {operation.status === 'recover' ? (
            <Button
              data-cy="recover-submit"
              variant="outline"
              disabled={
                !verified ||
                !session ||
                pendingCount >= 2 ||
                (operation.retryAt ?? 0) > retryClock
              }
              onClick={() => void submit(operation)}
            >
              Recuperar envío {index + 1}
            </Button>
          ) : null}
        </div>
      ))}
      <AttemptHelpScope>
        {verified && result ? (
          <>
            <p data-cy="saved-snapshot">
              {result.code !== code
                ? 'El intento guardado corresponde al código enviado; tu borrador contiene cambios posteriores.'
                : 'El código del intento guardado coincide con el borrador visible.'}
            </p>
            <AttemptResult attempt={result} />
            <AttemptHelpPanel attempt={result} />
          </>
        ) : null}
        {verified ? (
          <>
            <ActivityProgress
              key={`progress:${historyRevision}`}
              activityId={activityId}
            />
            <AttemptHistory
              key={`history:${historyRevision}`}
              activityId={activityId}
              assignmentId={scope.assignmentId}
              code={code}
              canEdit={canSubmit}
              onCopy={onCopy}
            />
          </>
        ) : (
          <p>El historial estará disponible al comprobar de nuevo tu acceso.</p>
        )}
      </AttemptHelpScope>
    </div>
  );
}
