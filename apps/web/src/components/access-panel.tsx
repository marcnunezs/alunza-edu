'use client';

import { useEffect, useRef, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/components/session-provider';
import { RequestError } from '@/components/request-error';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export function AccessPanel() {
  const auth = useSession();
  const router = useRouter();
  const emailInput = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const alert = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (auth.authError) alert.current?.focus();
    else if (auth.closed) emailInput.current?.focus();
  }, [auth.authError, auth.closed]);
  useEffect(() => {
    if (auth.session && auth.identity.status === 'ready')
      router.replace('/inicio');
  }, [auth.session, auth.identity.status, router]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await auth.signIn(
        String(form.get('email') ?? '').trim(),
        String(form.get('password') ?? ''),
      );
    } finally {
      if (passwordInput.current) passwordInput.current.value = '';
    }
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <Card>
        <CardHeader>
          <CardTitle>
            {auth.session ? 'Comprobar acceso' : 'Iniciar sesión'}
          </CardTitle>
          <CardDescription>
            Usa el correo y la contraseña de tu cuenta.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {auth.authError ? (
            <div
              ref={alert}
              tabIndex={-1}
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm"
            >
              {auth.authError}
            </div>
          ) : null}
          {auth.closed ? (
            <p role="status" className="rounded-lg bg-secondary p-4 text-sm">
              La sesión se cerró en este navegador.
            </p>
          ) : null}
          {!auth.initialized ? (
            <div className="space-y-3">
              <p role="status">
                {auth.authError
                  ? 'La sesión no se pudo comprobar.'
                  : 'Recuperando sesión…'}
              </p>
              {auth.authError ? (
                <Button variant="outline" onClick={auth.retryInitialization}>
                  Volver a comprobar
                </Button>
              ) : null}
            </div>
          ) : auth.session ? (
            <div className="space-y-4">
              {auth.identity.status === 'error' ? (
                <>
                  <RequestError error={auth.identity.error} />
                  <Button
                    variant="outline"
                    onClick={() => void auth.refreshIdentity()}
                  >
                    Reintentar acceso
                  </Button>
                </>
              ) : (
                <p role="status">Comprobando tus permisos…</p>
              )}
              <Button
                variant="outline"
                onClick={() => void auth.signOut()}
                disabled={auth.pending}
              >
                Cerrar sesión
              </Button>
            </div>
          ) : auth.logoutFailed ? (
            <Button
              variant="outline"
              onClick={() => void auth.signOut()}
              disabled={auth.pending}
            >
              {auth.pending
                ? 'Cerrando sesión…'
                : 'Reintentar cierre de sesión'}
            </Button>
          ) : (
            <form
              onSubmit={(event) => void signIn(event)}
              className="space-y-5"
              aria-busy={auth.pending}
            >
              <div className="space-y-2">
                <label htmlFor="email" className="text-sm font-semibold">
                  Correo electrónico
                </label>
                <Input
                  ref={emailInput}
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                  disabled={auth.pending}
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="password" className="text-sm font-semibold">
                  Contraseña
                </label>
                <Input
                  ref={passwordInput}
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  disabled={auth.pending}
                />
              </div>
              <Button type="submit" className="w-full" disabled={auth.pending}>
                {auth.pending ? 'Comprobando acceso…' : 'Iniciar sesión'}
              </Button>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Si recibiste una invitación, abre el enlace de tu correo para
                activar el acceso a tu organización.
              </p>
            </form>
          )}
        </CardContent>
      </Card>
      <section
        className="rounded-xl border border-dashed p-6 sm:p-8"
        aria-labelledby="private-access-title"
      >
        <span
          aria-hidden="true"
          className="mb-5 grid size-11 place-items-center rounded-lg bg-secondary text-lg"
        >
          ↗
        </span>
        <h2 id="private-access-title" className="text-lg font-semibold">
          Un espacio con acceso verificado
        </h2>
        <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">
          Tu organización y tu rol determinan las funciones disponibles. Los
          cambios de acceso se comprueban en cada operación.
        </p>
        <p className="mt-5 border-t pt-5 text-xs leading-relaxed text-muted-foreground">
          Una invitación pendiente o un acceso deshabilitado no permite operar
          en esa organización.
        </p>
      </section>
    </div>
  );
}
