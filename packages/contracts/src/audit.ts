import { z } from 'zod';
import {
  observationPeriodValid,
  progressInstantSchema,
  progressUtcInstantSchema,
} from './progress-observation';

export const auditQuerySchema = z
  .strictObject({
    from: progressUtcInstantSchema.optional(),
    asOf: progressUtcInstantSchema.optional(),
    actorId: z.uuid().optional(),
    action: z.string().min(1).max(100).optional(),
    entityType: z.string().min(1).max(100).optional(),
    entityId: z.uuid().optional(),
    cursor: z
      .string()
      .min(1)
      .max(4096)
      .regex(/^[A-Za-z0-9_-]+$/)
      .optional(),
    limit: z
      .union([z.number(), z.string().regex(/^[0-9]+$/)])
      .pipe(z.coerce.number<string | number>().int().min(1).max(100))
      .default(20),
  })
  .refine(observationPeriodValid, {
    path: ['from'],
    message: 'El inicio debe ser anterior o igual al corte.',
  })
  .refine((value) => !value.cursor || Boolean(value.asOf), {
    path: ['asOf'],
    message: 'La siguiente página requiere el corte de la consulta.',
  });

export const auditEventSchema = z.strictObject({
  eventId: z.uuid(),
  occurredAt: progressInstantSchema,
  actorId: z.uuid().nullable(),
  action: z.string().min(1).max(100),
  entityType: z.string().min(1).max(100),
  entityId: z.uuid().nullable(),
  organizationId: z.uuid(),
  outcome: z.string().min(1).max(80),
});
export const auditListSchema = z.strictObject({
  organizationId: z.uuid(),
  asOf: progressInstantSchema,
  items: z.array(auditEventSchema).max(100),
  page: z
    .strictObject({
      nextCursor: z.string().min(1).max(4096).nullable(),
      hasMore: z.boolean(),
      totalFiltered: z.number().int().nonnegative(),
    })
    .refine((page) => page.hasMore === (page.nextCursor !== null)),
});
export const auditListResponseSchema = z.strictObject({
  data: auditListSchema,
  requestId: z.uuid(),
});
export type AuditQuery = z.infer<typeof auditQuerySchema>;
export type AuditEvent = z.infer<typeof auditEventSchema>;
export type AuditList = z.infer<typeof auditListSchema>;
