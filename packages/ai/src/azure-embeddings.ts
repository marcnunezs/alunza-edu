import OpenAI from 'openai';
import { observeAiTransport } from './settlement';
import type { AiSettlementObserver } from './settlement';
import {
  AzureCliCredential,
  ManagedIdentityCredential,
  getBearerTokenProvider,
} from '@azure/identity';
import { z } from 'zod';
import type { EmbeddingConfiguration, EmbeddingsPort } from './ports';
import { validateVectors } from './ports';
import { azureConfigurationSchema } from './azure';
import {
  MATERIAL_INGESTION_LIMITS,
  MaterialIngestionError,
  materialTokenCount,
} from './ingestion';

export const azureEmbeddingConfigurationSchema = z
  .strictObject({
    baseURL: azureConfigurationSchema.shape.baseURL,
    embeddingDeployment: azureConfigurationSchema.shape.embeddingDeployment,
    embeddingModel: z.enum([
      'text-embedding-ada-002',
      'text-embedding-3-small',
      'text-embedding-3-large',
    ]),
    configurationId: azureConfigurationSchema.shape.configurationId,
    dimensions: z.number().int().min(1).max(3072),
    authMode: z.enum(['azure-cli', 'api-key', 'managed-identity']),
    apiKey: z.string().min(1).optional(),
    managedIdentityClientId: z.uuid().optional(),
  })
  .superRefine((config, context) => {
    if (
      (config.authMode === 'api-key') !== Boolean(config.apiKey) ||
      (config.authMode !== 'managed-identity' &&
        Boolean(config.managedIdentityClientId))
    )
      context.addIssue({
        code: 'custom',
        message: 'Choose one authentication mechanism.',
      });
    if (
      (config.embeddingModel === 'text-embedding-ada-002' &&
        config.dimensions !== 1536) ||
      (config.embeddingModel === 'text-embedding-3-small' &&
        config.dimensions > 1536)
    )
      context.addIssue({
        code: 'custom',
        message: 'Incompatible embedding configuration.',
      });
  });
export type AzureEmbeddingConfiguration = z.infer<
  typeof azureEmbeddingConfigurationSchema
