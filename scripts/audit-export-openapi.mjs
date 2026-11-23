import { z } from 'zod';
import {
  auditExportRequestSchema,
  auditExportResponseSchema,
} from '@alunza/contracts';

export function addAuditExportOpenApi(specification, operation) {
  for (const [name, schema] of Object.entries({
    AuditExportRequest: auditExportRequestSchema,
    AuditExport: auditExportResponseSchema,
  }))
    specification.components.schemas[name] = z.toJSONSchema(schema, {
      target: 'openapi-3.0',
      io: 'input',
    });
  const base = '/api/v1/organizations/{orgId}/audit-exports';
  const options = { ids: ['orgId', 'exportId'] };
  const create = operation('createAuditExport', 'AuditExport', {
    ids: ['orgId'],
    input: 'AuditExportRequest',
    idempotent: true,
    status: 201,
  });
  const metadata = operation('getAuditExport', 'AuditExport', options);
  for (const endpoint of [create, metadata])
    endpoint.responses[410] = {
      ...endpoint.responses[404],
      description:
        'AUDIT_EXPORT_EXPIRED: disponibilidad terminada a generatedAt+24h; sin contenido.',
    };
  specification.paths[base] = {
    post: {
      ...create,
      description:
        'IMP-06.06. ADMIN ACTIVE con perfil, sesión y membresía actuales; organizaciones archivadas admitidas. Solo solicitante. asOf explícito y filtros estrictos del visor, sin cursor/limit. Una captura SQL confirmada al generar (puede incorporar commits tardíos posteriores al visor), orden occurredAt DESC/eventId ASC. Máximo10000 filas y10485760 bytes finales; exceder devuelve422 AUDIT_EXPORT_LIMIT_EXCEEDED sin archivo parcial. Clave y cuerpo normalizado permanentes: replay READY conserva bytes/hash; RUNNING409 REQUEST_IN_PROGRESS; conflicto409; FAILED conserva error terminal. Lease30s: interrupción terminal sin regeneración automática. Dos operaciones CSV por instancia y una generación por actor/organización.201 solo tras READY y auditoría atómicos. Contenido disponible24h; eliminación física eventual.',
    },
  };
  specification.paths[`${base}/{exportId}`] = {
    get: {
      ...metadata,
      description:
        'Metadatos y SHA256 del CSV íntegro, solo solicitante reautorizado. RUNNING409; FAILED error terminal original; expirado410. No incluye bytes ni URL firmada. El cliente puede guardar este JSON por separado.',
    },
  };
  const content = operation('downloadAuditExport', 'AuditExport', options);
  content.responses[410] = metadata.responses[410];
  content.responses[200] = {
    description:
      'CSV completo verificado; finish del servidor no acredita lectura del cliente.',
    headers: {
      'Content-Disposition': { schema: { type: 'string' } },
      'Content-Length': { schema: { type: 'integer', maximum: 10485760 } },
      'Cache-Control': { schema: { type: 'string', enum: ['no-store'] } },
      'X-Content-Type-Options': {
        schema: { type: 'string', enum: ['nosniff'] },
      },
    },
    content: { 'text/csv': { schema: { type: 'string', format: 'binary' } } },
  };
  specification.paths[`${base}/{exportId}/content`] = {
    get: {
      ...content,
      description:
        'Reautoriza después de recuperar/verificar buffer y antes de crear ticket durable PENDING y enviar bytes; timeout30s. Ticket termina una sola vez FINISHED/ABORTED; pérdida del callback se concilia UNKNOWN después5min. UTF8 BOM, coma, CRLF, ocho columnas citadas event_id,occurred_at,actor_id,action,entity_type,entity_id,organization_id,outcome. Microsegundos UTC, null vacío, comillas duplicadas. Controles salvo CR/LF se escapan como texto; valores con prefijo de fórmula reciben texto: . No altera eventos originales.',
    },
    head: {
      ...content,
      operationId: 'headAuditExportContent',
      description:
        'Reautoriza y devuelve cabeceras; no recupera bytes ni crea ticket de entrega.',
      responses: {
        ...content.responses,
        200: { ...content.responses[200], content: undefined },
      },
    },
  };
}
