'use client';

import { Button } from '@/components/ui/button';

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <section className="max-w-xl space-y-5" role="alert">
      <h1 className="text-2xl font-semibold">No pudimos mostrar esta página</h1>
      <p className="text-muted-foreground">
        Vuelve a intentar para recuperar la vista.
      </p>
      <Button onClick={reset}>Volver a intentar</Button>
    </section>
  );
}
