import { z } from 'zod';
export * from './rag';

export const roleSchema = z.enum(['ADMIN', 'TEACHER', 'STUDENT']);
export const accountStateSchema = z.enum(['INVITED', 'ACTIVE', 'DISABLED']);
export const requestIdSchema = z.uuid();
export const membershipSchema = z.strictObject({
  organizationId: z.uuid(),
  organizationName: z.string().min(1).max(160),
  organizationState: z.enum(['ACTIVE', 'ARCHIVED']),
  accessMode: z.enum(['OPERATE', 'READ_ONLY']),
  role: roleSchema,
  state: z.literal('ACTIVE'),
});
export const meSchema = z.strictObject({
  id: z.uuid(),
  displayName: z.string().min(1).max(120),
  accountState: z.literal('ACTIVE'),
  memberships: z.array(membershipSchema),
  provisioningGrants: z.array(z.strictObject({ id: z.uuid() })),
  canProvisionOrganization: z.boolean(),
});
export const organizationSchema = z.strictObject({
  id: z.uuid(),
  code: z.string().min(1).max(40),
  name: z.string().min(1).max(160),
  timezone: z.string().min(1).max(64),
  revision: z.number().int().positive(),
  state: z.enum(['ACTIVE', 'ARCHIVED']),
  archivedAt: z.iso.datetime({ offset: true }).nullable(),
});
export const healthResponseSchema = z.strictObject({
  data: z.strictObject({ status: z.literal('ok') }),
  requestId: requestIdSchema,
});
export const meResponseSchema = z.strictObject({
  data: meSchema,
  requestId: requestIdSchema,
});
export const organizationResponseSchema = z.strictObject({
  data: organizationSchema,
  requestId: requestIdSchema,
});
export const errorResponseSchema = z.strictObject({
  error: z.strictObject({
    code: z.enum([
      'INVALID_REQUEST',
      'UNAUTHENTICATED',
      'ACCOUNT_INACTIVE',
      'FORBIDDEN',
      'RESOURCE_NOT_FOUND',
      'DEPENDENCY_UNAVAILABLE',
      'PERSISTENCE_UNAVAILABLE',
      'INTERNAL_ERROR',
      'VALIDATION_FAILED',
      'DUPLICATE',
      'LAST_ADMIN',
      'DEPENDENCIES_ACTIVE',
      'REQUEST_IN_PROGRESS',
      'IDEMPOTENCY_CONFLICT',
      'PRECONDITION_FAILED',
      'PRECONDITION_REQUIRED',
      'INVITATION_INVALID',
      'INVITATION_EXPIRED',
      'INVITATION_REVOKED',
      'ORGANIZATION_ARCHIVED',
      'RESOURCE_ARCHIVED',
      'ACTIVITY_UNAVAILABLE',
      'RATE_LIMITED',
      'PAYLOAD_TOO_LARGE',
      'UNSUPPORTED_MEDIA_TYPE',
      'OPERATION_DEADLINE_EXCEEDED',
    ]),
    message: z.string().min(1).max(240),
    fields: z.array(z.strictObject({ field: z.string(), message: z.string() })),
    retryable: z.boolean(),
  }),
  requestId: requestIdSchema,
});
export type Role = z.infer<typeof roleSchema>;
export type Me = z.infer<typeof meSchema>;
export type Organization = z.infer<typeof organizationSchema>;
export type MeResponse = z.infer<typeof meResponseSchema>;
export type OrganizationResponse = z.infer<typeof organizationResponseSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

const codeInput = z.string().trim().toUpperCase().min(1).max(40);
const nameInput = z.string().trim().min(1).max(160);
export const organizationCreateSchema = z.strictObject({
  grantId: z.uuid(),
  code: codeInput,
  name: nameInput,
});
export const organizationUpdateSchema = z
  .strictObject({ code: codeInput.optional(), name: nameInput.optional() })
  .refine(
    (value) => Object.keys(value).length > 0,
    'Indica al menos un cambio.',
  );
export const organizationArchiveSchema = z.strictObject({
  reason: z.string().trim().min(1).max(500),
});
export const memberSchema = z.strictObject({
  userId: z.uuid(),
  displayName: z.string().min(1).max(120),
  email: z.email().max(254),
  accountState: accountStateSchema,
  role: roleSchema,
  state: accountStateSchema,
  revision: z.number().int().positive(),
  joinedAt: z.iso.datetime({ offset: true }).nullable(),
});
export const memberUpdateSchema = z
  .strictObject({
    role: roleSchema.optional(),
    state: z.enum(['ACTIVE', 'DISABLED']).optional(),
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    'Indica al menos un cambio.',
  );
export const invitationCreateSchema = z.strictObject({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  role: roleSchema,
});
export const invitationSchema = z.strictObject({
  id: z.uuid(),
  organizationId: z.uuid(),
  email: z.email().max(254),
  role: roleSchema,
  state: z.enum(['INVITED', 'ACCEPTED', 'REVOKED', 'EXPIRED']),
  expiresAt: z.iso.datetime({ offset: true }),
  acceptedAt: z.iso.datetime({ offset: true }).nullable(),
  revokedAt: z.iso.datetime({ offset: true }).nullable(),
  generation: z.number().int().nonnegative(),
  revision: z.number().int().positive(),
  deliveryState: z.enum([
    'QUEUED',
    'SENDING',
    'SENT',
    'UNCERTAIN',
    'FAILED',
    'CANCELLED',
  ]),
  operationId: z.uuid().nullable(),
});
export const invitationProofSchema = z.strictObject({
  token: z.string().min(32).max(128),
  generation: z.number().int().positive(),
});
export const invitationAcceptSchema = invitationProofSchema.extend({
  displayName: z.string().trim().min(1).max(120).optional(),
});
export const invitationAcceptanceSchema = z.strictObject({
  organizationId: z.uuid(),
  userId: z.uuid(),
  role: roleSchema,
  state: accountStateSchema,
});
export const pageSchema = z.strictObject({
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});
export const organizationListResponseSchema = z.strictObject({
  data: z.array(organizationSchema),
  page: pageSchema,
  requestId: requestIdSchema,
});
export const memberResponseSchema = z.strictObject({
  data: memberSchema,
  requestId: requestIdSchema,
});
export const memberListResponseSchema = z.strictObject({
  data: z.array(memberSchema),
  page: pageSchema,
  requestId: requestIdSchema,
});
export const invitationResponseSchema = z.strictObject({
  data: invitationSchema,
  requestId: requestIdSchema,
});
export const invitationListResponseSchema = z.strictObject({
  data: z.array(invitationSchema),
  page: pageSchema,
  requestId: requestIdSchema,
});
export const invitationAcceptanceResponseSchema = z.strictObject({
  data: invitationAcceptanceSchema,
  requestId: requestIdSchema,
});
export type Member = z.infer<typeof memberSchema>;
export type Invitation = z.infer<typeof invitationSchema>;
export type InvitationAcceptance = z.infer<typeof invitationAcceptanceSchema>;
export * from './academic';
