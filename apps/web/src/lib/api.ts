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
  413: 'El contenido supera el tamaño permitido. Revisa el límite indicado y vuelve a intentar.',
  415: 'El formato no está admitido. Utiliza PDF con texto, TXT o Markdown.',
  422: 'Revisa los campos indicados antes de guardar.',
  429: 'Se alcanzó el límite de consultas. Espera un momento y vuelve a intentar.',
};

const codeMessages: Record<string, string> = {
  FILE_TOO_LARGE:
    'El archivo supera 10 MB (10.000.000 bytes). Selecciona uno más pequeño.',
  UNSUPPORTED_MEDIA_TYPE: 'Utiliza un PDF con texto, TXT o Markdown.',
  INVALID_DOCUMENT:
    'El archivo no se puede procesar. Revisa que contenga texto, esté íntegro y que el PDF no esté cifrado.',
  SOURCE_TOO_LARGE:
    'El archivo supera 10 MB (10.000.000 bytes). Selecciona uno más pequeño.',
  SOURCE_UNSUPPORTED_FORMAT: 'Utiliza un PDF con texto, TXT o Markdown.',
  SOURCE_NO_TEXT:
    'El archivo no contiene texto extraíble. Usa un PDF con texto, TXT o Markdown; no se procesan imágenes mediante OCR.',
  SOURCE_INVALID_FILE:
    'El archivo no se puede procesar. Revisa que esté íntegro y que el PDF no esté cifrado.',
  SOURCE_ARCHIVED: 'Este material está archivado y ya no está disponible.',
  SOURCE_PROCESSING:
    'Este material ya tiene un procesamiento en curso. Consulta su estado antes de reintentar.',
  ACADEMIC_ARCHIVED: 'Este recurso está archivado y solo permite consultas.',
  JOIN_CODE_INVALID:
    'El código no es válido, venció o no está disponible para tu cuenta. Solicita uno vigente.',
  ACTIVITY_NOT_AVAILABLE:
    'Esta actividad no permite la operación solicitada. Actualiza su disponibilidad.',
  ACTIVITY_CLOSED:
    'La actividad está cerrada o fuera de su horario y no admite nuevas ejecuciones ni envíos.',
  CODE_TOO_LARGE:
    'El código supera 65.536 bytes UTF-8. Reduce su tamaño antes de ejecutar.',
  VERSION_CONFLICT:
    'La versión del ejercicio cambió. Actualiza su disponibilidad antes de ejecutar.',
  INVALID_TRANSITION:
    'Ese cambio de estado no está permitido. La publicación y el cierre conservan su orden.',
  CONCEPT_CYCLE:
    'La relación crearía un ciclo. Selecciona otro concepto padre.',
  DUPLICATE: 'Ya existe un registro con esos datos. Revisa el campo indicado.',
  LAST_ADMIN:
    'Debe permanecer al menos un administrador activo en la organización.',
  DEPENDENCIES_ACTIVE:
    'Hay dependencias activas. Resuelve usuarios, invitaciones, clases o publicaciones antes de archivar.',
  ORGANIZATION_ARCHIVED:
    'La organización está archivada y solo permite consultas.',
  REQUEST_IN_PROGRESS:
    'La operación sigue en curso. Puedes consultar su estado o reintentar la misma solicitud.',
  IDEMPOTENCY_CONFLICT:
    'Esta solicitud ya se utilizó con otros datos. Comprueba el resultado anterior.',
  IDEMPOTENCY_EXPIRED:
    'La respuesta de esta solicitud venció. Consulta el historial para recuperar un intento guardado antes de decidir un nuevo envío. Una práctica temporal puede ejecutarse de nuevo si la actividad está disponible.',
  INVITATION_INVALID:
    'La invitación no está disponible. Solicita un enlace vigente al administrador.',
  INVITATION_EXPIRED:
    'La invitación venció. Solicita un enlace nuevo al administrador.',
  INVITATION_RECIPIENT_MISMATCH:
    'Esta sesión no corresponde al destinatario de la invitación.',
};

export type ApiOptions = {
  accessToken?: string;
  signal?: AbortSignal;
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT';
  body?: unknown;
  etag?: string;
  idempotencyKey?: string;
  timeoutMs?: 10_000 | 45_000;
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
  const deadline = AbortSignal.timeout(options.timeoutMs ?? 10_000);
  const signal = options.signal
    ? AbortSignal.any([options.signal, deadline])
    : deadline;
  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (options.accessToken)
      headers.Authorization = `Bearer ${options.accessToken}`;
    const multipart =
      typeof FormData !== 'undefined' && options.body instanceof FormData;
    if (options.body !== undefined && !multipart)
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
        ? {
            body: multipart
              ? (options.body as FormData)
              : JSON.stringify(options.body),
          }
        : {}),
    });
    signal.throwIfAborted();
    const body: unknown = await response.json().catch((cause: unknown) => {
      if (signal.aborted) throw cause;
      return null;
    });
    signal.throwIfAborted();
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
    if (deadline.aborted)
      throw new ApiError(
        504,
        'API_TIMEOUT',
        options.timeoutMs === 45_000 && !path.includes('/sources')
          ? 'La respuesta tardó demasiado. Conservamos tu código; recupera el resultado antes de iniciar otra ejecución.'
          : 'La respuesta tardó demasiado. Vuelve a intentar.',
        undefined,
        [],
        true,
      );
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

/** Downloads only versioned materials or a feedback's authorized citation. */
export async function apiDownloadSource(
  path: string,
  options: { accessToken?: string; signal?: AbortSignal } = {},
): Promise<Blob> {
  if (
    !/^\/api\/v1\/(?:sources\/[0-9a-f-]+\/versions\/[0-9a-f-]+|feedback\/[0-9a-f-]+\/sources\/[0-9a-f-]+)\/content$/i.test(
      path,
    )
  )
    throw new ApiError(
      400,
      'INVALID_REQUEST',
      'La ruta solicitada no es válida.',
    );
  const deadline = AbortSignal.timeout(45_000);
  const signal = options.signal
    ? AbortSignal.any([options.signal, deadline])
    : deadline;
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, '')}${path}`,
      {
        headers: {
          Accept:
            'application/pdf, text/plain, text/markdown, application/octet-stream',
          ...(options.accessToken
            ? { Authorization: `Bearer ${options.accessToken}` }
            : {}),
        },
        signal,
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
      },
    );
    if (!response.ok) {
      const parsed = errorResponseSchema.safeParse(
        await response.json().catch(() => null),
      );
      signal.throwIfAborted();
      const code = parsed.success ? parsed.data.error.code : 'INVALID_RESPONSE';
      throw new ApiError(
        response.status,
        code,
        codeMessages[code] ??
          messages[response.status] ??
          'No se pudo descargar el material. Vuelve a intentar.',
        parsed.success ? parsed.data.requestId : undefined,
        [],
        response.status >= 500,
      );
    }
    const content = await response.blob();
    signal.throwIfAborted();
    return content;
  } catch (error) {
    if (error instanceof ApiError || options.signal?.aborted) throw error;
    if (deadline.aborted)
      throw new ApiError(
        504,
        'API_TIMEOUT',
        'La descarga tardó demasiado. Vuelve a intentar.',
        undefined,
        [],
        true,
      );
    throw new ApiError(
      503,
      'API_UNAVAILABLE',
      'No se pudo descargar el material. Vuelve a intentar.',
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
