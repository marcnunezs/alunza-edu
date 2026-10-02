import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { setImmediate } from 'node:timers';
import vm from 'node:vm';
import ts from 'typescript';

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
const panelCode = compile('../src/components/academic/attempt-help-panel.tsx');
const attemptId = '10000000-0000-4000-8000-000000000001';
const requestId = '20000000-0000-4000-8000-000000000001';
function accepted(kind = 'HINT', hintLevel = 1) {
  return new Response(
    JSON.stringify({
      data: {
        id: requestId,
        attemptId,
        kind,
        hintLevel,
        state: 'QUEUED',
        feedbackId: null,
        createdAt: '2026-09-27T12:00:00Z',
        deadlineAt: '2026-09-27T12:00:15Z',
        completedAt: null,
        errorCode: null,
        errorMessage: null,
      },
      requestId,
    }),
    { status: 202 },
  );
}

// Execute the real components/API client. The host preserves hook slots while
// replaying effect setup/cleanup, as credential renewal and StrictMode do.
// Visible browser interactions remain E2E responsibilities.
function host(fetch, presentation, intentions = null) {
  const api = {};
  vm.runInNewContext(apiCode, {
    exports: api,
    require,
    fetch,
    FormData: globalThis.FormData,
    AbortSignal,
    process: { env: { NEXT_PUBLIC_API_BASE_URL: 'http://127.0.0.1:4300' } },
  });
  const slots = [];
  const effects = [];
  const visibilityListeners = new Set();
  const document = {
    visibilityState: 'visible',
    addEventListener: (_, listener) => visibilityListeners.add(listener),
    removeEventListener: (_, listener) => visibilityListeners.delete(listener),
  };
  let acknowledged = 0;
  const presentationProps = {
    feedback: presentation,
    onViewed: () => acknowledged++,
    onUnavailable: () => {},
  };
  let cursor = 0;
  let session = { session: { access_token: 'first-token' }, revision: 1 };
  const hooks = {
    createContext: () => ({}),
    useContext: () => intentions,
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
    useCallback(callback, dependencies) {
      const index = cursor++;
      const previous = slots[index];
      if (
        !previous ||
        dependencies.some((item, i) => item !== previous.dependencies[i])
      )
        slots[index] = { dependencies, callback };
      return slots[index].callback;
    },
    useEffect(effect, dependencies) {
      const index = cursor++;
      const previous = slots[index];
      if (
        !previous ||
        dependencies.some((item, i) => item !== previous.dependencies[i])
      ) {
        effects.push(() => {
          previous?.cleanup?.();
          slots[index] = { dependencies, effect, cleanup: effect() };
        });
      }
    },
  };
  const panel = {};
  vm.runInNewContext(`${panelCode}\nexports.presented = PresentedFeedback;`, {
    exports: panel,
    AbortController,
    document,
    crypto: { randomUUID },
    require: (name) => {
      if (name === 'react') return hooks;
      if (name === '@/lib/api') return api;
      if (name === '@/components/session-provider')
        return { useSession: () => session };
      if (name.startsWith('@/') || name === './shared') return {};
      return require(name);
    },
  });
  return {
    render() {
      cursor = 0;
      const result = presentation
        ? panel.presented(presentationProps)
        : panel.useHelpSubmission(attemptId);
      for (const effect of effects.splice(0)) effect();
      return result;
    },
    renew() {
      session = { session: { access_token: 'renewed-token' }, revision: 2 };
    },
    replayEffects() {
      for (const slot of slots) slot?.cleanup?.();
      for (const slot of slots) {
        if (slot?.effect) slot.cleanup = slot.effect();
      }
    },
    visibility(visible) {
      document.visibilityState = visible ? 'visible' : 'hidden';
      for (const listener of visibilityListeners) listener();
    },
    acknowledgements: () => acknowledged,
    dispose() {
      for (const slot of slots) slot?.cleanup?.();
    },
  };
}

