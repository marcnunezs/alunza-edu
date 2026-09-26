import Link from 'next/link';
import { StatusPanel } from '@/components/status-panel';
import { Button } from '@/components/ui/button';

export default function StatePage() {
  return (
    <>
      <div className="mb-10 grid gap-6 sm:grid-cols-[1fr_auto] sm:items-end">
        <div>
          <p className="mb-3 text-xs font-bold tracking-[0.16em] text-primary uppercase">
            Entorno de desarrollo
          </p>
          <h1 className="text-3xl leading-tight font-semibold tracking-tight sm:text-4xl">
            Una base para empezar.
          </h1>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-muted-foreground">
            Consulta la conexión de los servicios y comprueba el acceso de tu
            cuenta a Alunza.
          </p>
        </div>
        <Button asChild>
          <Link href="/acceso">
            Ir al acceso <span aria-hidden="true">→</span>
          </Link>
        </Button>
      </div>
      <StatusPanel />
      <section
        className="mt-10 grid gap-3 border-t pt-6 text-sm leading-relaxed sm:grid-cols-[1fr_2fr]"
        aria-labelledby="foundation-limit"
      >
        <h2 id="foundation-limit" className="font-semibold">
          Contenido y editor disponibles
        </h2>
        <p className="max-w-xl text-muted-foreground">
          Este entorno permite administrar cursos y clases, publicar actividades
          y preparar soluciones JavaScript con borradores locales. La ejecución,
          el envío de soluciones y la ayuda de aprendizaje se incorporarán en
          incrementos posteriores.
        </p>
      </section>
    </>
  );
}
