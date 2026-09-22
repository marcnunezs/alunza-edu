import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { JWTPayload } from 'jose';
import { APP_CONFIG, loadConfig } from '../config';
import { ApiError } from '../http/errors';
import { JWT_KEY_RESOLVER, JwtVerifier } from './jwt-verifier';

const actor = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const config = loadConfig({
  APP_ORIGIN: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://alunza_app:unit-only@127.0.0.1:55322/postgres',
  SUPABASE_JWKS_URL: 'http://127.0.0.1:55321/auth/v1/.well-known/jwks.json',
  SUPABASE_JWT_ISSUER: 'http://127.0.0.1:55321/auth/v1',
});

describe('JWT verification with real ES256 signatures', () => {
  let keys: Awaited<ReturnType<typeof generateKeyPair>>;
  let verifier: JwtVerifier;

  beforeAll(async () => {
    keys = await generateKeyPair('ES256');
    const publicKey = await exportJWK(keys.publicKey);
    publicKey.kid = 'unit-key';
    publicKey.alg = 'ES256';
    const module = await Test.createTestingModule({
      providers: [
        JwtVerifier,
        { provide: APP_CONFIG, useValue: config },
        {
          provide: JWT_KEY_RESOLVER,
          useValue: createLocalJWKSet({ keys: [publicKey] }),
        },
      ],
    }).compile();
    verifier = module.get(JwtVerifier);
    await module.close();
  });

  async function token(patch: JWTPayload = {}) {
    return new SignJWT({
      sub: actor,
      session_id: sessionId,
      iss: config.jwtIssuer,
      aud: 'authenticated',
      exp: Math.floor(Date.now() / 1000) + 300,
      ...patch,
    })
      .setProtectedHeader({ alg: 'ES256', kid: 'unit-key' })
      .sign(keys.privateKey);
  }

  it('accepts signed identity and ignores editable metadata', async () => {
    expect(
      await verifier.verify(
        `Bearer ${await token({ user_metadata: { role: 'ADMIN', userId: 'spoofed' } })}`,
      ),
    ).toEqual({ actorId: actor, sessionId });
  });

  it.each([
    undefined,
    '',
    'Basic abc',
    'Bearer not-a-jwt',
    'Bearer a.b.c extra',
  ])('rejects absent or malformed authorization', async (authorization) => {
    await expect(verifier.verify(authorization)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it.each([
    { iss: 'https://foreign.example/auth/v1' },
    { aud: 'service_role' },
    { sub: 'not-a-uuid' },
    { session_id: undefined },
    { session_id: 'not-a-session' },
    { exp: 1 },
    { exp: undefined },
    { nbf: Math.floor(Date.now() / 1000) + 3600 },
  ])('rejects invalid claims %j', async (patch) => {
    await expect(
      verifier.verify(`Bearer ${await token(patch)}`),
    ).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('rejects a token signed by another private key', async () => {
    const foreign = await generateKeyPair('ES256');
    const forged = await new SignJWT({ sub: actor })
      .setProtectedHeader({ alg: 'ES256', kid: 'unit-key' })
      .setIssuer(config.jwtIssuer)
      .setAudience('authenticated')
      .setExpirationTime('5m')
      .sign(foreign.privateKey);
    await expect(verifier.verify(`Bearer ${forged}`)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('rejects an algorithm outside ES256', async () => {
    const forged = await new SignJWT({ sub: actor })
      .setProtectedHeader({ alg: 'HS256', kid: 'unit-key' })
      .setIssuer(config.jwtIssuer)
      .setAudience('authenticated')
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode('unit-only-key-32-bytes-long-enough'));
    await expect(verifier.verify(`Bearer ${forged}`)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('returns a retryable dependency error for unavailable key transport', async () => {
    const unavailable = new JwtVerifier(config, async () => {
      throw new TypeError('fetch failed with private-network-details');
    });
    try {
      await unavailable.verify(`Bearer ${await token()}`);
      throw new Error('Expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({
        code: 'DEPENDENCY_UNAVAILABLE',
        retryable: true,
      });
      expect((error as Error).message).not.toContain('private-network-details');
    }
  });
});
