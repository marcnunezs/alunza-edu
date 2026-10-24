'use client';

import { LoadError } from '@/components/academic-shared';
import type { ApiError } from '@/lib/api';

export function LoadState({
  state,
  reload,
}: {
  state: { status: string; error?: ApiError };
  reload: () => Promise<void>;
}) {
  if (state.status === 'loading')
    return <p role="status">Consultando evidencia guardada…</p>;
  if (state.status === 'error' && state.error)
    return <LoadError error={state.error} reload={reload} />;
  return null;
}
