import { createECDH } from 'node:crypto';

const invalidKey = () =>
  new Error('El archivo local de firma necesita una clave ES256 P-256 válida.');

function fixedWidth(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value))
    throw invalidKey();
  const bytes = Buffer.from(value, 'base64url');
  if (
    bytes.length < 1 ||
    bytes.length > 32 ||
    bytes.toString('base64url') !== value
  )
    throw invalidKey();
  return Buffer.concat([Buffer.alloc(32 - bytes.length), bytes]);
}

export function normalizeSigningKeys(keys) {
  if (!Array.isArray(keys) || keys.length === 0) throw invalidKey();
  let privateKeys = 0;
  const normalized = keys.map((key) => {
    if (!key || typeof key !== 'object' || Array.isArray(key))
      throw invalidKey();
    if (key.alg !== 'ES256') return { ...key };
    if (
      key.kty !== 'EC' ||
      key.crv !== 'P-256' ||
      typeof key.kid !== 'string' ||
      !key.kid.trim()
    )
      throw invalidKey();
    const d = fixedWidth(key.d);
    const x = fixedWidth(key.x);
    const y = fixedWidth(key.y);
    try {
      const pair = createECDH('prime256v1');
      pair.setPrivateKey(d);
      const point = pair.getPublicKey();
      if (!point.subarray(1, 33).equals(x) || !point.subarray(33).equals(y))
        throw invalidKey();
    } catch {
      // Do not include provider errors or JWK contents in setup diagnostics.
      throw invalidKey();
    }
    privateKeys++;
    // RFC 7518 §6.2 requires fixed-width P-256 octets. Some CLI-generated
    // scalars omit leading zero octets; restoring them keeps the same key/kid.
    return {
      ...key,
      d: d.toString('base64url'),
      x: x.toString('base64url'),
      y: y.toString('base64url'),
    };
  });
  if (privateKeys === 0) throw invalidKey();
  return normalized;
}
