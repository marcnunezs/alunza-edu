'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import {
  exerciseBankListResponseSchema,
  organizationResponseSchema,
} from '@alunza/contracts';
import { useSession } from '@/components/session-provider';
import { Pagination } from '@/components/identity-forms';
import { RequestError } from '@/components/request-error';
import { LoadState, difficultyLabels } from '@/components/academic/shared';
import { DashboardTable } from '@/components/academic/dashboard-table';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import { BankFilterForm, type BankFilters } from './bank-filters';
import { BankDetails } from './bank-details';
import {
  BankConcepts,
  BankTime,
  BankUseCounts,
  bankQuery,
  exerciseStateLabels,
  visibilityLabels,
  useBankResource,
  type AccessDenied,
} from './bank-shared';

function BankContent({
  orgId,
  onDenied,
}: {
  orgId: string;
  onDenied: AccessDenied;
}) {
  const [filters, setFilters] = useState<BankFilters>({});
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const selectionTrigger = useRef<HTMLButtonElement | null>(null);
  const organization = useBankResource(
    `/api/v1/organizations/${orgId}`,
    organizationResponseSchema,
    onDenied,
  );
  const resource = useBankResource(
    `/api/v1/organizations/${orgId}/exercise-bank?${bankQuery({ ...filters, limit: 20, cursor })}`,
    exerciseBankListResponseSchema,
    onDenied,
  );
  const result =
    resource.state.status === 'ready' && organization.state.status === 'ready'
      ? resource.state.result.body.data
      : null;
  const timezone =
    organization.state.status === 'ready'
      ? organization.state.result.body.data.timezone
      : 'UTC';
  function reloadBank() {
    setSelected(null);
    if (cursor !== null) setCursor(null);
    else void resource.reload();
  }
  return (
    <>
      <BankFilterForm
        orgId={orgId}
        onDenied={onDenied}
        onApply={(value) => {
          setFilters(value);
          setCursor(null);
          setSelected(null);
        }}
      />
      <section className="space-y-4" aria-label="Ejercicios del banco">
        <LoadState state={organization.state} reload={organization.reload} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">Ejercicios</h2>
          <Button variant="outline" onClick={reloadBank}>
            Actualizar banco
          </Button>
        </div>
        <LoadState state={resource.state} reload={reloadBank} />
        {result ? (
          <div className="space-y-4" data-testid="bank-list-ready">
            <p role="status">
              Ejercicios encontrados: {result.page.totalFiltered}.
            </p>
            {result.items.length ? (
              <DashboardTable
                label="Banco de ejercicios de la organización"
                headers={[
                  'Ejercicio',
                  'Propietario',
                  'Estado y visibilidad',
                  'Conceptos',
                  'Versiones y usos',
                  'Detalle',
                ]}
              >
                {result.items.map((entry) => (
                  <tr
                    key={entry.id}
                    data-cy="exercise-bank-row"
                    data-exercise-id={entry.id}
                  >
                    <th scope="row" className="min-w-44 max-w-md break-words">
                      <p>{entry.currentVersion.title}</p>
                      <p className="text-xs font-normal">
                        {difficultyLabels[entry.currentVersion.difficulty]} ·
                        Versión actual {entry.currentVersion.version}
                      </p>
                    </th>
                    <td className="min-w-32 max-w-56 break-words">
                      {entry.owner.displayName}
                    </td>
                    <td>
                      {exerciseStateLabels[entry.state]}
                      <span className="block">
                        {visibilityLabels[entry.visibility]}
                      </span>
                    </td>
                    <td className="min-w-36">
                      <BankConcepts concepts={entry.currentVersion.concepts} />
                    </td>
                    <td className="min-w-36 space-y-2">
                      <p>Versiones: {entry.versionCount}</p>
                      <BankUseCounts value={entry.useCounts} />
                    </td>
                    <td>
                      <Button
                        variant="outline"
                        aria-pressed={selected === entry.id}
                        aria-controls={
                          selected === entry.id
                            ? 'exercise-bank-detail'
                            : undefined
                        }
                        onClick={(event) => {
                          selectionTrigger.current = event.currentTarget;
                          setSelected(entry.id);
                        }}
                      >
                        Ver detalle
                      </Button>
                    </td>
                  </tr>
                ))}
              </DashboardTable>
            ) : (
              <p>No hay ejercicios para estos filtros.</p>
            )}
            <nav aria-label="Páginas del banco">
              <Pagination
                cursor={cursor}
                hasMore={result.page.hasMore}
                onFirst={() => {
                  setCursor(null);
                  setSelected(null);
                }}
                onNext={() => {
                  setCursor(result.page.nextCursor);
                  setSelected(null);
                }}
              />
            </nav>
            <p className="text-xs text-muted-foreground">
              Consulta:{' '}
              <BankTime value={result.observedAt} timezone={timezone} />.
            </p>
          </div>
        ) : null}
      </section>
      {selected ? (
        <BankDetails
          key={selected}
          exerciseId={selected}
          timezone={timezone}
          readOnly={
            organization.state.status !== 'ready' ||
            organization.state.result.body.data.state === 'ARCHIVED'
          }
          onChanged={async () => {
            await resource.refresh();
          }}
          onClose={() => {
            setSelected(null);
            selectionTrigger.current?.focus();
          }}
          onDenied={onDenied}
        />
      ) : null}
    </>
  );
}

function AuthorizedBank({ orgId }: { orgId: string }) {
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
    <BankContent orgId={orgId} onDenied={setDenied} />
  );
}

export function ExerciseBankPanel({ orgId }: { orgId: string }) {
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
            'No tienes permiso para consultar este banco.',
          )
        }
      />
    );
  return (
    <div className="space-y-6" data-cy="exercise-bank">
      <header className="space-y-3">
        <Link
          href="/administracion/organizaciones"
          className="text-sm underline underline-offset-4"
        >
          Volver a organizaciones
        </Link>
        <h1 className="text-3xl font-semibold">Banco de ejercicios</h1>
        <p className="break-words text-muted-foreground">
          {membership.organizationName} · Propietarios, versiones, visibilidad y
          usos.
        </p>
        {membership.accessMode === 'READ_ONLY' ? (
          <p role="status" className="rounded-lg bg-secondary p-3 text-sm">
            Organización archivada · Solo lectura.
          </p>
        ) : null}
      </header>
      <AuthorizedBank key={`${revision}:${orgId}`} orgId={orgId} />
    </div>
  );
}
