'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import {
  organizationCreateSchema,
  organizationUpdateSchema,
  organizationArchiveSchema,
  organizationResponseSchema,
  organizationListResponseSchema,
  type Organization,
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
  SelectField,
  formatDate,
  useOperation,
} from '@/components/identity-forms';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

function CreateOrganization({
  grants,
  onSaved,
}: {
  grants: { id: string }[];
  onSaved: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const operation = useOperation();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = operation.unresolved
      ? undefined
      : operation.validate(organizationCreateSchema, {
          grantId: form.get('grantId'),
          code: form.get('code'),
          name: form.get('name'),
        });
    if (!body && !operation.unresolved) return;
    const result = await operation.run(
      '/api/v1/organizations',
      organizationResponseSchema,
      { method: 'POST', body },
    );
    if (result) {
      setOpen(false);
      await onSaved();
    }
  }
  return (
    <FormDialog
      title="Crear organización"
      description="La autorización recibida permite crear una organización. Al confirmar, serás su primer administrador."
      trigger={<Button>Crear organización</Button>}
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
          {grants.length === 1 ? (
            <input type="hidden" name="grantId" value={grants[0]?.id} />
          ) : (
            <SelectField
              label="Autorización disponible"
              name="grantId"
              required
            >
              {grants.map((grant, index) => (
                <option key={grant.id} value={grant.id}>
                  Autorización {index + 1}
                </option>
              ))}
            </SelectField>
          )}
          <Field
            label="Nombre"
            name="name"
            maxLength={160}
            required
            error={operation.error}
            autoComplete="organization"
          />
          <Field
            label="Código"
            name="code"
            maxLength={40}
            required
            error={operation.error}
            autoComplete="off"
          />
        </fieldset>
        <Button type="submit" disabled={operation.pending}>
          {operation.pending
            ? 'Creando…'
            : operation.unresolved
              ? 'Reintentar solicitud'
              : 'Crear organización'}
        </Button>
      </form>
    </FormDialog>
  );
}

