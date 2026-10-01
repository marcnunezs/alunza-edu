import type { Metadata } from 'next';
import { AccessPanel } from '@/components/access-panel';

export const metadata: Metadata = { title: 'Acceso · Alunza' };

export default function AccessPage() {
  return (
    <>
      <div className="mb-9 max-w-2xl">
        <p className="mb-3 text-xs font-bold tracking-[0.16em] text-primary uppercase">
          Acceso a Alunza
        </p>
        <h1 className="text-3xl leading-tight font-semibold tracking-tight sm:text-4xl">
          Tu cuenta. Tu organización.
        </h1>
        <p className="mt-4 text-base leading-relaxed text-muted-foreground">
          Inicia sesión para consultar el perfil y la organización a los que
          tienes acceso.
        </p>
      </div>
      <AccessPanel />
    </>
  );
}