test('lost response replays the same hint and key; a confirmed operation permits a fresh explanation', async () => {
  const calls = [];
  const state = host(async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1)
      throw new Error('transport lost after possible commit');
    return accepted();
  });
  await state.render().run({ kind: 'HINT', hintLevel: 1 });
  expect(state.render().unresolved).toBe(true);
  await state.render().run({ kind: 'HINT', hintLevel: 2 });
  expect(calls[1].options.body).toBe(calls[0].options.body);
  expect(calls[1].options.headers['Idempotency-Key']).toBe(
    calls[0].options.headers['Idempotency-Key'],
  );
  expect(state.render().unresolved).toBe(false);
  await state.render().run({ kind: 'FEEDBACK' });
  expect(calls[2].options.headers['Idempotency-Key']).not.toBe(
    calls[0].options.headers['Idempotency-Key'],
  );
  expect(JSON.parse(calls[2].options.body)).toEqual({ kind: 'FEEDBACK' });
  state.dispose();
});

test('renewal aborts and discards late content while preserving the exact pending intention for replay', async () => {
  const calls = [];
  let release;
  const state = host((url, options) => {
    calls.push({ url, options });
    return calls.length === 1
      ? new Promise((resolve) => {
          release = resolve;
        })
      : Promise.resolve(accepted());
  });
  const pending = state.render().run({ kind: 'HINT', hintLevel: 1 });
  state.renew();
  expect(state.render().unresolved).toBe(true);
  expect(calls[0].options.signal.aborted).toBe(true);
  release(accepted());
  expect(await pending).toBeNull();
  await state.render().run();
  expect(calls[1].options.headers['Idempotency-Key']).toBe(
    calls[0].options.headers['Idempotency-Key'],
  );
  expect(calls[1].options.headers.Authorization).toBe('Bearer renewed-token');
  expect(state.render().unresolved).toBe(false);
  state.dispose();
});

test('synchronous double activation sends one request and unmount prevents late delivery', async () => {
  let calls = 0;
  let release;
  const state = host(() => {
    calls++;
    return new Promise((resolve) => {
      release = resolve;
    });
  });
  const operation = state.render();
  const pending = operation.run({ kind: 'FEEDBACK' });
  expect(await operation.run({ kind: 'FEEDBACK' })).toBeNull();
  expect(calls).toBe(1);
  state.dispose();
  release(accepted('FEEDBACK', null));
  expect(await pending).toBeNull();
});

test('authorization revalidation can unmount the panel without losing its scoped uncertain operation', async () => {
  const intentions = new Map();
  const calls = [];
  let release;
  const first = host(
    (url, options) => {
      calls.push({ url, options });
      return new Promise((resolve) => {
        release = resolve;
      });
    },
    undefined,
    intentions,
  );
  const pending = first.render().run({ kind: 'HINT', hintLevel: 1 });
  first.dispose();
  expect(calls[0].options.signal.aborted).toBe(true);
  expect(intentions.size).toBe(1);
  expect([...intentions.values()][0]).toEqual({
    key: calls[0].options.headers['Idempotency-Key'],
    input: { kind: 'HINT', hintLevel: 1 },
  });
  const otherSession = host(async () => accepted(), undefined, new Map());
  expect(otherSession.render().unresolved).toBe(false);
  expect(await otherSession.render().run()).toBeNull();
  expect(calls).toHaveLength(1);
  const remounted = host(
    async (url, options) => {
      calls.push({ url, options });
      return accepted();
    },
    undefined,
    intentions,
  );
  remounted.renew();
  expect(remounted.render().unresolved).toBe(true);
  release(accepted());
  expect(await pending).toBeNull();
  expect(intentions.size).toBe(1);
  await remounted.render().run();
  expect(calls).toHaveLength(2);
  expect(calls[1].options.headers['Idempotency-Key']).toBe(
    calls[0].options.headers['Idempotency-Key'],
  );
  expect(calls[1].options.body).toBe(calls[0].options.body);
  expect(calls[1].options.headers.Authorization).toBe('Bearer renewed-token');
  expect(intentions.size).toBe(0);
  remounted.dispose();
  otherSession.dispose();
});

