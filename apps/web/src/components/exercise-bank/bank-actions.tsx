'use client';

import { useEffect, useState, type FormEvent } from 'react';
import {
  academicArchiveSchema,
  exerciseBankDetailResponseSchema,
  exerciseBankGovernanceInputSchema,
  exerciseResponseSchema,
  exerciseVersionResponseSchema,
  memberListResponseSchema,
  type ExerciseBankEntry,
  type Member,
} from '@alunza/contracts';
import {
  Field,
  FormDialog,
  OperationError,
  SelectField,
  useOperation,
} from '@/components/identity-forms';
import { ExerciseFormBody } from '@/components/academic/exercise-panel';
import { etagFor, LoadState } from '@/components/academic/shared';
import { useSession } from '@/components/session-provider';
import { Button } from '@/components/ui/button';
import { apiRequest, asApiError, type ApiError } from '@/lib/api';
import {
  BankConcepts,
  BankUseCounts,
  bankQuery,
  useBankResource,
  visibilityLabels,
  type AccessDenied,
} from './bank-shared';

type ActionProps = {
  detail: ExerciseBankEntry;
  onDenied: AccessDenied;
  onSaved: (notice: string) => Promise<void>;
};

function useDeniedOperation(error: ApiError | null, onDenied: AccessDenied) {
  useEffect(() => {
    if (error && [401, 403, 404].includes(error.status)) onDenied(error);
  }, [error, onDenied]);
}

function Context({ detail }: { detail: ExerciseBankEntry }) {
  return (
    <div className="space-y-3 rounded-lg bg-secondary p-3 text-sm">
      <p className="break-words font-semibold">{detail.currentVersion.title}</p>
      <p>Propietario actual: {detail.owner.displayName}.</p>
      <p>
        Visibilidad actual: {visibilityLabels[detail.visibility]} · Versión{' '}
        {detail.currentVersion.version}.
      </p>
      <BankConcepts concepts={detail.currentVersion.concepts} />
      <BankUseCounts value={detail.useCounts} />
    </div>
  );
}

function OwnerSelect({
  detail,
  selected,
  onSelect,
  onDenied,
  error,
}: {
  detail: ExerciseBankEntry;
  selected: { id: string; displayName: string };
  onSelect: (member: { id: string; displayName: string }) => void;
  onDenied: AccessDenied;
  error: ApiError | null;
}) {
  const [cursor, setCursor] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const resource = useBankResource(
    `/api/v1/organizations/${detail.organizationId}/members?${bankQuery({ state: 'ACTIVE', search: query, cursor, limit: 100 })}`,
    memberListResponseSchema,
    onDenied,
  );
  const result =
    resource.state.status === 'ready' ? resource.state.result.body : null;
  const members =
    result?.data.filter(
      (member: Member) =>
        member.accountState === 'ACTIVE' &&
        ['ADMIN', 'TEACHER'].includes(member.role),
    ) ?? [];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <Field
            label="Buscar propietario"
            name="ownerSearch"
            value={search}
            maxLength={160}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setCursor(null);
            setQuery(search.trim());
          }}
        >
          Buscar
        </Button>
      </div>
      <LoadState state={resource.state} reload={resource.reload} />
      <SelectField
        label="Propietario"
        name="ownerId"
        data-cy="bank-owner"
        error={error}
        value={selected.id}
        onChange={(event) => {
          const owner = members.find(
            (member) => member.userId === event.target.value,
          );
          if (owner)
            onSelect({ id: owner.userId, displayName: owner.displayName });
          else if (event.target.value === detail.owner.id)
            onSelect(detail.owner);
        }}
      >
        {!members.some((member) => member.userId === selected.id) ? (
          <option value={selected.id}>
            {selected.displayName} · seleccionado
          </option>
        ) : null}
        {detail.owner.id !== selected.id &&
        !members.some((member) => member.userId === detail.owner.id) ? (
          <option value={detail.owner.id}>
            {detail.owner.displayName} · actual
          </option>
        ) : null}
        {members.map((member) => (
          <option key={member.userId} value={member.userId}>
            {member.displayName} ·{' '}
            {member.role === 'ADMIN' ? 'Administrador' : 'Profesor'}
          </option>
        ))}
      </SelectField>
      {result ? (
        <div className="flex flex-wrap gap-3">
          {cursor ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => setCursor(null)}
            >
              Primera página de propietarios
            </Button>
          ) : null}
          {result.page.hasMore ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => setCursor(result.page.nextCursor)}
            >
              Siguiente página de propietarios
            </Button>
          ) : null}
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Solo administradores y profesores activos de esta organización pueden
        recibir la propiedad. La asignación se comprueba de nuevo al confirmar.
      </p>
    </div>
  );
}

