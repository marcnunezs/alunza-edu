'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import {
  memberListResponseSchema,
  memberResponseSchema,
  memberUpdateSchema,
  invitationCreateSchema,
  invitationListResponseSchema,
  invitationResponseSchema,
  type Member,
  type Invitation,
} from '@alunza/contracts';
import { useSession } from '@/components/session-provider';
import { useApiResource } from '@/lib/use-api-resource';
import { ApiError } from '@/lib/api';
import { RequestError } from '@/components/request-error';
import {
  Field,
  FormDialog,
  OperationError,
  Pagination,
  RoleOptions,
  SelectField,
  formatDate,
  roleLabels,
  stateLabels,
  useOperation,
} from '@/components/identity-forms';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

function InviteMember({
  orgId,
  onSaved,
}: {
  orgId: string;
  onSaved: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const operation = useOperation();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = operation.unresolved
      ? undefined
      : operation.validate(invitationCreateSchema, {
          email: String(form.get('email') ?? '').trim(),
          role: form.get('role'),
        });
    if (!body && !operation.unresolved) return;
    const result = await operation.run(
      `/api/v1/organizations/${orgId}/invitations`,
      invitationResponseSchema,
      { method: 'POST', body },
    );
    if (result) {
      setOpen(false);
      await onSaved();
    }
  }
  return (
    <FormDialog
      title="Invitar usuario"
      description="La invitación permite unirse a esta organización. El enlace vence en 72 horas; la cuenta se activa cuando el destinatario lo acepta."
      trigger={<Button>Invitar usuario</Button>}
      open={open}
      onOpenChange={setOpen}
      locked={operation.pending || operation.unresolved}
    >
      <form
        className="space-y-4"
        onSubmit={(event) => void submit(event)}
        aria-busy={operation.pending}
      >
        <OperationError
          error={operation.error}
          unresolved={operation.unresolved}
        />
        <fieldset
          disabled={operation.pending || operation.unresolved}
          className="space-y-4"
        >
          <Field
            label="Correo electrónico"
            name="email"
            type="email"
            autoComplete="off"
            autoCapitalize="none"
            required
            maxLength={254}
            error={operation.error}
          />
          <SelectField
            label="Rol en la organización"
            name="role"
            defaultValue="STUDENT"
            error={operation.error}
          >
            <RoleOptions />
          </SelectField>
        </fieldset>
        <p className="text-sm text-muted-foreground">
          Si ya usa Alunza, conservará su cuenta y los accesos de sus otras
          organizaciones.
        </p>
        <Button type="submit" disabled={operation.pending}>
          {operation.pending
            ? 'Registrando invitación…'
            : operation.unresolved
              ? 'Reintentar solicitud'
              : 'Enviar invitación'}
        </Button>
      </form>
    </FormDialog>
  );
}

