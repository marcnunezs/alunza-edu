import type { ArgumentsHost } from '@nestjs/common';
import { ApiError, SafeExceptionFilter } from './errors';

describe('practice errors at the HTTP boundary', () => {
  it.each([
    ['VERSION_CONFLICT', 409],
    ['IDEMPOTENCY_EXPIRED', 409],
    ['ACTIVITY_CLOSED', 409],
    ['ACTIVITY_NOT_AVAILABLE', 409],
    ['CODE_TOO_LARGE', 413],
  ])(
    'serializes %s without replacing it with an internal error',
    (code, status) => {
      const requestId = '20000000-0000-4000-8000-000000000001';
      const response = {
        setHeader: jest.fn(),
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      const host = {
        switchToHttp: () => ({
          getRequest: () => ({ requestId }),
          getResponse: () => response,
        }),
      } as ArgumentsHost;

      new SafeExceptionFilter().catch(
        new ApiError(String(code), 'Solicitud rechazada.', Number(status)),
        host,
      );

      expect(response.status).toHaveBeenCalledWith(status);
      expect(response.json).toHaveBeenCalledWith({
        error: {
          code,
          message: 'Solicitud rechazada.',
          fields: [],
          retryable: false,
        },
        requestId,
      });
    },
  );
});
