import { Catch, HttpException } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { errorResponseSchema } from '@alunza/contracts';
import type { Request, Response } from 'express';

export class ApiError extends HttpException {
  constructor(
    readonly code: string,
    readonly publicMessage: string,
    status: number,
    readonly retryable = false,
    readonly fields: Array<{ field: string; message: string }> = [],
  ) {
    super(publicMessage, status);
  }
}

export const unauthenticated = () =>
  new ApiError('UNAUTHENTICATED', 'Se requiere una sesión válida.', 401);
export const inactive = () =>
  new ApiError('ACCOUNT_INACTIVE', 'La cuenta no está habilitada.', 403);
export const notFound = () =>
  new ApiError('RESOURCE_NOT_FOUND', 'Recurso no encontrado.', 404);
export const databaseUnavailable = () =>
  new ApiError(
    'PERSISTENCE_UNAVAILABLE',
    'Los datos no están disponibles.',
    503,
    true,
  );

export interface ApiRequest extends Request {
  requestId: string;
  actorId?: string;
  sessionId?: string;
}

@Catch()
export class SafeExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<ApiRequest>();
    const response = context.getResponse<Response>();
    let error: ApiError;
    if (exception instanceof ApiError) {
      error = exception;
    } else if (
      typeof exception === 'object' &&
      exception !== null &&
      'status' in exception &&
      [400, 413].includes(Number(exception.status))
    ) {
      error = new ApiError(
        Number(exception.status) === 413
          ? 'PAYLOAD_TOO_LARGE'
          : 'INVALID_REQUEST',
        'El cuerpo JSON no es válido o supera el límite permitido.',
        Number(exception.status),
      );
    } else if (
      exception instanceof HttpException &&
      exception.getStatus() === 404
    ) {
      error = notFound();
    } else if (
      exception instanceof HttpException &&
      exception.getStatus() === 400
    ) {
      error = new ApiError(
        'INVALID_REQUEST',
        'La solicitud no es válida.',
        400,
      );
    } else {
      error = new ApiError(
        'INTERNAL_ERROR',
        'No se pudo procesar la solicitud.',
        500,
      );
    }
    if (error.code === 'REQUEST_IN_PROGRESS')
      response.setHeader('Retry-After', '1');
    if (error.code === 'RATE_LIMITED') response.setHeader('Retry-After', '60');
    response.status(error.getStatus()).json(
      errorResponseSchema.parse({
        error: {
          code: error.code,
          message: error.publicMessage,
          fields: error.fields,
          retryable: error.retryable,
        },
        requestId: request.requestId,
      }),
    );
  }
}
