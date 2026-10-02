import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { EvaluationPhase } from '@alunza/contracts';
import { TOKENIZER_VERSION } from './ingestion';
import {
  HELP_QUERY_VERSION,
  HELP_PROMPT_VERSION,
  HELP_VERIFICATION_PROMPT_VERSION,
  HELP_SCHEMA_VERSION,
} from './help';

export interface EvaluationPublicProfile {
  id: string;
  model: string;
  dimensions?: number;
}

// This descriptor deliberately cannot carry credentials. Prices belong to the
// approved budget, not the provider identity. Keep the payload property order
// stable: persisted TEST and Azure receipts already use this exact identity.
export const evaluationPublicAzureDescriptorSchema = z.strictObject({
  baseURL: z
    .string()
    .regex(/^https:\/\/[a-z0-9-]+\.openai\.azure\.com\/openai\/v1\/$/u),
  deployment: z.string().regex(/^[a-zA-Z0-9_.-]{1,128}$/u),
  authMode: z.enum(['azure-cli', 'managed-identity', 'api-key']),
  tokenizer: z.enum(['cl100k_base', 'o200k_base']).optional(),
});
export type EvaluationPublicAzureDescriptor = z.infer<
  typeof evaluationPublicAzureDescriptorSchema
>;
export type EvaluationProviderDescriptor = {
  phase: EvaluationPhase;
  profile: EvaluationPublicProfile;
} & (
  | { provider: 'TEST'; azure?: never }
  | { provider: 'AZURE'; azure: EvaluationPublicAzureDescriptor }
);

const profileSchema = z.object({
  id: z.string().min(1).max(160),
  model: z.string().min(1).max(160),
  dimensions: z.number().int().min(1).max(16000).optional(),
});

export function evaluationProviderFingerprint(
  descriptor: EvaluationProviderDescriptor,
): string {
  const parsed = profileSchema.safeParse(descriptor.profile);
  if (
    !parsed.success ||
    !['EMBEDDING', 'GENERATION', 'REVIEW'].includes(descriptor.phase) ||
    !['TEST', 'AZURE'].includes(descriptor.provider)
  )
    throw new Error('INVALID_EVALUATION_PROVIDER_DESCRIPTOR');
  // Construct explicitly so arbitrary profile metadata or property order cannot
  // change the hash or accidentally incorporate a secret.
  const profile = {
    id: parsed.data.id,
    model: parsed.data.model,
    ...(parsed.data.dimensions === undefined
      ? {}
      : { dimensions: parsed.data.dimensions }),
  };
  let payload: object;
  if (descriptor.provider === 'TEST') {
    if (descriptor.azure !== undefined)
      throw new Error('INVALID_EVALUATION_PROVIDER_DESCRIPTOR');
    payload = { origin: 'TEST', phase: descriptor.phase, ...profile };
  } else {
    const azure = evaluationPublicAzureDescriptorSchema.safeParse(
      descriptor.azure,
    );
    if (
      !azure.success ||
      (descriptor.phase === 'EMBEDDING'
        ? profile.dimensions === undefined || azure.data.tokenizer !== undefined
        : profile.dimensions !== undefined ||
          azure.data.tokenizer === undefined)
    )
      // Never propagate the schema issues or the untrusted descriptor.
      throw new Error('INVALID_EVALUATION_PROVIDER_DESCRIPTOR');
    payload = {
      phase: descriptor.phase,
      ...profile,
      baseURL: azure.data.baseURL,
      deployment: azure.data.deployment,
      authMode: azure.data.authMode,
      ...(descriptor.phase === 'EMBEDDING'
        ? {
            tokenizerVersion: TOKENIZER_VERSION,
            queryVersion: HELP_QUERY_VERSION,
          }
        : {
            tokenizer: azure.data.tokenizer,
            schemaVersion: HELP_SCHEMA_VERSION,
            promptVersion:
              descriptor.phase === 'GENERATION'
                ? HELP_PROMPT_VERSION
                : HELP_VERIFICATION_PROMPT_VERSION,
          }),
    };
  }
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
