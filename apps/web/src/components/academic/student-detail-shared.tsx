'use client';

import { useEffect } from 'react';
import type { z } from 'zod';
import type { ApiError } from '@/lib/api';
import { useApiResource } from '@/lib/use-api-resource';

export type StudentDetailScope = {
  base: string;
  classId: string;
  studentId: string;
  asOf: string;
  timezone: string;
  writable: boolean;
  onDenied: (error: ApiError) => void;
};

export function useStudentDetailResource<T>(
  path: string,
  schema: z.ZodType<T>,
  onDenied: StudentDetailScope['onDenied'],
  enabled = true,
) {
  const resource = useApiResource(path, schema, enabled);
  const error = resource.state.status === 'error' ? resource.state.error : null;
  useEffect(() => {
    if (error && [401, 403, 404].includes(error.status)) onDenied(error);
  }, [error, onDenied]);
  return resource;
}
