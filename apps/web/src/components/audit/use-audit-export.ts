'use client';

import { useEffect, useRef, useState } from 'react';
import {
  auditExportResponseSchema,
  type AuditExportMetadata,
  type AuditExportRequest,
} from '@alunza/contracts';
import { useSession } from '@/components/session-provider';
import { apiRequest, ApiError, asApiError } from '@/lib/api';
import {
  auditExportMatches,
  auditExportTerminalFailure,
  clearAuditExport,
  pendingAuditExportSchema,
  readAuditExport,
  saveAuditExport,
  type AuditExportJournal,
  type PendingAuditExport,
} from '@/lib/audit-export-operation';

const storageFailure = () =>
  new ApiError(
    503,
    'AUDIT_EXPORT_RECOVERY_UNAVAILABLE',
    'No se pudo conservar o verificar la solicitud en esta pestaña. Comprueba el registro pendiente antes de generar otra exportación.',
  );

export function useAuditExport(
  organizationId: string,
  onDenied: (error: ApiError) => void,
) {
  const { session } = useSession();
  const userId = session?.user.id ?? '';
  const [journal, setJournal] = useState<
    AuditExportJournal | { status: 'loading' }
  >({ status: 'loading' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [receipt, setReceipt] = useState<AuditExportMetadata | null>(null);
  const alive = useRef(false);
  const inFlight = useRef(false);
  const active = useRef<AbortController | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      active.current?.abort();
    };
  }, [organizationId, userId]);
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      try {
        setJournal(
          readAuditExport(window.sessionStorage, { userId, organizationId }),
        );
      } catch {
        setJournal({ status: 'unavailable' });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [organizationId, userId]);

  function checkStorage() {
    try {
      const current = readAuditExport(window.sessionStorage, {
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
  async function execute(payload?: AuditExportRequest) {
    if (inFlight.current || !session) return;
    inFlight.current = true;
    setError(null);
    setReceipt(null);
    let operation: PendingAuditExport | null = null;
    let controller: AbortController | null = null;
    let dispatched = false;
    let earlierPending = false;
    try {
      const current = checkStorage();
      if (current.status === 'ready') {
        earlierPending = true;
        if (payload)
          throw new ApiError(
            409,
            'AUDIT_EXPORT_RECOVERY_PENDING',
            'Recupera primero el resultado de la exportación pendiente.',
          );
        operation = current.operation;
      } else if (current.status === 'empty' && payload) {
        operation = pendingAuditExportSchema.parse({
          formatVersion: 1,
          userId,
          organizationId,
          key: crypto.randomUUID(),
          payload,
        });
      } else throw storageFailure();
      if (!saveAuditExport(window.sessionStorage, operation))
        throw storageFailure();
      setJournal({ status: 'ready', operation });
      setBusy(true);
      controller = new AbortController();
      active.current = controller;
      dispatched = true;
      const result = await apiRequest(
        `/api/v1/organizations/${organizationId}/audit-exports`,
        auditExportResponseSchema,
        {
          method: 'POST',
          body: operation.payload,
          idempotencyKey: operation.key,
          accessToken: session.access_token,
          signal: controller.signal,
          timeoutMs: 45_000,
        },
      );
      if (!alive.current || controller.signal.aborted) return;
      if (!auditExportMatches(operation, result.body.data))
        throw new ApiError(
          502,
          'INVALID_RESPONSE',
          'La respuesta no corresponde al filtro y la organización de esta exportación.',
          undefined,
          [],
          true,
        );
      setReceipt(result.body.data);
      if (clearAuditExport(window.sessionStorage, operation))
        setJournal({ status: 'empty' });
      else {
        setError(storageFailure());
        checkStorage();
      }
    } catch (cause) {
      if (!alive.current || controller?.signal.aborted) return;
      const failure = asApiError(cause);
      setError(failure);
      if (
        operation &&
        ((!earlierPending && !dispatched) ||
          auditExportTerminalFailure(failure))
      ) {
        if (clearAuditExport(window.sessionStorage, operation))
          setJournal({ status: 'empty' });
        else {
          setError(storageFailure());
          checkStorage();
        }
      } else checkStorage();
      if ([401, 403, 404].includes(failure.status)) onDenied(failure);
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
    locked: busy || journal.status !== 'empty',
    generate: (payload: AuditExportRequest) => execute(payload),
    recover: () => execute(),
    checkStorage,
  };
}

export type AuditExportOperation = ReturnType<typeof useAuditExport>;
