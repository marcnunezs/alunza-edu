import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash, webcrypto } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const compiled = ts.transpileModule(
  readFileSync(new URL('../src/lib/api.ts', import.meta.url), 'utf8'),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  },
).outputText;
const organizationId = '10000000-0000-4000-8000-000000000001';
const exportId = '20000000-0000-4000-8000-000000000001';
const body =
  '\ufeff"event_id","occurred_at","actor_id","action","entity_type","entity_id","organization_id","outcome"\r\n';
const bytes = new globalThis.TextEncoder().encode(body);
const sha256 = createHash('sha256').update(bytes).digest('hex');
const metadata = {
  state: 'READY',
  exportId,
  organizationId,
  filters: { asOf: '2026-11-02T12:00:00.000001Z' },
  snapshotAt: '2026-11-02T12:00:01.000001Z',
  generatedAt: '2026-11-02T12:00:02.000001Z',
  expiresAt: '2026-11-03T12:00:02.000001Z',
  rowCount: 0,
  byteLength: bytes.length,
  sha256,
  formatVersion: 'audit-csv-v1',
  fileName: `auditoria-${organizationId}-${exportId}.csv`,
  downloadPath: `/api/v1/organizations/${organizationId}/audit-exports/${exportId}/content`,
};
function client(
  fetch,
  { deadline = new AbortController().signal, crypto = webcrypto } = {},
) {
  const exports = {},
    blobs = [];
  class DownloadBlob extends globalThis.Blob {
    constructor(parts, options) {
      super(parts, options);
      blobs.push(this);
    }
  }
  vm.runInNewContext(compiled, {
    exports,
    require,
    fetch,
    crypto,
    Blob: DownloadBlob,
    Uint8Array,
    FormData: globalThis.FormData,
    URLSearchParams: globalThis.URLSearchParams,
    process: { env: { NEXT_PUBLIC_API_BASE_URL: 'http://127.0.0.1:4300' } },
    AbortSignal: {
      timeout: () => deadline,
      any: AbortSignal.any.bind(AbortSignal),
    },
  });
  return { ...exports, blobs };
}
function response(content = bytes, extra = {}) {
  return new Response(content, {
    headers: { 'Content-Type': 'text/csv; charset=utf-8' },
    ...extra,
  });
}

test('private CSV download authenticates, rejects redirects and verifies full UTF-8 bytes before creating a blob', async () => {
  const calls = [];
  const api = client(async (url, options) => {
    calls.push({ url, options });
    return response();
  });
  const blob = await api.apiDownloadAuditExport(metadata, {
    accessToken: 'requesting-admin',
  });
  expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
  expect(api.blobs).toHaveLength(1);
  expect(calls).toHaveLength(1);
  expect(calls[0].url).toBe(`http://127.0.0.1:4300${metadata.downloadPath}`);
  expect(calls[0].options).toMatchObject({
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
    headers: { Authorization: 'Bearer requesting-admin', Accept: 'text/csv' },
  });
});

test.each([
  [
    'external path',
    { ...metadata, downloadPath: 'https://external.invalid/private' },
  ],
  ['unsafe filename', { ...metadata, fileName: '../secret.csv' }],
  ['excessive declared size', { ...metadata, byteLength: 10_485_761 }],
  ['malformed object', null],
])('invalid metadata %s cannot invoke fetch', async (_name, input) => {
  let calls = 0;
  const api = client(async () => {
    calls++;
    return response();
  });
  await expect(api.apiDownloadAuditExport(input)).rejects.toMatchObject({
    status: 400,
    code: 'INVALID_REQUEST',
  });
  expect(calls).toBe(0);
  expect(api.blobs).toHaveLength(0);
});

test.each([
  ['short body', () => response(bytes.slice(0, -1)), metadata],
  ['long body', () => response(new Uint8Array(bytes.length + 1)), metadata],
  [
    'wrong digest',
    () => response(bytes),
    { ...metadata, sha256: '0'.repeat(64) },
  ],
  [
    'wrong mime',
    () => response(bytes, { headers: { 'Content-Type': 'application/json' } }),
    metadata,
  ],
  ['partial HTTP result', () => response(bytes, { status: 206 }), metadata],
])(
  'incomplete or incompatible CSV %s never creates a downloadable blob',
  async (_name, buildResponse, input) => {
    const api = client(async () => buildResponse());
    await expect(api.apiDownloadAuditExport(input)).rejects.toMatchObject({
      code: 'AUDIT_EXPORT_INTEGRITY_FAILED',
      retryable: true,
    });
    expect(api.blobs).toHaveLength(0);
  },
);

test('oversized streaming body cancels the reader instead of collecting unbounded data', async () => {
  let cancelled = false;
  const stream = new globalThis.ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes.length + 1));
    },
    cancel() {
      cancelled = true;
    },
  });
  const api = client(async () => response(stream));
  await expect(api.apiDownloadAuditExport(metadata)).rejects.toMatchObject({
    code: 'AUDIT_EXPORT_INTEGRITY_FAILED',
  });
  expect(cancelled).toBe(true);
  expect(api.blobs).toHaveLength(0);
});

test.each([404, 410])(
  'authorization/expiration error %s is safe and never creates a file',
  async (status) => {
    const api = client(
      async () =>
        new Response(
          JSON.stringify({
            data: undefined,
            error: {
              code: status === 410 ? 'AUDIT_EXPORT_EXPIRED' : 'NOT_FOUND',
              message: 'private internal filename',
              fields: [],
              retryable: false,
            },
            requestId: exportId,
          }),
          { status },
        ),
    );
    await expect(api.apiDownloadAuditExport(metadata)).rejects.toMatchObject({
      status,
    });
    try {
      await api.apiDownloadAuditExport(metadata);
    } catch (error) {
      expect(error.message).not.toContain('private internal');
    }
    expect(api.blobs).toHaveLength(0);
  },
);

test('deadline during body transfer and caller abort after hashing cannot release partial bytes', async () => {
  const deadline = new AbortController();
  const timeout = client(
    async () => {
      const stream = new globalThis.ReadableStream({
        pull(controller) {
          deadline.abort();
          controller.error(new Error('aborted body'));
        },
      });
      return response(stream);
    },
    { deadline: deadline.signal },
  );
  await expect(timeout.apiDownloadAuditExport(metadata)).rejects.toMatchObject({
    code: 'API_TIMEOUT',
    status: 504,
  });
  expect(timeout.blobs).toHaveLength(0);
  const caller = new AbortController();
  const cancelled = client(async () => response(), {
    crypto: {
      subtle: {
        digest: async (...args) => {
          const digest = await webcrypto.subtle.digest(...args);
          caller.abort();
          return digest;
        },
      },
    },
  });
  await expect(
    cancelled.apiDownloadAuditExport(metadata, { signal: caller.signal }),
  ).rejects.toBeDefined();
  expect(cancelled.blobs).toHaveLength(0);
});

test('POST export timeout uses export-neutral recovery text, without referring to student code', async () => {
  const deadline = new AbortController();
  const api = client(
    async () => {
      deadline.abort();
      throw new Error('timeout');
    },
    { deadline: deadline.signal },
  );
  await expect(
    api.apiRequest(
      `/api/v1/organizations/${organizationId}/audit-exports`,
      require('@alunza/contracts').auditExportResponseSchema,
      { method: 'POST', body: metadata.filters, timeoutMs: 45_000 },
    ),
  ).rejects.toMatchObject({
    code: 'API_TIMEOUT',
    message: 'La respuesta tardó demasiado. Vuelve a intentar.',
  });
});