function feedback(kind, status, presentationToken = randomUUID()) {
  return {
    id: randomUUID(),
    attemptId,
    requestId,
    kind,
    hintLevel: kind === 'HINT' ? 1 : null,
    status,
    createdAt: '2026-09-27T12:00:00Z',
    viewedAt: null,
    available: true,
    presentationToken,
    help: {
      diagnosis_code: 'FAILED_TEST',
      explanation: 'El resultado técnico del intento permanece disponible.',
      hint:
        status === 'SUPPORTED' && kind === 'HINT' ? 'Revisa la condición.' : '',
      status,
      source_refs:
        status === 'SUPPORTED'
          ? [
              {
                source_id: randomUUID(),
                source_version_id: randomUUID(),
                chunk_id: randomUUID(),
                locator: 'Líneas 1–2',
              },
            ]
          : [],
    },
  };
}
function viewedResponse(data) {
  return new Response(
    JSON.stringify({
      data: { ...data, viewedAt: '2026-09-27T12:00:01Z' },
      requestId,
    }),
    { status: 200 },
  );
}
const flush = () => new Promise((resolve) => setImmediate(resolve));
function renderedText(node) {
  if (Array.isArray(node)) return node.map(renderedText).join(' ');
  if (node && typeof node === 'object')
    return renderedText(node.props?.children);
  return typeof node === 'string' ? node : '';
}

test('effect replay retries an aborted presentation ACK with the same token and ignores its late result', async () => {
  const data = feedback('HINT', 'SUPPORTED');
  const calls = [];
  let releaseFirst;
  const state = host((url, options) => {
    calls.push({ url, options });
    return calls.length === 1
      ? new Promise((resolve) => {
          releaseFirst = resolve;
        })
      : Promise.resolve(viewedResponse(data));
  }, data);
  expect(renderedText(state.render())).toContain('Registrando la lectura');
  expect(calls).toHaveLength(1);
  state.replayEffects();
  expect(calls[0].options.signal.aborted).toBe(true);
  expect(calls).toHaveLength(2);
  expect(calls[1].options.signal.aborted).toBe(false);
  expect(calls[1].options.body).toBe(calls[0].options.body);
  expect(JSON.parse(calls[1].options.body)).toEqual({
    presentationToken: data.presentationToken,
  });
  await flush();
  expect(state.acknowledgements()).toBe(1);
  expect(renderedText(state.render())).toContain('Lectura registrada.');
  releaseFirst(viewedResponse(data));
  await flush();
  expect(state.acknowledgements()).toBe(1);
  state.visibility(false);
  state.visibility(true);
  expect(calls).toHaveLength(2);
  state.dispose();
});

test.each(['NO_EVIDENCE', 'PROVIDER_UNAVAILABLE'])(
  'an explicitly presented FEEDBACK %s acknowledges the server token without delivering a hint',
  async (status) => {
    const data = feedback('FEEDBACK', status);
    const calls = [];
    const state = host(async (url, options) => {
      calls.push({ url, options });
      return viewedResponse(data);
    }, data);
    state.render();
    await flush();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain(`/feedback/${data.id}/viewed`);
    expect(JSON.parse(calls[0].options.body)).toEqual({
      presentationToken: data.presentationToken,
    });
    expect(state.acknowledgements()).toBe(1);
    expect(renderedText(state.render())).toContain('Lectura registrada.');
    expect(data.help.hint).toBe('');
    state.dispose();
  },
);

test('a HINT fallback has no presentation token and emits no acknowledgement', async () => {
  let calls = 0;
  const state = host(
    async () => {
      calls++;
      throw new Error('A fallback hint must not be delivered');
    },
    feedback('HINT', 'NO_EVIDENCE', null),
  );
  const tree = state.render();
  state.replayEffects();
  state.visibility(false);
  state.visibility(true);
  await flush();
  expect(calls).toBe(0);
  expect(state.acknowledgements()).toBe(0);
  expect(renderedText(tree)).not.toContain('Registrando la lectura');
  state.dispose();
});
