import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import { z } from 'zod';

const require = createRequire(import.meta.url);
const compile = (path) =>
  ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
const apiCode = compile('../src/lib/api.ts');
const formsCode = compile('../src/components/identity-forms.tsx');
const path = '/api/v1/classes/class/sources';
const schema = z.object({ data: z.string() });

// Minimal state/effect host executes the real hook and API client without a DOM.
// Its scope is operation recovery; modal keyboard/focus is covered by Cypress.
function operationHost(fetch) {
  const api = {};
  vm.runInNewContext(apiCode, {
    exports: api,
    require,
    fetch,
    FormData: globalThis.FormData,
    process: { env: { NEXT_PUBLIC_API_BASE_URL: 'http://127.0.0.1:4300' } },
    AbortSignal,
  });
  const slots = [];
  const effects = [];
  let cursor = 0;
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [
        slots[index],
        (value) => {
          slots[index] =
            typeof value === 'function' ? value(slots[index]) : value;
        },
      ];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useEffect(effect) {
      const index = cursor++;
      if (!(index in slots)) {
        slots[index] = true;
        effects.push(effect);
      }
    },
  };
  const forms = {};
  vm.runInNewContext(formsCode, {
    exports: forms,
    require: (name) => {
      if (name === 'react') return hooks;
      if (name === '@/lib/api') return api;
      if (name === '@/components/session-provider')
        return {
          useSession: () => ({
            session: { access_token: 'authorized-teacher' },
            revision: 1,
            refreshIdentity: () => undefined,
          }),
        };
      if (name.startsWith('@/') || name === 'radix-ui') return {};
      return require(name);
    },
    crypto: { randomUUID },
    AbortController,
  });
  return () => {
    cursor = 0;
    const operation = forms.useOperation();
    for (const effect of effects.splice(0)) effect();
    return operation;
  };
}
function body(text) {
  const form = new globalThis.FormData();
  form.set('title', 'Funciones');
  form.set('file', new globalThis.Blob([text]), 'funciones.txt');
  return form;
}
function errorResponse(status, code, retryable) {
  return new Response(
    JSON.stringify({
      error: { code, message: 'Server diagnostic', fields: [], retryable },
      requestId: '10000000-0000-4000-8000-000000000001',
    }),
    { status },
  );
}

test('a confirmed terminal upload failure unlocks correction and a new operation gets a new key and file', async () => {
  const calls = [];
  const render = operationHost(async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1
      ? errorResponse(503, 'STORAGE_UNAVAILABLE', false)
      : new Response(JSON.stringify({ data: 'accepted' }), { status: 202 });
  });
  let operation = render();
  await operation.run(path, schema, { method: 'POST', body: body('Initial') });
  operation = render();
  expect(operation).toMatchObject({
    pending: false,
    unresolved: false,
    error: { status: 503, retryable: false },
  });
  const corrected = body('Corrected');
  await operation.run(path, schema, { method: 'POST', body: corrected });
  expect(calls[1].options.body).toBe(corrected);
  expect(calls[1].options.headers['Idempotency-Key']).not.toBe(
    calls[0].options.headers['Idempotency-Key'],
  );
  expect(render()).toMatchObject({
    pending: false,
    unresolved: false,
    error: null,
  });
});

test.each([
  ['lost transport', () => Promise.reject(new Error('response lost'))],
  ['unverified 503', () => new Response('unavailable', { status: 503 })],
  ['generic server failure', () => errorResponse(500, 'INTERNAL_ERROR', false)],
  ['in progress', () => errorResponse(409, 'REQUEST_IN_PROGRESS', false)],
])(
  '%s preserves the original upload, path, revision and key until the response is known',
  async (_label, failure) => {
    const calls = [];
    const render = operationHost(async (url, options) => {
      calls.push({ url, options });
      if (calls.length === 1) return failure();
      return new Response(JSON.stringify({ data: 'accepted' }), {
        status: 202,
      });
    });
    const original = body('Original');
    let operation = render();
    await operation.run(path, schema, {
      method: 'POST',
      body: original,
      etag: '"2"',
    });
    operation = render();
    expect(operation).toMatchObject({ pending: false, unresolved: true });
    await operation.run('/api/v1/classes/other/sources', schema, {
      method: 'POST',
      body: body('Changed while pending'),
      etag: '"3"',
    });
    expect(calls[1].url).toBe(calls[0].url);
    expect(calls[1].options.body).toBe(original);
    expect(calls[1].options.headers['If-Match']).toBe('"2"');
    expect(calls[1].options.headers['Idempotency-Key']).toBe(
      calls[0].options.headers['Idempotency-Key'],
    );
    expect(render()).toMatchObject({
      pending: false,
      unresolved: false,
      error: null,
    });
  },
);
