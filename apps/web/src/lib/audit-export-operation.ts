import { z } from 'zod';
import {
  auditExportRequestSchema,
  progressMicros,
  type AuditExportMetadata,
  type AuditExportRequest,
} from '@alunza/contracts';
import type { AuditFilters } from './audit-view';

export type AuditExportScope = { userId: string; organizationId: string };
const scopeSchema = z.strictObject({
  userId: z.uuid(),
  organizationId: z.uuid(),
});
export const pendingAuditExportSchema = z.strictObject({
  formatVersion: z.literal(1),
  ...scopeSchema.shape,
  key: z.uuid(),
  payload: auditExportRequestSchema,
});
export type PendingAuditExport = z.infer<typeof pendingAuditExportSchema>;
export type AuditExportJournal =
  | { status: 'empty' }
  | { status: 'ready'; operation: PendingAuditExport }
  | { status: 'invalid' | 'unavailable' };
type JournalStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function auditExportInput(
  filters: AuditFilters,
  asOf: string,
): AuditExportRequest {
  return auditExportRequestSchema.parse({
    asOf,
    from: filters.from,
    actorId: filters.actorId,
    action: filters.action,
    entityType: filters.entityType,
    entityId: filters.entityId,
  });
}

export function auditExportFingerprint(input: AuditExportRequest): string {
  const value = auditExportRequestSchema.parse(input);
  return JSON.stringify({
    asOf: progressMicros(value.asOf).toString(),
    from: value.from ? progressMicros(value.from).toString() : null,
    actorId: value.actorId?.toLowerCase() ?? null,
    action: value.action ?? null,
    entityType: value.entityType ?? null,
    entityId: value.entityId?.toLowerCase() ?? null,
  });
}

export function auditExportMatches(
  operation: PendingAuditExport,
  metadata: AuditExportMetadata,
): boolean {
  return (
    metadata.organizationId === operation.organizationId &&
    auditExportFingerprint(operation.payload) ===
      auditExportFingerprint(metadata.filters)
  );
}

export function auditExportStorageKey(scope: AuditExportScope): string {
  const checked = scopeSchema.parse({
    userId: scope.userId,
    organizationId: scope.organizationId,
  });
  return `alunza:audit-export-operation:v1:${checked.userId}:${checked.organizationId}`;
}

export function readAuditExport(
  storage: JournalStorage,
  scope: AuditExportScope,
): AuditExportJournal {
  try {
    const raw = storage.getItem(auditExportStorageKey(scope));
    if (raw === null) return { status: 'empty' };
    if (raw.length > 8192) return { status: 'invalid' };
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      return { status: 'invalid' };
    }
    const parsed = pendingAuditExportSchema.safeParse(value);
    if (
      !parsed.success ||
      parsed.data.userId !== scope.userId ||
      parsed.data.organizationId !== scope.organizationId
    )
      return { status: 'invalid' };
    return { status: 'ready', operation: parsed.data };
  } catch {
    return { status: 'unavailable' };
  }
}

export function saveAuditExport(
  storage: JournalStorage,
  operation: PendingAuditExport,
): boolean {
  try {
    const validated = pendingAuditExportSchema.parse(operation);
    const current = readAuditExport(storage, validated);
    if (
      current.status !== 'empty' &&
      !(
        current.status === 'ready' &&
        JSON.stringify(current.operation) === JSON.stringify(validated)
      )
    )
      return false;
    storage.setItem(
      auditExportStorageKey(validated),
      JSON.stringify(validated),
    );
    const after = readAuditExport(storage, validated);
    return (
      after.status === 'ready' &&
      JSON.stringify(after.operation) === JSON.stringify(validated)
    );
  } catch {
    return false;
  }
}

export function clearAuditExport(
  storage: JournalStorage,
  operation: PendingAuditExport,
): boolean {
  try {
    const current = readAuditExport(storage, operation);
    if (current.status === 'empty') return true;
    if (
      current.status !== 'ready' ||
      JSON.stringify(current.operation) !== JSON.stringify(operation)
    )
      return false;
    storage.removeItem(auditExportStorageKey(operation));
    return readAuditExport(storage, operation).status === 'empty';
  } catch {
    return false;
  }
}

export function auditExportTerminalFailure(error: {
  status: number;
  code: string;
  retryable?: boolean;
}): boolean {
  return (
    (error.status === 422 &&
      ['VALIDATION_FAILED', 'AUDIT_EXPORT_LIMIT_EXCEEDED'].includes(
        error.code,
      )) ||
    (error.status === 410 && error.code === 'AUDIT_EXPORT_EXPIRED') ||
    (error.status === 503 &&
      error.retryable === false &&
      ['AUDIT_EXPORT_FAILED', 'AUDIT_EXPORT_INTERRUPTED'].includes(error.code))
  );
}
