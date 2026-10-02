const { createHash } = require('node:crypto');
const {
  evaluationProviderFingerprint,
  TOKENIZER_VERSION,
  HELP_QUERY_VERSION,
  HELP_PROMPT_VERSION,
  HELP_VERIFICATION_PROMPT_VERSION,
  HELP_SCHEMA_VERSION,
} = require('../../packages/ai/dist');

const hash = (payload) =>
  createHash('sha256').update(JSON.stringify(payload)).digest('hex');
const profiles = {
  EMBEDDING: {
    id: 'embedding-fixture',
    model: 'text-embedding-3-small',
    dimensions: 3,
  },
  GENERATION: { id: 'generation-fixture', model: 'gpt-4.1-mini-2025-04-14' },
  REVIEW: { id: 'generation-fixture', model: 'gpt-4.1-mini-2025-04-14' },
};
const azure = {
  baseURL: 'https://fixture.openai.azure.com/openai/v1/',
  deployment: 'fixture-deployment',
  authMode: 'azure-cli',
};
const descriptor = (phase) => ({
  provider: 'AZURE',
  phase,
  profile: profiles[phase],
  azure: {
    ...azure,
    ...(phase === 'EMBEDDING' ? {} : { tokenizer: 'o200k_base' }),
  },
});

test.each(Object.keys(profiles))(
  'preserves the exact existing TEST identity for %s',
  (phase) => {
    expect(
      evaluationProviderFingerprint({
        provider: 'TEST',
        phase,
        profile: profiles[phase],
      }),
    ).toBe(hash({ origin: 'TEST', phase, ...profiles[phase] }));
  },
);

test.each(Object.keys(profiles))(
  'preserves the exact existing Azure identity for %s',
  (phase) => {
    const legacy =
      phase === 'EMBEDDING'
        ? {
            phase,
            ...profiles[phase],
            ...azure,
            tokenizerVersion: TOKENIZER_VERSION,
            queryVersion: HELP_QUERY_VERSION,
          }
        : {
            phase,
            ...profiles[phase],
            ...azure,
            tokenizer: 'o200k_base',
            schemaVersion: HELP_SCHEMA_VERSION,
            promptVersion:
              phase === 'GENERATION'
                ? HELP_PROMPT_VERSION
                : HELP_VERIFICATION_PROMPT_VERSION,
          };
    expect(evaluationProviderFingerprint(descriptor(phase))).toBe(hash(legacy));
  },
);

test.each([
  { baseURL: 'https://different.openai.azure.com/openai/v1/' },
  { deployment: 'other-deployment' },
  { authMode: 'managed-identity' },
  { tokenizer: 'cl100k_base' },
])(
  'public runtime destination changes cannot reuse the generation identity: %j',
  (change) => {
    const original = descriptor('GENERATION');
    expect(
      evaluationProviderFingerprint({
        ...original,
        azure: { ...original.azure, ...change },
      }),
    ).not.toBe(evaluationProviderFingerprint(original));
  },
);

test('prices, unknown metadata and profile property order are outside provider identity', () => {
  const original = descriptor('EMBEDDING');
  const reordered = {
    dimensions: 3,
    model: profiles.EMBEDDING.model,
    id: profiles.EMBEDDING.id,
    inputMicroUsdPerMillion: '999',
    outputMicroUsdPerMillion: '999',
    apiKey: 'fictitious-never-hashed',
  };
  expect(
    evaluationProviderFingerprint({ ...original, profile: reordered }),
  ).toBe(evaluationProviderFingerprint(original));
});

test('generation and review remain different identities on the same deployment and model', () => {
  expect(evaluationProviderFingerprint(descriptor('GENERATION'))).not.toBe(
    evaluationProviderFingerprint(descriptor('REVIEW')),
  );
});

test.each([
  { apiKey: 'fictitious-secret' },
  { baseURL: 'https://fictitious-secret@fixture.openai.azure.com/openai/v1/' },
  {
    baseURL:
      'https://fixture.openai.azure.com/openai/v1/?key=fictitious-secret',
  },
  { deployment: 'fictitious-secret/invalid' },
  { authMode: 'fictitious-secret' },
])(
  'invalid or secret-bearing descriptors fail without echoing their contents',
  (change) => {
    const original = descriptor('GENERATION');
    expect(() =>
      evaluationProviderFingerprint({
        ...original,
        azure: { ...original.azure, ...change },
      }),
    ).toThrow(/^INVALID_EVALUATION_PROVIDER_DESCRIPTOR$/);
  },
);

test.each([
  { ...descriptor('EMBEDDING'), profile: { id: 'fixture', model: 'fixture' } },
  { ...descriptor('GENERATION'), profile: profiles.EMBEDDING },
  { ...descriptor('REVIEW'), azure },
  { ...descriptor('EMBEDDING'), azure: { ...azure, tokenizer: 'o200k_base' } },
  { provider: 'TEST', phase: 'EMBEDDING', profile: profiles.EMBEDDING, azure },
])('rejects phase descriptors that the product cannot execute', (value) => {
  expect(() => evaluationProviderFingerprint(value)).toThrow(
    'INVALID_EVALUATION_PROVIDER_DESCRIPTOR',
  );
});
