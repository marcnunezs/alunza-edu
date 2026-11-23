'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  auditListResponseSchema,
  organizationResponseSchema,
} from '@alunza/contracts';
import { useSession } from '@/components/session-provider';
import { Pagination } from '@/components/identity-forms';
import { RequestError } from '@/components/request-error';
import { DashboardTable } from '@/components/academic/dashboard-table';
import { LoadState } from '@/components/academic/shared';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import { useApiResource } from '@/lib/use-api-resource';
import {
  auditOutcomeLabel,
  auditPageQuery,
  auditQuery,
  auditRefreshFilters,
  type AuditFilters,
} from '@/lib/audit-view';
import { AuditFilterForm } from './audit-filters';
import { AuditExportPanel } from './audit-export-panel';
import { useAuditExport } from './use-audit-export';
import { auditExportInput } from '@/lib/audit-export-operation';

function AuditTime({ value, timezone }: { value: string; timezone: string }) {
  return (
    <time dateTime={value} title={value}>
      {new Intl.DateTimeFormat('es-CL', {
        dateStyle: 'medium',
        timeStyle: 'medium',
        timeZone: timezone,
      }).format(new Date(value))}{' '}
      ({timezone})
    </time>
  );
}

function AuditContent({
  orgId,
  onDenied,
}: {
  orgId: string;
  onDenied: (error: ApiError) => void;
}) {
  const [filters, setFilters] = useState<AuditFilters>({});
  const [cursor, setCursor] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const [confirmedCut, setConfirmedCut] = useState<string | undefined>();
  const [draftChanged, setDraftChanged] = useState(false);
  const exportOperation = useAuditExport(orgId, onDenied);
  const organization = useApiResource(
    `/api/v1/organizations/${orgId}`,
    organizationResponseSchema,
  );
  const resource = useApiResource(
    `/api/v1/organizations/${orgId}/audit-events?${auditQuery({ ...filters, limit: 20, ...(cursor ? { cursor } : {}) })}`,
    auditListResponseSchema,
  );
  const failure =
    organization.state.status === 'error'
      ? organization.state.error
      : resource.state.status === 'error'
        ? resource.state.error
        : null;
  useEffect(() => {
    if (failure && [401, 403, 404].includes(failure.status)) onDenied(failure);
  }, [failure, onDenied]);
  const result =
    resource.state.status === 'ready' && organization.state.status === 'ready'
      ? resource.state.result.body.data
      : null;
  const timezone =
    organization.state.status === 'ready'
      ? organization.state.result.body.data.timezone
      : 'UTC';
  function apply(next: AuditFilters) {
    if (exportOperation.locked) return;
    setDraftChanged(false);
    if (result) setConfirmedCut(result.asOf);
    setFilters(next);
    setCursor(null);
  }
  function refresh() {
    if (exportOperation.locked) return;
    setGeneration((value) => value + 1);
    const next = auditRefreshFilters(filters);
    apply(next);
    setConfirmedCut(undefined);
    // Identical first-page paths still need a fresh authorized request.
    if (!filters.asOf && !cursor) void resource.reload();
  }
  return (
    <>
      <LoadState state={organization.state} reload={organization.reload} />
      {organization.state.status === 'ready' ? (
        <AuditFilterForm
          key={generation}
          filters={filters}
          asOf={result?.asOf ?? confirmedCut}
          timezone={timezone}
          locked={exportOperation.locked}
          onDraftChange={() => setDraftChanged(true)}
          onApply={apply}
          onClear={() => {
            setGeneration((value) => value + 1);
            apply({ asOf: result?.asOf ?? confirmedCut });
          }}
        />
      ) : null}
      <AuditExportPanel
        operation={exportOperation}
        payload={result ? auditExportInput(filters, result.asOf) : null}
        disabledReason={
          draftChanged
            ? 'Aplica o limpia los filtros editados antes de exportar.'
            : !result
              ? 'Espera una consulta válida antes de exportar.'
              : null
        }
        timezone={timezone}
        onDenied={onDenied}
      />
      <section className="space-y-4" aria-label="Eventos de auditoría">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">Registros operativos</h2>
          <Button
            variant="outline"
            onClick={refresh}
            disabled={exportOperation.locked}
          >
            Actualizar auditoría
          </Button>
        </div>
        <LoadState state={resource.state} reload={resource.reload} />
        {result ? (
          <div
            className="space-y-4"
            data-testid="audit-list-ready"
            data-cut={result.asOf}
          >
            <p role="status">
              Registros encontrados: {result.page.totalFiltered}.
            </p>
            <p className="text-sm">
              Corte de consulta:{' '}
              <AuditTime value={result.asOf} timezone={timezone} />.
            </p>
            {result.items.length ? (
              <DashboardTable
                label="Auditoría de la organización"
                headers={[
                  'Fecha',
                  'Actor',
                  'Acción',
                  'Entidad',
                  'Identificador de entidad',
                  'Resultado',
                  'Identificador del evento',
                  'Organización',
                ]}
              >
                {result.items.map((event) => (
                  <tr
                    key={event.eventId}
                    data-cy="audit-row"
                    data-event-id={event.eventId}
                  >
                    <th scope="row" className="min-w-44 font-normal">
                      <AuditTime value={event.occurredAt} timezone={timezone} />
                    </th>
                    <td className="min-w-36 max-w-56 break-all">
                      {event.actorId ?? 'Sin actor identificado'}
                    </td>
                    <td className="min-w-40 max-w-64 break-words">
                      {event.action}
                    </td>
                    <td className="min-w-28 max-w-48 break-words">
                      {event.entityType}
                    </td>
                    <td className="min-w-36 max-w-56 break-all">
                      {event.entityId ?? 'Sin identificador'}
                    </td>
                    <td className="min-w-28 max-w-48 break-words">
                      {auditOutcomeLabel(event.outcome)}
                      {auditOutcomeLabel(event.outcome) !== event.outcome ? (
                        <span className="block text-xs">{event.outcome}</span>
                      ) : null}
                    </td>
                    <td className="min-w-36 max-w-56 break-all">
                      {event.eventId}
                    </td>
                    <td className="min-w-36 max-w-56 break-all">
                      {event.organizationId}
                    </td>
                  </tr>
                ))}
              </DashboardTable>
            ) : (
              <p>No hay registros para estos filtros.</p>
            )}
            <nav aria-label="Páginas de auditoría">
              <fieldset disabled={exportOperation.locked}>
                <Pagination
                  cursor={cursor}
                  hasMore={result.page.hasMore}
                  onFirst={() => {
                    setConfirmedCut(result.asOf);
                    setFilters(auditPageQuery(filters, result.asOf, null));
                    setCursor(null);
                  }}
                  onNext={() => {
                    setConfirmedCut(result.asOf);
                    setFilters(auditPageQuery(filters, result.asOf, null));
                    setCursor(result.page.nextCursor);
                  }}
                />
              </fieldset>
            </nav>
          </div>
        ) : null}
      </section>
    </>
  );
}

