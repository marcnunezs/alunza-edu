import { z } from 'zod';
import { auditQuerySchema, auditListResponseSchema } from '@alunza/contracts';

export function addAuditOpenApi(specification, operation) {
  specification.components.schemas.AuditList = z.toJSONSchema(
    auditListResponseSchema,
    { target: 'openapi-3.0', io: 'input' },
  );
  const properties = z.toJSONSchema(auditQuerySchema, {
    target: 'openapi-3.0',
    io: 'input',
  }).properties;
  const base = operation('listAuditEvents', 'AuditList', { ids: ['orgId'] });
  specification.paths['/api/v1/organizations/{orgId}/audit-events'] = {
    get: {
      ...base,
      description:
        'IMP-06.05. ADMIN con perfil, sesión y membresía vigentes; permite lectura administrativa ARCHIVED. Proyección de ocho campos operativos, outcome corresponde a result. Filtros exactos y fechas inclusivas, microsegundos conservados. asOf predeterminado del servidor, no futuro. Orden occurredAt DESC/eventId ASC. Cursor ligado al actor, organización, filtros y corte, que debe reenviarse. Conteo anterior al cursor; una misma sentencia para conteo y página. No es una instantánea entre solicitudes: confirmaciones tardías pueden cambiar el conteo y entrar después del cursor. Actualizar sin cursor/asOf inicia un corte nuevo. Campos desconocidos y cursor sin asOf rechazados. Consulta y denegación emiten registro operativo separado, sin contenido ni filtros. Sin CSV.',
      parameters: [
        ...base.parameters,
        ...Object.entries(properties).map(([name, schema]) => ({
          name,
          in: 'query',
          required: false,
          schema:
            name === 'limit'
              ? { type: 'integer', minimum: 1, maximum: 100, default: 20 }
              : schema,
        })),
      ],
    },
  };
}
