import type { AuditQuery } from '@alunza/contracts';
import { localDateTime, toInstant } from './academic-time';

export type AuditFilters = Omit<AuditQuery, 'cursor' | 'limit'>;

export function auditTextFilters(
  values: Record<'actorId' | 'action' | 'entityType' | 'entityId', string>,
): Pick<AuditFilters, 'actorId' | 'action' | 'entityType' | 'entityId'> {
  return {
    actorId: values.actorId.trim() || undefined,
    action: values.action || undefined,
    entityType: values.entityType || undefined,
    entityId: values.entityId.trim() || undefined,
  };
}

export function auditQuery(values: Partial<AuditQuery>): string {
  const query = new URLSearchParams();
  for (const key of [
    'from',
    'asOf',
    'actorId',
    'action',
    'entityType',
    'entityId',
    'limit',
    'cursor',
  ] as const) {
    const value = values[key];
    if (value !== undefined && value !== null && value !== '')
      query.set(key, String(value));
  }
  return query.toString();
}

export function auditSelectedInstant(
  value: string,
  previous: string | undefined,
  timezone: string,
): string | undefined {
  if (!value) return undefined;
  return previous && value === localDateTime(previous, timezone)
    ? previous
    : (toInstant(value, timezone) ?? undefined);
}

export function auditPageQuery(
  filters: AuditFilters,
  asOf: string,
  cursor: string | null,
): AuditQuery {
  return { ...filters, asOf, limit: 20, ...(cursor ? { cursor } : {}) };
}

export function auditRefreshFilters(filters: AuditFilters): AuditFilters {
  const { asOf: _cut, ...rest } = filters;
  return rest;
}

export function auditOutcomeLabel(outcome: string): string {
  if (outcome === 'SUCCEEDED' || outcome === 'SUCCESS') return 'Completado';
  if (outcome === 'DENIED') return 'Denegado';
  if (outcome === 'FAILED') return 'Fallido';
  return outcome;
}
