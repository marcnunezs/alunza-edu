'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/components/session-provider';
import { RequestError } from '@/components/request-error';
import { Button } from '@/components/ui/button';

export function ProtectedView({ children }: { children: React.ReactNode }) {
  const {
    session,
    initialized,
    identity,
    revision,
    refreshIdentity,
    authError,
    retryInitialization,
    signOut,
  } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (initialized && !session) router.replace('/acceso');
  }, [initialized, session, router]);
  if (!initialized && authError)
    return (
      <div className="space-y-4">
        <p role="alert">{authError}</p>
        <Button variant="outline" onClick={retryInitialization}>
          Volver a comprobar
        </Button>
      </div>
    );
  if (!initialized || !session || identity.status === 'loading')
    return <p role="status">Comprobando tus permisos…</p>;
  if (identity.status === 'error')
    return (
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
  return <div key={revision}>{children}</div>;
}