function GovernanceForm({
  detail,
  onDenied,
  onSaved,
  onClose,
  onLock,
}: ActionProps & { onClose: () => void; onLock: (locked: boolean) => void }) {
  const operation = useOperation();
  const { session } = useSession();
  const [expected, setExpected] = useState(detail);
  const [owner, setOwner] = useState(detail.owner);
  const [visibility, setVisibility] = useState(detail.visibility);
  const [reviewing, setReviewing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<ApiError | null>(null);
  const [refreshed, setRefreshed] = useState(false);
  const locked = operation.pending || operation.unresolved || refreshing;
  const conflict = operation.error?.status === 412;
  useEffect(() => onLock(locked), [locked, onLock]);
  useDeniedOperation(refreshError ?? operation.error, onDenied);
  const payload = {
    ...(owner.id !== expected.owner.id ? { ownerId: owner.id } : {}),
    ...(visibility !== expected.visibility ? { visibility } : {}),
  };
  async function refresh() {
    setRefreshing(true);
    setRefreshError(null);
    try {
      const current = await apiRequest(
        `/api/v1/exercises/${detail.id}/governance`,
        exerciseBankDetailResponseSchema,
        { accessToken: session?.access_token },
      );
      setExpected(current.body.data);
      setReviewing(false);
      setRefreshed(true);
      operation.clear();
    } catch (error) {
      setRefreshError(asApiError(error));
    } finally {
      setRefreshing(false);
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reviewing && !operation.unresolved) {
      if (operation.validate(exerciseBankGovernanceInputSchema, payload))
        setReviewing(true);
      return;
    }
    const result = await operation.run(
      `/api/v1/exercises/${detail.id}/governance`,
      exerciseBankDetailResponseSchema,
      {
        method: 'PATCH',
        body: payload,
        etag: etagFor(expected.revision),
      },
    );
    if (result) {
      onClose();
      await onSaved('Propiedad y visibilidad confirmadas.');
    }
  }
  return (
    <form
      data-cy="bank-governance-form"
      className="space-y-5"
      onSubmit={(event) => void submit(event)}
      aria-busy={operation.pending || refreshing}
    >
      <OperationError
        error={refreshError ?? operation.error}
        unresolved={operation.unresolved}
      />
      <Context detail={expected} />
      {refreshed ? (
        <p role="status">
          Datos actuales cargados. Conservamos tu selección; revisa los cambios
          antes de confirmar.
        </p>
      ) : null}
      {expected.state === 'ARCHIVED' ? (
        <p role="alert">
          El ejercicio fue archivado y ahora solo admite consultas.
        </p>
      ) : null}
      <fieldset
        disabled={locked || reviewing || expected.state === 'ARCHIVED'}
        className="space-y-4"
      >
        <OwnerSelect
          detail={expected}
          selected={owner}
          onSelect={setOwner}
          onDenied={onDenied}
          error={operation.error}
        />
        <SelectField
          label="Visibilidad"
          name="visibility"
          data-cy="bank-visibility"
          value={visibility}
          error={operation.error}
          onChange={(event) =>
            setVisibility(event.target.value as typeof visibility)
          }
        >
          <option value="PRIVATE">Privado</option>
          <option value="ORGANIZATION">Organización</option>
        </SelectField>
      </fieldset>
      {reviewing ? (
        <div data-cy="bank-governance-confirmation" className="space-y-2">
          <p>
            Propietario elegido: <strong>{owner.displayName}</strong>.
          </p>
          <p>
            Visibilidad elegida: <strong>{visibilityLabels[visibility]}</strong>
            .
          </p>
          <p className="text-sm">
            La propiedad determina quién puede editar como autor. La visibilidad
            se aplica a nuevas selecciones del banco dentro de esta
            organización. Las actividades y los intentos anteriores conservan
            sus versiones.
          </p>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button
          type="submit"
          data-cy={
            reviewing ? 'bank-governance-confirm' : 'bank-governance-review'
          }
          disabled={
            operation.pending ||
            refreshing ||
            conflict ||
            expected.state === 'ARCHIVED' ||
            (!reviewing && Object.keys(payload).length === 0)
          }
        >
          {operation.pending
            ? 'Guardando…'
            : operation.unresolved
              ? 'Comprobar solicitud'
              : reviewing
                ? 'Confirmar cambios'
                : 'Revisar cambios'}
        </Button>
        <Button
          type="button"
          variant="outline"
          data-cy="bank-governance-cancel"
          disabled={locked}
          onClick={onClose}
        >
          Cancelar
        </Button>
        {reviewing && !locked ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => setReviewing(false)}
          >
            Volver al formulario
          </Button>
        ) : null}
        {conflict ? (
          <Button
            type="button"
            variant="outline"
            disabled={locked}
            onClick={() => void refresh()}
          >
            Cargar datos actuales
          </Button>
        ) : null}
      </div>
    </form>
  );
}

function GovernExercise(props: ActionProps) {
  const [open, setOpen] = useState(false);
  const [locked, setLocked] = useState(false);
  return (
    <FormDialog
      title="Cambiar propiedad y visibilidad"
      description="Revisa el destino y el alcance antes de confirmar. Cancelar conserva el estado del ejercicio."
      trigger={
        <Button variant="outline" data-cy="bank-governance-open">
          Cambiar propiedad y visibilidad
        </Button>
      }
      open={open}
      onOpenChange={setOpen}
      locked={locked}
    >
      {open ? (
        <GovernanceForm
          {...props}
          onClose={() => {
            setOpen(false);
            setLocked(false);
          }}
          onLock={setLocked}
        />
      ) : null}
    </FormDialog>
  );
}

function ArchiveExercise({ detail, onDenied, onSaved }: ActionProps) {
  const [open, setOpen] = useState(false);
  const operation = useOperation();
  const [expected, setExpected] = useState(detail);
  const [refreshError, setRefreshError] = useState<ApiError | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshed, setRefreshed] = useState(false);
  const { session } = useSession();
  useDeniedOperation(refreshError ?? operation.error, onDenied);
  const conflict = operation.error?.status === 412;
  const locked = operation.pending || operation.unresolved || refreshing;
  async function refresh() {
    setRefreshing(true);
    setRefreshError(null);
    try {
      const current = await apiRequest(
        `/api/v1/exercises/${detail.id}/governance`,
        exerciseBankDetailResponseSchema,
        { accessToken: session?.access_token },
      );
      setExpected(current.body.data);
      setRefreshed(true);
      operation.clear();
    } catch (error) {
      setRefreshError(asApiError(error));
    } finally {
      setRefreshing(false);
    }
  }
  return (
    <FormDialog
      title="Archivar ejercicio"
      description="Impedirá nuevas asignaciones y versiones. Las actividades publicadas mantienen su contenido y disponibilidad; se conservan las versiones, usos e intentos anteriores."
      trigger={
        <Button variant="outline" data-cy="bank-archive-review">
          Archivar ejercicio
        </Button>
      }
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setExpected(detail);
          setRefreshError(null);
          setRefreshed(false);
          operation.clear();
        }
      }}
      locked={locked}
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          const body = operation.unresolved
            ? undefined
            : operation.validate(academicArchiveSchema, {
                reason: new FormData(event.currentTarget).get('reason'),
              });
          if (!body && !operation.unresolved) return;
          void operation
            .run(
              `/api/v1/exercises/${detail.id}/archive`,
              exerciseResponseSchema,
              { method: 'POST', body, etag: etagFor(expected.revision) },
            )
            .then(async (result) => {
              if (result) {
                setOpen(false);
                await onSaved(
                  'Ejercicio archivado. Sus versiones y usos se conservan.',
                );
              }
            });
        }}
      >
        <OperationError
          error={refreshError ?? operation.error}
          unresolved={operation.unresolved}
        />
        <Context detail={expected} />
        {refreshed ? (
          <p role="status">
            Datos actuales cargados. Conservamos el motivo; revisa el estado y
            los usos antes de confirmar.
          </p>
        ) : null}
        {expected.state === 'ARCHIVED' ? (
          <p role="status">
            El ejercicio ya está archivado. Sus versiones y usos se conservan.
          </p>
        ) : null}
        <Field
          label="Motivo del archivo"
          name="reason"
          required
          maxLength={500}
          disabled={locked || expected.state === 'ARCHIVED'}
          error={operation.error}
        />
        {conflict ? (
          <p role="alert">
            Los datos cambiaron. Carga el estado actual para revisar los usos
            antes de archivar.
          </p>
        ) : null}
        <div className="flex flex-wrap gap-3">
          <Button
            type="submit"
            data-cy="bank-archive-confirm"
            disabled={
              operation.pending ||
              refreshing ||
              conflict ||
              expected.state === 'ARCHIVED'
            }
          >
            {operation.pending
              ? 'Archivando…'
              : operation.unresolved
                ? 'Comprobar solicitud'
                : 'Confirmar archivo'}
          </Button>
          <Button
            type="button"
            variant="outline"
            data-cy="bank-archive-cancel"
            disabled={locked}
            onClick={() => setOpen(false)}
          >
            Cancelar
          </Button>
          {conflict ? (
            <Button
              type="button"
              variant="outline"
              disabled={locked}
              onClick={() => void refresh()}
            >
              Cargar datos actuales
            </Button>
          ) : null}
        </div>
      </form>
    </FormDialog>
  );
}

