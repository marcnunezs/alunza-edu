import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function NotFoundPage() {
  return (
    <section className="max-w-xl space-y-5">
      <h1 className="text-2xl font-semibold">Página no disponible</h1>
      <p className="text-muted-foreground">
        Puedes volver al estado de los servicios o acceder a tu cuenta.
      </p>
      <Button asChild>
        <Link href="/">Volver al estado</Link>
      </Button>
    </section>
  );
}
