import { z } from 'zod';
import { progressInstantSchema } from './progress-observation';

const id = z.uuid();
const count = z.number().int().nonnegative();
const positive = z.number().int().positive();
const state = z.enum(['ACTIVE', 'ARCHIVED']);
const difficulty = z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']);
const visibility = z.enum(['PRIVATE', 'ORGANIZATION']);
export const exerciseBankGovernanceInputSchema = z
  .strictObject({ ownerId: id.optional(), visibility: visibility.optional() })
  .refine(
    (value) => value.ownerId !== undefined || value.visibility !== undefined,
    {
      message: 'Indica al menos un cambio de propiedad o visibilidad.',
    },
  );
export type ExerciseBankGovernanceInput = z.infer<
  typeof exerciseBankGovernanceInputSchema
>;
const activityState = z.enum(['DRAFT', 'PUBLISHED', 'CLOSED']);
const pagination = {
  cursor: z
    .string()
    .min(1)
    .max(4096)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};
export const exerciseBankQuerySchema = z.strictObject({
  ...pagination,
  search: z.string().trim().max(160).optional(),
  state: state.optional(),
  difficulty: difficulty.optional(),
  conceptId: id.optional(),
  visibility: visibility.optional(),
});
export const exerciseBankVersionsQuerySchema = z.strictObject(pagination);
export const exerciseBankUsesQuerySchema = z.strictObject({
  ...pagination,
  versionId: id.optional(),
  activityState: activityState.optional(),
});
export const exerciseBankPageSchema = z
  .strictObject({
    nextCursor: z.string().min(1).max(4096).nullable(),
    hasMore: z.boolean(),
    totalFiltered: count,
  })
  .refine((value) => value.hasMore === (value.nextCursor !== null));
export const exerciseBankUseCountsSchema = z
  .strictObject({
    total: count,
    draft: count,
    published: count,
    closed: count,
  })
  .refine(
    (value) => value.total === value.draft + value.published + value.closed,
  );
const versionFields = {
  id,
  version: positive,
  title: z.string().min(1).max(160),
  difficulty,
  createdAt: progressInstantSchema,
  concepts: z.array(
    z.strictObject({
      id,
      versionId: id,
      name: z.string().min(1).max(160),
      version: positive,
    }),
  ),
};
export const exerciseBankVersionMetadataSchema = z.strictObject(versionFields);
export const exerciseBankVersionSchema = z.strictObject({
  ...versionFields,
  useCounts: exerciseBankUseCountsSchema,
});
const entryFields = {
  id,
  organizationId: id,
  revision: positive,
  state,
  visibility,
  owner: z.strictObject({ id, displayName: z.string().min(1) }),
  currentVersion: exerciseBankVersionMetadataSchema,
  versionCount: positive,
  useCounts: exerciseBankUseCountsSchema,
};
export const exerciseBankEntrySchema = z.strictObject(entryFields);
export const exerciseBankUseSchema = z.strictObject({
  assignmentId: id,
  exerciseVersionId: id,
  version: positive,
  activity: z.strictObject({
    id,
    title: z.string().min(1),
    state: activityState,
  }),
  class: z.strictObject({ id, name: z.string().min(1), archived: z.boolean() }),
});
const pageContext = {
  organizationId: id,
  observedAt: progressInstantSchema,
  page: exerciseBankPageSchema,
};
const envelope = <T extends z.ZodType>(data: T) =>
  z.strictObject({ data, requestId: id });
export const exerciseBankListResponseSchema = envelope(
  z.strictObject({
    ...pageContext,
    items: z.array(exerciseBankEntrySchema).max(100),
  }),
);
export const exerciseBankDetailResponseSchema = envelope(
  z.strictObject({
    ...entryFields,
    observedAt: progressInstantSchema,
  }),
);
export const exerciseBankVersionsResponseSchema = envelope(
  z.strictObject({
    ...pageContext,
    exerciseId: id,
    items: z.array(exerciseBankVersionSchema).max(100),
  }),
);
export const exerciseBankUsesResponseSchema = envelope(
  z.strictObject({
    ...pageContext,
    exerciseId: id,
    items: z.array(exerciseBankUseSchema).max(100),
  }),
);
export type ExerciseBankQuery = z.infer<typeof exerciseBankQuerySchema>;
export type ExerciseBankVersionsQuery = z.infer<
  typeof exerciseBankVersionsQuerySchema
>;
export type ExerciseBankUsesQuery = z.infer<typeof exerciseBankUsesQuerySchema>;
export type ExerciseBankEntry = z.infer<typeof exerciseBankEntrySchema>;
export type ExerciseBankVersion = z.infer<typeof exerciseBankVersionSchema>;
export type ExerciseBankUse = z.infer<typeof exerciseBankUseSchema>;
