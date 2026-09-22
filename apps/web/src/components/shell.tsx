'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useSession } from '@/components/session-provider';
import { Button } from '@/components/ui/button';

export function Shell({ children }: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  const router = useRouter();
  const auth = useSession();
  const signedIn = !!auth.session && auth.identity.status === 'ready';
  const admin =
    auth.identity.status === 'ready' &&
    (auth.identity.data.canProvisionOrganization ||
      auth.identity.data.memberships.some((item) => item.role === 'ADMIN'));
  const navigation = [
    { href: '/', label: 'Estado' },
    ...(signedIn
      ? [{ href: '/inicio', label: 'Inicio' }]
      : [{ href: '/acceso', label: 'Acceso' }]),
    ...(signedIn && admin
      ? [{ href: '/administracion/organizaciones', label: 'Organizaciones' }]
      : []),
  ];
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#contenido"
        className="sr-only rounded-md bg-primary px-4 py-3 text-primary-foreground focus:not-sr-only focus:absolute focus:top-3 focus:left-4 focus:z-50"
      >
        Saltar al contenido
      </a>
      <header className="border-b bg-card">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-5 px-5 py-5 sm:px-8">
          <Link
            href="/"
            className="flex min-h-11 items-center gap-3 rounded-sm"
            aria-label="Alunza, ir al estado"
          >
            <span
              aria-hidden="true"
              className="grid size-11 place-items-center rounded-xl bg-primary font-mono text-xl font-bold text-primary-foreground"
            >
              a.
            </span>
            <span className="text-2xl font-bold tracking-tight">
              alunza<span className="text-primary">.</span>
            </span>
          </Link>
          <nav
            aria-label="Navegación principal"
            className="flex flex-wrap items-center gap-1 rounded-lg border bg-background p-1"
          >
            {navigation.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={pathname === item.href ? 'page' : undefined}
                className={cn(
                  'inline-flex min-h-11 items-center rounded-md px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-accent',
                  pathname === item.href &&
                    'bg-primary text-primary-foreground hover:bg-primary',
                )}
              >
                {item.label}
              </Link>
            ))}
            {auth.session && pathname !== '/acceso' ? (
              <Button
                variant="ghost"
                disabled={auth.pending}
                onClick={() => {
                  void auth.signOut().then(() => router.replace('/acceso'));
                }}
              >
                {auth.pending ? 'Cerrando sesión…' : 'Cerrar sesión'}
              </Button>
            ) : null}
          </nav>
        </div>
      </header>
      <main
        id="contenido"
        tabIndex={-1}
        className="mx-auto w-full max-w-6xl flex-1 px-5 py-10 outline-none sm:px-8 sm:py-14"
      >
        {children}
      </main>
      <footer className="border-t px-5 py-6 sm:px-8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 text-xs leading-relaxed text-muted-foreground">
          <p>Alunza · Programación I</p>
          <p>Identidad y organización · Programación I</p>
        </div>
      </footer>
    </div>
  );
}
