'use client';

import { useEffect, useRef, useState } from 'react';
import {
  exerciseBankDetailResponseSchema,
  exerciseBankVersionsResponseSchema,
  exerciseBankUsesResponseSchema,
} from '@alunza/contracts';
import { Pagination, SelectField } from '@/components/identity-forms';
import { LoadState, difficultyLabels } from '@/components/academic/shared';
import { DashboardTable } from '@/components/academic/dashboard-table';
import { Button } from '@/components/ui/button';
import { BankActions } from './bank-actions';
import {
  activityStateLabels,
  BankConcepts,
  BankTime,
  BankUseCounts,
  bankQuery,
  exerciseStateLabels,
  visibilityLabels,
  useBankResource,
  type AccessDenied,
} from './bank-shared';

function Versions({
  exerciseId,
  timezone,
  onVersion,
  onDenied,
}: {
  exerciseId: string;
  timezone: string;
  onVersion: (value: { id: string; number: number }) => void;
  onDenied: AccessDenied;
}) {
  const [cursor, setCursor] = useState<string | null>(null);
  const resource = useBankResource(
    `/api/v1/exercises/${exerciseId}/governance/versions?${bankQuery({ limit: 20, cursor })}`,
    exerciseBankVersionsResponseSchema,
    onDenied,
  );
  const result =
    resource.state.status === 'ready' ? resource.state.result.body.data : null;
  return (
    <section
      className="space-y-4"
      aria-labelledby="bank-versions-title"
      data-cy="exercise-bank-versions"
    >
      <h3 id="bank-versions-title" className="text-lg font-semibold">
        Historial de versiones
      </h3>
      <LoadState
        state={resource.state}
        reload={() => {
          if (cursor !== null) setCursor(null);
          else void resource.reload();
        }}
      />
      {result ? (
        <div className="space-y-4" data-testid="bank-versions-ready">
          <p className="text-sm">Versiones: {result.page.totalFiltered}.</p>
          {result.items.length ? (
            <DashboardTable
              label="Versiones del ejercicio"
              headers={['Versión', 'Contenido', 'Conceptos', 'Usos']}
            >
              {result.items.map((version) => (
                <tr
                  key={version.id}
                  data-cy="exercise-bank-version"
                  data-version-id={version.id}
                >
                  <th scope="row">{version.version}</th>
                  <td className="min-w-44 max-w-md break-words">
                    <p className="font-semibold">{version.title}</p>
                    <p>{difficultyLabels[version.difficulty]}</p>
                    <p className="text-xs">
                      <BankTime value={version.createdAt} timezone={timezone} />
                    </p>
                  </td>
                  <td className="min-w-36">
                    <BankConcepts concepts={version.concepts} />
                  </td>
                  <td className="min-w-40 space-y-3">
                    <BankUseCounts value={version.useCounts} />
                    <Button
                      variant="outline"
                      onClick={() =>
                        onVersion({ id: version.id, number: version.version })
                      }
                    >
                      Ver usos de versión {version.version}
                    </Button>
                  </td>
                </tr>
              ))}
            </DashboardTable>
          ) : (
            <p>No hay versiones disponibles.</p>
          )}
          <nav aria-label="Páginas de versiones">
            <Pagination
              cursor={cursor}
              hasMore={result.page.hasMore}
              onFirst={() => setCursor(null)}
              onNext={() => setCursor(result.page.nextCursor)}
            />
          </nav>
          <p className="text-xs text-muted-foreground">
            Consulta: <BankTime value={result.observedAt} timezone={timezone} />
            .
          </p>
        </div>
      ) : null}
    </section>
  );
}

