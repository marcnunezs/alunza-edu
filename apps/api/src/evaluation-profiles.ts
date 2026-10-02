import { evaluationProviderFingerprint } from '@alunza/ai';
import type { AppConfig } from './config';
import type { EvaluationPhase } from '@alunza/contracts';

export function evaluationProviderProfile(
  config: AppConfig,
  phase: EvaluationPhase,
  fallback: { id: string; model: string; dimensions?: number },
) {
  const embedding = config.azureEmbeddingConfiguration;
  const generation = config.azureGenerationConfiguration;
  const profile =
    phase === 'EMBEDDING' && embedding
      ? {
          id: embedding.configurationId,
          model: embedding.embeddingModel,
          dimensions: embedding.dimensions,
        }
      : phase !== 'EMBEDDING' && generation
        ? {
            id: generation.configurationId,
            model:
              phase === 'GENERATION'
                ? generation.generationModel
                : generation.verificationModel,
          }
        : fallback;
  const descriptor =
    phase === 'EMBEDDING' && embedding
      ? {
          provider: 'AZURE' as const,
          azure: {
            baseURL: embedding.baseURL,
            deployment: embedding.embeddingDeployment,
            authMode: embedding.authMode,
          },
        }
      : phase !== 'EMBEDDING' && generation
        ? {
            provider: 'AZURE' as const,
            azure: {
              baseURL: generation.baseURL,
              deployment:
                phase === 'GENERATION'
                  ? generation.generationDeployment
                  : generation.verificationDeployment,
              authMode: generation.authMode,
              tokenizer: generation.tokenizer,
            },
          }
        : { provider: 'TEST' as const };
  return {
    ...profile,
    fingerprint: evaluationProviderFingerprint({
      phase,
      profile,
      ...descriptor,
    }),
  };
}