>;
export function azureEmbeddingConfigurationFromEnv(
  env: NodeJS.ProcessEnv,
): AzureEmbeddingConfiguration {
  const result = azureEmbeddingConfigurationSchema.safeParse({
    baseURL: env.AI_AZURE_BASE_URL,
    embeddingDeployment: env.AI_EMBEDDING_DEPLOYMENT,
    embeddingModel: env.AI_EMBEDDING_MODEL,
    configurationId: env.AI_CONFIGURATION_ID,
    dimensions: Number(env.AI_EMBEDDING_DIMENSIONS),
    authMode: env.AI_AUTH_MODE,
    ...(env.AI_AZURE_API_KEY ? { apiKey: env.AI_AZURE_API_KEY } : {}),
    ...(env.AI_MANAGED_IDENTITY_CLIENT_ID
      ? { managedIdentityClientId: env.AI_MANAGED_IDENTITY_CLIENT_ID }
      : {}),
  });
  if (!result.success)
    throw new MaterialIngestionError('INVALID_CONFIGURATION');
  return result.data;
}
export class AzureEmbeddingsAdapter implements EmbeddingsPort {
  readonly configuration: EmbeddingConfiguration;
  private readonly client: OpenAI;
  private readonly settings: AzureEmbeddingConfiguration;
  private readonly transport: typeof fetch;
  private readonly observer?: AiSettlementObserver;
  // One bounded observation; the domain persists safe usage per completed job.
  lastUsage:
    { inputTokens: number; model: string; requestId?: string } | undefined;
  constructor(
    config: AzureEmbeddingConfiguration,
    transport?: typeof fetch,
    observer?: AiSettlementObserver,
  ) {
    const parsed = azureEmbeddingConfigurationSchema.safeParse(config);
    if (!parsed.success)
      throw new MaterialIngestionError('INVALID_CONFIGURATION');
    this.settings = parsed.data;
    this.transport = transport ?? globalThis.fetch;
    this.observer = observer;
    this.configuration = {
      id: config.configurationId,
      model: config.embeddingModel,
      dimensions: config.dimensions,
    };
    this.client = new OpenAI({
      baseURL: config.baseURL,
      apiKey:
        config.authMode === 'api-key'
          ? config.apiKey
          : getBearerTokenProvider(
              config.authMode === 'managed-identity'
                ? new ManagedIdentityCredential(
                    config.managedIdentityClientId
                      ? { clientId: config.managedIdentityClientId }
                      : {},
                  )
                : new AzureCliCredential(),
              'https://ai.azure.com/.default',
            ),
      maxRetries: 0,
      timeout: 15_000,
      logLevel: 'off',
      ...(transport ? { fetch: transport } : {}),
    });
  }
  async embed(
    texts: readonly string[],
    signal: AbortSignal,
    observe?: AiSettlementObserver,
  ): Promise<readonly (readonly number[])[]> {
    this.lastUsage = undefined;
    if (signal.aborted) throw new MaterialIngestionError('CANCELLED');
    if (
      !texts.length ||
      texts.length > MATERIAL_INGESTION_LIMITS.embeddingBatchSize ||
      texts.some(
        (text) =>
          !text.trim() ||
          materialTokenCount(text) > MATERIAL_INGESTION_LIMITS.chunkTokens,
      )
    )
      throw new MaterialIngestionError('INVALID_EMBEDDING');
    try {
      const observer = observe ?? this.observer;
      const client = observer
        ? this.client.withOptions({
            fetch: observeAiTransport(this.transport, observer, 'EMBEDDING'),
          })
        : this.client;
      const response = await client.embeddings.create(
        {
          model: this.settings.embeddingDeployment,
          input: [...texts],
          encoding_format: 'float',
          ...(this.settings.embeddingModel === 'text-embedding-ada-002'
            ? {}
            : { dimensions: this.settings.dimensions }),
        },
        { signal },
      );
      if (signal.aborted) throw new MaterialIngestionError('CANCELLED');
      if (
        response.model !== this.settings.embeddingModel ||
        !Array.isArray(response.data) ||
        response.data.length !== texts.length ||
        response.data.some(
          (item) =>
            !item ||
            typeof item !== 'object' ||
            !Number.isInteger(item.index) ||
            item.index < 0 ||
            item.index >= texts.length,
        ) ||
        new Set(response.data.map((item) => item.index)).size !== texts.length
      )
        throw new MaterialIngestionError('INVALID_EMBEDDING');
      const vectors = [...response.data]
        .sort((a, b) => a.index - b.index)
        .map((item) => item.embedding);
      try {
        validateVectors(vectors, texts.length, this.configuration.dimensions);
      } catch {
        throw new MaterialIngestionError('INVALID_EMBEDDING');
      }
      if (
        Number.isSafeInteger(response.usage?.prompt_tokens) &&
        response.usage.prompt_tokens >= 0
      ) {
        this.lastUsage = {
          inputTokens: response.usage.prompt_tokens,
          model: response.model,
          ...(typeof response._request_id === 'string' &&
          /^[\w.-]{1,128}$/u.test(response._request_id)
            ? { requestId: response._request_id }
            : {}),
        };
      }
      return vectors;
    } catch (error) {
      if (error instanceof MaterialIngestionError) throw error;
      if (signal.aborted) throw new MaterialIngestionError('CANCELLED');
      if (error instanceof OpenAI.APIError) {
        const status = error.status;
        const retryable =
          status === undefined ||
          status === 408 ||
          status === 429 ||
          (status >= 500 && status <= 599);
        const seconds = Number(error.headers?.get('retry-after'));
        const retryAfterMs =
          Number.isFinite(seconds) && seconds > 0
            ? Math.min(300_000, Math.ceil(seconds * 1000))
            : undefined;
        throw new MaterialIngestionError(
          retryable ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_REJECTED',
          retryable,
          retryable ? retryAfterMs : undefined,
        );
      }
      throw new MaterialIngestionError('INVALID_EMBEDDING');
    }
  }
}
