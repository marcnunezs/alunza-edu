'use client';

import { useState } from 'react';
import Link from 'next/link';
import { organizationResponseSchema } from '@alunza/contracts';
import { useSession } from '@/components/session-provider';
import { useApiResource } from '@/lib/use-api-resource';
import { RequestError } from '@/components/request-error';
import { roleLabels, SelectField } from '@/components/identity-forms';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';

function OrganizationDetails({ id }: { id: string }) {
  const { state, reload } = useApiResource(
    `/api/v1/organizations/${encodeURIComponent(id)}`,
    organizationResponseSchema,
  );
  if (state.status === 'loading')
    return <p role="status">Consultando organización…</p>;
  if (state.status === 'error')
    return (
      <div className="space-y-3">
        <RequestError error={state.error} />
        <Button variant="outline" onClick={() => void reload()}>
          Reintentar organización
        </Button>
      </div>
    );
  const org = state.result.body.data;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-3 text-sm">
      <dt className="text-muted-foreground">Código</dt>
      <dd>{org.code}</dd>
      <dt className="text-muted-foreground">Zona horaria</dt>
      <dd>{org.timezone}</dd>
      <dt className="text-muted-foreground">Estado</dt>
      <dd>
        {org.state === 'ARCHIVED' ? 'Archivada · Solo lectura' : 'Activa'}
      </dd>
    </dl>
  );
}

export function HomePanel() {
  const { identity, refreshIdentity } = useSession();
  const [selected, setSelected] = useState<string | null>(null);
  if (identity.status !== 'ready') return null;
  const me = identity.data;
  const membership =
    me.memberships.find((item) => item.organizationId === selected) ??
    me.memberships[0];
  return (
    <div className="space-y-7">
      <div>
        <p className="mb-2 text-sm font-semibold text-primary">
          Tu espacio en Alunza
        </p>
        <h1 className="text-3xl font-semibold">Inicio</h1>
        <h2 className="mt-3 text-xl">{me.displayName}</h2>
      </div>
      <div className="grid gap-6 md:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Tu organización</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {membership ? (
              <>
                {me.memberships.length > 1 ? (
                  <SelectField
                    label="Organización"
                    name="organization"
                    value={membership.organizationId}
                    onChange={(event) => setSelected(event.target.value)}
                  >
                    {me.memberships.map((item) => (
                      <option
                        key={item.organizationId}
                        value={item.organizationId}
                      >
                        {item.organizationName}
                        {item.accessMode === 'READ_ONLY' ? ' · Archivada' : ''}
                      </option>
                    ))}
                  </SelectField>
                ) : null}
                <div key={membership.organizationId} className="space-y-5">
                  <h3 className="text-2xl font-semibold">
                    {membership.organizationName}
                  </h3>
                  <dl className="grid grid-cols-[auto_1fr] gap-3 text-sm">
                    <dt className="text-muted-foreground">Tu rol</dt>
                    <dd>{roleLabels[membership.role]}</dd>
                  </dl>
                  <OrganizationDetails id={membership.organizationId} />
                  {membership.accessMode === 'READ_ONLY' ? (
                    <p
                      role="status"
                      className="rounded-lg bg-secondary p-4 text-sm"
                    >
                      Esta organización está archivada. Puedes consultar sus
                      datos institucionales; las operaciones están cerradas.
                    </p>
                  ) : (
                    <p role="status" className="text-sm">
                      Tu acceso está activo como{' '}
                      {roleLabels[membership.role].toLowerCase()}.
                    </p>
                  )}
                  {membership.role === 'ADMIN' ? (
                    <div className="flex flex-wrap gap-3">
                      <Button asChild>
                        <Link href="/administracion/organizaciones">
                          Gestionar organización
                        </Link>
                      </Button>
                      {membership.accessMode === 'OPERATE' ? (
                        <Button asChild variant="outline">
                          <Link
                            href={`/administracion/organizaciones/${membership.organizationId}/usuarios`}
                          >
                            Usuarios y roles
                          </Link>
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                  {membership.accessMode === 'OPERATE' ? (
                    <Button asChild variant="outline">
                      <Link href={`/academia?org=${membership.organizationId}`}>
                        Abrir clases y contenido
                      </Link>
                    </Button>
                  ) : null}
                </div>
              </>
            ) : (
              <p className="text-sm leading-relaxed">
                No tienes una organización activa disponible.{' '}
                {me.canProvisionOrganization
                  ? 'Puedes crear una organización con la autorización que recibiste.'
                  : 'Si recibiste una invitación, usa el enlace de tu correo. Para recuperar un acceso deshabilitado, contacta al administrador.'}
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Acceso vigente</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <p className="text-sm leading-relaxed text-muted-foreground">
              Tu rol se aplica a la organización seleccionada. Las invitaciones
              y los cambios de estado se reflejan al comprobar el acceso.
            </p>
            <Button variant="outline" onClick={() => void refreshIdentity()}>
              Actualizar acceso
            </Button>
            {me.canProvisionOrganization ? (
              <Button asChild>
                <Link href="/administracion/organizaciones">
                  Crear organización
                </Link>
              </Button>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
