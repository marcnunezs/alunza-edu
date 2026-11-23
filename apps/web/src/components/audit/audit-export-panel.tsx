'use client';

import { useEffect, useRef, useState } from 'react';
import {
  auditExportResponseSchema,
  type AuditExportRequest,
} from '@alunza/contracts';
import { useSession } from '@/components/session-provider';
import { RequestError } from '@/components/request-error';
import { Button } from '@/components/ui/button';
import {
  apiDownloadAuditExport,
  apiRequest,
  ApiError,
  asApiError,
} from '@/lib/api';
import { auditExportFingerprint } from '@/lib/audit-export-operation';
import type { AuditExportOperation } from './use-audit-export';

export function AuditExportPanel({
  operation,
  payload,
  disabledReason,
  timezone,
  onDenied,
}: {
  operation: AuditExportOperation;
  payload: AuditExportRequest | null;
  disabledReason: string | null;
  timezone: string;
  onDenied: (error: ApiError) => void;
}) {
  const { session, revision } = useSession();
  const [downloading, setDownloading] = useState<'csv' | 'metadata' | null>(
    null,
  );
  const [downloadError, setDownloadError] = useState<ApiError | null>(null);
  const [downloaded, setDownloaded] = useState<'csv' | 'metadata' | null>(null);
  const [expiredId, setExpiredId] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), [revision]);
  const receipt = operation.receipt;
  const time = (value: string) =>
    new Intl.DateTimeFormat('es-CL', {
      dateStyle: 'medium',
      timeStyle: 'medium',
      timeZone: timezone,
    }).format(new Date(value));

  async function download(kind: 'csv' | 'metadata') {
    if (!receipt || !session || active.current || operation.busy) return;
    const controller = new AbortController();
    active.current = controller;
    setDownloading(kind);
    setDownloadError(null);
    setDownloaded(null);
    try {
      const current = (
        await apiRequest(
          `/api/v1/organizations/${receipt.organizationId}/audit-exports/${receipt.exportId}`,
          auditExportResponseSchema,
          { accessToken: session.access_token, signal: controller.signal },
        )
      ).body.data;
      if (controller.signal.aborted) return;
      if (
        current.exportId !== receipt.exportId ||
        current.organizationId !== receipt.organizationId ||
        current.sha256 !== receipt.sha256 ||
        current.byteLength !== receipt.byteLength ||
        auditExportFingerprint(current.filters) !==
          auditExportFingerprint(receipt.filters)
      )
        throw new ApiError(
          502,
          'INVALID_RESPONSE',
          'No se pudo verificar la exportación solicitada.',
          undefined,
          [],
          true,
        );
      const content =
        kind === 'csv'
          ? await apiDownloadAuditExport(current, {
              accessToken: session.access_token,
              signal: controller.signal,
            })
          : new Blob([`${JSON.stringify(current, null, 2)}\n`], {
              type: 'application/json;charset=utf-8',
            });
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(content);
      try {
        const link = document.createElement('a');
        link.href = url;
        link.download =
          kind === 'csv'
            ? current.fileName
            : current.fileName.replace(/\.csv$/, '.json');
        document.body.append(link);
        link.click();
        link.remove();
      } finally {
        URL.revokeObjectURL(url);
      }
      setDownloaded(kind);
    } catch (cause) {
      if (!controller.signal.aborted) {
        const error = asApiError(cause);
        setDownloadError(error);
        if (error.status === 410) setExpiredId(receipt.exportId);
        if ([401, 403, 404].includes(error.status)) onDenied(error);
      }
    } finally {
      if (!controller.signal.aborted) setDownloading(null);
      if (active.current === controller) active.current = null;
    }
  }
  return (
    <section
      aria-label="Exportación de auditoría"
      className="space-y-4 rounded-xl border bg-card p-5"
      data-cy="audit-export"
    >
      <h2 className="text-xl font-semibold">Exportar consulta</h2>
      <p className="text-sm text-muted-foreground">
        Incluye todos los registros del filtro y corte aplicados, hasta 10.000
        filas y 10 MiB. El archivo conserva los datos que estaban confirmados al
        generarlo y está disponible durante 24 horas.
      </p>
      {disabledReason && !operation.locked ? (
        <p role="status">{disabledReason}</p>
      ) : null}
      {operation.journal.status === 'loading' ? (
        <p role="status">Comprobando solicitudes pendientes…</p>
      ) : null}
      {operation.journal.status === 'invalid' ||
      operation.journal.status === 'unavailable' ? (
        <div className="space-y-3">
          <p role="alert">
            No se pudo comprobar el registro pendiente de esta pestaña. No se
            generará otra exportación mientras no pueda recuperarse.
          </p>
          <Button variant="outline" onClick={operation.checkStorage}>
            Volver a comprobar solicitud
          </Button>
        </div>
      ) : null}
      {operation.error ? <RequestError error={operation.error} /> : null}
      {operation.busy ? <p role="status">Generando exportación…</p> : null}
      {operation.journal.status === 'ready' ? (
        <div className="space-y-3">
          <p role="status">
            Hay una solicitud pendiente. Recupera su resultado antes de cambiar
            los filtros o iniciar otra exportación.
          </p>
          <p className="text-sm">
            Corte de la solicitud pendiente:{' '}
            <time
              dateTime={operation.journal.operation.payload.asOf}
              title={operation.journal.operation.payload.asOf}
            >
              {time(operation.journal.operation.payload.asOf)} ({timezone})
            </time>
            .
          </p>
          <Button
            data-cy="audit-export-recover"
            variant="outline"
            disabled={operation.busy}
            onClick={() => void operation.recover()}
          >
            {operation.busy
              ? 'Comprobando exportación…'
              : 'Recuperar exportación'}
          </Button>
        </div>
      ) : (
        <Button
          data-cy="audit-export-generate"
          disabled={
            !payload ||
            Boolean(disabledReason) ||
            operation.locked ||
            Boolean(downloading)
          }
          onClick={() => {
            if (payload) {
              setDownloadError(null);
              setDownloaded(null);
              void operation.generate(payload);
            }
          }}
        >
          {receipt ? 'Generar nueva exportación' : 'Generar CSV'}
        </Button>
      )}
      {receipt ? (
        <div
          className="space-y-4"
          data-cy="audit-export-ready"
          data-export-id={receipt.exportId}
        >
          <p role="status">
            Exportación preparada: {receipt.rowCount} registros.
          </p>
          <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[max-content_minmax(0,1fr)]">
            <dt>Identificador</dt>
            <dd className="break-all">{receipt.exportId}</dd>
            <dt>Corte del filtro</dt>
            <dd>
              <time
                dateTime={receipt.filters.asOf}
                title={receipt.filters.asOf}
              >
                {time(receipt.filters.asOf)} ({timezone})
              </time>
            </dd>
            <dt>Datos confirmados al</dt>
            <dd>
              <time dateTime={receipt.snapshotAt} title={receipt.snapshotAt}>
                {time(receipt.snapshotAt)} ({timezone})
              </time>
            </dd>
            <dt>Generada</dt>
            <dd>
              <time dateTime={receipt.generatedAt}>
                {time(receipt.generatedAt)} ({timezone})
              </time>
            </dd>
            <dt>Disponible hasta</dt>
            <dd>
              <time dateTime={receipt.expiresAt}>
                {time(receipt.expiresAt)} ({timezone})
              </time>
            </dd>
            <dt>Filas y tamaño</dt>
            <dd>
              {receipt.rowCount} filas · {receipt.byteLength} bytes
            </dd>
          </dl>
          {Object.entries(receipt.filters).filter(([name]) => name !== 'asOf')
            .length ? (
            <details>
              <summary className="cursor-pointer text-sm underline underline-offset-4">
                Filtros de esta exportación
              </summary>
              <dl className="mt-3 space-y-2 text-sm">
                {Object.entries(receipt.filters)
                  .filter(([name]) => name !== 'asOf')
                  .map(([name, value]) => (
                    <div key={name} className="break-all">
                      <dt className="font-semibold">
                        {{
                          from: 'Desde',
                          actorId: 'Actor',
                          action: 'Acción',
                          entityType: 'Tipo de entidad',
                          entityId: 'Entidad',
                        }[name] ?? name}
                      </dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
              </dl>
            </details>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <Button
              data-cy="audit-export-download"
              aria-describedby="audit-export-excel-help"
              disabled={
                Boolean(downloading) ||
                operation.locked ||
                expiredId === receipt.exportId
              }
              onClick={() => void download('csv')}
            >
              {downloading === 'csv' ? 'Verificando CSV…' : 'Descargar CSV'}
            </Button>
            <Button
              data-cy="audit-export-metadata"
              variant="outline"
              disabled={
                Boolean(downloading) ||
                operation.locked ||
                expiredId === receipt.exportId
              }
              onClick={() => void download('metadata')}
            >
              {downloading === 'metadata'
                ? 'Consultando metadatos…'
                : 'Descargar metadatos JSON'}
            </Button>
          </div>
          <p
            id="audit-export-excel-help"
            className="text-sm text-muted-foreground"
          >
            En Excel, importa el archivo desde Datos → Desde texto/CSV, con
            UTF-8 y separador coma para conservar los saltos de línea.
          </p>
          {downloadError ? <RequestError error={downloadError} /> : null}
          {downloaded ? (
            <p role="status">
              {downloaded === 'csv'
                ? 'CSV íntegro verificado y enviado al navegador para descarga.'
                : 'Metadatos verificados y enviados al navegador para descarga.'}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
