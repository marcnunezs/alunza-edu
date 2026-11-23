import { EvaluationRepository } from './evaluation.repository';
import { evaluationProviderProfile } from '../evaluation-profiles';
import type { DatabaseService } from '../database/database.service';
import type { AppConfig } from '../config';

const config = {
  azureEmbeddingConfiguration: {
    baseURL: 'https://unit-one.openai.azure.com/openai/v1/',
    embeddingDeployment: 'unit-deployment',
    embeddingModel: 'text-embedding-3-small',
    configurationId: 'stable-unit-profile',
    dimensions: 3,
    authMode: 'azure-cli',
  },
  azureGenerationConfiguration: null,
} satisfies Pick<
  AppConfig,
  'azureEmbeddingConfiguration' | 'azureGenerationConfiguration'
>;
const fallback = { id: 'test', model: 'test', dimensions: 3 };

function fixture() {
  const client = {
    query: jest.fn().mockResolvedValue({ rows: [{ result: null }] }),
  };
  const database = {
    internal: jest.fn(async (run: (client: unknown) => Promise<unknown>) =>
      run(client),
    ),
  };
  return {
    client,
    repository: new EvaluationRepository(
      database as unknown as DatabaseService,
    ),
  };
}

test('a missing runtime fingerprint stays null at the authoritative attestation gate', async () => {
  const { repository, client } = fixture();
  // Even a supplied artifact cannot establish the actual deployment identity.
  const artifact = { fingerprint: 'f'.repeat(64) };
  await expect(repository.assertCalibration(artifact)).resolves.toBeNull();
  expect(client.query).toHaveBeenCalledWith(
    'SELECT app_private.evaluation_calibration_assert($1,$2,$3) AS result',
    [JSON.stringify(artifact), false, null],
  );
});

test.each([
  { baseURL: 'https://unit-two.openai.azure.com/openai/v1/' },
  { embeddingDeployment: 'another-deployment' },
  { authMode: 'managed-identity' as const },
])(
  'a changed effective destination cannot reuse the original attestation: %j',
  async (change) => {
    const before = evaluationProviderProfile(
      config as AppConfig,
      'EMBEDDING',
      fallback,
    );
    const changed = {
      ...config,
      azureEmbeddingConfiguration: {
        ...config.azureEmbeddingConfiguration,
        ...change,
      },
    };
    const after = evaluationProviderProfile(
      changed as AppConfig,
      'EMBEDDING',
      fallback,
    );
    expect(after.id).toBe(before.id);
    expect(after.model).toBe(before.model);
    expect(after.dimensions).toBe(before.dimensions);
    expect(after.fingerprint).not.toBe(before.fingerprint);
    const { repository, client } = fixture();
    const artifact = { fingerprint: before.fingerprint };
    await repository.assertCalibration(artifact, false, after.fingerprint);
    expect(client.query).toHaveBeenCalledWith(
      'SELECT app_private.evaluation_calibration_assert($1,$2,$3) AS result',
      [JSON.stringify(artifact), false, after.fingerprint],
    );
  },
);
