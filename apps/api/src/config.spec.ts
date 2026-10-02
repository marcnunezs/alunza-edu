import { ConfigurationError, loadConfig } from './config';
import { rootCertificates } from 'node:tls';

export const validEnvironment: NodeJS.ProcessEnv = {
  APP_ORIGIN: 'http://localhost:3000',
  DATABASE_URL:
    'postgresql://alunza_app:unit-only-secret@127.0.0.1:55322/postgres',
  SUPABASE_JWKS_URL: 'http://127.0.0.1:55321/auth/v1/.well-known/jwks.json',
  SUPABASE_JWT_ISSUER: 'http://127.0.0.1:55321/auth/v1',
};

describe('configuration boundary', () => {
  const remote = {
    ENVIRONMENT: 'preproduction',
    RELEASE_ID: 'a'.repeat(40),
    APP_ORIGIN: 'https://web.alunza.invalid',
    DATABASE_URL:
      'postgresql://alunza_app.projectref:unit-only@db.alunza.invalid:5432/postgres',
    DATABASE_SSL_CA: rootCertificates[0],
    SUPABASE_JWKS_URL:
      'https://projectref.supabase.co/auth/v1/.well-known/jwks.json',
    SUPABASE_JWT_ISSUER: 'https://projectref.supabase.co/auth/v1',
  };

  it('requires CA and hostname verification for remote pooler connections', () => {
    const config = loadConfig(remote);
    expect(config.databaseSsl).toEqual({
      ca: rootCertificates[0],
      rejectUnauthorized: true,
      servername: 'db.alunza.invalid',
    });
    expect(config.releaseId).toBe('a'.repeat(40));
    expect(loadConfig(validEnvironment).databaseSsl).toBe(false);
  });

  it.each([
    { RELEASE_ID: undefined },
    { RELEASE_ID: 'release-with-newline\nsecret' },
    { DATABASE_SSL_CA: undefined },
    { DATABASE_SSL_CA: 'not-a-certificate' },
    { APP_ORIGIN: 'http://localhost:3000' },
    { ALLOWED_ORIGINS: 'https://web.alunza.invalid,http://localhost:3000' },
    { SUPABASE_JWT_ISSUER: 'http://127.0.0.1:15421/auth/v1' },
    {
      SUPABASE_JWKS_URL:
        'http://host.docker.internal:15421/auth/v1/.well-known/jwks.json',
    },
    {
      SUPABASE_JWKS_URL:
        'https://other.supabase.co/auth/v1/.well-known/jwks.json',
    },
    {
      DATABASE_URL:
        'postgresql://postgres:unit-only@db.alunza.invalid/postgres',
    },
    { DATABASE_URL: 'postgresql://alunza_app:unit-only@127.0.0.1/postgres' },
    {
      DATABASE_URL:
        'postgresql://alunza_app:unit-only@db.alunza.invalid/postgres?sslmode=no-verify',
    },
    {
      DATABASE_URL:
        'postgresql://alunza_app:unit-only@db.alunza.invalid/postgres?sslrootcert=untrusted',
    },
  ])('rejects unsafe preproduction configuration %j', (patch) => {
    expect(() => loadConfig({ ...remote, ...patch })).toThrow(
      ConfigurationError,
    );
    expect(() =>
      loadConfig({ ...remote, ...patch, ENVIRONMENT: 'production' }),
    ).toThrow(ConfigurationError);
  });

  it('uses explicit local defaults and freezes the result', () => {
    const config = loadConfig(validEnvironment);
    expect(config.port).toBe(4000);
    expect(config.host).toBe('127.0.0.1');
    expect(config.jwtAudience).toBe('authenticated');
    expect(config.allowedOrigins).toEqual(['http://localhost:3000']);
    expect(Object.isFrozen(config)).toBe(true);
    expect(config.invitationWorkerEnabled).toBe(false);
    expect(config.practiceRunnerEnabled).toBe(false);
    expect(config.practiceQuotas).toEqual({
      actorConcurrency: 1,
      submitActorConcurrency: 2,
      organizationConcurrency: 4,
      actorRequestsPerMinute: 10,
    });
    expect(config.invitationCallbackUrl).toBe(
      'http://localhost:3000/acceso/invitacion',
    );
  });

  it('permits Docker practice only on explicit local/test environments', () => {
    expect(
      loadConfig({ ...validEnvironment, PRACTICE_RUNNER_ENABLED: 'true' })
        .practiceRunnerEnabled,
    ).toBe(true);
    expect(() =>
      loadConfig({ ...remote, PRACTICE_RUNNER_ENABLED: 'true' }),
    ).toThrow(ConfigurationError);
    expect(() =>
      loadConfig({ ...validEnvironment, PRACTICE_ACTOR_CONCURRENCY: '0' }),
    ).toThrow(ConfigurationError);
    expect(() =>
      loadConfig({
        ...validEnvironment,
        PRACTICE_SUBMIT_ACTOR_CONCURRENCY: '0',
      }),
    ).toThrow(ConfigurationError);
    expect(() =>
      loadConfig({
        ...validEnvironment,
        PRACTICE_ORGANIZATION_CONCURRENCY: '33',
      }),
    ).toThrow(ConfigurationError);
    expect(() =>
      loadConfig({
        ...validEnvironment,
        PRACTICE_ACTOR_REQUESTS_PER_MINUTE: '121',
      }),
    ).toThrow(ConfigurationError);
  });

  it('requires separate Auth credentials and an allowlisted invitation callback', () => {
    expect(() =>
      loadConfig({ ...validEnvironment, INVITATION_WORKER_ENABLED: 'true' }),
    ).toThrow(ConfigurationError);
    expect(() =>
      loadConfig({
        ...validEnvironment,
        INVITATION_CALLBACK_URL: 'https://foreign.example/acceso/invitacion',
      }),
    ).toThrow(ConfigurationError);
    expect(() =>
      loadConfig({
        ...validEnvironment,
        INVITATION_CALLBACK_URL:
          'http://localhost:3000/acceso/invitacion?redirect=https://foreign.example',
      }),
    ).toThrow(ConfigurationError);
    expect(() =>
      loadConfig({
        ...validEnvironment,
        SUPABASE_URL: 'http://remote.example',
      }),
    ).toThrow(ConfigurationError);
  });

  it.each([
    'APP_ORIGIN',
    'DATABASE_URL',
    'SUPABASE_JWKS_URL',
    'SUPABASE_JWT_ISSUER',
  ])('rejects a missing %s before bootstrap', (key) => {
    const env = { ...validEnvironment };
    delete env[key];
    expect(() => loadConfig(env)).toThrow(ConfigurationError);
  });

  it.each([
    { ALLOWED_ORIGINS: '*' },
    { ALLOWED_ORIGINS: 'https://foreign.example' },
    { APP_ORIGIN: 'http://localhost:3000/path' },
    {
      SUPABASE_JWKS_URL: 'http://remote.example/auth/v1/.well-known/jwks.json',
    },
    { SUPABASE_JWT_AUDIENCE: 'service_role' },
    { PORT: 'not-a-port' },
  ])('rejects invalid configuration %j', (patch) => {
    expect(() => loadConfig({ ...validEnvironment, ...patch })).toThrow(
      ConfigurationError,
    );
  });

  it('reports only variable names, never rejected secrets', () => {
    try {
      loadConfig({
        ...validEnvironment,
        DATABASE_URL: 'secret-value-not-a-url',
      });
      throw new Error('Expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      expect((error as Error).message).toContain('DATABASE_URL');
      expect((error as Error).message).not.toContain('secret-value');
    }
  });

  it('allows the Docker host only for local JWKS transport', () => {
    const local = {
      ...validEnvironment,
      SUPABASE_JWKS_URL:
        'http://host.docker.internal:55321/auth/v1/.well-known/jwks.json',
    };
    expect(loadConfig(local).jwksUrl).toContain('host.docker.internal');
    expect(() => loadConfig({ ...local, ENVIRONMENT: 'production' })).toThrow(
      ConfigurationError,
    );
    expect(() =>
      loadConfig({
        ...validEnvironment,
        APP_ORIGIN: 'http://host.docker.internal:3000',
      }),
    ).toThrow(ConfigurationError);
  });

  it('keeps missing embeddings explicit and requires private Storage for its worker', () => {
    expect(loadConfig(validEnvironment).azureEmbeddingConfiguration).toBeNull();
    expect(() =>
      loadConfig({ ...validEnvironment, MATERIALS_WORKER_ENABLED: 'true' }),
    ).toThrow(ConfigurationError);
  });

  it('configures ingestion independently of generation credentials', () => {
    const config = loadConfig({
      ...validEnvironment,
      AI_AZURE_BASE_URL: 'https://materials.openai.azure.com/openai/v1/',
      AI_EMBEDDING_DEPLOYMENT: 'embeddings',
      AI_EMBEDDING_MODEL: 'text-embedding-3-small',
      AI_EMBEDDING_DIMENSIONS: '1536',
      AI_CONFIGURATION_ID: 'materials-v1',
      AI_AUTH_MODE: 'azure-cli',
    });
    expect(config.azureEmbeddingConfiguration?.embeddingModel).toBe(
      'text-embedding-3-small',
    );
    expect(config.materialsLeaseMs).toBe(60_000);
  });

  it('configures generation independently while missing calibration remains explicit', () => {
    const config = loadConfig({
      ...validEnvironment,
      AI_AZURE_BASE_URL: 'https://help.openai.azure.com/openai/v1/',
      AI_AUTH_MODE: 'azure-cli',
      AI_GENERATION_DEPLOYMENT: 'help',
      AI_GENERATION_MODEL: 'gpt-4o',
      AI_GENERATION_CONFIGURATION_ID: 'help-v1',
      AI_GENERATION_TOKENIZER: 'o200k_base',
      HELP_WORKER_ENABLED: 'true',
    });
    expect(config.azureEmbeddingConfiguration).toBeNull();
    expect(config.azureGenerationConfiguration?.verificationDeployment).toBe(
      'help',
    );
    expect(config.helpCalibration).toBeNull();
    expect(config.helpCalibrationCorpusHash).toBeNull();
    expect(config.helpWorkerEnabled).toBe(true);
  });
  it('rejects incomplete generation or unvalidated calibration without disclosing values', () => {
    for (const patch of [
      { AI_GENERATION_DEPLOYMENT: 'private-fixture-value' },
      { HELP_CALIBRATION_JSON: 'private-fixture-value' },
      { HELP_CALIBRATION_CORPUS_SHA256: 'private-fixture-value' },
    ]) {
      try {
        loadConfig({ ...validEnvironment, ...patch });
        throw new Error('Expected rejection');
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigurationError);
        expect(String(error)).not.toContain('private-fixture-value');
      }
    }
  });

  it('rejects incomplete embedding configuration without exposing supplied values', () => {
    expect(() =>
      loadConfig({
        ...validEnvironment,
        AI_AZURE_API_KEY: 'private-fixture-value',
      }),
    ).toThrow(ConfigurationError);
    try {
      loadConfig({
        ...validEnvironment,
        AI_AZURE_API_KEY: 'private-fixture-value',
      });
    } catch (error) {
      expect(String(error)).not.toContain('private-fixture-value');
    }
  });
});
