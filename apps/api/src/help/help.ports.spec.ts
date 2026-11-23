import {
  HELP_QUERY_VERSION,
  HELP_PROMPT_VERSION,
  HELP_VERIFICATION_PROMPT_VERSION,
  HELP_SCHEMA_VERSION,
  HELP_GENERATION_REQUEST_POLICY_VERSION,
  TOKENIZER_VERSION,
  verifiedHelpCalibrationHash,
} from '@alunza/ai';
import { createHash } from 'node:crypto';
import { loadConfig } from '../config';
import { productionHelpFactory } from './help.ports';
const environment = {
  ENVIRONMENT: 'test',
  APP_ORIGIN: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://alunza_app:unit-only@127.0.0.1:55322/postgres',
  SUPABASE_JWKS_URL: 'http://127.0.0.1:55321/auth/v1/.well-known/jwks.json',
  SUPABASE_JWT_ISSUER: 'http://127.0.0.1:55321/auth/v1',
  AI_AZURE_BASE_URL: 'https://help.openai.azure.com/openai/v1/',
  AI_AUTH_MODE: 'azure-cli',
  AI_GENERATION_DEPLOYMENT: 'help',
  AI_GENERATION_MODEL: 'gpt-4o',
  AI_GENERATION_CONFIGURATION_ID: 'help-v1',
  AI_GENERATION_TOKENIZER: 'o200k_base',
  AI_EMBEDDING_DEPLOYMENT: 'embed',
  AI_EMBEDDING_MODEL: 'text-embedding-3-small',
  AI_EMBEDDING_DIMENSIONS: '1536',
  AI_CONFIGURATION_ID: 'embed-v1',
  HELP_CALIBRATION_CORPUS_SHA256: 'a'.repeat(64),
  HELP_CALIBRATION_JSON: JSON.stringify({
    version: 'help-evidence-2',
    origin: 'AZURE',
    runId: 'a0000000-0000-4000-8000-000000000001',
    evidenceHash: 'c'.repeat(64),
    corpusManifestHash: 'd'.repeat(64),
    receiptCount: 6,
    observationCount: 6,
    measurement: {
      version: 'help-evidence-1',
      measurementProvider: 'azure',
      binding: {
        configurationId: 'embed-v1',
        embeddingModel: 'text-embedding-3-small',
        dimensions: 1536,
        tokenizerVersion: TOKENIZER_VERSION,
        queryVersion: HELP_QUERY_VERSION,
        corpusHash: 'a'.repeat(64),
      },
      acceptanceThreshold: 0.1,
      calibrationCases: 4,
      validationCases: 2,
      validationSupported: 1,
      validationAccepted: 1,
      falseAcceptances: 0,
      casesHash: 'b'.repeat(64),
    },
  }),
};
// An explicit unit trust input exercises the pure factory; production obtains
// this digest independently from the durable evaluation repository.
const trustedHash = verifiedHelpCalibrationHash(
  environment.HELP_CALIBRATION_JSON,
);
test('a prior generation request policy cannot reuse the recovery checkpoint identity', () => {
  const config = loadConfig(environment);
  const generation = config.azureGenerationConfiguration!;
  const original = {
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
  };
  const hash = (value: object) =>
    createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const current = productionHelpFactory(config, trustedHash)()!;
  expect(current.configurationFingerprint).not.toBe(hash(original));
  expect(current.configurationFingerprint).toBe(
    hash({
      ...original,
      requestPolicyVersion: HELP_GENERATION_REQUEST_POLICY_VERSION,
    }),
  );
});
test('an uploaded calibration label or artifact does not establish server trust', () => {
  expect(productionHelpFactory(loadConfig(environment))()).toBeNull();
  expect(() =>
    productionHelpFactory(loadConfig(environment), 'e'.repeat(64))(),
  ).toThrow('CALIBRATION_INVALID');
});
test('runtime calibration requires an independently configured corpus binding', () => {
  expect(
    productionHelpFactory(
      loadConfig({ ...environment, HELP_CALIBRATION_CORPUS_SHA256: undefined }),
    )(),
  ).toBeNull();
  expect(() =>
    productionHelpFactory(
      loadConfig({
        ...environment,
        HELP_CALIBRATION_CORPUS_SHA256: 'c'.repeat(64),
      }),
      trustedHash,
    )(),
  ).toThrow('CALIBRATION_INVALID');
});
test.each([
  { AI_GENERATION_MODEL: 'gpt-4.1' },
  { AI_GENERATION_DEPLOYMENT: 'other-help' },
  { AI_VERIFICATION_MODEL: 'gpt-4.1' },
  { AI_VERIFICATION_DEPLOYMENT: 'review' },
  { AI_AZURE_BASE_URL: 'https://other.openai.azure.com/openai/v1/' },
])(
  'recovery fingerprint changes with concrete provider configuration %j',
  (patch) => {
    const original = productionHelpFactory(
      loadConfig(environment),
      trustedHash,
    )()!;
    const changed = productionHelpFactory(
      loadConfig({ ...environment, ...patch }),
      trustedHash,
    )()!;
    expect(changed.configurationId).toBe(original.configurationId);
    expect(changed.configurationFingerprint).not.toBe(
      original.configurationFingerprint,
    );
  },
);
