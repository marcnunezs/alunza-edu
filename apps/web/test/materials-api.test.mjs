import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { z } from 'zod';

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
const contentPath =
  '/api/v1/sources/10000000-0000-4000-8000-000000000001/versions/20000000-0000-4000-8000-000000000001/content';
function client(fetch, deadline = new AbortController().signal) {
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    require,
    fetch,
    FormData: globalThis.FormData,
    process: { env: { NEXT_PUBLIC_API_BASE_URL: 'http://127.0.0.1:4300' } },
    AbortSignal: {
      timeout: () => deadline,
      any: AbortSignal.any.bind(AbortSignal),
    },
  });
  return exports;
}

test('material upload preserves binary form data, bearer identity and retry key without setting a false multipart boundary', async () => {
  const calls = [];
  const api = client(async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ data: 'queued' }), { status: 202 });
  });
  const form = new globalThis.FormData();
  form.append('title', 'Funciones');
  form.append(
    'file',
    new globalThis.Blob(['Función y retorno.']),
    'funciones.txt',
  );
  const options = {
    method: 'POST',
    body: form,
    accessToken: 'scoped-user',
    idempotencyKey: 'same-upload',
    timeoutMs: 45_000,
  };
  await api.apiRequest(
    '/api/v1/classes/class/sources',
    z.object({ data: z.string() }),
    options,
  );
  await api.apiRequest(
    '/api/v1/classes/class/sources',
    z.object({ data: z.string() }),
    options,
  );
  expect(calls).toHaveLength(2);
  for (const call of calls) {
    expect(call.options.body).toBe(form);
    expect(call.options.headers.Authorization).toBe('Bearer scoped-user');
    expect(call.options.headers['Idempotency-Key']).toBe('same-upload');
    expect(call.options.headers['Content-Type']).toBeUndefined();
    expect(call.options).toMatchObject({
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
    });
  }
});

test('source download is authenticated and returns the exact bytes without following a redirect', async () => {
  const calls = [];
  const bytes = new Uint8Array([37, 80, 68, 70, 45, 0, 255]);
  const api = client(async (url, options) => {
    calls.push({ url, options });
    return new Response(bytes, {
      headers: { 'Content-Type': 'application/pdf' },
    });
  });
  const blob = await api.apiDownloadSource(contentPath, {
    accessToken: 'reader',
  });
  expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
  expect(calls[0].options).toMatchObject({
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
    headers: { Authorization: 'Bearer reader' },
  });
  expect(calls[0].url).toBe(`http://127.0.0.1:4300${contentPath}`);
});

test('download rejects arbitrary URLs and revoked sources without reflecting server messages', async () => {
  let calls = 0;
  const api = client(async () => {
    calls++;
    return new Response(
      JSON.stringify({
        error: {
          code: 'NOT_FOUND',
          message: 'sensitive source title',
          fields: [],
          retryable: false,
        },
        requestId: '10000000-0000-4000-8000-000000000001',
      }),
      { status: 404 },
    );
  });
  await expect(
    api.apiDownloadSource('https://external.test/material'),
  ).rejects.toMatchObject({ code: 'INVALID_REQUEST', status: 400 });
  expect(calls).toBe(0);
  await expect(api.apiDownloadSource(contentPath)).rejects.toMatchObject({
    status: 404,
    message: 'El recurso no está disponible o no tienes acceso.',
  });
});

test('source transfer deadlines and download-body cancellation are recoverable and do not mention student code', async () => {
  const deadline = new AbortController();
  const api = client(async () => {
    deadline.abort();
    throw new Error('disconnected');
  }, deadline.signal);
  await expect(
    api.apiRequest('/api/v1/classes/class/sources', z.any(), {
      timeoutMs: 45_000,
    }),
  ).rejects.toMatchObject({
    code: 'API_TIMEOUT',
    retryable: true,
    message: 'La respuesta tardó demasiado. Vuelve a intentar.',
  });
  const secondDeadline = new AbortController();
  const download = client(
    async () => ({
      ok: true,
      blob: async () => {
        secondDeadline.abort();
        throw new Error('body aborted');
      },
    }),
    secondDeadline.signal,
  );
  await expect(download.apiDownloadSource(contentPath)).rejects.toMatchObject({
    code: 'API_TIMEOUT',
    status: 504,
    retryable: true,
  });
});

test('a material format rejection maps to safe, actionable text', async () => {
  const api = client(
    async () =>
      new Response(
        JSON.stringify({
          error: {
            code: 'UNSUPPORTED_MEDIA_TYPE',
            message: '<script>private detail</script>',
            fields: [],
            retryable: false,
          },
          requestId: '10000000-0000-4000-8000-000000000001',
        }),
        { status: 415 },
      ),
  );
  await expect(
    api.apiRequest('/api/v1/classes/class/sources', z.any()),
  ).rejects.toMatchObject({
    status: 415,
    message: 'Utiliza un PDF con texto, TXT o Markdown.',
  });
});

test('citation download allows only the private feedback source route and rejects paths supplied as arbitrary links', async () => {
  const calls = [];
  const api = client(async (url, options) => {
    calls.push({ url, options });
    return new Response('Versión citada original.');
  });
  const citation =
    '/api/v1/feedback/10000000-0000-4000-8000-000000000001/sources/20000000-0000-4000-8000-000000000001/content';
  const content = await api.apiDownloadSource(citation, {
    accessToken: 'citation-reader',
  });
  expect(await content.text()).toBe('Versión citada original.');
  expect(calls[0].options).toMatchObject({
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
  });
  expect(calls[0].options.headers.Authorization).toBe('Bearer citation-reader');
  for (const path of [
    citation + '?url=https://external.test',
    citation + '/extra',
    citation.replace('/sources/', '/sources/../'),
    '/api/v1/feedback/anything/sources/anything/content',
    'https://external.test' + citation,
  ])
    await expect(api.apiDownloadSource(path)).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
  expect(calls).toHaveLength(1);
});