function EditMember({
  orgId,
  member,
  onSaved,
}: {
  orgId: string;
  member: Member;
  onSaved: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const operation = useOperation();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = operation.unresolved
      ? undefined
      : operation.validate(memberUpdateSchema, {
          role: form.get('role'),
          ...(member.state !== 'INVITED' ? { state: form.get('state') } : {}),
        });
    if (!body && !operation.unresolved) return;
    const result = await operation.run(
      `/api/v1/organizations/${orgId}/members/${member.userId}`,
      memberResponseSchema,
      { method: 'PATCH', body, etag: `"${member.revision}"` },
    );
    if (result) {
      setOpen(false);
      await onSaved();
    }
  }
  return (
    <FormDialog
      title="Cambiar acceso"
      description={`Administra el acceso de ${member.displayName} en esta organización. Sus otras organizaciones conservan sus propios permisos.`}
      trigger={<Button variant="outline">Cambiar acceso</Button>}
      open={open}
      onOpenChange={setOpen}
      locked={operation.pending || operation.unresolved}
    >
      <form
        className="space-y-4"
        onSubmit={(event) => void submit(event)}
        aria-busy={operation.pending}
      >
        <OperationError
          error={operation.error}
          unresolved={operation.unresolved}
        />
        <fieldset
          disabled={operation.pending || operation.unresolved}
          className="space-y-4"
        >
          <SelectField
            label="Rol"
            name="role"
            defaultValue={member.role}
            error={operation.error}
          >
            <RoleOptions />
          </SelectField>
          {member.state === 'INVITED' ? (
            <p className="rounded-lg bg-secondary p-4 text-sm">
              El destinatario debe aceptar su invitación para activar este
              acceso.
            </p>
          ) : (
            <SelectField
              label="Estado del acceso"
              name="state"
              defaultValue={member.state}
              error={operation.error}
            >
              <option value="ACTIVE">Activo</option>
              <option value="DISABLED">Deshabilitado</option>
            </SelectField>
          )}
        </fieldset>
        <p className="text-sm text-muted-foreground">
          Siempre debe permanecer un administrador activo.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={operation.pending}>
            {operation.pending
              ? 'Guardando…'
              : operation.unresolved
                ? 'Reintentar solicitud'
                : 'Guardar cambios'}
          </Button>
          {operation.error?.status === 412 ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOpen(false);
                void onSaved();
              }}
            >
              Cargar versión actual
            </Button>
          ) : null}
        </div>
      </form>
    </FormDialog>
  );
}

const deliveryLabels: Record<Invitation['deliveryState'], string> = {
  QUEUED: 'Envío pendiente',
  SENDING: 'Preparando envío',
  SENT: 'Correo enviado',
  UNCERTAIN: 'Entrega sin confirmar',
  FAILED: 'No se pudo enviar',
  CANCELLED: 'Envío cancelado',
};
const invitationLabels: Record<Invitation['state'], string> = {
  INVITED: 'Pendiente de aceptación',
  ACCEPTED: 'Aceptada',
  REVOKED: 'Revocada',
  EXPIRED: 'Vencida',
};

function InvitationAction({
  invitation,
  action,
  orgId,
  onSaved,
}: {
  invitation: Invitation;
  action: 'resend' | 'revoke';
  orgId: string;
  onSaved: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const operation = useOperation();
  const resend = action === 'resend';
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await operation.run(
      `/api/v1/organizations/${orgId}/invitations/${invitation.id}/${action}`,
      invitationResponseSchema,
      { method: 'POST', body: {}, etag: `"${invitation.revision}"` },
    );
    if (result) {
      setOpen(false);
      await onSaved();
    }
  }
  return (
    <FormDialog
      title={resend ? 'Reenviar invitación' : 'Revocar invitación'}
      description={
        resend
          ? `Se enviará un nuevo enlace a ${invitation.email}, válido durante 72 horas. El enlace anterior dejará de activar este acceso.`
          : `La invitación de ${invitation.email} dejará de permitir unirse a esta organización.`
      }
      trigger={
        <Button variant="outline">{resend ? 'Reenviar' : 'Revocar'}</Button>
      }
      open={open}
      onOpenChange={setOpen}
      locked={operation.pending || operation.unresolved}
    >
      <form
        className="space-y-4"
        onSubmit={(event) => void submit(event)}
        aria-busy={operation.pending}
      >
        <OperationError
          error={operation.error}
          unresolved={operation.unresolved}
        />
        <Button type="submit" disabled={operation.pending}>
          {operation.pending
            ? 'Procesando…'
            : operation.unresolved
              ? 'Reintentar solicitud'
              : resend
                ? 'Confirmar reenvío'
                : 'Confirmar revocación'}
        </Button>
        {operation.error?.status === 412 ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setOpen(false);
              void onSaved();
            }}
          >
            Cargar versión actual
          </Button>
        ) : null}
      </form>
    </FormDialog>
  );
}

