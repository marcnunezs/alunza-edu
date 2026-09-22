'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { healthResponseSchema } from '@alunza/contracts';
import { apiGet, asApiError, type ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { RequestError } from '@/components/request-error';

type ServiceStatus =
  | { status: 'waiting' | 'checking' }
  | { status: 'ready'; requestId: string }
  | { status: 'error'; error: ApiError };

function ServiceCard({
  title,
  description,
  state,
}: {
  title: string;
  description: string;
  state: ServiceStatus;
}) {
  const label =
    state.status === 'ready'
      ? 'Disponible'
      : state.status === 'error'
        ? 'No disponible'
        : state.status === 'checking'
          ? 'Comprobando…'
          : 'Por comprobar';
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p
          className="flex items-center gap-2 text-sm font-semibold"
          role="status"
        >
          <span
            aria-hidden="true"
            className={`size-2.5 rounded-full ${state.status === 'ready' ? 'bg-primary' : state.status === 'error' ? 'bg-destructive' : 'bg-muted-foreground'}`}
          />
          {label}
        </p>
        {state.status === 'error' ? <RequestError error={state.error} /> : null}
        {state.status === 'ready' ? (
          <p className="break-all font-mono text-xs leading-relaxed text-muted-foreground">
            Referencia: {state.requestId}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function StatusPanel() {
  const [live, setLive] = useState<ServiceStatus>({ status: 'checking' });
  const [ready, setReady] = useState<ServiceStatus>({ status: 'checking' });
  const active = useRef<AbortController | null>(null);
  const busy = live.status === 'checking' || ready.status === 'checking';

  const check = useCallback(async () => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    const query = async (path: string, update: typeof setLive) => {
      try {
        const response = await apiGet(path, healthResponseSchema, {
          signal: controller.signal,
        });
        if (!controller.signal.aborted)
          update({ status: 'ready', requestId: response.requestId });
      } catch (error) {
        if (!controller.signal.aborted)
          update({ status: 'error', error: asApiError(error) });
      }
    };
    await Promise.all([
      query('/health/live', setLive),
      query('/health/ready', setReady),
    ]);
  }, []);

  useEffect(() => {
    void check();
    return () => active.current?.abort();
  }, [check]);

  return (
    <section aria-labelledby="service-status">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2 id="service-status" className="text-lg font-semibold">
          Estado de los servicios
        </h2>
        <Button
          variant="outline"
          onClick={() => {
            setLive({ status: 'checking' });
            setReady({ status: 'checking' });
            void check();
          }}
          disabled={busy}
        >
          {busy ? 'Comprobando…' : 'Volver a comprobar'}
        </Button>
      </div>
      <div className="grid gap-5 md:grid-cols-2" aria-busy={busy}>
        <ServiceCard
          title="API"
          description="Confirma que el servicio de Alunza responde."
          state={live}
        />
        <ServiceCard
          title="Conexión con los datos"
          description="Confirma una consulta real desde la API a la base de datos."
          state={ready}
        />
      </div>
    </section>
  );
}
