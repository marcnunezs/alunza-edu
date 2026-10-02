'use client';

import { useEffect, useId, useRef, useState } from 'react';
import {
  MATERIAL_MAX_BYTES,
  materialArchiveInputSchema,
  materialChunkListResponseSchema,
  materialOperationResponseSchema,
  materialScopeListResponseSchema,
  materialSourceListResponseSchema,
  materialSourceResponseSchema,
  materialUploadInputSchema,
  materialVersionListResponseSchema,
  type MaterialJob,
  type MaterialSource,
  type MaterialVersion,
} from '@alunza/contracts';
import { apiDownloadSource, asApiError, ApiError } from '@/lib/api';
import { useSession } from '@/components/session-provider';
import {
  Field,
  FormDialog,
  OperationError,
  SelectField,
  useOperation,
} from '@/components/identity-forms';
import { Button } from '@/components/ui/button';
import {
  ConfirmAction,
  LoadState,
  RecordForm,
  Section,
  etagFor,
  instantLabel,
  usePagedResource,
} from './shared';

const jobLabels = {
  UPLOADING: 'Recibiendo archivo',
  QUEUED: 'En espera',
  RUNNING: 'Procesando',
  SUCCEEDED: 'Completado',
  FAILED: 'Fallido',
} as const;
const availabilityLabels = {
  NOT_READY: 'Aún no disponible',
  READY: 'Disponible',
  HIDDEN: 'Oculto para estudiantes',
  ARCHIVED: 'Archivado',
} as const;
const activityLabels = {
  DRAFT: 'Borrador',
  PUBLISHED: 'Publicada',
  CLOSED: 'Cerrada',
} as const;
const processing = (job: MaterialJob | null) =>
  job?.state === 'UPLOADING' ||
  job?.state === 'QUEUED' ||
  job?.state === 'RUNNING';

