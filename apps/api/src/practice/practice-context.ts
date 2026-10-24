import { z } from 'zod';

// Private server contracts. Tests and budgets are always derived from the fixed
// academic version; they are never accepted from browser RUN/SUBMIT payloads.
export const practiceLimitsSchema = z.strictObject({
  memoryBytes: z.number().int().min(1).max(134217728),
  runtimeMs: z.number().int().min(1).max(3000),
  outputBytes: z.number().int().min(1).max(65536),
});
export const assignmentContextSchema = z.object({
  organizationId: z.uuid(),
  exerciseVersionId: z.uuid(),
  limits: practiceLimitsSchema,
});
export const runContextSchema = assignmentContextSchema.extend({
  tests: z
    .array(
      z.strictObject({
        id: z.uuid(),
        visibility: z.literal('visible'),
        args: z.array(z.json()),
        expected: z.json(),
      }),
    )
    .min(1)
    .max(8),
});
