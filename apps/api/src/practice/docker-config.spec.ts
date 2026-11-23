import { ConfigurationError, loadConfig } from '../config';
import { loadDockerConfiguration } from './docker-config';
import {
  configuredDockerExecutionContextSchema,
  executionContextSchema,
} from './execution.port';

const base = {
  APP_ORIGIN: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://alunza_app:unit@127.0.0.1/test',
  SUPABASE_JWKS_URL: 'http://localhost/auth/v1/.well-known/jwks.json',
  SUPABASE_JWT_ISSUER: 'http://localhost/auth/v1',
};
const candidate = {
  PRACTICE_DOCKER_RUNTIME: 'crun',
  PRACTICE_DOCKER_RUNTIME_NAME: 'alunza-crun',
  PRACTICE_DOCKER_RUNTIME_VERSION: '1.31',
  PRACTICE_DOCKER_RUNTIME_SHA256: 'a'.repeat(64),
  PRACTICE_DOCKER_STRATEGY: 'prepared-pair-v1',
};

describe('explicit local Docker candidate configuration', () => {
  it('keeps existing environments on legacy cold Docker without new resource creation', () => {
    expect(loadConfig(base).dockerConfiguration).toBeUndefined();
    expect(
      loadDockerConfiguration({
        PRACTICE_DOCKER_RUNTIME: 'runc',
        PRACTICE_DOCKER_STRATEGY: 'cold',
      }),
    ).toBeUndefined();
  });

  it.each(['local', 'test'])(
    'pins a complete immutable candidate in %s',
    (environment) => {
      const result = loadConfig({
        ...base,
        ...candidate,
        ENVIRONMENT: environment,
      });
      expect(result.dockerConfiguration).toEqual({
        runtime: 'crun',
        runtimeName: 'alunza-crun',
        runtimeVersion: '1.31',
        runtimeSha256: 'a'.repeat(64),
        strategy: 'prepared-pair-v1',
      });
      expect(Object.isFrozen(result.dockerConfiguration)).toBe(true);
    },
  );

  it('allows explicit cold runtime selection independently of prewarming', () => {
    expect(
      loadDockerConfiguration({
        ...candidate,
        PRACTICE_DOCKER_RUNTIME: 'runc',
        PRACTICE_DOCKER_RUNTIME_NAME: 'alunza-runc',
        PRACTICE_DOCKER_RUNTIME_VERSION: '1.3.4',
        PRACTICE_DOCKER_STRATEGY: 'cold',
      }),
    ).toMatchObject({ runtime: 'runc', strategy: 'cold' });
  });

  it.each([
    { PRACTICE_DOCKER_RUNTIME_NAME: undefined },
    { PRACTICE_DOCKER_RUNTIME_VERSION: undefined },
    { PRACTICE_DOCKER_RUNTIME_SHA256: undefined },
    { PRACTICE_DOCKER_RUNTIME: 'automatic' },
    { PRACTICE_DOCKER_RUNTIME_VERSION: '1.14.1' },
    {
      PRACTICE_DOCKER_RUNTIME: 'runc',
      PRACTICE_DOCKER_RUNTIME_VERSION: '1.3.3',
    },
    { PRACTICE_DOCKER_RUNTIME_NAME: 'a'.repeat(65) },
    { PRACTICE_DOCKER_RUNTIME_NAME: '/private/runtime' },
    { PRACTICE_DOCKER_RUNTIME_SHA256: 'A'.repeat(64) },
    { PRACTICE_DOCKER_STRATEGY: 'reuse' },
  ])(
    'rejects incomplete or unsupported settings without echoing values: %j',
    (patch) => {
      expect(() => loadConfig({ ...base, ...candidate, ...patch })).toThrow(
        new ConfigurationError(['PRACTICE_DOCKER_CONFIGURATION']),
      );
    },
  );

  it.each(['preproduction', 'production'])(
    'does not activate the local candidate in %s',
    (environment) => {
      expect(() =>
        loadConfig({ ...base, ...candidate, ENVIRONMENT: environment }),
      ).toThrow('PRACTICE_DOCKER_CONFIGURATION');
    },
  );

  it('rejects Docker candidate settings when Vercel is selected', () => {
    expect(() =>
      loadConfig({ ...base, ...candidate, PRACTICE_RUNNER_PROVIDER: 'vercel' }),
    ).toThrow('PRACTICE_DOCKER_CONFIGURATION');
  });
});

describe('durable Docker context compatibility', () => {
  const legacy = {
    provider: 'docker',
    image: `sha256:${'b'.repeat(64)}`,
    runnerVersion: 'unit',
  };
  const identity = {
    engineId: 'engine-unit',
    runtimeName: 'alunza-crun',
    runtimeVersion: '1.31',
    runtimeSha256: 'a'.repeat(64),
    strategy: 'prepared-pair-v1',
  };

  it('preserves the exact three-field historical context', () => {
    expect(executionContextSchema.parse(legacy)).toEqual(legacy);
    expect(
      configuredDockerExecutionContextSchema.safeParse(legacy).success,
    ).toBe(false);
  });

  it('accepts complete identity and rejects every partial combination', () => {
    expect(executionContextSchema.parse({ ...legacy, ...identity })).toEqual({
      ...legacy,
      ...identity,
    });
    const entries = Object.entries(identity);
    for (let mask = 1; mask < 31; mask++) {
      const partial = Object.fromEntries(
        entries.filter((_, index) => mask & (1 << index)),
      );
      expect(
        executionContextSchema.safeParse({ ...legacy, ...partial }).success,
      ).toBe(false);
    }
  });

  it('rejects unknown fields, mutable images and unsafe runtime identities', () => {
    for (const patch of [
      { image: 'image:latest' },
      { engineId: '../engine' },
      { runtimeName: '--runtime=other' },
      { runtimeVersion: '1.31\nextra' },
      { runtimeSha256: 'a'.repeat(63) },
      { strategy: 'reuse' },
      { path: '/private/runtime' },
    ])
      expect(
        executionContextSchema.safeParse({ ...legacy, ...identity, ...patch })
          .success,
      ).toBe(false);
  });
});