function Uses({
  exerciseId,
  version,
  timezone,
  onAllVersions,
  onDenied,
}: {
  exerciseId: string;
  version: { id: string; number: number } | null;
  timezone: string;
  onAllVersions: () => void;
  onDenied: AccessDenied;
}) {
  const [cursor, setCursor] = useState<string | null>(null);
  const [activityState, setActivityState] = useState('');
  const resource = useBankResource(
    `/api/v1/exercises/${exerciseId}/governance/uses?${bankQuery({ limit: 20, cursor, versionId: version?.id, activityState })}`,
    exerciseBankUsesResponseSchema,
    onDenied,
  );
  const result =
    resource.state.status === 'ready' ? resource.state.result.body.data : null;
  return (
    <section
      className="space-y-4"
      aria-labelledby="bank-uses-title"
      data-cy="exercise-bank-uses"
    >
      <h3 id="bank-uses-title" className="text-lg font-semibold">
        Usos en actividades
      </h3>
      <p className="text-sm" role="status">
        {version
          ? `Usos de la versión ${version.number}.`
          : 'Usos de todas las versiones.'}
      </p>
      <div className="flex flex-wrap items-end gap-4">
        <div className="w-full sm:w-64">
          <SelectField
            label="Estado de la actividad"
            name="activityState"
            value={activityState}
            onChange={(event) => {
              setActivityState(event.target.value);
              setCursor(null);
            }}
          >
            <option value="">Todos los estados</option>
            {Object.entries(activityStateLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </SelectField>
        </div>
        {version ? (
          <Button variant="outline" onClick={onAllVersions}>
            Ver todas las versiones
          </Button>
        ) : null}
      </div>
      <LoadState
        state={resource.state}
        reload={() => {
          if (cursor !== null) setCursor(null);
          else void resource.reload();
        }}
      />
      {result ? (
        <div className="space-y-4" data-testid="bank-uses-ready">
          <p className="text-sm">
            Asignaciones encontradas: {result.page.totalFiltered}.
          </p>
          {result.items.length ? (
            <DashboardTable
              label="Usos del ejercicio"
              headers={['Actividad', 'Clase', 'Versión', 'Estado']}
            >
              {result.items.map((use) => (
                <tr
                  key={use.assignmentId}
                  data-cy="exercise-bank-use"
                  data-assignment-id={use.assignmentId}
                >
                  <th scope="row" className="min-w-40 max-w-md break-words">
                    {use.activity.title}
                  </th>
                  <td className="min-w-36 max-w-sm break-words">
                    {use.class.name}
                    {use.class.archived ? (
                      <span className="block text-xs">Clase archivada</span>
                    ) : null}
                  </td>
                  <td>{use.version}</td>
                  <td>{activityStateLabels[use.activity.state]}</td>
                </tr>
              ))}
            </DashboardTable>
          ) : (
            <p>Sin usos para estos filtros.</p>
          )}
          <nav aria-label="Páginas de usos">
            <Pagination
              cursor={cursor}
              hasMore={result.page.hasMore}
              onFirst={() => setCursor(null)}
              onNext={() => setCursor(result.page.nextCursor)}
            />
          </nav>
          <p className="text-xs text-muted-foreground">
            Consulta: <BankTime value={result.observedAt} timezone={timezone} />
            .
          </p>
        </div>
      ) : null}
    </section>
  );
}

export function BankDetails({
  exerciseId,
  timezone,
  onClose,
  onDenied,
  readOnly,
  onChanged,
}: {
  exerciseId: string;
  timezone: string;
  onClose: () => void;
  onDenied: AccessDenied;
  readOnly: boolean;
  onChanged: () => Promise<void>;
}) {
  const [version, setVersion] = useState<{ id: string; number: number } | null>(
    null,
  );
  const region = useRef<HTMLElement>(null);
  const [generation, setGeneration] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    region.current?.focus();
  }, [exerciseId]);
  const resource = useBankResource(
    `/api/v1/exercises/${exerciseId}/governance`,
    exerciseBankDetailResponseSchema,
    onDenied,
  );
  const detail =
    resource.state.status === 'ready' ? resource.state.result.body.data : null;
  return (
    <section
      ref={region}
      tabIndex={-1}
      id="exercise-bank-detail"
      className="space-y-6 rounded-xl border bg-card p-5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:p-6"
      aria-labelledby="bank-detail-title"
      data-cy="exercise-bank-detail"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="bank-detail-title" className="text-xl font-semibold">
          Detalle del ejercicio
        </h2>
        <Button variant="outline" onClick={onClose}>
          Cerrar detalle
        </Button>
      </div>
      <LoadState state={resource.state} reload={resource.reload} />
      {message ? <p role="status">{message}</p> : null}
      {detail ? (
        <div className="space-y-6" data-testid="bank-detail-ready">
          <div className="space-y-3">
            <h3 className="break-words text-lg font-semibold">
              {detail.currentVersion.title}
            </h3>
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <dt className="text-sm font-semibold">Propietario</dt>
                <dd className="break-words">{detail.owner.displayName}</dd>
              </div>
              <div>
                <dt className="text-sm font-semibold">Estado</dt>
                <dd>{exerciseStateLabels[detail.state]}</dd>
              </div>
              <div>
                <dt className="text-sm font-semibold">Visibilidad</dt>
                <dd>{visibilityLabels[detail.visibility]}</dd>
              </div>
              <div>
                <dt className="text-sm font-semibold">Versión actual</dt>
                <dd>
                  {detail.currentVersion.version} de {detail.versionCount}{' '}
                  versiones
                </dd>
              </div>
              <div>
                <dt className="text-sm font-semibold">Dificultad actual</dt>
                <dd>{difficultyLabels[detail.currentVersion.difficulty]}</dd>
              </div>
              <div>
                <dt className="text-sm font-semibold">
                  Conceptos de la versión actual
                </dt>
                <dd>
                  <BankConcepts concepts={detail.currentVersion.concepts} />
                </dd>
              </div>
            </dl>
            <div className="max-w-sm">
              <h4 className="mb-2 text-sm font-semibold">
                Usos de todas las versiones
              </h4>
              <BankUseCounts value={detail.useCounts} />
            </div>
            <p className="text-xs text-muted-foreground">
              Consulta:{' '}
              <BankTime value={detail.observedAt} timezone={timezone} />.
            </p>
          </div>
          {!readOnly && detail.state === 'ACTIVE' ? (
            <BankActions
              detail={detail}
              onDenied={onDenied}
              onSaved={async (notice) => {
                setMessage(notice);
                await Promise.all([resource.refresh(), onChanged()]);
                setGeneration((value) => value + 1);
              }}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Solo lectura. Se conservan las versiones y los usos históricos.
            </p>
          )}
          <Versions
            key={`versions:${generation}`}
            exerciseId={exerciseId}
            timezone={timezone}
            onVersion={setVersion}
            onDenied={onDenied}
          />
          <Uses
            key={`${exerciseId}:${version?.id ?? 'all'}:${generation}`}
            exerciseId={exerciseId}
            version={version}
            timezone={timezone}
            onAllVersions={() => setVersion(null)}
            onDenied={onDenied}
          />
        </div>
      ) : null}
    </section>
  );
}
