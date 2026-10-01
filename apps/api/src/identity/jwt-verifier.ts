import { Inject, Injectable } from '@nestjs/common';
import { createRemoteJWKSet, errors, jwtVerify } from 'jose';
import type { JWTVerifyGetKey } from 'jose';
import { z } from 'zod';
import { APP_CONFIG } from '../config';
import type { AppConfig } from '../config';
import { ApiError, unauthenticated } from '../http/errors';

export const JWT_KEY_RESOLVER = Symbol('JWT_KEY_RESOLVER');
export interface VerifiedIdentity {
  actorId: string;
  sessionId: string;
}

export function remoteKeyResolver(config: AppConfig): JWTVerifyGetKey {
  return createRemoteJWKSet(new URL(config.jwksUrl), {
    timeoutDuration: 1500,
    cooldownDuration: 30_000,
    cacheMaxAge: 600_000,
  });
}

@Injectable()
export class JwtVerifier {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(JWT_KEY_RESOLVER) private readonly keys: JWTVerifyGetKey,
  ) {}

  async verify(authorization: string | undefined): Promise<VerifiedIdentity> {
    const match = authorization?.match(
      /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i,
    );
    const token = match?.[1];
    if (!token || token.length > 8192) throw unauthenticated();
    try {
      const { payload } = await jwtVerify(token, this.keys, {
        algorithms: ['ES256'],
        issuer: this.config.jwtIssuer,
        audience: this.config.jwtAudience,
        requiredClaims: ['sub', 'iss', 'aud', 'exp', 'session_id'],
      });
      const subject = z.uuid().safeParse(payload.sub);
      const session = z.uuid().safeParse(payload.session_id);
      if (!subject.success || !session.success) throw unauthenticated();
      return { actorId: subject.data, sessionId: session.data };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (
        error instanceof errors.JWKSTimeout ||
        error instanceof TypeError ||
        (error instanceof errors.JOSEError &&
          ['ERR_JWKS_INVALID', 'ERR_JOSE_GENERIC'].includes(error.code))
      ) {
        throw new ApiError(
          'DEPENDENCY_UNAVAILABLE',
          'La verificación de sesión no está disponible.',
          503,
          true,
        );
      }
      throw unauthenticated();
    }
  }
}
