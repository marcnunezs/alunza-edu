import {
  createClient,
  type Session,
  type SupabaseClient,
} from '@supabase/supabase-js';

let browserClient: SupabaseClient | undefined;

function publicConfiguration() {
  if (typeof window === 'undefined')
    throw new Error('La sesión solo está disponible en el navegador.');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key)
    throw new Error('La configuración pública de acceso está incompleta.');
  return { url, key };
}

const boundedFetch: typeof fetch = (input, init) =>
  fetch(input, {
    ...init,
    signal: init?.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(10_000)])
      : AbortSignal.timeout(10_000),
  });

export function getBrowserAuthClient(): SupabaseClient {
  if (typeof window === 'undefined')
    throw new Error('La sesión solo está disponible en el navegador.');
  if (!browserClient) {
    const { url, key } = publicConfiguration();
    browserClient = createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: `alunza.auth.${new URL(url).host}`,
        debug: false,
      },
      global: {
        fetch: boundedFetch,
      },
    });
  }
  return browserClient;
}

export async function setInvitationPassword(
  session: Session,
  password: string,
) {
  const { url, key } = publicConfiguration();
  // Bind this operation to the verified recipient, even if another tab changes
  // the persistent browser session before updateUser reads it.
  const client = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: `alunza.invitation.${crypto.randomUUID()}`,
      debug: false,
    },
    global: { fetch: boundedFetch },
  });
  const established = await client.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
  if (
    established.error ||
    established.data.session?.user.id !== session.user.id
  )
    return { error: true };
  const result = await client.auth.updateUser({ password });
  return { error: !!result.error };
}
