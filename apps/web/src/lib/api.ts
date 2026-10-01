import { errorResponseSchema } from '@alunza/contracts';
import type { z } from 'zod';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
    readonly fields: ReadonlyArray<{ field: string; message: string }> = [],
    readonly retryable = false,
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const messages: Record<number, string> = {
  400: 'No se pudo realizar esta consulta.',
  401: 'Tu sesión no es válida o venció. Vuelve a iniciar sesión.',
  403: 'Tu cuenta no tiene acceso activo. Contacta al responsable de tu organización.',
  404: 'El recurso no está disponible o no tienes acceso.',
  409: 'La operación no se pudo completar. Actualiza los datos y revisa el estado actual.',
  412: 'Los datos cambiaron mientras editabas. Vuelve a cargar antes de guardar.',
  422: 'Revisa los campos indicados antes de guardar.',
  429: 'Se alcanzó el límite de consultas. Espera un momento y vuelve a intentar.',
};

const codeMessages: Record<string, string> = {
  DUPLICATE: 'Ya existe un registro con esos datos. Revisa el campo indicado.',
  LAST_ADMIN:
    'Debe permanecer al menos un administrador activo en la organización.',
  DEPENDENCIES_ACTIVE:
    'Hay dependencias activas, como usuarios, cursos, clases o publicaciones. Resuélvelas antes de archivar.',
  ORGANIZATION_ARCHIVED:
    'La organización está archivada y solo permite consultas.',
  REQUEST_IN_PROGRESS:
    'La operación sigue en curso. Puedes consultar su estado o reintentar la misma solicitud.',
  IDEMPOTENCY_CONFLICT:
    'Esta solicitud ya se utilizó con otros datos. Comprueba el resultado anterior.',
  INVITATION_INVALID:
    'La invitación no está disponible. Solicita un enlace vigente al administrador.',
  INVITATION_EXPIRED:
    'La invitación venció. Solicita un enlace nuevo al administrador.',
  INVITATION_RECIPIENT_MISMATCH:
    'Esta sesión no corresponde al destinatario de la invitación.',
  ACTIVITY_UNAVAILABLE:
    'La actividad no está disponible para esta operación. Revisa su estado y fechas.',
  RESOURCE_ARCHIVED: 'Este recurso está archivado y solo permite consultas.',
};

export type ApiOptions = {
  accessToken?: string;
  signal?: AbortSignal;
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT';
  body?: unknown;
  etag?: string;
  idempotencyKey?: string;
};

export type ApiResult<T> = { body: T; etag: string | null; status: number };

export async function apiRequest<T>(
  path: string,
  schema: z.ZodType<T>,
  options: ApiOptions = {},
): Promise<ApiResult<T>> {
  if (!path.startsWith('/api/v1/') && !path.startsWith('/health/'))
    throw new ApiError(
      400,
      'INVALID_REQUEST',
      'La ruta solicitada no es válida.',
    );
  const deadline = AbortSignal.timeout(10_000);
  const signal = options.signal
    ? AbortSignal.any([options.signal, deadline])
    : deadline;
  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (options.accessToken)
      headers.Authorization = `Bearer ${options.accessToken}`;
    if (options.body !== undefined)
      headers['Content-Type'] = 'application/json';
    if (options.etag) headers['If-Match'] = options.etag;
    if (options.idempotencyKey)
      headers['Idempotency-Key'] = options.idempotencyKey;
    const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, '');
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers,
      signal,
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      ...(options.body !== undefined
        ? { body: JSON.stringify(options.body) }
        : {}),
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const parsed = errorResponseSchema.safeParse(body);
      const code = parsed.success ? parsed.data.error.code : 'INVALID_RESPONSE';
      const retryAfter = Number(response.headers.get('Retry-After'));
      throw new ApiError(
        response.status,
        code,
        codeMessages[code] ??
          messages[response.status] ??
          'El servicio no está disponible. Puedes volver a intentar.',
        parsed.success ? parsed.data.requestId : undefined,
        parsed.success ? parsed.data.error.fields : [],
        parsed.success ? parsed.data.error.retryable : response.status >= 500,
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
      );
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success)
      throw new ApiError(
        502,
        'INVALID_RESPONSE',
        'La respuesta del servicio no se pudo verificar. Vuelve a intentar.',
        undefined,
        [],
        true,
      );
    return {
      body: parsed.data,
      etag: response.headers.get('ETag'),
      status: response.status,
    };
  } catch (error) {
    if (error instanceof ApiError || options.signal?.aborted) throw error;
    throw new ApiError(
      503,
      'API_UNAVAILABLE',
      'No pudimos conectar con la API. Comprueba el servicio y vuelve a intentar.',
      undefined,
      [],
      true,
    );
  }
}

export async function apiGet<T>(
  path: string,
  schema: z.ZodType<T>,
  options: { accessToken?: string; signal?: AbortSignal } = {},
): Promise<T> {
  return (await apiRequest(path, schema, options)).body;
}

export function asApiError(error: unknown): ApiError {
  return error instanceof ApiError
    ? error
    : new ApiError(
        503,
        'API_UNAVAILABLE',
        'No se pudo consultar el servicio. Vuelve a intentar.',
      );
}
