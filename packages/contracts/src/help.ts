import { z } from 'zod';
import { ragHelpSchema, ragStatusSchema } from './rag';
import { materialFormatSchema } from './materials';

const id = z.uuid();
const instant = z.iso.datetime({ offset: true });
const level = z.number().int().min(1).max(3);
const envelope = <T extends z.ZodType>(schema: T) =>
  z.strictObject({ data: schema, requestId: id });

export const helpKindSchema = z.enum(['FEEDBACK', 'HINT']);
export const helpRequestInputSchema = z
  .strictObject({ kind: helpKindSchema, hintLevel: level.optional() })
  .refine((value) => value.kind === 'HINT' || value.hintLevel === undefined, {
    message: 'La explicación no solicita un nivel de pista.',
    path: ['hintLevel'],
  });
export const helpRequestSchema = z.strictObject({
  id,
  attemptId: id,
  kind: helpKindSchema,
  hintLevel: level.nullable(),
  state: z.enum(['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED']),
  feedbackId: id.nullable(),
  createdAt: instant,
  deadlineAt: instant,
  completedAt: instant.nullable(),
  errorCode: z.string().max(80).nullable(),
  errorMessage: z.string().max(500).nullable(),
});
export const helpFeedbackSummarySchema = z.strictObject({
  id,
  attemptId: id,
  requestId: id,
  kind: helpKindSchema,
  hintLevel: level.nullable(),
  status: ragStatusSchema,
  createdAt: instant,
  viewedAt: instant.nullable(),
  available: z.boolean(),
});
export const helpFeedbackSchema = helpFeedbackSummarySchema.extend({
  help: ragHelpSchema,
  presentationToken: id.nullable(),
});
export const helpCapabilitiesSchema = z.strictObject({
  canExplain: z.boolean(),
  canHint: z.boolean(),
  nextHintLevel: level.nullable(),
  reason: z.string().max(80).nullable(),
  pendingRequest: helpRequestSchema.nullable(),
  preparedFeedbackId: id.nullable(),
});
export const helpHistorySchema = z.strictObject({
  items: z.array(helpFeedbackSummarySchema).max(20),
  nextCursor: z.string().nullable(),
  capabilities: helpCapabilitiesSchema,
});
export const helpHistoryQuerySchema = z.strictObject({
  cursor: id.optional(),
  limit: z.coerce.number().int().min(1).max(20).default(20),
});
export const helpViewedInputSchema = z.strictObject({ presentationToken: id });
export const helpReferenceSchema = z.strictObject({
  sourceId: id,
  versionId: id,
  chunkId: id,
  title: z.string().min(1).max(160),
  version: z.number().int().positive(),
  fileName: z.string().min(1).max(255),
  format: materialFormatSchema,
  locator: z.string().min(1).max(1000),
  text: z.string().min(1),
});
export const helpRequestResponseSchema = envelope(helpRequestSchema);
export const helpFeedbackResponseSchema = envelope(helpFeedbackSchema);
export const helpHistoryResponseSchema = envelope(helpHistorySchema);
export const helpReferenceResponseSchema = envelope(helpReferenceSchema);

export type HelpKind = z.infer<typeof helpKindSchema>;
export type HelpRequestInput = z.infer<typeof helpRequestInputSchema>;
export type HelpRequest = z.infer<typeof helpRequestSchema>;
export type HelpFeedbackSummary = z.infer<typeof helpFeedbackSummarySchema>;
export type HelpFeedback = z.infer<typeof helpFeedbackSchema>;
export type HelpCapabilities = z.infer<typeof helpCapabilitiesSchema>;
export type HelpHistory = z.infer<typeof helpHistorySchema>;
export type HelpHistoryQuery = z.infer<typeof helpHistoryQuerySchema>;
export type HelpReference = z.infer<typeof helpReferenceSchema>;
