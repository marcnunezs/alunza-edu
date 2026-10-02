import { z } from 'zod';

export const MATERIAL_MAX_BYTES = 10_000_000;
export const materialFormatSchema = z.enum(['PDF', 'TXT', 'MARKDOWN']);
export const materialJobStateSchema = z.enum([
  'UPLOADING',
  'QUEUED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
]);
const id = z.uuid();
const timestamp = z.iso.datetime({ offset: true });
const title = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .refine(
    (s) =>
      [...s].every((character) => {
        const point = character.codePointAt(0)!;
        return point !== 0 && !(point >= 0xd800 && point <= 0xdfff);
      }),
    'Título inválido.',
  );
const page = z.strictObject({
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});
const envelope = <T extends z.ZodType>(schema: T) =>
  z.strictObject({ data: schema, requestId: id });
const list = <T extends z.ZodType>(schema: T) =>
  z.strictObject({ data: z.array(schema), page, requestId: id });

export const materialJobSchema = z.strictObject({
  id,
  sourceId: id,
  versionId: id,
  generationId: id,
  state: materialJobStateSchema,
  attempts: z.number().int().nonnegative(),
  errorCode: z.string().max(80).nullable(),
  errorMessage: z.string().max(500).nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
export const materialVersionSchema = z.strictObject({
  id,
  sourceId: id,
  version: z.number().int().positive(),
  fileName: z.string().min(1).max(255),
  format: materialFormatSchema,
  sizeBytes: z.number().int().min(1).max(MATERIAL_MAX_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: timestamp,
});
export const materialChunkSchema = z.strictObject({
  id,
  sourceId: id,
  versionId: id,
  generationId: id,
  index: z.number().int().nonnegative(),
  text: z.string().min(1),
  tokenCount: z.number().int().min(1).max(500),
  locator: z.string().min(1).max(1000),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export const materialSourceSchema = z.strictObject({
  id,
  organizationId: id,
  classId: id,
  activityId: id.nullable(),
  ownerId: id,
  title,
  visible: z.boolean(),
  state: z.enum(['ACTIVE', 'ARCHIVED']),
  availability: z.enum(['NOT_READY', 'READY', 'HIDDEN', 'ARCHIVED']),
  revision: z.number().int().positive(),
  createdAt: timestamp,
  activeVersion: materialVersionSchema.nullable(),
  activeGenerationId: id.nullable(),
  chunkCount: z.number().int().nonnegative(),
  latestJob: materialJobSchema.nullable(),
  permissions: z.strictObject({
    replace: z.boolean(),
    retry: z.boolean(),
    govern: z.boolean(),
    history: z.boolean(),
  }),
});
export const materialUploadInputSchema = z.strictObject({
  title,
  activityId: id.optional(),
});
export const materialVisibilityInputSchema = z.strictObject({
  visible: z.boolean(),
});
export const materialReindexInputSchema = z.strictObject({
  versionId: id.optional(),
});
export const materialArchiveInputSchema = z.strictObject({
  reason: z.string().trim().min(1).max(500),
});
export const materialOperationSchema = z.strictObject({
  source: materialSourceSchema,
  version: materialVersionSchema,
  job: materialJobSchema,
});
export const materialScopeSchema = z.strictObject({
  id,
  title,
  state: z.enum(['DRAFT', 'PUBLISHED', 'CLOSED']),
});
export const materialSourceResponseSchema = envelope(materialSourceSchema);
export const materialSourceListResponseSchema = list(materialSourceSchema);
export const materialVersionListResponseSchema = list(materialVersionSchema);
export const materialChunkListResponseSchema = list(materialChunkSchema);
export const materialJobResponseSchema = envelope(materialJobSchema);
export const materialOperationResponseSchema = envelope(
  materialOperationSchema,
);
export const materialScopeListResponseSchema = list(materialScopeSchema);
export type MaterialSource = z.infer<typeof materialSourceSchema>;
export type MaterialVersion = z.infer<typeof materialVersionSchema>;
export type MaterialChunk = z.infer<typeof materialChunkSchema>;
export type MaterialJob = z.infer<typeof materialJobSchema>;
export type MaterialOperation = z.infer<typeof materialOperationSchema>;
export type MaterialScope = z.infer<typeof materialScopeSchema>;
export type MaterialFormat = z.infer<typeof materialFormatSchema>;
