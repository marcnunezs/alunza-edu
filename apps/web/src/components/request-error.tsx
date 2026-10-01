import type { ApiError } from '@/lib/api';

export function RequestError({ error }: { error: ApiError }) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm leading-relaxed"
    >
      <p className="font-semibold text-destructive">
        {error.status === 401 || error.status === 403 || error.status === 404
          ? 'Acceso no permitido'
          : 'Consulta no disponible'}
      </p>
      <p className="mt-1">{error.message}</p>
      {error.retryAfter ? (
        <p className="mt-2">
          Espera {error.retryAfter} segundos antes de volver a intentar.
        </p>
      ) : null}
      {error.requestId ? (
        <p className="mt-3 break-all font-mono text-xs text-muted-foreground">
          Referencia: {error.requestId}
        </p>
      ) : null}
    </div>
  );
}