function EditOrganization({
  organization,
  onSaved,
}: {
  organization: Organization;
  onSaved: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const operation = useOperation();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = operation.unresolved
      ? undefined
      : operation.validate(organizationUpdateSchema, {
          code: form.get('code'),
          name: form.get('name'),
        });
    if (!body && !operation.unresolved) return;
    const result = await operation.run(
      `/api/v1/organizations/${organization.id}`,
      organizationResponseSchema,
      { method: 'PATCH', body, etag: `"${organization.revision}"` },
    );
    if (result) {
      setOpen(false);
      await onSaved();
    }
  }
  return (
    <FormDialog
      title="Editar organización"
      description="Actualiza los datos institucionales. Los cambios conservan su historial."
      trigger={<Button variant="outline">Editar</Button>}
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
            label="Nombre"
            name="name"
            defaultValue={organization.name}
            maxLength={160}
            required
            error={operation.error}
          />
          <Field
            label="Código"
            name="code"
            defaultValue={organization.code}
            maxLength={40}
            required
            error={operation.error}
          />
        </fieldset>
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

function ArchiveOrganization({
  organization,
  onSaved,
}: {
  organization: Organization;
  onSaved: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const operation = useOperation();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = operation.unresolved
      ? undefined
      : operation.validate(organizationArchiveSchema, {
          reason: form.get('reason'),
        });
    if (!body && !operation.unresolved) return;
    const result = await operation.run(
      `/api/v1/organizations/${organization.id}/archive`,
      organizationResponseSchema,
      { method: 'POST', body, etag: `"${organization.revision}"` },
    );
    if (result) {
      setOpen(false);
      await onSaved();
    }
  }
  return (
    <FormDialog
      title="Archivar organización"
      description="La organización conservará sus referencias y quedará en solo lectura para ti. Antes deben resolverse los otros accesos activos y las invitaciones pendientes."
      trigger={<Button variant="ghost">Archivar</Button>}
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
        <fieldset disabled={operation.pending || operation.unresolved}>
          <Field
            label="Motivo de archivo"
            name="reason"
            required
            maxLength={500}
            error={operation.error}
          />
        </fieldset>
        <Button type="submit" disabled={operation.pending}>
          {operation.pending
            ? 'Archivando…'
            : operation.unresolved
              ? 'Reintentar solicitud'
              : 'Confirmar archivo'}
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

function OrganizationList() {
  const { identity, refreshIdentity } = useSession();
  const [cursor, setCursor] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const { state, reload } = useApiResource(
    `/api/v1/organizations?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    organizationListResponseSchema,
  );
  if (identity.status !== 'ready') return null;
  const me = identity.data;
  async function saved() {
    setMessage('Los cambios se guardaron.');
    await reload();
  }
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">Organizaciones</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Instituciones sobre las que tienes permiso de administración.
          </p>
        </div>
        {me.canProvisionOrganization && me.provisioningGrants.length > 0 ? (
          <CreateOrganization
            grants={me.provisioningGrants}
            onSaved={refreshIdentity}
          />
        ) : null}
      </div>
      {message ? (
        <p role="status" className="rounded-lg bg-secondary p-4 text-sm">
          {message}
        </p>
      ) : null}
      {state.status === 'loading' ? (
        <p role="status">Cargando organizaciones…</p>
      ) : state.status === 'error' ? (
        <div className="space-y-3">
          <RequestError error={state.error} />
          <Button variant="outline" onClick={() => void reload()}>
            Reintentar organizaciones
          </Button>
        </div>
      ) : (
        <>
          {state.result.body.data.length === 0 ? (
            <Card>
              <CardContent className="p-6">
                <p>No hay organizaciones disponibles para administrar.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-5 md:grid-cols-2">
              {state.result.body.data.map((organization) => (
                <Card
                  key={organization.id}
                  data-cy="organization-card"
                  data-organization-id={organization.id}
                >
                  <CardHeader>
                    <CardTitle>{organization.name}</CardTitle>
                    <p className="text-sm text-muted-foreground">
                      {organization.code}
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="inline-flex rounded-full bg-secondary px-3 py-1 text-xs font-semibold">
                      {organization.state === 'ARCHIVED'
                        ? 'Archivada · Solo lectura'
                        : 'Activa'}
                    </p>
                    {organization.archivedAt ? (
                      <p className="text-sm">
                        Archivada el {formatDate(organization.archivedAt)}.
                      </p>
                    ) : null}
                    <p className="text-sm text-muted-foreground">
                      {organization.timezone}
                    </p>
                    {organization.state === 'ACTIVE' ? (
                      <div className="flex flex-wrap gap-2">
                        <Button asChild>
                          <Link
                            href={`/administracion/organizaciones/${organization.id}/usuarios`}
                          >
                            Usuarios y roles
                          </Link>
                        </Button>
                        <EditOrganization
                          organization={organization}
                          onSaved={saved}
                        />
                        <ArchiveOrganization
                          organization={organization}
                          onSaved={async () => {
                            await refreshIdentity();
                          }}
                        />
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <p className="text-sm">
                          Se conservan los datos institucionales. Las
                          operaciones de esta organización están cerradas.
                        </p>
                        <Button asChild variant="outline">
                          <Link
                            href={`/administracion/organizaciones/${organization.id}/usuarios`}
                          >
                            Consultar usuarios e invitaciones
                          </Link>
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
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
    </div>
  );
}

export function OrganizationsPanel() {
  const { identity } = useSession();
  if (identity.status !== 'ready') return null;
  if (
    !identity.data.canProvisionOrganization &&
    !identity.data.memberships.some((membership) => membership.role === 'ADMIN')
  )
    return (
      <RequestError
        error={
          new ApiError(
            403,
            'FORBIDDEN',
            'No tienes permiso para administrar organizaciones.',
          )
        }
      />
    );
  return <OrganizationList />;
}
