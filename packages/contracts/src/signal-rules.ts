import { z } from 'zod';

// PostgreSQL int4 bounds constrain representation, not pedagogical suitability.
export const signalRuleIntegerMaximum = 2_147_483_647;
const days = z.number().int().min(1).max(signalRuleIntegerMaximum);
const attempts = z.number().int().min(2).max(signalRuleIntegerMaximum);
const instant = z.iso
  .datetime()
  .refine(
    (value) => (value.match(/\.(\d+)/)?.[1].length ?? 0) <= 6,
    'La fecha admite como máximo seis decimales de segundo.',
  );
function micros(value: string): bigint {
  const fraction = value.match(/\.(\d+)/)?.[1] ?? '';
  return (
    BigInt(Date.parse(value.replace(/\.\d+/, ''))) * 1000n +
    BigInt(fraction.padEnd(6, '0'))
  );
}
export const signalRuleTypeSchema = z.enum([
  'INACTIVITY',
  'REPEATED_ERROR',
  'STAGNATION',
]);
export const signalRuleAlgorithmVersionSchema = z.literal('DEC005_V1');
const semantics = {
  schemaVersion: z.literal(1),
  algorithmVersion: signalRuleAlgorithmVersionSchema,
};
const variants = [
  z.strictObject({
    type: z.literal('INACTIVITY'),
    ...semantics,
    parameters: z.strictObject({ inactivityDays: days }),
  }),
  z.strictObject({
    type: z.literal('REPEATED_ERROR'),
    ...semantics,
    parameters: z.strictObject({
      repeatedErrorAttempts: attempts,
      repeatedErrorWindowDays: days,
    }),
  }),
  z.strictObject({
    type: z.literal('STAGNATION'),
    ...semantics,
    parameters: z.strictObject({ stagnationAttempts: attempts }),
  }),
] as const;
export const signalRuleCreateSchema = z.discriminatedUnion('type', variants);
export const signalRuleActivateSchema = z.strictObject({
  expectedCurrentVersionId: z.uuid().nullable(),
});
export const signalRuleListQuerySchema = z.strictObject({
  type: signalRuleTypeSchema.optional(),
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const versionFields = {
  id: z.uuid(),
  organizationId: z.uuid(),
  version: days,
  createdBy: z.uuid(),
  createdAt: instant,
  activatedBy: z.uuid().nullable(),
  validFrom: instant.nullable(),
  validTo: instant.nullable(),
  state: z.enum(['DRAFT', 'ACTIVE', 'RETIRED']),
};
export const signalRuleVersionSchema = z
  .discriminatedUnion('type', [
    variants[0].extend(versionFields),
    variants[1].extend(versionFields),
    variants[2].extend(versionFields),
  ])
  .refine((value) => {
    if (value.state === 'DRAFT')
      return (
        value.validFrom === null &&
        value.validTo === null &&
        value.activatedBy === null
      );
    if (
      value.validFrom === null ||
      value.activatedBy === null ||
      micros(value.validFrom) < micros(value.createdAt)
    )
      return false;
    return value.state === 'ACTIVE'
      ? value.validTo === null
      : value.validTo !== null &&
          micros(value.validTo) > micros(value.validFrom);
  }, 'La vigencia de la versión es incoherente.');
export const signalRuleVersionResponseSchema = z.strictObject({
  data: signalRuleVersionSchema,
  requestId: z.uuid(),
});
export const signalRuleEffectiveSchema = z
  .strictObject({
    organizationId: z.uuid(),
    observedAt: instant,
    rules: z
      .array(
        z.strictObject({
          type: signalRuleTypeSchema,
          ruleVersion: signalRuleVersionSchema.nullable(),
        }),
      )
      .length(3),
  })
  .refine(
    (value) =>
      new Set(value.rules.map((entry) => entry.type)).size === 3 &&
      value.rules.every(
        ({ type, ruleVersion }) =>
          ruleVersion === null ||
          (ruleVersion.type === type &&
            ruleVersion.organizationId === value.organizationId &&
            ruleVersion.state === 'ACTIVE'),
      ),
    'Las reglas efectivas deben cubrir los tres tipos y su organización vigente.',
  );
export const signalRuleEffectiveResponseSchema = z.strictObject({
  data: signalRuleEffectiveSchema,
  requestId: z.uuid(),
});
export const signalRuleVersionListSchema = z
  .strictObject({
    data: z.array(signalRuleVersionSchema),
    page: z.strictObject({
      nextCursor: z.uuid().nullable(),
      hasMore: z.boolean(),
    }),
  })
  .refine(
    (value) =>
      value.page.hasMore
        ? value.data.length > 0 &&
          value.page.nextCursor === value.data.at(-1)?.id
        : value.page.nextCursor === null,
    'La página de versiones es incoherente.',
  );
export const signalRuleVersionListResponseSchema =
  signalRuleVersionListSchema.safeExtend({ requestId: z.uuid() });
export type SignalRuleCreate = z.infer<typeof signalRuleCreateSchema>;
export type SignalRuleActivate = z.infer<typeof signalRuleActivateSchema>;
export type SignalRuleListQuery = z.infer<typeof signalRuleListQuerySchema>;
export type SignalRuleVersion = z.infer<typeof signalRuleVersionSchema>;
export type SignalRuleEffective = z.infer<typeof signalRuleEffectiveSchema>;
