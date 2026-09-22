import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validatePublicEnvironment } from '../config/public-environment.mjs';

const valid = {
  NEXT_PUBLIC_API_BASE_URL: 'http://127.0.0.1:4000',
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:15421',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_configuration_test',
};

test('accepts public browser configuration and ignores server-only environment fields', () => {
  assert.deepEqual(
    validatePublicEnvironment({ ...valid, SERVER_ONLY: 'not-public' }),
    valid,
  );
});

test('required fields fail with variable names only', () => {
  assert.throws(() => validatePublicEnvironment({}), {
    message:
      /NEXT_PUBLIC_API_BASE_URL.*NEXT_PUBLIC_SUPABASE_URL.*NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/,
  });
});

test('malformed URLs, credential URLs and privileged keys never leak their value', () => {
  const serviceJwt = `header.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.signature`;
  for (const [field, value] of [
    ['NEXT_PUBLIC_API_BASE_URL', 'invalid-url-private-sentinel'],
    ['NEXT_PUBLIC_API_BASE_URL', 'http://user:private-sentinel@localhost'],
    ['NEXT_PUBLIC_SUPABASE_URL', 'ftp://localhost'],
    ['NEXT_PUBLIC_SUPABASE_URL', 'http://localhost?secret=private-sentinel'],
    ['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_secret_private-sentinel'],
    ['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', serviceJwt],
  ]) {
    assert.throws(
      () => validatePublicEnvironment({ ...valid, [field]: value }),
      (error) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, new RegExp(field));
        assert.ok(!error.message.includes(value));
        assert.ok(!error.message.includes('private-sentinel'));
        assert.ok(!(error instanceof TypeError));
        return true;
      },
    );
  }
});

test('legacy anon key remains compatible without accepting arbitrary JWT roles', () => {
  const key = `header.${Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url')}.signature`;
  assert.equal(
    validatePublicEnvironment({
      ...valid,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key,
    }).NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    key,
  );
});

test('standalone startup rejects missing environment before loading the server', () => {
  const entry = fileURLToPath(
    new URL('../scripts/start-standalone.mjs', import.meta.url),
  );
  const result = spawnSync(process.execPath, [entry], {
    env: {},
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /NEXT_PUBLIC_API_BASE_URL/);
  assert.ok(!result.stderr.includes('ERR_MODULE_NOT_FOUND'));
});
