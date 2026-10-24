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

function client(fetch, deadline = new AbortController().signal) {
  const timeouts = [];
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    require,
    fetch,
    process: { env: { NEXT_PUBLIC_API_BASE_URL: 'http://127.0.0.1:4300' } },
    AbortSignal: {
      timeout(milliseconds) {
        timeouts.push(milliseconds);
        return deadline;
      },
      any: AbortSignal.any.bind(AbortSignal),
    },
  });
  return { ...exports, timeouts };
}

test('RUN uses a 45 second deadline, original payload and idempotency key without changing the normal 10 second deadline', async () => {
  const calls = [];
  const api = client(async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ data: 'verified' }), { status: 201 });
  });
  const schema = z.object({ data: z.string() });
  await api.apiRequest('/api/v1/me', schema);
  const options = {
    method: 'POST',
    accessToken: 'test-token',
    body: { code: 'module.exports.solve=()=>1;', exerciseVersionId: 'version' },
    idempotencyKey: 'same-operation',
    timeoutMs: 45_000,
  };
  await api.apiRequest(
    '/api/v1/activities/activity/exercises/assignment/executions',
    schema,
    options,
  );
  await api.apiRequest(
    '/api/v1/activities/activity/exercises/assignment/executions',
    schema,
    options,
  );
  expect(api.timeouts).toEqual([10_000, 45_000, 45_000]);
  expect(calls[1].options.body).toBe(calls[2].options.body);
  expect(calls[1].options.headers['Idempotency-Key']).toBe('same-operation');
  expect(calls[2].options.headers['Idempotency-Key']).toBe('same-operation');
  expect(calls[1].options.cache).toBe('no-store');
  expect(calls[1].options.credentials).toBe('omit');
});

test('a response timeout remains distinct from a student TIMEOUT diagnosis and recommends recovery', async () => {
  const deadline = new AbortController();
  deadline.abort();
  const api = client(async () => {
    throw new Error('transport aborted');
  }, deadline.signal);
  await expect(
    api.apiRequest('/api/v1/activities/a/exercises/b/executions', z.any(), {
      timeoutMs: 45_000,
    }),
  ).rejects.toMatchObject({
    status: 504,
    code: 'API_TIMEOUT',
    retryable: true,
    message: expect.stringContaining('recupera el resultado'),
  });
});

test('uncertain network or invalid success response is retryable and never becomes a practice result', async () => {
  const offline = client(async () => {
    throw new Error('socket closed');
  });
  await expect(
    offline.apiRequest(
      '/api/v1/activities/a/exercises/b/executions',
      z.object({ data: z.string() }),
    ),
  ).rejects.toMatchObject({
    status: 503,
    code: 'API_UNAVAILABLE',
    retryable: true,
  });
  const malformed = client(
    async () => new Response('{"unexpected":true}', { status: 201 }),
  );
  await expect(
    malformed.apiRequest(
      '/api/v1/activities/a/exercises/b/executions',
      z.object({ data: z.string() }),
    ),
  ).rejects.toMatchObject({
    status: 502,
    code: 'INVALID_RESPONSE',
    retryable: true,
  });
});

test('a timeout while downloading the result body remains a recoverable API timeout', async () => {
  const deadline = new AbortController();
  const api = client(
    async () => ({
      json: async () => {
        deadline.abort();
        throw new Error('body download aborted');
      },
    }),
    deadline.signal,
  );
  await expect(
    api.apiRequest('/api/v1/activities/a/exercises/b/executions', z.any(), {
      timeoutMs: 45_000,
    }),
  ).rejects.toMatchObject({
    status: 504,
    code: 'API_TIMEOUT',
    retryable: true,
  });
});

test('in-progress responses preserve Retry-After and use safe local messages', async () => {
  const api = client(
    async () =>
      new Response(
        JSON.stringify({
          error: {
            code: 'REQUEST_IN_PROGRESS',
            message: '<script>private internal data</script>',
            fields: [],
            retryable: true,
          },
          requestId: '10000000-0000-4000-8000-000000000001',
        }),
        { status: 409, headers: { 'Retry-After': '3' } },
      ),
  );
  await expect(
    api.apiRequest('/api/v1/activities/a/exercises/b/executions', z.any()),
  ).rejects.toMatchObject({
    status: 409,
    code: 'REQUEST_IN_PROGRESS',
    retryAfter: 3,
    message:
      'La operación sigue en curso. Puedes consultar su estado o reintentar la misma solicitud.',
  });
});
