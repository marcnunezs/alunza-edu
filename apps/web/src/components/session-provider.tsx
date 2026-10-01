'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { usePathname } from 'next/navigation';
import type { Session, Subscription } from '@supabase/supabase-js';
import { meResponseSchema, type Me } from '@alunza/contracts';
import { apiGet, asApiError, type ApiError } from '@/lib/api';
import { clearDrafts } from '@/lib/academic-local';

type Identity =
  | { status: 'loading'; key: string }
  | { status: 'ready'; key: string; data: Me }
  | { status: 'error'; key: string; error: ApiError };

type SessionContextValue = {
  session: Session | null;
  initialized: boolean;
  revision: number;
  identity: Identity;
  authError: string | null;
  closed: boolean;
  logoutFailed: boolean;
  draftStorageAvailable: boolean;
  draftCleanupWarning: string | null;
  pending: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshIdentity: () => Promise<void>;
  retryInitialization: () => void;
  allowAuthSession: () => void;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export async function browserAuth() {
  const { getBrowserAuthClient } = await import('@/lib/supabase-browser');
  return getBrowserAuthClient();
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [auth, setAuth] = useState<{
    session: Session | null;
    revision: number;
    initialized: boolean;
  }>({ session: null, revision: 0, initialized: false });
  const [identity, setIdentity] = useState<Identity>({
    status: 'loading',
    key: '',
  });
  const [authError, setAuthError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [closed, setClosed] = useState(false);
  const [logoutFailed, setLogoutFailed] = useState(false);
  const [draftCleanupFailed, setDraftCleanupFailed] = useState(false);
  const [initialization, setInitialization] = useState(0);
  const suppressed = useRef(false);
  const active = useRef<AbortController | null>(null);
  const alive = useRef(false);
  const draftOwner = useRef<string | null>(null);
  const draftCleanupPending = useRef(false);
  const token = auth.session?.access_token;
  const identityKey = `${auth.revision}:${pathname}`;
  const retireDrafts = useCallback(() => {
    let cleared = false;
    try {
      cleared = clearDrafts(window.sessionStorage);
    } catch {
      // Storage access itself may be blocked. Auth logout must still work.
    }
    draftCleanupPending.current = !cleared;
    setDraftCleanupFailed(!cleared);
    return cleared;
  }, []);

  useEffect(() => {
    alive.current = true;
    let disposed = false;
    let subscription: Subscription | undefined;
    const timeout = window.setTimeout(() => {
      if (!disposed)
        setAuthError(
          'No pudimos recuperar la sesión. Vuelve a comprobar el acceso.',
        );
    }, 12_000);
    void browserAuth()
      .then((client) => {
        if (disposed) return;
        subscription = client.auth.onAuthStateChange((event, session) => {
          if (disposed) return;
          if (
            (draftOwner.current && draftOwner.current !== session?.user.id) ||
            (event === 'SIGNED_IN' && draftCleanupPending.current) ||
            (event === 'INITIAL_SESSION' && !session)
          )
            retireDrafts();
          draftOwner.current = session?.user.id ?? null;
          window.clearTimeout(timeout);
          setAuth((previous) => {
            const next = suppressed.current ? null : session;
            const changed =
              previous.session?.access_token !== next?.access_token;
            if (changed) active.current?.abort();
            return {
              session: next,
              initialized: true,
              revision: previous.revision + (changed ? 1 : 0),
            };
          });
          if (session && !suppressed.current) setAuthError(null);
        }).data.subscription;
      })
      .catch(() => {
        window.clearTimeout(timeout);
        if (!disposed)
          setAuthError(
            'El servicio de acceso no se pudo iniciar. Vuelve a comprobar el acceso.',
          );
      });
    return () => {
      disposed = true;
      alive.current = false;
      window.clearTimeout(timeout);
      subscription?.unsubscribe();
      active.current?.abort();
    };
  }, [initialization, retireDrafts]);

  const loadIdentity = useCallback(() => {
    active.current?.abort();
    if (!token) return;
    const controller = new AbortController();
    active.current = controller;
    return apiGet('/api/v1/me', meResponseSchema, {
      accessToken: token,
      signal: controller.signal,
    })
      .then((response) => {
        if (!controller.signal.aborted)
          setIdentity({
            status: 'ready',
            key: identityKey,
            data: response.data,
          });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setIdentity({
            status: 'error',
            key: identityKey,
            error: asApiError(error),
          });
      });
  }, [token, identityKey]);

  const refreshIdentity = useCallback(async () => {
    setIdentity({ status: 'loading', key: identityKey });
    await loadIdentity();
  }, [identityKey, loadIdentity]);

  useEffect(() => {
    void loadIdentity();
    return () => active.current?.abort();
  }, [loadIdentity]);

  async function signIn(email: string, password: string) {
    setPending(true);
    setAuthError(null);
    setClosed(false);
    suppressed.current = false;
    try {
      const { error } = await (
        await browserAuth()
      ).auth.signInWithPassword({ email, password });
      if (error && alive.current)
        setAuthError(
          error.status === 400 || error.status === 401
            ? 'No pudimos iniciar sesión con ese correo y contraseña. Revisa tus datos.'
            : 'El servicio de acceso no está disponible. Vuelve a intentar.',
        );
    } catch {
      if (alive.current)
        setAuthError(
          'No pudimos conectar con el servicio de acceso. Vuelve a intentar.',
        );
    } finally {
      if (alive.current) setPending(false);
    }
  }

  async function signOut() {
    setPending(true);
    setAuthError(null);
    suppressed.current = true;
    active.current?.abort();
    retireDrafts();
    setAuth((previous) => ({
      ...previous,
      session: null,
      revision: previous.revision + 1,
    }));
    try {
      const { error } = await (
        await browserAuth()
      ).auth.signOut({ scope: 'local' });
      if (alive.current) {
        setLogoutFailed(!!error);
        if (error)
          setAuthError(
            'No se pudo confirmar el cierre de sesión. Vuelve a intentarlo.',
          );
        else setClosed(true);
      }
    } catch {
      if (alive.current) {
        setLogoutFailed(true);
        setAuthError(
          'No se pudo confirmar el cierre de sesión. Vuelve a intentarlo.',
        );
      }
    } finally {
      if (alive.current) setPending(false);
    }
  }

  const effectiveIdentity: Identity =
    identity.key === identityKey && token
      ? identity
      : { status: 'loading', key: identityKey };
  const value: SessionContextValue = {
    ...auth,
    identity: effectiveIdentity,
    authError,
    closed,
    logoutFailed,
    draftStorageAvailable: !draftCleanupFailed,
    draftCleanupWarning: draftCleanupFailed
      ? `${closed ? 'Tu sesión se cerró, pero no pudimos eliminar los borradores locales.' : 'No pudimos eliminar los borradores locales.'} Cierra esta pestaña para retirarlos. Mientras tanto, no recuperaremos ni guardaremos borradores locales.`
      : null,
    pending,
    signIn,
    signOut,
    refreshIdentity,
    retryInitialization: () => {
      setAuthError(null);
      setInitialization((previous) => previous + 1);
    },
    allowAuthSession: () => {
      suppressed.current = false;
      setClosed(false);
    },
  };
  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error('La vista requiere SessionProvider.');
  return value;
}
