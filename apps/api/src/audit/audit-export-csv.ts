import { createHash } from 'node:crypto';
import {
  AUDIT_EXPORT_MAX_BYTES,
  AUDIT_EXPORT_MAX_ROWS,
  auditEventSchema,
} from '@alunza/contracts';
import type { AuditEvent } from '@alunza/contracts';
import { ApiError } from '../http/errors';

export const auditCsvHeaders = [
  'event_id',
  'occurred_at',
  'actor_id',
  'action',
  'entity_type',
  'entity_id',
  'organization_id',
  'outcome',
] as const;
export function auditExportLimit() {
  return new ApiError(
    'AUDIT_EXPORT_LIMIT_EXCEEDED',
    'La exportación supera 10.000 filas o 10 MiB. Acota los filtros.',
    422,
  );
}
export function auditCsvCell(value: string | null): string {
  let text = value ?? '';
  const significant = text.replace(/^[\p{White_Space}\p{Cc}\p{Cf}]*/u, '');
  const dangerous = /^[=+\-@＝＋－＠]/u.test(significant);
  text = text.replace(/[\p{Cc}\p{Cf}]/gu, (character) => {
    if (character === '\r' || character === '\n') return character;
    return `\\u${character.codePointAt(0)!.toString(16).padStart(4, '0')}`;
  });
  if (dangerous) text = `texto: ${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export function auditCsv(events: AuditEvent[]) {
  if (events.length > AUDIT_EXPORT_MAX_ROWS) throw auditExportLimit();
  const parts: Buffer[] = [
    Buffer.from(
      `\uFEFF${auditCsvHeaders.map(auditCsvCell).join(',')}\r\n`,
      'utf8',
    ),
  ];
  let length = parts[0]!.length;
  for (const candidate of events) {
    const event = auditEventSchema.parse(candidate);
    const row = Buffer.from(
      [
        event.eventId,
        event.occurredAt,
        event.actorId,
        event.action,
        event.entityType,
        event.entityId,
        event.organizationId,
        event.outcome,
      ]
        .map(auditCsvCell)
        .join(',') + '\r\n',
      'utf8',
    );
    length += row.length;
    if (length > AUDIT_EXPORT_MAX_BYTES) throw auditExportLimit();
    parts.push(row);
  }
  const bytes = Buffer.concat(parts, length);
  return {
    bytes,
    rowCount: events.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}
