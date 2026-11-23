'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  signalRuleEffectiveResponseSchema,
  signalRuleVersionListResponseSchema,
  signalRuleVersionResponseSchema,
  type SignalRuleEffective,
  type SignalRuleVersion,
  type Me,
} from '@alunza/contracts';
import { useSession } from '@/components/session-provider';
import {
  FormDialog,
  OperationError,
  Pagination,
  SelectField,
} from '@/components/identity-forms';
import { RequestError } from '@/components/request-error';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useApiResource } from '@/lib/use-api-resource';
import { ApiError } from '@/lib/api';
import {
  ruleParametersLabel,
  ruleStateLabels,
  ruleTypeLabels,
  type RuleType,
} from '@/lib/signal-rule-operation';
import { RuleDetails, RuleTime } from './rule-details';
import { ActivateRule, CreateRule } from './rule-forms';
import { useRuleOperation, type RuleOperation } from './use-rule-operation';

function VersionDetail({ id }: { id: string }) {
  const resource = useApiResource(
    `/api/v1/signal-rules/${id}`,
    signalRuleVersionResponseSchema,
  );
  if (resource.state.status === 'loading')
    return <p role="status">Cargando versión…</p>;
  if (resource.state.status === 'error')
    return (
      <div className="space-y-3">
        <RequestError error={resource.state.error} />
        <Button onClick={() => void resource.reload()} variant="outline">
          Reintentar versión
        </Button>
      </div>
    );
  return <RuleDetails rule={resource.state.result.body.data} />;
}

function DetailButton({ rule }: { rule: SignalRuleVersion }) {
  const [open, setOpen] = useState(false);
  const { identity } = useSession();
  const visible = open && identity.status === 'ready';
  return (
    <FormDialog
      title={`Detalle de versión ${rule.version}`}
      description="Autoría, parámetros y vigencia confirmados por el servidor. Las versiones conservan su historia."
      open={visible}
      onOpenChange={setOpen}
      trigger={
        <Button variant="ghost" data-cy="rule-detail">
          Ver detalle
        </Button>
      }
    >
      {visible ? <VersionDetail id={rule.id} /> : null}
    </FormDialog>
  );
}

