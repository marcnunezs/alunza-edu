'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { z } from 'zod';
import {
  apiRequest,
  asApiError,
  type ApiError,
  type ApiResult,
} from '@/lib/api';
import { useSession } from '@/components/session-provider';

type Resource<T> =
  | { status: 'loading'; key: string }
  | { status: 'ready'; key: string; result: ApiResult<T> }
  | { status: 'error'; key: string; error: ApiError };

export function useApiResource<T>(
  path: string,
  schema: z.ZodType<T>,
  enabled = true,
) {
  const { session, revision } = useSession();
  const token = session?.access_token;
  const key = `${revision}:${path}`;
  const [state, setState] = useState<Resource<T>>({ status: 'loading', key });
  const active = useRef<AbortController | null>(null);
  const load = useCallback(() => {
    active.current?.abort();
    if (!token || !enabled) return;
    const controller = new AbortController();
    active.current = controller;
    return apiRequest(path, schema, {
      accessToken: token,
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted)
          setState({ status: 'ready', key, result });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setState({ status: 'error', key, error: asApiError(error) });
      });
  }, [key, path, schema, token, enabled]);
  const reload = useCallback(async () => {
    setState({ status: 'loading', key });
    await load();
  }, [key, load]);
  const refresh = useCallback(async () => {
    await load();
  }, [load]);
  useEffect(() => {
    void load();
    return () => active.current?.abort();
  }, [load]);
  return {
    state: state.key === key ? state : { status: 'loading' as const, key },
    reload,
    refresh,
  };
}
