import { z } from 'zod';
import { X509Certificate } from 'node:crypto';

export const APP_CONFIG = Symbol('APP_CONFIG');

const webUrl = z.url().refine((value) => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return (
    !url.username &&
    !url.password &&
    (url.protocol === 'https:' ||
      (url.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
  );
});

const environmentSchema = z.object({
  ENVIRONMENT: z
    .enum(['local', 'test', 'preproduction', 'production'])
    .default('local'),
  RELEASE_ID: z
    .string()
    .regex(/^[a-f0-9]{40}$/)
    .optional(),
  DATABASE_SSL_CA: z.string().min(1).optional(),
  PORT: z.coerce.number().int().min(0).max(65535).default(4000),
  HOST: z.string().min(1).default('127.0.0.1'),
  APP_ORIGIN: webUrl,
  ALLOWED_ORIGINS: z.string().optional(),
  DATABASE_URL: z.url().refine((value) => {
    if (!URL.canParse(value)) return false;
    const url = new URL(value);
    return (
      ['postgres:', 'postgresql:'].includes(url.protocol) && !!url.username
    );
  }),
  SUPABASE_JWKS_URL: z.url(),
  SUPABASE_JWT_ISSUER: webUrl,
  SUPABASE_JWT_AUDIENCE: z.literal('authenticated').default('authenticated'),
  INVITATION_WORKER_ENABLED: z.enum(['true', 'false']).default('false'),
  SUPABASE_URL: z.url().optional(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1).optional(),
  SUPABASE_SECRET_KEY: z.string().min(1).optional(),
  INVITATION_CALLBACK_URL: webUrl.optional(),
});

export interface AppConfig {
  environment: 'local' | 'test' | 'preproduction' | 'production';
  releaseId: string;
  port: number;
  host: string;
  allowedOrigins: readonly string[];
  databaseUrl: string;
  databaseSsl:
    | false
    | Readonly<{ ca: string; rejectUnauthorized: true; servername: string }>;
  jwksUrl: string;
  jwtIssuer: string;
  jwtAudience: 'authenticated';
  invitationWorkerEnabled: boolean;
  supabaseUrl?: string;
  supabasePublishableKey?: string;
  supabaseSecretKey?: string;
  invitationCallbackUrl: string;
}

export class ConfigurationError extends Error {
  constructor(readonly fields: string[]) {
    super(`Configuración inválida: ${fields.join(', ')}`);
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = environmentSchema.safeParse(env);
  if (!result.success) {
    throw new ConfigurationError([
      ...new Set(result.error.issues.map((issue) => String(issue.path[0]))),
    ]);
  }
  const value = result.data;
  const local = ['local', 'test'].includes(value.ENVIRONMENT);
  const jwksUrl = new URL(value.SUPABASE_JWKS_URL);
  const dockerLocalJwks =
    local &&
    jwksUrl.protocol === 'http:' &&
    jwksUrl.hostname === 'host.docker.internal' &&
    !jwksUrl.username &&
    !jwksUrl.password;
  if (!webUrl.safeParse(value.SUPABASE_JWKS_URL).success && !dockerLocalJwks) {
    throw new ConfigurationError(['SUPABASE_JWKS_URL']);
  }
  const origins = (value.ALLOWED_ORIGINS ?? value.APP_ORIGIN)
    .split(',')
    .map((origin) => origin.trim());
  if (
    origins.some(
      (origin) =>
        !webUrl.safeParse(origin).success || new URL(origin).origin !== origin,
    ) ||
    new URL(value.APP_ORIGIN).origin !== value.APP_ORIGIN ||
    !origins.includes(value.APP_ORIGIN)
  ) {
    throw new ConfigurationError(['APP_ORIGIN', 'ALLOWED_ORIGINS']);
  }
  const databaseUrl = new URL(value.DATABASE_URL);
  const invitationCallbackUrl =
    value.INVITATION_CALLBACK_URL ?? `${value.APP_ORIGIN}/acceso/invitacion`;
  const callback = new URL(invitationCallbackUrl);
  if (
    !origins.includes(callback.origin) ||
    callback.hash ||
    callback.search ||
    callback.pathname !== '/acceso/invitacion'
  ) {
    throw new ConfigurationError(['INVITATION_CALLBACK_URL']);
  }
  if (
    value.INVITATION_WORKER_ENABLED === 'true' &&
    (!value.SUPABASE_URL ||
      !value.SUPABASE_SECRET_KEY ||
      !value.SUPABASE_PUBLISHABLE_KEY)
  ) {
    throw new ConfigurationError([
      'SUPABASE_URL',
      'SUPABASE_PUBLISHABLE_KEY',
      'SUPABASE_SECRET_KEY',
    ]);
  }
  if (value.SUPABASE_URL) {
    const transport = new URL(value.SUPABASE_URL);
    const docker =
      local &&
      transport.protocol === 'http:' &&
      transport.hostname === 'host.docker.internal';
    if (
      (!webUrl.safeParse(value.SUPABASE_URL).success && !docker) ||
      transport.username ||
      transport.password ||
      transport.search ||
      transport.hash ||
      transport.pathname !== '/'
    ) {
      throw new ConfigurationError(['SUPABASE_URL']);
    }
    if (!local && `${transport.origin}/auth/v1` !== value.SUPABASE_JWT_ISSUER)
      throw new ConfigurationError(['SUPABASE_URL']);
  }
  let databaseSsl: AppConfig['databaseSsl'] = false;
  if (!local) {
    const remoteHttps = (input: string) => {
      const url = new URL(input);
      return (
        url.protocol === 'https:' &&
        ![
          'localhost',
          '127.0.0.1',
          '[::1]',
          '0.0.0.0',
          'host.docker.internal',
        ].includes(url.hostname) &&
        !url.hash &&
        !url.search
      );
    };
    if (!value.RELEASE_ID) throw new ConfigurationError(['RELEASE_ID']);
    if (!origins.every(remoteHttps))
      throw new ConfigurationError(['APP_ORIGIN', 'ALLOWED_ORIGINS']);
    if (
      !remoteHttps(value.SUPABASE_JWT_ISSUER) ||
      new URL(value.SUPABASE_JWT_ISSUER).pathname !== '/auth/v1'
    )
      throw new ConfigurationError(['SUPABASE_JWT_ISSUER']);
    if (
      !remoteHttps(value.SUPABASE_JWKS_URL) ||
      value.SUPABASE_JWKS_URL !==
        `${value.SUPABASE_JWT_ISSUER}/.well-known/jwks.json`
    )
      throw new ConfigurationError(['SUPABASE_JWKS_URL']);
    // pg connection-string SSL parameters replace the explicit TLS object.
    // Remote URLs therefore contain no query options; all TLS policy is here.
    if (
      databaseUrl.search ||
      databaseUrl.hash ||
      !databaseUrl.hostname ||
      [
        'localhost',
        '127.0.0.1',
        '[::1]',
        '0.0.0.0',
        'host.docker.internal',
      ].includes(databaseUrl.hostname) ||
      !/^alunza_app(?:\.[a-z0-9]+)?$/.test(databaseUrl.username)
    )
      throw new ConfigurationError(['DATABASE_URL']);
    if (!value.DATABASE_SSL_CA)
      throw new ConfigurationError(['DATABASE_SSL_CA']);
    try {
      new X509Certificate(value.DATABASE_SSL_CA);
    } catch {
      throw new ConfigurationError(['DATABASE_SSL_CA']);
    }
    databaseSsl = Object.freeze({
      ca: value.DATABASE_SSL_CA,
      rejectUnauthorized: true,
      servername: databaseUrl.hostname,
    });
  }
  return Object.freeze({
    environment: value.ENVIRONMENT,
    releaseId: value.RELEASE_ID ?? 'foundation-local',
    port: value.PORT,
    host: value.HOST,
    allowedOrigins: Object.freeze([...new Set(origins)]),
    databaseUrl: value.DATABASE_URL,
    databaseSsl,
    jwksUrl: value.SUPABASE_JWKS_URL,
    jwtIssuer: value.SUPABASE_JWT_ISSUER,
    jwtAudience: value.SUPABASE_JWT_AUDIENCE,
    invitationWorkerEnabled: value.INVITATION_WORKER_ENABLED === 'true',
    supabaseUrl: value.SUPABASE_URL,
    supabasePublishableKey: value.SUPABASE_PUBLISHABLE_KEY,
    supabaseSecretKey: value.SUPABASE_SECRET_KEY,
    invitationCallbackUrl,
  });
}
