'use client';

import { useEffect } from 'react';
import type { z } from 'zod';
import type { ExerciseBankEntry, ExerciseBankVersion } from '@alunza/contracts';
import { useApiResource } from '@/lib/use-api-resource';
import type { ApiError } from '@/lib/api';

export type AccessDenied = (error: ApiError) => void;

export function bankQuery(
  values: Record<string, string | number | null | undefined>,
) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== '')
      query.set(key, String(value));
  }
  return query.toString();
}

export function useBankResource<T>(
  path: string,
  schema: z.ZodType<T>,
  onDenied: AccessDenied,
) {
  const resource = useApiResource(path, schema);
  const error = resource.state.status === 'error' ? resource.state.error : null;
  useEffect(() => {
    if (error && [401, 403, 404].includes(error.status)) onDenied(error);
  }, [error, onDenied]);
  return resource;
}

export const visibilityLabels = {
  PRIVATE: 'Privado',
  ORGANIZATION: 'Organización',
} as const;
export const exerciseStateLabels = {
  ACTIVE: 'Activo',
  ARCHIVED: 'Archivado',
} as const;
export const activityStateLabels = {
  DRAFT: 'Borrador',
  PUBLISHED: 'Publicada',
  CLOSED: 'Cerrada',
} as const;

export function BankTime({
  value,
  timezone,
}: {
  value: string;
  timezone: string;
}) {
  return (
    <time dateTime={value}>
      {new Intl.DateTimeFormat('es-CL', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: timezone,
      }).format(new Date(value))}{' '}
      ({timezone})
    </time>
  );
}

export function BankConcepts({
  concepts,
}: {
  concepts: ExerciseBankVersion['concepts'];
}) {
  return concepts.length ? (
    <ul className="space-y-1">
      {concepts.map((concept) => (
        <li key={concept.versionId} className="break-words">
          {concept.name}{' '}
          <span className="text-xs text-muted-foreground">
            · versión {concept.version}
          </span>
        </li>
      ))}
    </ul>
  ) : (
    <span>Sin conceptos</span>
  );
}

export function BankUseCounts({
  value,
}: {
  value: ExerciseBankEntry['useCounts'];
}) {
  return (
    <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
      <dt>Total</dt>
      <dd>{value.total}</dd>
      <dt>Borradores</dt>
      <dd>{value.draft}</dd>
      <dt>Publicadas</dt>
      <dd>{value.published}</dd>
      <dt>Cerradas</dt>
      <dd>{value.closed}</dd>
    </dl>
  );
}
