import { z } from 'zod';
import {
  observationPeriodValid,
  progressInstantSchema,
  progressUtcInstantSchema,
} from './progress-observation';

export const AUDIT_EXPORT_MAX_ROWS = 10_000;
export const AUDIT_EXPORT_MAX_BYTES = 10_485_760;
export const auditExportRequestSchema = z
  .strictObject({
    from: progressUtcInstantSchema.optional(),
    asOf: progressUtcInstantSchema,
    actorId: z
      .uuid()
      .transform((value) => value.toLowerCase())
      .optional(),
    action: z.string().min(1).max(100).optional(),
    entityType: z.string().min(1).max(100).optional(),
    entityId: z
      .uuid()
      .transform((value) => value.toLowerCase())
      .optional(),
  })
  .refine(observationPeriodValid, {
    path: ['from'],
    message: 'El inicio debe ser anterior o igual al corte.',
  });
export const auditExportMetadataSchema = z
  .strictObject({
    state: z.literal('READY'),
    exportId: z.uuid(),
    organizationId: z.uuid(),
    filters: auditExportRequestSchema,
    snapshotAt: progressInstantSchema,
    generatedAt: progressInstantSchema,
    expiresAt: progressInstantSchema,
    rowCount: z.number().int().min(0).max(AUDIT_EXPORT_MAX_ROWS),
    byteLength: z.number().int().positive().max(AUDIT_EXPORT_MAX_BYTES),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    fileName: z.string(),
    downloadPath: z.string(),
    formatVersion: z.literal('audit-csv-v1'),
  })
  .superRefine((value, context) => {
    if (
      value.fileName !==
      `auditoria-${value.organizationId}-${value.exportId}.csv`
    )
      context.addIssue({
        code: 'custom',
        path: ['fileName'],
        message: 'Nombre de archivo incompatible.',
      });
    if (
      value.downloadPath !==
      `/api/v1/organizations/${value.organizationId}/audit-exports/${value.exportId}/content`
    )
      context.addIssue({
        code: 'custom',
        path: ['downloadPath'],
        message: 'Ruta de descarga incompatible.',
      });
    if (
      Date.parse(value.expiresAt) - Date.parse(value.generatedAt) !==
      86_400_000
    )
      context.addIssue({
        code: 'custom',
        path: ['expiresAt'],
        message: 'Vigencia incompatible.',
      });
  });
export const auditExportResponseSchema = z.strictObject({
  data: auditExportMetadataSchema,
  requestId: z.uuid(),
});
export type AuditExportRequest = z.infer<typeof auditExportRequestSchema>;
export type AuditExportMetadata = z.infer<typeof auditExportMetadataSchema>;