function InvitationsList({
  orgId,
  readOnly,
}: {
  orgId: string;
  readOnly: boolean;
}) {
  const [cursor, setCursor] = useState<string | null>(null);
  const { state, reload } = useApiResource(
    `/api/v1/organizations/${orgId}/invitations?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    invitationListResponseSchema,
  );
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <CardTitle>Invitaciones</CardTitle>
          <Button variant="outline" onClick={() => void reload()}>
            Actualizar estados
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Enviar el correo y aceptar el acceso son pasos distintos.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {state.status === 'loading' ? (
          <p role="status">Consultando invitaciones…</p>
        ) : state.status === 'error' ? (
          <RequestError error={state.error} />
        ) : (
          <>
            {state.result.body.data.length === 0 ? (
              <p className="text-sm">No hay invitaciones registradas.</p>
            ) : (
              <ul className="divide-y">
                {state.result.body.data.map((invitation) => (
                  <li
                    key={invitation.id}
                    data-cy="invitation-row"
                    data-invitation-id={invitation.id}
                    className="space-y-3 py-5 first:pt-0"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="break-all font-semibold">
                          {invitation.email}
                        </p>
                        <p className="mt-1 text-sm">
                          {roleLabels[invitation.role]} ·{' '}
                          {invitationLabels[invitation.state]}
                        </p>
                      </div>
                      {!readOnly &&
                      (invitation.state === 'INVITED' ||
                        invitation.state === 'EXPIRED') ? (
                        <div className="flex flex-wrap gap-2">
                          <InvitationAction
                            invitation={invitation}
                            action="resend"
                            orgId={orgId}
                            onSaved={reload}
                          />
                          <InvitationAction
                            invitation={invitation}
                            action="revoke"
                            orgId={orgId}
                            onSaved={reload}
                          />
                        </div>
                      ) : null}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {deliveryLabels[invitation.deliveryState]} · Vence:{' '}
                      {formatDate(invitation.expiresAt)}
                    </p>
                    {!readOnly &&
                    (invitation.deliveryState === 'FAILED' ||
                      invitation.deliveryState === 'UNCERTAIN') ? (
                      <p role="status" className="text-sm">
                        La entrega no está confirmada. Comprueba el estado antes
                        de reenviar; el acceso todavía requiere aceptación.
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            <Pagination
              cursor={cursor}
              hasMore={state.result.body.page.hasMore}
              onFirst={() => setCursor(null)}
              onNext={() => setCursor(state.result.body.page.nextCursor)}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function OrganizationMembers({
  orgId,
  name,
  readOnly,
}: {
  orgId: string;
  name: string;
  readOnly: boolean;
}) {
  const { identity, refreshIdentity } = useSession();
  const [filters, setFilters] = useState({ q: '', role: '', state: '' });
  const [cursor, setCursor] = useState<string | null>(null);
  const [invitationRevision, setInvitationRevision] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const query = new URLSearchParams({ limit: '20' });
  if (filters.q) query.set('search', filters.q);
  if (filters.role) query.set('role', filters.role);
  if (filters.state) query.set('state', filters.state);
  if (cursor) query.set('cursor', cursor);
  const { state, reload } = useApiResource(
    `/api/v1/organizations/${orgId}/members?${query}`,
    memberListResponseSchema,
  );
  async function invited() {
    setMessage('La invitación se registró. Consulta su estado de envío.');
    setInvitationRevision((previous) => previous + 1);
    await reload();
  }
  async function updated(member: Member) {
    setMessage('El acceso se actualizó.');
    await reload();
    if (identity.status === 'ready' && member.userId === identity.data.id)
      await refreshIdentity();
  }
  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setCursor(null);
    setFilters({
      q: String(form.get('q') ?? '').trim(),
      role: String(form.get('role') ?? ''),
      state: String(form.get('state') ?? ''),
    });
  }
  return (
    <div className="space-y-6">
      <Link
        className="text-sm font-semibold underline underline-offset-4"
        href="/administracion/organizaciones"
      >
        Volver a organizaciones
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">Usuarios y roles</h1>
          <p className="mt-3 text-muted-foreground">{name}</p>
        </div>
        {!readOnly ? <InviteMember orgId={orgId} onSaved={invited} /> : null}
      </div>
      {readOnly ? (
        <p className="rounded-lg bg-secondary p-4 text-sm">
          Organización archivada · Solo lectura. Puedes consultar sus usuarios e
          invitaciones; los cambios de acceso y los envíos están bloqueados.
        </p>
      ) : null}
      {message ? (
        <p role="status" className="rounded-lg bg-secondary p-4 text-sm">
          {message}
        </p>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>Accesos a la organización</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <form
            onSubmit={filter}
            className="grid items-end gap-4 sm:grid-cols-2 lg:grid-cols-[1.5fr_1fr_1fr_auto]"
          >
            <Field
              label="Buscar por nombre o correo"
              name="q"
              maxLength={120}
            />
            <SelectField label="Rol" name="role" defaultValue="">
              <option value="">Todos los roles</option>
              <RoleOptions />
            </SelectField>
            <SelectField label="Estado" name="state" defaultValue="">
              <option value="">Todos los estados</option>
              {Object.entries(stateLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </SelectField>
            <Button variant="outline" type="submit">
              Filtrar
            </Button>
          </form>
          {state.status === 'loading' ? (
            <p role="status">Cargando usuarios…</p>
          ) : state.status === 'error' ? (
            <div className="space-y-3">
              <RequestError error={state.error} />
              <Button variant="outline" onClick={() => void reload()}>
                Reintentar usuarios
              </Button>
            </div>
          ) : (
            <>
              {state.result.body.data.length === 0 ? (
                <p className="py-6 text-sm">
                  No hay usuarios que coincidan con los filtros.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[600px] text-left text-sm">
                    <caption className="sr-only">
                      Usuarios y permisos de {name}
                    </caption>
                    <thead className="border-b">
                      <tr>
                        <th scope="col" className="p-3 pl-0">
                          Usuario
                        </th>
                        <th scope="col" className="p-3">
                          Rol
                        </th>
                        <th scope="col" className="p-3">
                          Estado
                        </th>
                        {!readOnly ? (
                          <th scope="col" className="p-3">
                            Acciones
                          </th>
                        ) : null}
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {state.result.body.data.map((member) => (
                        <tr
                          key={member.userId}
                          data-cy="member-row"
                          data-user-id={member.userId}
                        >
                          <th scope="row" className="py-4 pr-3 font-normal">
                            <span className="font-semibold">
                              {member.displayName}
                            </span>
                            <span className="mt-1 block text-xs text-muted-foreground">
                              {member.email}
                            </span>
                          </th>
                          <td className="p-3">{roleLabels[member.role]}</td>
                          <td className="p-3">{stateLabels[member.state]}</td>
                          {!readOnly ? (
                            <td className="p-3">
                              {member.state === 'INVITED' ? (
                                <span className="text-xs text-muted-foreground">
                                  Aceptación pendiente
                                </span>
                              ) : (
                                <EditMember
                                  orgId={orgId}
                                  member={member}
                                  onSaved={() => updated(member)}
                                />
                              )}
                            </td>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <Pagination
                cursor={cursor}
                hasMore={state.result.body.page.hasMore}
                onFirst={() => setCursor(null)}
                onNext={() => setCursor(state.result.body.page.nextCursor)}
              />
            </>
          )}
        </CardContent>
      </Card>
      <InvitationsList
        key={invitationRevision}
        orgId={orgId}
        readOnly={readOnly}
      />
    </div>
  );
}

export function MembersPanel({ orgId }: { orgId: string }) {
  const { identity } = useSession();
  if (identity.status !== 'ready') return null;
  const membership = identity.data.memberships.find(
    (item) => item.organizationId === orgId && item.role === 'ADMIN',
  );
  if (!membership)
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
  return (
    <OrganizationMembers
      orgId={orgId}
      name={membership.organizationName}
      readOnly={membership.accessMode === 'READ_ONLY'}
    />
  );
}
