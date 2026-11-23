import type { ArgumentsHost } from '@nestjs/common';
import { errorResponseSchema } from '@alunza/contracts';
import { ApiError, SafeExceptionFilter } from './errors';

describe('execution capacity public response', () => {
  const requestId = '10000000-0000-4000-8000-000000000001';
  it.each([
    ['RUNNER_BUSY', 503, '1'],
    ['RATE_LIMITED', 429, '60'],
    ['REQUEST_IN_PROGRESS', 409, '1'],
    ['DEPENDENCY_UNAVAILABLE', 503, undefined],
  ] as const)(
    'preserves the distinct contract for %s',
    (code, status, retryAfter) => {
      const response = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
        setHeader: jest.fn(),
      };
      const host = {
        switchToHttp: () => ({
          getRequest: () => ({ requestId }),
          getResponse: () => response,
        }),
      } as unknown as ArgumentsHost;
      new SafeExceptionFilter().catch(
        new ApiError(code, 'Conserva tu código.', status, true),
        host,
      );
      expect(response.status).toHaveBeenCalledWith(status);
      if (retryAfter)
        expect(response.setHeader).toHaveBeenCalledWith(
          'Retry-After',
          retryAfter,
        );
      else expect(response.setHeader).not.toHaveBeenCalled();
      const payload: unknown = response.json.mock.calls[0]?.[0];
      expect(errorResponseSchema.parse(payload)).toEqual({
        requestId,
        error: {
          code,
          message: 'Conserva tu código.',
          retryable: true,
          fields: [],
        },
      });
      expect(JSON.stringify(payload)).not.toMatch(
        /technicalResult|diagnosisCode|hostId|broker/,
      );
    },
  );
});
