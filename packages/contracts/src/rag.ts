import { z } from 'zod';

export const diagnosisCodeSchema = z.enum([
  'SUCCESS',
  'SYNTAX_ERROR',
  'RUNTIME_ERROR',
  'FAILED_TEST',
  'TIMEOUT',
  'UNKNOWN',
]);
export const ragStatusSchema = z.enum([
  'SUPPORTED',
  'NO_EVIDENCE',
  'PROVIDER_UNAVAILABLE',
]);
export const sourceRefSchema = z.strictObject({
  source_id: z.uuid(),
  source_version_id: z.uuid(),
  chunk_id: z.uuid(),
  locator: z.string().min(1),
});
// DEC-010: lengths/reference shape are provisional technical bounds, not academic acceptance.
export const ragHelpSchema = z
  .strictObject({
    diagnosis_code: diagnosisCodeSchema,
    explanation: z
      .string()
      .min(1)
      .max(2000)
      .refine((value) => value.trim().length > 0),
    hint: z.string().max(1000),
    source_refs: z.array(sourceRefSchema).max(5),
    status: ragStatusSchema,
  })
  .superRefine((value, ctx) => {
    if (value.status === 'SUPPORTED' && value.source_refs.length === 0)
      ctx.addIssue({
        code: 'custom',
        path: ['source_refs'],
        message: 'Evidence is required.',
      });
    if (
      value.status !== 'SUPPORTED' &&
      (value.source_refs.length !== 0 || value.hint !== '')
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Fallbacks cannot contain references or hints.',
      });
  });
export type DiagnosisCode = z.infer<typeof diagnosisCodeSchema>;
export type RagHelp = z.infer<typeof ragHelpSchema>;
export type SourceRef = z.infer<typeof sourceRefSchema>;