function AuthorizedAudit({ orgId }: { orgId: string }) {
  const [denied, setDenied] = useState<ApiError | null>(null);
  const { refreshIdentity } = useSession();
  return denied ? (
    <div className="space-y-3">
      <RequestError error={denied} />
      <Button variant="outline" onClick={() => void refreshIdentity()}>
        Volver a comprobar acceso
      </Button>
    </div>
  ) : (
    <AuditContent orgId={orgId} onDenied={setDenied} />
  );
}

export function AuditPanel({ orgId }: { orgId: string }) {
  const { identity, revision } = useSession();
  if (identity.status !== 'ready') return null;
  const membership = identity.data.memberships.find(
    (item) =>
      item.organizationId === orgId &&
      item.role === 'ADMIN' &&
      item.state === 'ACTIVE',
  );
  if (!membership)
    return (
      <RequestError
        error={
          new ApiError(
            403,
            'FORBIDDEN',
            'No tienes permiso para consultar esta auditoría.',
          )
        }
      />
    );
  return (
    <div className="space-y-6" data-cy="audit-panel">
      <header className="space-y-3">
        <Link
          href="/administracion/organizaciones"
          className="text-sm underline underline-offset-4"
        >
          Volver a organizaciones
        </Link>
        <h1 className="text-3xl font-semibold">Auditoría</h1>
        <p className="break-words text-muted-foreground">
          {membership.organizationName} · Registros operativos autorizados.
        </p>
        {membership.accessMode === 'READ_ONLY' ? (
          <p role="status" className="rounded-lg bg-secondary p-3 text-sm">
            Organización archivada · Solo lectura.
          </p>
        ) : null}
      </header>
      <AuthorizedAudit key={`${revision}:${orgId}`} orgId={orgId} />
    </div>
  );
}