function DownloadMaterial({
  sourceId,
  version,
}: {
  sourceId: string;
  version: MaterialVersion;
}) {
  const { session, revision } = useSession();
  const controller = useRef<AbortController | null>(null);
  const [transfer, setTransfer] = useState<{
    key: number;
    pending: boolean;
    error: ApiError | null;
  }>({ key: revision, pending: false, error: null });
  const pending = transfer.key === revision && transfer.pending;
  const error = transfer.key === revision ? transfer.error : null;
  useEffect(() => () => controller.current?.abort(), [revision]);
  async function download() {
    if (pending) return;
    const request = new AbortController();
    controller.current = request;
    setTransfer({ key: revision, pending: true, error: null });
    try {
      const content = await apiDownloadSource(
        `/api/v1/sources/${sourceId}/versions/${version.id}/content`,
        { accessToken: session?.access_token, signal: request.signal },
      );
      if (request.signal.aborted) return;
      const url = URL.createObjectURL(content);
      try {
        const link = document.createElement('a');
        link.href = url;
        link.download = Array.from(version.fileName, (character) =>
          character.charCodeAt(0) < 32 ||
          character.charCodeAt(0) === 127 ||
          character === '/' ||
          character === '\\'
            ? '_'
            : character,
        ).join('');
        document.body.append(link);
        link.click();
        link.remove();
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch (cause) {
      if (!request.signal.aborted)
        setTransfer({
          key: revision,
          pending: false,
          error: asApiError(cause),
        });
    } finally {
      if (!request.signal.aborted)
        setTransfer((value) => ({ ...value, pending: false }));
    }
  }
  return (
    <div className="space-y-2">
      <Button
        variant="outline"
        disabled={pending}
        onClick={() => void download()}
      >
        {pending ? 'Descargando…' : `Descargar versión ${version.version}`}
      </Button>
      <OperationError error={error} />
    </div>
  );
}

function UploadMaterial({
  classId,
  activityId,
  source,
  done,
}: {
  classId: string;
  activityId?: string;
  source?: MaterialSource;
  done: () => unknown;
}) {
  const [open, setOpen] = useState(false);
  const [fileError, setFileError] = useState<ApiError | null>(null);
  const [selectedScope, setSelectedScope] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const operation = useOperation();
  const scopes = usePagedResource(
    `/api/v1/classes/${classId}/source-scopes`,
    materialScopeListResponseSchema,
    open && !activityId && !source,
  );
  const label = source ? 'Subir nueva versión' : 'Cargar material';
  return (
    <FormDialog
      title={label}
      description={
        source
          ? 'La nueva versión se procesará antes de sustituir la disponible. Si falla, se conserva el material anterior.'
          : 'PDF con texto, TXT o Markdown de hasta 10 MB (10.000.000 bytes). El material estará disponible al completar su procesamiento.'
      }
      trigger={<Button variant="outline">{label}</Button>}
      open={open}
      onOpenChange={setOpen}
      locked={operation.pending || operation.unresolved}
    >
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          const fields = new FormData(event.currentTarget);
          let body: FormData | undefined;
          if (!operation.unresolved) {
            const file = fields.get('file');
            if (
              !(file instanceof File) ||
              !file.size ||
              file.size > MATERIAL_MAX_BYTES
            ) {
              setFileError(
                new ApiError(
                  422,
                  'VALIDATION_FAILED',
                  'Revisa el archivo antes de cargarlo.',
                  undefined,
                  [
                    {
                      field: 'file',
                      message:
                        'Selecciona un archivo con contenido de hasta 10.000.000 bytes.',
                    },
                  ],
                ),
              );
              return;
            }
            setFileError(null);
            body = new FormData();
            body.append('file', file);
            if (!source) {
              const selectedActivity =
                activityId ?? String(fields.get('activityId') ?? '');
              const metadata = operation.validate(materialUploadInputSchema, {
                title: fields.get('title'),
                ...(selectedActivity ? { activityId: selectedActivity } : {}),
              });
              if (!metadata) return;
              body.append('title', metadata.title);
              if (metadata.activityId)
                body.append('activityId', metadata.activityId);
            }
          }
          void operation
            .run(
              source
                ? `/api/v1/sources/${source.id}/versions`
                : `/api/v1/classes/${classId}/sources`,
              materialOperationResponseSchema,
              {
                method: 'POST',
                body,
                timeoutMs: 45_000,
                ...(source ? { etag: etagFor(source.revision) } : {}),
              },
            )
            .then((result) => {
              if (result) {
                setOpen(false);
                void done();
              }
            });
        }}
      >
        <OperationError
          error={fileError ?? operation.error}
          unresolved={operation.unresolved}
        />
        <fieldset
          disabled={operation.pending || operation.unresolved}
          className="space-y-4"
        >
          {!source ? (
            <Field
              label="Título del material"
              name="title"
              required
              maxLength={160}
              error={operation.error}
            />
          ) : null}
          {!source && !activityId ? (
            <>
              <SelectField
                label="Disponible para"
                name="activityId"
                error={operation.error}
                value={selectedScope?.id ?? ''}
                disabled={scopes.state.status !== 'ready'}
                onChange={(event) => {
                  const scope =
                    scopes.state.status === 'ready'
                      ? scopes.state.result.body.data.find(
                          (item) => item.id === event.target.value,
                        )
                      : undefined;
                  setSelectedScope(
                    scope ? { id: scope.id, title: scope.title } : null,
                  );
                }}
              >
                <option value="">Toda la clase</option>
                {selectedScope &&
                (scopes.state.status !== 'ready' ||
                  !scopes.state.result.body.data.some(
                    (scope) => scope.id === selectedScope.id,
                  )) ? (
                  <option value={selectedScope.id}>
                    {selectedScope.title}
                  </option>
                ) : null}
                {scopes.state.status === 'ready'
                  ? scopes.state.result.body.data.map((scope) => (
                      <option key={scope.id} value={scope.id}>
                        {scope.title} · {activityLabels[scope.state]}
                      </option>
                    ))
                  : null}
              </SelectField>
              <LoadState state={scopes.state} reload={scopes.reload} />
              {scopes.state.status === 'ready'
                ? scopes.pagination(scopes.state.result.body.page)
                : null}
            </>
          ) : null}
          {activityId && !source ? (
            <p className="text-sm">
              Disponible únicamente para esta actividad.
            </p>
          ) : null}
          <Field
            label="Archivo"
            name="file"
            type="file"
            accept=".pdf,.txt,.md,.markdown,application/pdf,text/plain,text/markdown"
            required
            error={fileError ?? operation.error}
          />
        </fieldset>
        <div className="flex flex-wrap gap-3">
          <Button
            type="submit"
            disabled={
              operation.pending ||
              (!source &&
                !activityId &&
                scopes.state.status !== 'ready' &&
                !operation.unresolved)
            }
          >
            {operation.pending
              ? 'Cargando…'
              : operation.unresolved
                ? 'Comprobar carga'
                : 'Cargar y procesar'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={operation.pending || operation.unresolved}
            onClick={() => setOpen(false)}
          >
            Cancelar
          </Button>
        </div>
      </form>
    </FormDialog>
  );
}

function MaterialChunks({
  sourceId,
  versionId,
}: {
  sourceId: string;
  versionId: string;
}) {
  const chunks = usePagedResource(
    `/api/v1/sources/${sourceId}/versions/${versionId}/chunks`,
    materialChunkListResponseSchema,
    true,
    20,
  );
  return (
    <div className="space-y-3" data-cy="material-chunks">
      <LoadState state={chunks.state} reload={chunks.reload} />
      {chunks.state.status === 'ready' ? (
        <>
          {chunks.state.result.body.data.length ? (
            <ul className="space-y-3">
              {chunks.state.result.body.data.map((chunk) => (
                <li
                  key={chunk.id}
                  className="space-y-2 rounded-lg bg-secondary p-3"
                  data-cy="material-chunk"
                >
                  <p className="text-sm font-semibold">
                    Fragmento {chunk.index + 1} · {chunk.tokenCount} tokens
                  </p>
                  <p className="text-sm" data-cy="material-chunk-locator">
                    {chunk.locator}
                  </p>
                  <p
                    className="whitespace-pre-wrap break-words text-sm"
                    data-cy="material-chunk-text"
                  >
                    {chunk.text}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p>Esta versión aún no tiene fragmentos completos disponibles.</p>
          )}
          {chunks.pagination(chunks.state.result.body.page)}
        </>
      ) : null}
    </div>
  );
}

function MaterialVersionEntry({
  source,
  version,
}: {
  source: MaterialSource;
  version: MaterialVersion;
}) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  return (
    <li className="space-y-2 rounded-lg border p-3">
      <p>
        Versión {version.version} · {version.fileName} ·{' '}
        {version.sizeBytes.toLocaleString('es-CL')} bytes
      </p>
      <p className="text-sm">{instantLabel(version.createdAt)}</p>
      {source.state === 'ACTIVE' ? (
        <>
          <div className="flex flex-wrap gap-3">
            <DownloadMaterial sourceId={source.id} version={version} />
            <Button
              variant="outline"
              aria-expanded={expanded}
              aria-controls={contentId}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? 'Ocultar fragmentos' : 'Consultar fragmentos'}
            </Button>
          </div>
          <div id={contentId}>
            {expanded ? (
              <MaterialChunks
                key={source.activeGenerationId}
                sourceId={source.id}
                versionId={version.id}
              />
            ) : null}
          </div>
        </>
      ) : null}
    </li>
  );
}

function MaterialHistory({ source }: { source: MaterialSource }) {
  const versions = usePagedResource(
    `/api/v1/sources/${source.id}/versions`,
    materialVersionListResponseSchema,
    true,
    10,
  );
  return (
    <div className="space-y-3" data-cy="material-history">
      <h4 className="font-semibold">Versiones conservadas</h4>
      <LoadState state={versions.state} reload={versions.reload} />
      {versions.state.status === 'ready' ? (
        <>
          <ul className="space-y-3">
            {versions.state.result.body.data.map((version) => (
              <MaterialVersionEntry
                key={version.id}
                source={source}
                version={version}
              />
            ))}
          </ul>
          {versions.pagination(versions.state.result.body.page)}
        </>
      ) : null}
    </div>
  );
}

function MaterialCard({
  source,
  done,
  manage,
}: {
  source: MaterialSource;
  done: () => unknown;
  manage: boolean;
}) {
  const [history, setHistory] = useState(false);
  const busy = processing(source.latestJob);
  const active = source.state === 'ACTIVE';
  return (
    <article
      data-cy="material-card"
      data-source-id={source.id}
      className="space-y-4 rounded-lg border p-4"
    >
      <div className="space-y-2">
        <h3 className="font-semibold">{source.title}</h3>
        <p data-cy="material-availability">
          {availabilityLabels[source.availability]}
        </p>
        <p className="text-sm">
          {source.activityId
            ? 'Ámbito: una actividad de esta clase'
            : 'Ámbito: toda la clase'}
        </p>
        {source.activeVersion ? (
          <p data-cy="material-active-version" className="text-sm">
            Versión disponible: {source.activeVersion.version} ·{' '}
            {source.chunkCount} fragmentos ·{' '}
            {instantLabel(source.activeVersion.createdAt)}
          </p>
        ) : (
          <p className="text-sm">
            {source.latestJob?.state === 'UPLOADING'
              ? 'La recepción del archivo está pendiente de confirmación. Todavía no hay una versión disponible.'
              : 'El archivo recibido todavía no tiene una versión completa disponible.'}
          </p>
        )}
      </div>
      {manage && source.latestJob ? (
        <div className="space-y-2 rounded-lg bg-secondary p-3" role="status">
          <p data-cy="material-processing" data-job-id={source.latestJob.id}>
            Último procesamiento: {jobLabels[source.latestJob.state]}
          </p>
          {source.latestJob.state === 'FAILED' ? (
            <>
              <p>
                {source.latestJob.errorMessage ??
                  'No se pudo completar el procesamiento. Puedes reintentar si el archivo es válido.'}
              </p>
              {source.activeVersion && active ? (
                <p>
                  La versión {source.activeVersion.version} anterior se conserva
                  disponible según su visibilidad.
                </p>
              ) : null}
            </>
          ) : null}
          {busy ? (
            <p className="text-sm">
              Puedes volver a esta pantalla más tarde; el procesamiento
              continúa.
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-3">
        {source.activeVersion && source.availability === 'READY' ? (
          <DownloadMaterial
            sourceId={source.id}
            version={source.activeVersion}
          />
        ) : null}
        {manage && active && source.permissions.replace && !busy ? (
          <UploadMaterial
            classId={source.classId}
            source={source}
            done={done}
          />
        ) : null}
        {manage &&
        active &&
        !busy &&
        (source.latestJob?.state === 'FAILED'
          ? source.permissions.retry
          : source.permissions.govern && source.activeVersion !== null) ? (
          <ConfirmAction
            label={
              source.latestJob?.state === 'FAILED'
                ? 'Reintentar procesamiento'
                : 'Reindexar material'
            }
            description="Se procesará una nueva generación. La versión disponible se conserva hasta completar el trabajo."
            path={`/api/v1/sources/${source.id}/reindex`}
            schema={materialOperationResponseSchema}
            etag={etagFor(source.revision)}
            body={
              source.latestJob?.state === 'FAILED'
                ? { versionId: source.latestJob.versionId }
                : {}
            }
            onDone={done}
          />
        ) : null}
        {manage && active && source.permissions.govern ? (
          <>
            <ConfirmAction
              label={source.visible ? 'Ocultar material' : 'Mostrar material'}
              description={
                source.visible
                  ? 'Los estudiantes dejarán de acceder al material. Se conservan sus versiones y procesamiento.'
                  : 'La versión completa estará disponible para los estudiantes del ámbito autorizado.'
              }
              path={`/api/v1/sources/${source.id}/visibility`}
              schema={materialSourceResponseSchema}
              method="PATCH"
              etag={etagFor(source.revision)}
              body={{ visible: !source.visible }}
              onDone={done}
            />
            <RecordForm
              title="Archivar material"
              description="El material dejará de recuperarse inmediatamente y una indexación en curso no podrá volver a activarlo. Se conserva su historia."
              path={`/api/v1/sources/${source.id}/archive`}
              inputSchema={materialArchiveInputSchema}
              responseSchema={materialSourceResponseSchema}
              etag={etagFor(source.revision)}
              read={(form) => ({ reason: form.get('reason') })}
              onDone={done}
            >
              {(error) => (
                <Field
                  label="Motivo"
                  name="reason"
                  required
                  maxLength={500}
                  error={error}
                />
              )}
            </RecordForm>
          </>
        ) : null}
        {manage && source.permissions.history ? (
          <Button
            variant="outline"
            aria-expanded={history}
            onClick={() => setHistory((value) => !value)}
          >
            {history ? 'Ocultar versiones' : 'Consultar versiones'}
          </Button>
        ) : null}
      </div>
      {history && source.permissions.history ? (
        <MaterialHistory key={source.latestJob?.versionId} source={source} />
      ) : null}
    </article>
  );
}

export function MaterialsPanel({
  classId,
  activityId,
  canUpload = false,
  manage = false,
}: {
  classId: string;
  activityId?: string;
  canUpload?: boolean;
  manage?: boolean;
}) {
  const { sessionGeneration } = useSession();
  return (
    <MaterialsContent
      key={`${sessionGeneration}:${classId}:${activityId ?? ''}`}
      classId={classId}
      activityId={activityId}
      canUpload={canUpload}
      manage={manage}
    />
  );
}

function MaterialsContent({
  classId,
  activityId,
  canUpload,
  manage,
}: {
  classId: string;
  activityId?: string;
  canUpload: boolean;
  manage: boolean;
}) {
  const materials = usePagedResource(
    `/api/v1/classes/${classId}/sources${activityId ? `?activityId=${encodeURIComponent(activityId)}` : ''}`,
    materialSourceListResponseSchema,
    true,
    10,
  );
  const [pollCycle, setPollCycle] = useState(0);
  const [pollStopped, setPollStopped] = useState(false);
  const jobs =
    materials.state.status === 'ready'
      ? materials.state.result.body.data
          .filter((source) => processing(source.latestJob))
          .map((source) => source.latestJob!.id)
          .sort()
          .join(':')
      : '';
  const refresh = materials.refresh;
  useEffect(() => {
    if (!jobs) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const until = Date.now() + 60_000;
    async function poll() {
      if (cancelled) return;
      if (Date.now() >= until) {
        setPollStopped(true);
        return;
      }
      await refresh();
      if (!cancelled) timer = setTimeout(() => void poll(), 2_000);
    }
    timer = setTimeout(() => void poll(), 2_000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [jobs, refresh, pollCycle]);
  function update() {
    setPollStopped(false);
    setPollCycle((value) => value + 1);
    return refresh();
  }
  return (
    <Section
      title="Materiales"
      action={
        canUpload ? (
          <UploadMaterial
            classId={classId}
            activityId={activityId}
            done={update}
          />
        ) : undefined
      }
    >
      <p className="text-sm">
        {activityId
          ? 'Material de esta actividad y de su clase.'
          : 'Material oficial de la clase, con el alcance indicado en cada fuente.'}
      </p>
      <LoadState state={materials.state} reload={materials.reload} />
      {materials.state.status === 'ready' ? (
        <>
          {materials.state.result.body.data.length ? (
            <div className="space-y-4">
              {materials.state.result.body.data.map((source) => (
                <MaterialCard
                  key={source.id}
                  source={source}
                  done={update}
                  manage={manage}
                />
              ))}
            </div>
          ) : (
            <p>No hay materiales disponibles en este ámbito.</p>
          )}
          {materials.pagination(materials.state.result.body.page)}
          {pollStopped && jobs ? (
            <p role="status">
              El procesamiento continúa. Actualiza para consultar su estado.
            </p>
          ) : null}
          <Button variant="outline" onClick={() => void update()}>
            Actualizar materiales
          </Button>
        </>
      ) : null}
    </Section>
  );
}
