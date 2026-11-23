'use client';

import { useEffect, useRef, useState } from 'react';
import {
  signalRuleVersionResponseSchema,
  type SignalRuleVersion,
} from '@alunza/contracts';
import { useSession } from '@/components/session-provider';
import { apiRequest, ApiError, asApiError } from '@/lib/api';
import {
  clearRuleOperation,
  isRuleOperationTerminalFailure,
  pendingRuleOperationSchema,
  readRuleOperation,
  ruleOperationRequest,
  saveRuleOperation,
  type PendingRuleOperation,
  type RuleOperationInput,
  type RuleStorageRead,
} from '@/lib/signal-rule-operation';

const storageFailure = () =>
  new ApiError(
    503,
    'RULE_RECOVERY_UNAVAILABLE',
    'No se pudo conservar o comprobar la solicitud pendiente en esta pestaña. No se enviarán nuevos cambios hasta recuperar ese registro.',
  );
type RuleOperationResult =
  | { status: 'confirmed'; version: SignalRuleVersion }
  | { status: 'failed'; error: ApiError; uncertain: boolean }
  | null;

/** Same durable idempotency protocol as useOperation, with a rule-only storage journal. */
export function useRuleOperation(
  organizationId: string,
  authorized: boolean,
  canRead: boolean,
) {
  const { session, refreshIdentity } = useSession();
  const userId = session?.user.id ?? '';
  const [journal, setJournal] = useState<
    RuleStorageRead | { status: 'loading' }
  >({ status: 'loading' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [receipt, setReceipt] = useState<SignalRuleVersion | null>(null);
  const active = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  const alive = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      active.current?.abort();
    };
  }, [organizationId, userId]);

  useEffect(() => {
    if (!canRead) return;
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      try {
        setJournal(
          readRuleOperation(window.sessionStorage, { userId, organizationId }),
        );
      } catch {
        setJournal({ status: 'unavailable' });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [organizationId, userId, canRead]);

  function checkStorage() {
    try {
      const current = readRuleOperation(window.sessionStorage, {
        userId,
        organizationId,
      });
      setJournal(current);
      return current;
    } catch {
      setJournal({ status: 'unavailable' });
      return { status: 'unavailable' } as const;
    }
  }

  async function execute(
    input?: RuleOperationInput,
  ): Promise<RuleOperationResult> {
    if (inFlight.current || !authorized || !session) return null;
    inFlight.current = true;
    setError(null);
    setReceipt(null);
    let operation: PendingRuleOperation | null = null;
    let controller: AbortController | null = null;
    let earlierPending = false;
    let mutationStarted = false;
    try {
      const current = checkStorage();
      if (current.status === 'ready') {
        earlierPending = true;
        if (input)
          throw new ApiError(
            409,
            'RULE_RECOVERY_PENDING',
            'Reconcilia primero la solicitud pendiente.',
          );
        operation = current.operation;
      } else if (current.status === 'empty' && input) {
        operation = pendingRuleOperationSchema.parse({
          ...input,
          formatVersion: 1,
          userId,
          organizationId,
          key: crypto.randomUUID(),
        });
      } else throw storageFailure();

      // No network mutation occurs until the entire validated request is durable.
      if (!saveRuleOperation(window.sessionStorage, operation))
        throw storageFailure();
      setJournal({ status: 'ready', operation });
      setBusy(true);
      controller = new AbortController();
      active.current = controller;
      if (operation.operation === 'activate') {
        const target = await apiRequest(
          `/api/v1/signal-rules/${operation.versionId}`,
          signalRuleVersionResponseSchema,
          {
            accessToken: session.access_token,
            signal: controller.signal,
          },
        );
        if (target.body.data.organizationId !== organizationId)
          throw new ApiError(
            409,
            'RULE_RECOVERY_SCOPE',
            'La versión pendiente no pertenece a esta organización. No se envió la activación.',
          );
      }
      const request = ruleOperationRequest(operation);
      mutationStarted = true;
      const response = await apiRequest(
        request.path,
        signalRuleVersionResponseSchema,
        {
          method: 'POST',
          body: request.body,
          idempotencyKey: request.idempotencyKey,
          accessToken: session.access_token,
          signal: controller.signal,
        },
      );
      if (!alive.current || controller.signal.aborted) return null;
      const version = response.body.data;
      if (
        version.organizationId !== organizationId ||
        (operation.operation === 'activate' &&
          version.id !== operation.versionId) ||
        (operation.operation === 'create' &&
          version.type !== operation.payload.type)
      )
        throw new ApiError(
          502,
          'INVALID_RESPONSE',
          'La respuesta no corresponde a la solicitud pendiente.',
          undefined,
          [],
          true,
        );
      setReceipt(version);
      if (!clearRuleOperation(window.sessionStorage, operation)) {
        setError(storageFailure());
        checkStorage();
      } else setJournal({ status: 'empty' });
      return { status: 'confirmed', version };
    } catch (cause) {
      if (!alive.current || controller?.signal.aborted) return null;
      const failure = cause instanceof ApiError ? cause : asApiError(cause);
      setError(failure);
      if (
        operation &&
        ((!earlierPending && !mutationStarted) ||
          isRuleOperationTerminalFailure(failure))
      ) {
        try {
          if (clearRuleOperation(window.sessionStorage, operation))
            setJournal({ status: 'empty' });
          else {
            setError(storageFailure());
            checkStorage();
          }
        } catch {
          setJournal({ status: 'unavailable' });
        }
      } else checkStorage();
      if ([401, 403].includes(failure.status)) void refreshIdentity();
      return {
        status: 'failed',
        error: failure,
        uncertain:
          (earlierPending || mutationStarted) &&
          !isRuleOperationTerminalFailure(failure),
      };
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  }

  return {
    journal,
    busy,
    error,
    receipt,
    suspended: !canRead,
    locked: !authorized || busy || journal.status !== 'empty',
    run: (input: RuleOperationInput) => execute(input),
    reconcile: () => execute(),
    checkStorage,
    clearError: () => setError(null),
  };
}

export type RuleOperation = ReturnType<typeof useRuleOperation>;
