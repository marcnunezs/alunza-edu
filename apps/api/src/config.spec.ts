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
    expect(config.invitationCallbackUrl).toBe(
      'http://localhost:3000/acceso/invitacion',
    );
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
});