function RecentVersion({
  id,
  effective,
  operation,
  canOperate,
  onSaved,
  onRefresh,
}: {
  id: string;
  effective: SignalRuleEffective | null;
  operation: RuleOperation;
  canOperate: boolean;
  onSaved: (version: SignalRuleVersion) => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const currentResource = useApiResource(
    `/api/v1/signal-rules/${id}`,
    signalRuleVersionResponseSchema,
  );
  const [lastReady, setLastReady] = useState<Extract<
    typeof currentResource.state,
    { status: 'ready' }
  > | null>(null);
  if (
    currentResource.state.status === 'ready' &&
    lastReady?.result !== currentResource.state.result
  )
    setLastReady(currentResource.state);
  const resource = {
    ...currentResource,
    state:
      currentResource.state.status === 'loading' && lastReady
        ? lastReady
        : currentResource.state,
  };
  const kind =
    resource.state.status === 'ready'
      ? resource.state.result.body.data.type
      : null;
  return (
    <section
      className="space-y-4 rounded-lg border p-5"
      data-cy="rule-recent-version"
      aria-label="Última versión confirmada"
    >
      <h2 className="text-xl font-semibold">Última versión confirmada</h2>
      <p className="text-sm">
        Consulta actual de la versión cuya operación se confirmó. Puede estar
        fuera de esta página del historial.
      </p>
      {currentResource.state.status === 'loading' && lastReady ? (
        <p role="status">Actualizando versión confirmada…</p>
      ) : null}
      {resource.state.status === 'loading' ? (
        <p role="status">Consultando versión confirmada…</p>
      ) : resource.state.status === 'error' ? (
        <>
          <RequestError error={resource.state.error} />
          <Button variant="outline" onClick={() => void resource.reload()}>
            Reintentar versión confirmada
          </Button>
        </>
      ) : (
        <>
          <RuleDetails rule={resource.state.result.body.data} />
          {canOperate && resource.state.result.body.data.state === 'DRAFT' ? (
            <ActivateRule
              rule={resource.state.result.body.data}
              effective={
                effective?.rules.find((entry) => entry.type === kind)
                  ?.ruleVersion ?? null
              }
              available={!!effective}
              operation={operation}
              onSaved={onSaved}
              onRefresh={onRefresh}
            />
          ) : null}
        </>
      )}
    </section>
  );
}

function RulesContent({ orgId }: { orgId: string }) {
  const { identity, refreshIdentity } = useSession();
  const membership =
    identity.status === 'ready'
      ? identity.data.memberships.find(
          (item) => item.organizationId === orgId && item.role === 'ADMIN',
        )
      : undefined;
  const authorized = !!membership;
  const canOperate = authorized && membership.accessMode === 'OPERATE';
  const [lastMembership, setLastMembership] = useState<
    Me['memberships'][number] | undefined
  >(membership);
  if (identity.status === 'ready' && lastMembership !== membership)
    setLastMembership(membership);
  const displayedMembership =
    identity.status === 'ready' ? membership : lastMembership;
  const [filter, setFilter] = useState<RuleType | ''>('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [recent, setRecent] = useState<{ id: string; revision: number } | null>(
    null,
  );
  const query = new URLSearchParams({ limit: '20' });
  if (filter) query.set('type', filter);
  if (cursor) query.set('cursor', cursor);
  const effectiveResource = useApiResource(
    `/api/v1/organizations/${orgId}/signal-rules/effective`,
    signalRuleEffectiveResponseSchema,
    authorized,
  );
  const historyResource = useApiResource(
    `/api/v1/organizations/${orgId}/signal-rules?${query}`,
    signalRuleVersionListResponseSchema,
    authorized,
  );
  const operation = useRuleOperation(orgId, canOperate, authorized);

  // Retain the same row/form tree while a token is revalidated. ProtectedView
  // hides/inerts it during identity refresh; only the current identity grants
  // read/mutation permission. Resource refresh keeps old data explicitly marked
  // as updating, while a failure replaces it with the actual error state.
  const [lastEffective, setLastEffective] = useState<Extract<
    typeof effectiveResource.state,
    { status: 'ready' }
  > | null>(null);
  const [lastHistory, setLastHistory] = useState<{
    query: string;
    state: Extract<typeof historyResource.state, { status: 'ready' }>;
  } | null>(null);
  if (
    effectiveResource.state.status === 'ready' &&
    lastEffective?.result !== effectiveResource.state.result
  )
    setLastEffective(effectiveResource.state);
  const queryKey = query.toString();
  if (
    historyResource.state.status === 'ready' &&
    lastHistory?.state.result !== historyResource.state.result
  )
    setLastHistory({ query: queryKey, state: historyResource.state });
  const effective = {
    ...effectiveResource,
    state:
      effectiveResource.state.status === 'loading' && lastEffective
        ? lastEffective
        : effectiveResource.state,
  };
  const history = {
    ...historyResource,
    state:
      historyResource.state.status === 'loading' &&
      lastHistory?.query === queryKey
        ? lastHistory.state
        : historyResource.state,
  };

  // Keep this component (and pending operation) mounted during identity refresh.
  // ProtectedView hides its contents until the refreshed permission is known.
  if (!displayedMembership && identity.status !== 'ready') return null;
  if (!displayedMembership)
    return (
      <RequestError
        error={
          new ApiError(
            404,
            'RESOURCE_NOT_FOUND',
            'El recurso no está disponible o no tienes acceso.',
          )
        }
      />
    );

  async function refresh() {
    await Promise.all([effective.reload(), history.reload()]);
  }
  async function saved(version: SignalRuleVersion) {
    setRecent((previous) => ({
      id: version.id,
      revision: (previous?.revision ?? 0) + 1,
    }));
    setNotice(
      'Operación confirmada por el servidor. La vigencia actual se muestra en Parámetros efectivos; la activación no confirma que todas las clases hayan sido evaluadas.',
    );
    await refresh();
  }
  async function reconcile() {
    const result = await operation.reconcile();
    if (result?.status === 'confirmed') await saved(result.version);
    else if (result?.status === 'failed' && !result.uncertain) await refresh();
  }
  const current =
    effectiveResource.state.status === 'ready' && authorized
      ? effectiveResource.state.result.body.data
      : null;
  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/administracion/organizaciones"
            className="text-sm underline underline-offset-4"
          >
            Organizaciones
          </Link>
          <h1 className="mt-3 text-3xl font-semibold">Reglas de señales</h1>
          <p className="mt-2 text-lg">{displayedMembership.organizationName}</p>
          {displayedMembership.accessMode === 'READ_ONLY' ? (
            <p role="status" className="mt-2">
              Organización archivada · Solo lectura
            </p>
          ) : null}
        </div>
        <Button
          variant="outline"
          data-cy="rules-refresh-access"
          onClick={() => void refreshIdentity()}
        >
          Actualizar acceso
        </Button>
      </div>
      {notice ? (
        <p
          role="status"
          className="rounded-lg bg-secondary p-4 text-sm"
          data-cy="rule-operation-confirmed"
        >
          {notice}
        </p>
      ) : null}
      {operation.journal.status === 'empty' && operation.error ? (
        <OperationError error={operation.error} />
      ) : null}
      {operation.journal.status === 'ready' ? (
        <section
          className="space-y-3 rounded-lg border p-4"
          data-cy="rule-pending"
          aria-label="Solicitud pendiente"
        >
          <h2 className="text-lg font-semibold">
            Solicitud pendiente de reconciliación
          </h2>
          <p className="text-sm">
            {operation.journal.operation.operation === 'create'
              ? `Creación de ${ruleTypeLabels[operation.journal.operation.payload.type]}: ${ruleParametersLabel(operation.journal.operation.payload)}.`
              : `Activación de la versión ${operation.journal.operation.versionId}.`}
          </p>
          <p className="text-sm">
            Se conserva la misma solicitud en esta pestaña. Reconciliar
            comprueba el resultado sin crear otra operación.
          </p>
          {operation.receipt ? (
            <p className="text-sm">
              El servidor confirmó la operación, pero queda pendiente retirar el
              registro local. La comprobación conserva la misma clave.
            </p>
          ) : null}
          <OperationError error={operation.error} />
          <Button
            data-cy="rule-pending-reconcile"
            disabled={operation.busy || !canOperate}
            onClick={() => void reconcile()}
          >
            {operation.busy ? 'Comprobando…' : 'Reconciliar solicitud'}
          </Button>
          {!canOperate ? (
            <p className="text-sm">
              La organización archivada no permite repetir mutaciones. El
              pendiente se conserva; consulta el historial autorizado.
            </p>
          ) : null}
        </section>
      ) : operation.journal.status === 'invalid' ||
        operation.journal.status === 'unavailable' ? (
        <section
          className="space-y-3 rounded-lg border p-4"
          data-cy="rule-storage-error"
        >
          <p role="alert">
            No se pudo verificar el registro de operaciones de esta pestaña. No
            se enviarán nuevos cambios; conserva la pestaña y recupera el
            almacenamiento para comprobar el resultado.
          </p>
          <Button variant="outline" onClick={() => operation.checkStorage()}>
            Volver a comprobar almacenamiento
          </Button>
        </section>
      ) : null}
      {recent &&
      history.state.status === 'ready' &&
      !history.state.result.body.data.some((rule) => rule.id === recent.id) ? (
        <RecentVersion
          key={`${recent.id}:${recent.revision}`}
          id={recent.id}
          effective={current}
          operation={operation}
          canOperate={displayedMembership.accessMode === 'OPERATE'}
          onSaved={saved}
          onRefresh={refresh}
        />
      ) : null}
      <section aria-labelledby="effective-heading" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="effective-heading" className="text-xl font-semibold">
            Parámetros efectivos
          </h2>
          <Button variant="outline" onClick={() => void refresh()}>
            Actualizar reglas
          </Button>
        </div>
        {effectiveResource.state.status === 'loading' && lastEffective ? (
          <p role="status" data-cy="rule-effective-loading">
            Actualizando parámetros efectivos…
          </p>
        ) : null}
        {effective.state.status === 'loading' ? (
          <p role="status" data-cy="rule-effective-loading">
            Consultando parámetros efectivos…
          </p>
        ) : effective.state.status === 'error' ? (
          <div className="space-y-3" data-cy="rule-effective-error">
            <RequestError error={effective.state.error} />
            {notice ? (
              <p>
                La operación está confirmada; no se pudo actualizar la consulta
                de vigencia.
              </p>
            ) : null}
            <Button variant="outline" onClick={() => void effective.reload()}>
              Reintentar parámetros efectivos
            </Button>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Consulta del{' '}
              <RuleTime value={effective.state.result.body.data.observedAt} />.
              No indica el corte de procesamiento de las clases.
            </p>
            <div className="grid gap-4 lg:grid-cols-3">
              {effective.state.result.body.data.rules.map((entry) => (
                <Card
                  key={entry.type}
                  data-cy="rule-effective"
                  data-rule-type={entry.type}
                  data-rule-id={entry.ruleVersion?.id ?? ''}
                >
                  <CardHeader>
                    <CardTitle>{ruleTypeLabels[entry.type]}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {entry.ruleVersion ? (
                      <>
                        <p className="font-semibold">
                          Versión {entry.ruleVersion.version} · Vigente
                        </p>
                        <p>{ruleParametersLabel(entry.ruleVersion)}</p>
                        <p className="text-sm">
                          Desde <RuleTime value={entry.ruleVersion.validFrom} />
                        </p>
                        <DetailButton rule={entry.ruleVersion} />
                      </>
                    ) : (
                      <p>Sin regla activa</p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        )}
      </section>
      <section
        aria-labelledby="history-heading"
        className="space-y-4"
        data-cy="rule-history"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="history-heading" className="text-xl font-semibold">
            Historial de versiones
          </h2>
          {displayedMembership.accessMode === 'OPERATE' ? (
            <CreateRule operation={operation} onSaved={saved} />
          ) : null}
        </div>
        {historyResource.state.status === 'loading' &&
        lastHistory?.query === queryKey ? (
          <p role="status">Actualizando historial…</p>
        ) : null}
        <p className="text-sm text-muted-foreground">
          Las versiones son inmutables. Para cambiar parámetros, crea un nuevo
          borrador. Los identificadores de autor conservan su trazabilidad
          aunque cambie su acceso.
        </p>
        <div className="max-w-sm">
          <SelectField
            label="Filtrar por tipo de regla"
            name="ruleFilter"
            data-cy="rule-filter"
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value as RuleType | '');
              setCursor(null);
            }}
          >
            <option value="">Todos los tipos</option>
            {Object.entries(ruleTypeLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </SelectField>
        </div>
        {history.state.status === 'loading' ? (
          <p role="status">Cargando historial…</p>
        ) : history.state.status === 'error' ? (
          <div className="space-y-3">
            <RequestError error={history.state.error} />
            <Button variant="outline" onClick={() => void history.reload()}>
              Reintentar historial
            </Button>
          </div>
        ) : (
          <>
            {history.state.result.body.data.length === 0 ? (
              <p>No hay versiones para este filtro.</p>
            ) : (
              <div
                className="overflow-x-auto rounded-lg border"
                role="region"
                aria-label="Versiones de reglas"
                tabIndex={0}
              >
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">
                    Historial de versiones, de la más antigua a la más reciente.
                  </caption>
                  <thead className="bg-secondary">
                    <tr>
                      <th scope="col" className="p-3">
                        Tipo y versión
                      </th>
                      <th scope="col" className="p-3">
                        Parámetros
                      </th>
                      <th scope="col" className="p-3">
                        Creación
                      </th>
                      <th scope="col" className="p-3">
                        Acciones
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.state.result.body.data.map((rule) => (
                      <tr
                        key={rule.id}
                        data-cy="rule-version-row"
                        data-rule-id={rule.id}
                        data-rule-state={rule.state}
                        className="border-t align-top"
                      >
                        <th scope="row" className="p-3">
                          <p>
                            {ruleTypeLabels[rule.type]} · Versión {rule.version}
                          </p>
                          <p className="mt-1 font-normal">
                            {ruleStateLabels[rule.state]}
                          </p>
                        </th>
                        <td className="p-3">{ruleParametersLabel(rule)}</td>
                        <td className="p-3">
                          <RuleTime value={rule.createdAt} />
                          <p className="mt-2 max-w-64 break-all font-mono text-xs">
                            {rule.createdBy}
                          </p>
                        </td>
                        <td className="p-3">
                          <div className="flex flex-wrap gap-2">
                            <DetailButton rule={rule} />
                            {displayedMembership.accessMode === 'OPERATE' &&
                            rule.state === 'DRAFT' ? (
                              <ActivateRule
                                rule={rule}
                                effective={
                                  current?.rules.find(
                                    (entry) => entry.type === rule.type,
                                  )?.ruleVersion ?? null
                                }
                                available={!!current}
                                operation={operation}
                                onSaved={saved}
                                onRefresh={refresh}
                              />
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <Pagination
              cursor={cursor}
              hasMore={history.state.result.body.page.hasMore}
              onFirst={() => setCursor(null)}
              onNext={() =>
                setCursor(
                  history.state.status === 'ready'
                    ? history.state.result.body.page.nextCursor
                    : null,
                )
              }
            />
          </>
        )}
      </section>
    </div>
  );
}

export function RulesPanel({ orgId }: { orgId: string }) {
  const { session, sessionGeneration } = useSession();
  return session ? (
    <RulesContent
      key={`${sessionGeneration}:${session.user.id}:${orgId}`}
      orgId={orgId}
    />
  ) : null;
}
