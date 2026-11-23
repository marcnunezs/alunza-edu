'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useSession } from '@/components/session-provider';
import { RequestError } from '@/components/request-error';
import { Button } from '@/components/ui/button';

export function ProtectedView({
  children,
  preserveOnRefresh = false,
}: {
  children: React.ReactNode;
  preserveOnRefresh?: boolean;
}) {
  const {
    session,
    initialized,
    identity,
    revision,
    sessionGeneration,
    refreshIdentity,
    authError,
    retryInitialization,
    signOut,
  } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const context = `${sessionGeneration}:${session?.user.id ?? ''}:${pathname}`;
  const ready = initialized && !!session && identity.status === 'ready';
  const denied =
    !session ||
    (identity.status === 'error' &&
      [401, 403, 404].includes(identity.error.status));
  const [authorizedContext, setAuthorizedContext] = useState<string | null>(
    null,
  );
  if (ready && authorizedContext !== context) setAuthorizedContext(context);
  else if (denied && authorizedContext !== null) setAuthorizedContext(null);
  const retain = preserveOnRefresh && authorizedContext === context && !denied;
  useEffect(() => {
    if (initialized && !session) router.replace('/acceso');
  }, [initialized, session, router]);
  let status: React.ReactNode = null;
  if (!initialized && authError)
    status = (
      <div className="space-y-4">
        <p role="alert">{authError}</p>
        <Button variant="outline" onClick={retryInitialization}>
          Volver a comprobar
        </Button>
      </div>
    );
  else if (!initialized || !session || identity.status === 'loading')
    status = <p role="status">Comprobando tus permisos…</p>;
  else if (identity.status === 'error')
    status = (
      <div className="space-y-4">
        <RequestError error={identity.error} />
        <Button variant="outline" onClick={() => void refreshIdentity()}>
          Reintentar acceso
        </Button>
        {identity.error.status === 401 ? (
          <Button
            onClick={() => {
              void signOut().then(() => router.replace('/acceso'));
            }}
          >
            Volver a iniciar sesión
          </Button>
        ) : (
          <Button variant="ghost" onClick={() => router.push('/acceso')}>
            Volver al acceso
          </Button>
        )}
      </div>
    );
  return (
    <>
      {status}
      {ready || retain ? (
        <div
          key={preserveOnRefresh ? context : revision}
          hidden={!ready}
          inert={!ready}
        >
          {children}
        </div>
      ) : null}
    </>
  );
}
