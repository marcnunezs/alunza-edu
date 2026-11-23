import type OpenAI from 'openai';
import type { APIError } from 'openai';
import type { AzureConfiguration } from './azure';

type ClientConfiguration = Pick<
  AzureConfiguration,
  'baseURL' | 'authMode' | 'apiKey' | 'managedIdentityClientId'
>;

function openAIConstructor(): typeof OpenAI {
  // Constructors stay synchronous; importing schemas does not load provider SDKs.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require('openai') as typeof import('openai')).default;
}

function azureApiKey(config: ClientConfiguration) {
  if (config.authMode === 'api-key') return config.apiKey;
  const {
    AzureCliCredential,
    ManagedIdentityCredential,
    getBearerTokenProvider,
  } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('@azure/identity') as typeof import('@azure/identity');
  return getBearerTokenProvider(
    config.authMode === 'managed-identity'
      ? new ManagedIdentityCredential(
          config.managedIdentityClientId
            ? { clientId: config.managedIdentityClientId }
            : {},
        )
      : new AzureCliCredential(),
    'https://ai.azure.com/.default',
  );
}

// Call only after the adapter has validated its complete configuration.
export function createAzureClient(
  config: ClientConfiguration,
  transport?: typeof fetch,
): OpenAI {
  const Client = openAIConstructor();
  return new Client({
    baseURL: config.baseURL,
    apiKey: azureApiKey(config),
    maxRetries: 0,
    timeout: 15_000,
    logLevel: 'off',
    ...(transport ? { fetch: transport } : {}),
  });
}

export function isOpenAIAPIError(error: unknown): error is APIError {
  return error instanceof openAIConstructor().APIError;
}
