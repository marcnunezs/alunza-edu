import { SupabaseMaterialsStorage } from './storage.adapter';
import { loadConfig } from '../config';
import { ApiError } from '../http/errors';

const key =
  '10000000-0000-4000-8000-000000000001/20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001';
const validEnvironment = {
  APP_ORIGIN: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://alunza_app:unit-only@127.0.0.1:55322/postgres',
  SUPABASE_JWKS_URL: 'http://127.0.0.1:55321/auth/v1/.well-known/jwks.json',
  SUPABASE_JWT_ISSUER: 'http://127.0.0.1:55321/auth/v1',
};
describe('private material storage boundary', () => {
  const config = () =>
    loadConfig({
      ...validEnvironment,
      SUPABASE_URL: 'http://127.0.0.1:55321',
      SUPABASE_SECRET_KEY: 'unit-only-storage-key',
    });
  it('rejects external, traversal and caller-filename paths before contacting storage', async () => {
    const transport = jest.spyOn(globalThis, 'fetch');
    const storage = new SupabaseMaterialsStorage(config());
    for (const path of [
      '../private',
      'https://attacker.invalid/file',
      '/etc/passwd',
      'a/b/name.txt',
    ])
      await expect(storage.download(path)).rejects.toBeInstanceOf(ApiError);
    expect(transport).not.toHaveBeenCalled();
  });
  it('writes immutable objects and never includes a user JWT or upsert', async () => {
    const transport = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ Key: `materials/${key}`, Id: 'id' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const storage = new SupabaseMaterialsStorage(config());
    await storage.upload(
      key,
      new TextEncoder().encode('material ficticio'),
      'text/plain',
    );
    const [url, request] = transport.mock.calls[0]!;
    expect(String(url)).toContain(`/storage/v1/object/materials/${key}`);
    expect(new Headers(request?.headers).get('x-upsert')).toBe('false');
    expect(request?.redirect).toBe('error');
  });
  it('returns safe errors without exposing SDK payloads or credentials', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          message: 'private-stack-or-token',
          statusCode: '500',
        }),
        { status: 500, headers: { 'content-type': 'application/json' } },
      ),
    );
    const storage = new SupabaseMaterialsStorage(config());
    await expect(
      storage.upload(key, new Uint8Array([1]), 'text/plain'),
    ).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE', retryable: true });
  });
});