function VersionForm({
  detail,
  onDenied,
  onSaved,
  onClose,
  onLock,
}: ActionProps & {
  onClose: () => void;
  onLock: (locked: boolean) => void;
}) {
  const [expected, setExpected] = useState(detail);
  const [refreshError, setRefreshError] = useState<ApiError | null>(null);
  const { session } = useSession();
  const resource = useBankResource(
    `/api/v1/exercises/${detail.id}/governance/content`,
    exerciseVersionResponseSchema,
    onDenied,
  );
  useDeniedOperation(refreshError, onDenied);
  const version =
    resource.state.status === 'ready' ? resource.state.result.body.data : null;
  return (
    <div className="space-y-4">
      <Context detail={expected} />
      <OperationError error={refreshError} />
      <LoadState state={resource.state} reload={resource.reload} />
      {version ? (
        <ExerciseFormBody
          orgId={detail.organizationId}
          exercise={{
            id: detail.id,
            organizationId: detail.organizationId,
            ownerId: expected.owner.id,
            revision: expected.revision,
            currentVersionId: expected.currentVersion.id,
            state: expected.state,
            visibility: expected.visibility,
            title: expected.currentVersion.title,
            difficulty: expected.currentVersion.difficulty,
          }}
          version={version}
          onBusy={onLock}
          onDenied={onDenied}
          onCancel={onClose}
          onRefresh={async () => {
            try {
              const current = await apiRequest(
                `/api/v1/exercises/${detail.id}/governance`,
                exerciseBankDetailResponseSchema,
                { accessToken: session?.access_token },
              );
              setExpected(current.body.data);
              setRefreshError(null);
              return true;
            } catch (error) {
              setRefreshError(asApiError(error));
              return false;
            }
          }}
          done={() => {
            onClose();
            void onSaved(
              'Nueva versión guardada. Las referencias anteriores se conservan.',
            );
          }}
        />
      ) : null}
    </div>
  );
}

function VersionExercise(props: ActionProps) {
  const [open, setOpen] = useState(false);
  const [locked, setLocked] = useState(false);
  return (
    <FormDialog
      title="Crear nueva versión"
      description="Completa una nueva definición. Las actividades publicadas y los intentos conservan exactamente la versión, pruebas y conceptos anteriores."
      trigger={<Button data-cy="bank-version-open">Crear nueva versión</Button>}
      open={open}
      onOpenChange={setOpen}
      locked={locked}
    >
      {open ? (
        <VersionForm
          {...props}
          onLock={setLocked}
          onClose={() => {
            setOpen(false);
            setLocked(false);
          }}
        />
      ) : null}
    </FormDialog>
  );
}

export function BankActions(props: ActionProps) {
  return (
    <section aria-label="Gobierno del ejercicio" className="space-y-3">
      <h3 className="text-lg font-semibold">Gobernar ejercicio</h3>
      <div className="flex flex-wrap gap-3">
        <GovernExercise {...props} />
        <VersionExercise {...props} />
        <ArchiveExercise {...props} />
      </div>
    </section>
  );
}
