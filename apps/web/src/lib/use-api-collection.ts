'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { z } from 'zod';
import { useSession } from '@/components/session-provider';
import { apiRequest, asApiError, ApiError, type ApiResult } from '@/lib/api';

type Collection<T> = {
  data: T[];
  page: { hasMore: boolean; nextCursor: string | null };
  requestId: string;
};
type CollectionState<T> =
  | { status: 'loading'; key: string }
  | { status: 'error'; key: string; error: ApiError }
  | { status: 'ready'; key: string; result: ApiResult<Collection<T>> };

async function fetchCollection<T>(
  path: string,
  schema: z.ZodType<Collection<T>>,
  token: string,
  signal: AbortSignal,
): Promise<ApiResult<Collection<T>>> {
  const entries: T[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  for (;;) {
    const result: ApiResult<Collection<T>> = await apiRequest(
      `${path}${cursor ? `${path.includes('?') ? '&' : '?'}cursor=${encodeURIComponent(cursor)}` : ''}`,
      schema,
      { accessToken: token, signal },
    );
    entries.push(...result.body.data);
    if (!result.body.page.hasMore)
      return { ...result, body: { ...result.body, data: entries } };
    cursor = result.body.page.nextCursor;
    if (!cursor || seen.has(cursor))
      throw new ApiError(
        502,
        'INVALID_RESPONSE',
        'No se pudo verificar la lista completa. Vuelve a intentar.',
      );
    seen.add(cursor);
  }
}

/** Selectors must not silently hide valid choices beyond the first API page. */
export function useApiCollection<T>(
  path: string,
  schema: z.ZodType<Collection<T>>,
) {
  const { session, revision } = useSession();
  const token = session?.access_token;
  const key = `${revision}:${path}`;
  const [state, setState] = useState<CollectionState<T>>({
    status: 'loading',
    key,
  });
  const active = useRef<AbortController | null>(null);
  const load = useCallback(() => {
    active.current?.abort();
    if (!token) return;
    const controller = new AbortController();
    active.current = controller;
    return fetchCollection(path, schema, token, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted)
          setState({ status: 'ready', key, result });
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setState({ status: 'error', key, error: asApiError(cause) });
      });
  }, [key, path, schema, token]);
  const reload = useCallback(async () => {
    setState({ status: 'loading', key });
    await load();
  }, [key, load]);
  useEffect(() => {
    void load();
    return () => active.current?.abort();
  }, [load]);
  return {
    state: state.key === key ? state : { status: 'loading' as const, key },
    reload,
  };
}
