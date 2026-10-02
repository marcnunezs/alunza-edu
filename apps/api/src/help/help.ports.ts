import {
  AzureEmbeddingsAdapter,
  AzureHelpAdapter,
  HELP_QUERY_VERSION,
  HELP_PROMPT_VERSION,
  HELP_VERIFICATION_PROMPT_VERSION,
  HELP_SCHEMA_VERSION,
  TOKENIZER_VERSION,
  verifiedHelpEvidencePolicyFromArtifact,
} from '@alunza/ai';
import type {
  EmbeddingsPort,
  HelpGenerationPort,
  HelpVerificationPort,
  HelpTokenizer,
  RetrievedChunk,
} from '@alunza/ai';
import type { AppConfig } from '../config';
import { createHash } from 'node:crypto';

export const HELP_PROVIDER_FACTORY = Symbol('HELP_PROVIDER_FACTORY');
export interface HelpProviders {
  embeddings: EmbeddingsPort;
  generation: HelpGenerationPort;
  verification: HelpVerificationPort;
  tokenizer: HelpTokenizer;
  configurationId: string;
  configurationFingerprint: string;
  evidence: {
    version: string;
    select(chunks: readonly RetrievedChunk[]): {
      chunks: readonly RetrievedChunk[];
      reason: 'SUPPORTED' | 'NO_EVIDENCE' | 'AMBIGUOUS_EVIDENCE';
    };
  };
}
export type HelpProviderFactory = () =>
  HelpProviders | null | Promise<HelpProviders | null>;
export function productionHelpFactory(
  config: AppConfig,
  trustedEvidenceHash?: string,
): () => HelpProviders | null {
  return () => {
    const embedding = config.azureEmbeddingConfiguration;
    const generation = config.azureGenerationConfiguration;
    const artifact = config.helpCalibration;
    if (
      !embedding ||
      !generation ||
      !artifact ||
      !config.helpCalibrationCorpusHash ||
      !trustedEvidenceHash ||
      artifact.version !== 'help-evidence-2'
    )
      return null;
    const evidence = verifiedHelpEvidencePolicyFromArtifact(
      artifact,
      {
        configurationId: embedding.configurationId,
        embeddingModel: embedding.embeddingModel,
        dimensions: embedding.dimensions,
        tokenizerVersion: TOKENIZER_VERSION,
        queryVersion: HELP_QUERY_VERSION,
        corpusHash: config.helpCalibrationCorpusHash,
      },
      trustedEvidenceHash,
    );
    // A separate adapter per job keeps last-call usage from racing with other
    // jobs or the independent document-ingestion worker.
    const adapter = new AzureHelpAdapter(generation);
    return {
      embeddings: new AzureEmbeddingsAdapter(embedding),
      generation: adapter,
      verification: adapter,
      tokenizer: generation.tokenizer,
      configurationId: generation.configurationId,
      configurationFingerprint: createHash('sha256')
        .update(
          JSON.stringify({
            configurationId: generation.configurationId,
            baseURL: generation.baseURL,
            generationDeployment: generation.generationDeployment,
            generationModel: generation.generationModel,
            verificationDeployment: generation.verificationDeployment,
            verificationModel: generation.verificationModel,
            tokenizer: generation.tokenizer,
            promptVersion: HELP_PROMPT_VERSION,
            verificationPromptVersion: HELP_VERIFICATION_PROMPT_VERSION,
            schemaVersion: HELP_SCHEMA_VERSION,
          }),
        )
        .digest('hex'),
      evidence,
    };
  };
}
