import type { z } from 'zod';
import type { Response } from 'express';
import type { ApiRequest } from './errors';

export function answer<T>(
  schema: z.ZodType<T>,
  data: unknown,
  request: ApiRequest,
  response?: Response,
): T {
  if (response && data && typeof data === 'object' && 'revision' in data)
    response.setHeader('ETag', `"${data.revision}"`);
  return schema.parse({ data, requestId: request.requestId });
}
