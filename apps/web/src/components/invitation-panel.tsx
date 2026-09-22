'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import type { Session } from '@supabase/supabase-js';
import { z } from 'zod';
import {
  invitationAcceptSchema,
  invitationAcceptanceResponseSchema,
  invitationProofSchema,
  invitationResponseSchema,
  meResponseSchema,
} from '@alunza/contracts';
import { apiGet, ApiError } from '@/lib/api';
import { browserAuth, useSession } from '@/components/session-provider';
import {
  Field,
  OperationError,
  useOperation,
} from '@/components/identity-forms';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

const linkSchema = invitationProofSchema.extend({
  invitationId: z.uuid(),
  tokenHash: z.string().min(16).max(1024),
  type: z.enum(['invite', 'magiclink', 'email']),
});
type InvitationLink = z.infer<typeof linkSchema>;

export function InvitationPanel() {
  const auth = useSession();
  const [link, setLink] = useState<InvitationLink | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [verified, setVerified] = useState<Session | null>(null);
  const [authFailure, setAuthFailure] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [renewed, setRenewed] = useState(false);
  const [complete, setComplete] = useState(false);
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const operation = useOperation();
  const captured = useRef(false);
  const alive = useRef(false);
  const alert = useRef<HTMLDivElement>(null);
  const password = useRef<HTMLInputElement>(null);
  const confirmation = useRef<HTMLInputElement>(null);
  const verifiedSession =
    verified && auth.session?.user.id === verified.user.id
      ? auth.session
      : null;

  useEffect(() => {
    alive.current = true;
    if (!captured.current) {
      captured.current = true;
      const values = new URLSearchParams(window.location.hash.slice(1));
      const parsed = linkSchema.safeParse({
        invitationId: values.get('invitationId'),
        token: values.get('invitationToken'),
        generation: Number(values.get('generation')),
        tokenHash: values.get('token_hash'),
        type: values.get('type'),
      });
      // Keep proof only in this view's memory; never persist it or send it as a URL.
      window.history.replaceState(
        window.history.state,
        '',
        '/acceso/invitacion',
      );
      setLink(parsed.success ? parsed.data : null);
      setLoaded(true);
    }
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (authFailure) alert.current?.focus();
  }, [authFailure]);

  async function verify() {
    if (!link || working) return;
    setWorking(true);
    setAuthFailure(null);
    auth.allowAuthSession();
    try {
      const { data, error } = await (
        await browserAuth()
      ).auth.verifyOtp({ token_hash: link.tokenHash, type: link.type });
      if (!alive.current) return;
      if (error || !data.session)
        setAuthFailure(
          'No pudimos verificar este enlace. Si venció la comprobación de correo, solicita una nueva desde aquí.',
        );
      else {
        let setup = link.type === 'invite';
        if (!setup) {
          try {
            await apiGet('/api/v1/me', meResponseSchema, {
              accessToken: data.session.access_token,
            });
          } catch (failure) {
            if (
              failure instanceof ApiError &&
              failure.code === 'ACCOUNT_INACTIVE'
            )
              setup = true;
            else throw failure;
          }
        }
        if (alive.current) {
          setNeedsSetup(setup);
          setVerified(data.session);
        }
      }
    } catch {
      if (alive.current)
        setAuthFailure(
          'No pudimos conectar con el servicio de acceso. Vuelve a intentar.',
        );
    } finally {
      if (alive.current) setWorking(false);
    }
  }

  async function renew() {
    if (!link) return;
    const result = await operation.run(
      `/api/v1/invitations/${link.invitationId}/renew-auth`,
      invitationResponseSchema,
      {
        method: 'POST',
        accessToken: '',
        body: { token: link.token, generation: link.generation },
      },
    );
    if (result) {
      setRenewed(true);
      setAuthFailure(null);
    }
  }

  async function accept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!link || !verifiedSession || working) return;
    const form = new FormData(event.currentTarget);
    const body = operation.unresolved
      ? undefined
      : operation.validate(invitationAcceptSchema, {
          token: link.token,
          generation: link.generation,
          ...(needsSetup
            ? { displayName: String(form.get('displayName') ?? '').trim() }
            : {}),
        });
    if (!body && !operation.unresolved) return;
    setAuthFailure(null);
    if (needsSetup && !passwordSaved && !operation.unresolved) {
      const value = String(form.get('password') ?? '');
      const repeated = String(form.get('passwordConfirmation') ?? '');
      if (value.length < 12 || value !== repeated) {
        setAuthFailure(
          'Usa una contraseña de al menos 12 caracteres y repítela sin cambios.',
        );
        return;
      }
      setWorking(true);
      try {
        const { setInvitationPassword } =
          await import('@/lib/supabase-browser');
        const { error } = await setInvitationPassword(verifiedSession, value);
        if (!alive.current) return;
        if (error) {
          setAuthFailure(
            'No se pudo guardar la contraseña. Revisa los requisitos y vuelve a intentar.',
          );
          return;
        }
        setPasswordSaved(true);
      } catch {
        if (alive.current)
          setAuthFailure(
            'No pudimos confirmar la contraseña. Vuelve a intentar.',
          );
        return;
      } finally {
        if (password.current) password.current.value = '';
        if (confirmation.current) confirmation.current.value = '';
        if (alive.current) setWorking(false);
      }
    }
    const response = await operation.run(
      `/api/v1/invitations/${link.invitationId}/accept`,
      invitationAcceptanceResponseSchema,
      {
        method: 'POST',
        accessToken: verifiedSession.access_token,
        body,
      },
    );
    if (response && alive.current) {
      if (response.body.data.state === 'ACTIVE') {
        setComplete(true);
        setLink(null);
        await auth.refreshIdentity();
      } else
        setAuthFailure(
          'La aceptación no confirmó un acceso activo. Contacta al administrador.',
        );
    }
  }

  const disabled = working || operation.pending || operation.unresolved;
  return (
    <div className="mx-auto max-w-xl">
      <Card>
        <CardHeader>
          <CardTitle>Aceptar invitación</CardTitle>
          <CardDescription>
            Confirma el acceso que recibiste para una organización de Alunza.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {authFailure ? (
            <div
              ref={alert}
              role="alert"
              tabIndex={-1}
              className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm"
            >
              {authFailure}
            </div>
          ) : null}
          <OperationError
            error={operation.error}
            unresolved={operation.unresolved}
          />
          {!loaded ? (
            <p role="status">Comprobando enlace…</p>
          ) : complete ? (
            <div className="space-y-4">
              <p role="status">Tu acceso a la organización está activo.</p>
              <Button asChild>
                <Link href="/inicio">Ir al inicio</Link>
              </Button>
            </div>
          ) : renewed ? (
            <div className="space-y-4">
              <p role="status">
                La nueva comprobación de correo se registró. Revisa tu correo y
                abre el enlace más reciente.
              </p>
              <p className="text-sm text-muted-foreground">
                La invitación conserva su vencimiento original de 72 horas.
              </p>
            </div>
          ) : !link ? (
            <div className="space-y-4">
              <p role="alert">
                El enlace de invitación no está disponible. Abre el enlace
                completo de tu correo o solicita uno nuevo al administrador.
              </p>
              <Button asChild variant="outline">
                <Link href="/acceso">Ir al acceso</Link>
              </Button>
            </div>
          ) : !verifiedSession ? (
            <div className="space-y-4">
              <p className="text-sm leading-relaxed">
                Continuar verificará la cuenta destinataria de este enlace.
                Después podrás confirmar tu incorporación.
              </p>
              <Button
                onClick={() => void verify()}
                disabled={working || operation.pending || operation.unresolved}
              >
                {working ? 'Verificando…' : 'Continuar'}
              </Button>
              {authFailure || operation.unresolved ? (
                <Button
                  variant="outline"
                  onClick={() => void renew()}
                  disabled={working || operation.pending}
                >
                  {operation.pending
                    ? 'Solicitando…'
                    : operation.unresolved
                      ? 'Reintentar solicitud'
                      : 'Renovar comprobación de correo'}
                </Button>
              ) : null}
            </div>
          ) : (
            <form
              className="space-y-4"
              onSubmit={(event) => void accept(event)}
              aria-busy={working || operation.pending}
            >
              <p className="text-sm">
                Cuenta verificada:{' '}
                <span className="break-all font-semibold">
                  {verifiedSession.user.email}
                </span>
              </p>
              <fieldset disabled={disabled} className="space-y-4">
                {needsSetup ? (
                  <>
                    <Field
                      label="Tu nombre"
                      name="displayName"
                      maxLength={120}
                      required
                      error={operation.error}
                      autoComplete="name"
                    />
                    {!passwordSaved ? (
                      <>
                        <Field
                          ref={password}
                          label="Nueva contraseña"
                          name="password"
                          type="password"
                          minLength={12}
                          maxLength={128}
                          autoComplete="new-password"
                          required
                        />
                        <Field
                          ref={confirmation}
                          label="Repetir contraseña"
                          name="passwordConfirmation"
                          type="password"
                          minLength={12}
                          maxLength={128}
                          autoComplete="new-password"
                          required
                        />
                        <p className="text-xs text-muted-foreground">
                          Usa al menos 12 caracteres. Podrás iniciar sesión con
                          esta contraseña.
                        </p>
                      </>
                    ) : (
                      <p className="text-sm">
                        Tu contraseña se guardó. Falta confirmar el acceso a la
                        organización.
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Conservarás los accesos que tengas en otras organizaciones.
                  </p>
                )}
              </fieldset>
              <Button type="submit" disabled={working || operation.pending}>
                {working
                  ? 'Guardando contraseña…'
                  : operation.pending
                    ? 'Confirmando acceso…'
                    : operation.unresolved
                      ? 'Reintentar aceptación'
                      : 'Aceptar invitación'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
