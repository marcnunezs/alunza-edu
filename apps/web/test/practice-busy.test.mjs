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
const stateCode = compile('../src/lib/attempt-state.ts');
const panelCode = {
  RUN: compile('../src/components/academic/run-result-panel.tsx'),
  SUBMIT: compile('../src/components/academic/submit-attempt-panel.tsx'),
};
const id = (value) =>
  `10000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const scope = {
  userId: id(1),
  organizationId: id(2),
  classId: id(3),
  assignmentId: id(4),
  exerciseVersionId: id(5),
};
const originalCode = 'module.exports.solve=(a,b)=>a+b;';
const editedCode = '// draft edited after the original request';
const flush = () => new Promise(setImmediate);
function storage() {
  const data = new Map();
  return {
    get length() {
      return data.size;
    },
    key: (index) => [...data.keys()][index] ?? null,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  };
}
function busy() {
  return new Response(
    JSON.stringify({
      error: {
        code: 'RUNNER_BUSY',
        message: 'internal text',
        fields: [],
        retryable: true,
      },
      requestId: id(6),
    }),
    { status: 503, headers: { 'Retry-After': '1' } },
  );
}
function success(mode, options, diagnosisCode = 'SUCCESS') {
  const input = JSON.parse(options.body);
  const technicalResult = {
    runnerVersion: 'quickjs-13',
    diagnosisCode,
    terminationReason:
      diagnosisCode === 'TIMEOUT' ? 'EXECUTION_DEADLINE' : 'COMPLETED',
    infrastructureStatus: 'OK',
    visibleTestResults: [
      {
        id: 'visible',
        passed: diagnosisCode === 'SUCCESS',
        stdout: '',
        stderr: '',
      },
    ],
    visiblePassed: diagnosisCode === 'SUCCESS' ? 1 : 0,
    visibleTotal: 1,
    outputTruncated: false,
    outputBytes: 0,
    runtimeMs: diagnosisCode === 'TIMEOUT' ? 2956 : 85,
    lifecycleMs: 4100,
  };
  const common = {
    executionId: id(7),
    exerciseVersionId: input.exerciseVersionId,
    admittedAt: '2026-11-17T12:00:00Z',
    technicalResult,
  };
  const data =
    mode === 'RUN'
      ? { ...common, mode: 'RUN', finishedAt: '2026-11-17T12:00:05Z' }
      : {
          ...common,
          attemptId: id(8),
          activityId: id(9),
          assignmentId: scope.assignmentId,
          testsVersion: 'a'.repeat(64),
          attemptNumber: 1,
          previousAttemptId: input.previousAttemptId ?? null,
          submittedAt: '2026-11-17T12:00:05Z',
          code: input.code,
          technicalResult: {
            ...technicalResult,
            hiddenChecksPassed: null,
            allRequiredPassed: diagnosisCode === 'SUCCESS',
          },
        };
  return new Response(JSON.stringify({ data, requestId: id(6) }), {
    status: 201,
  });
}
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children), ...nodes(tree.props?.trigger)];
}
function text(tree) {
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  if (Array.isArray(tree)) return tree.map(text).join('');
  return tree && typeof tree === 'object' ? text(tree.props?.children) : '';
}

// Real components, contracts and API client; only React scheduling, the clock
// and HTTP I/O are controlled. Browser focus/DOM behavior belongs to Cypress.
function host(mode, respond, local = storage(), initialScope = scope) {
  const clock = { now: 1000, timers: new Map(), sequence: 0 };
  const calls = [],
    slots = [],
    effects = [];
  let cursor = 0,
    tree,
    session = { access_token: 'first-token' };
  const props = {
    activityId: id(9),
    assignmentId: initialScope.assignmentId,
    exerciseVersionId: initialScope.exerciseVersionId,
    scope: initialScope,
    code: originalCode,
    canRun: true,
    canSubmit: true,
    verified: true,
    reload: () => {},
    onCopy: () => {},
  };
  const api = {},
    state = {},
    panel = {};
  const ClockDate = class extends Date {
    static now() {
      return clock.now;
    }
  };
  vm.runInNewContext(apiCode, {
    exports: api,
    require,
    AbortSignal,
    fetch: async (url, options) => {
      calls.push({ url, options });
      return respond(mode, options, calls.length);
    },
    process: { env: { NEXT_PUBLIC_API_BASE_URL: 'http://127.0.0.1:4300' } },
  });
  vm.runInNewContext(stateCode, { exports: state, require, Date: ClockDate });
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots))
        slots[index] = typeof initial === 'function' ? initial() : initial;
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
    useEffect(effect, dependencies) {
      const index = cursor++,
        previous = slots[index];
      if (
        !previous ||
        dependencies.some(
          (value, i) => !Object.is(value, previous.dependencies[i]),
        )
      )
        effects.push(() => {
          previous?.cleanup?.();
          slots[index] = { dependencies, cleanup: effect() };
        });
    },
  };
  vm.runInNewContext(panelCode[mode], {
    exports: panel,
    AbortController,
    crypto: { randomUUID },
    Date: ClockDate,
    window: {
      localStorage: local,
      setTimeout(callback, delay) {
        const timer = ++clock.sequence;
        clock.timers.set(timer, { callback, at: clock.now + delay });
        return timer;
      },
      clearTimeout: (timer) => clock.timers.delete(timer),
    },
    require: (name) => {
      if (name === 'react') return hooks;
      if (name === 'react/jsx-runtime') {
        const jsx = (type, props) => ({ type, props });
        return { jsx, jsxs: jsx, Fragment: 'Fragment' };
      }
      if (name === '@/lib/api') return api;
      if (name === '@/lib/attempt-state') return state;
      if (name === '@/components/session-provider')
        return { useSession: () => ({ session }) };
      if (name.startsWith('@/') || name.startsWith('./'))
        return new Proxy({}, { get: (_, key) => key });
      return require(name);
    },
  });
  function render() {
    cursor = 0;
    tree =
      mode === 'RUN'
        ? panel.RunPracticePanel(props)
        : panel.SubmitAttemptPanel(props);
    for (const effect of effects.splice(0)) effect();
    return tree;
  }
  const find = (selector) =>
    nodes(tree).find((node) => node.props?.['data-cy'] === selector);
  render();
  return {
    calls,
    props,
    local,
    render,
    find,
    text: () => text(tree),
    session(value) {
      session = value;
      render();
    },
    async click(selector) {
      const button = find(selector);
      if (!button) throw new Error(`Missing control ${selector}`);
      button.props.onClick();
      await flush();
      render();
    },
    async start() {
      if (mode === 'SUBMIT') {
        nodes(tree)
          .find((node) => node.type === 'FormDialog')
          .props.onOpenChange(true);
        render();
      }
      await this.click(mode === 'RUN' ? 'run-code' : 'confirm-submit');
    },
    async advance(milliseconds) {
      clock.now += milliseconds;
      for (const [timer, value] of clock.timers) {
        if (value.at <= clock.now) {
          clock.timers.delete(timer);
          value.callback();
        }
      }
      await flush();
      render();
    },
    dispose() {
      for (const slot of slots) slot?.cleanup?.();
    },
  };
}

test.each(['RUN', 'SUBMIT'])(
  '%s busy is a manual retry with the captured payload and no automatic dispatch',
  async (mode) => {
    const h = host(mode, (kind, options, count) =>
      count === 1 ? busy() : success(kind, options),
    );
    await h.start();
    const retry = mode === 'RUN' ? 'retry-run' : 'retry-submit';
    expect(h.find(retry).props.disabled).toBe(true);
    expect(
      h.find(mode === 'RUN' ? 'recover-run' : 'recover-submit'),
    ).toBeUndefined();
    expect(h.text()).toContain('no admitid');
    h.props.code = editedCode;
    h.render();
    await h.click(retry); // Handler guard also rejects a programmatic early retry.
    expect(h.calls).toHaveLength(1);
    await h.advance(999);
    expect(h.find(retry).props.disabled).toBe(true);
    await h.advance(1);
    expect(h.find(retry).props.disabled).toBe(false);
    expect(h.calls).toHaveLength(1);
    await h.click(retry);
    expect(h.calls).toHaveLength(2);
    expect(h.calls[1].options.body).toBe(h.calls[0].options.body);
    expect(h.calls[1].options.headers['Idempotency-Key']).toBe(
      h.calls[0].options.headers['Idempotency-Key'],
    );
    expect(h.props.code).toBe(editedCode);
    expect(h.find(retry)).toBeUndefined();
    h.dispose();
  },
);

test.each(['RUN', 'SUBMIT'])(
  '%s busy requires current availability while uncertain recovery needs verified authentication',
  async (mode) => {
    const h = host(mode, (_, __, count) => {
      if (count === 1) return busy();
      throw new Error('reply lost');
    });
    await h.start();
    await h.advance(1000);
    const retry = mode === 'RUN' ? 'retry-run' : 'retry-submit';
    const recover = mode === 'RUN' ? 'recover-run' : 'recover-submit';
    h.props.verified = false;
    h.render();
    expect(h.text()).toContain('Comprueba de nuevo tu acceso');
    expect(h.find(retry).props.disabled).toBe(true);
    await h.click(retry);
    expect(h.calls).toHaveLength(1);
    h.props.verified = true;
    h.props.canRun = h.props.canSubmit = false;
    h.render();
    expect(h.find(retry).props.disabled).toBe(true);
    await h.click(retry);
    expect(h.calls).toHaveLength(1);
    h.props.canRun = h.props.canSubmit = true;
    h.render();
    await h.click(retry);
    expect(h.find(retry)).toBeUndefined();
    expect(h.find(recover).props.disabled).toBe(false);
    h.props.canRun = h.props.canSubmit = false;
    h.render();
    expect(h.find(recover).props.disabled).toBe(false);
    h.props.verified = false;
    h.render();
    await h.click(recover);
    h.props.verified = true;
    h.session(null);
    await h.click(recover);
    expect(h.calls).toHaveLength(2);
    h.session({ access_token: 'renewed-token' });
    await h.click(recover);
    expect(h.calls).toHaveLength(3);
    expect(h.calls[2].options.headers.Authorization).toBe(
      'Bearer renewed-token',
    );
    expect(h.calls[2].options.headers['Idempotency-Key']).toBe(
      h.calls[0].options.headers['Idempotency-Key'],
    );
    expect(h.calls[2].options.body).toBe(h.calls[0].options.body);
    h.dispose();
  },
);

test('SUBMIT reload retains known non-admission and delay, then records uncertainty before retrying HTTP', async () => {
  const local = storage();
  const first = host('SUBMIT', () => busy(), local);
  await first.start();
  first.dispose();
  let finish;
  const second = host(
    'SUBMIT',
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    local,
  );
  expect(second.find('retry-submit').props.disabled).toBe(true);
  await second.advance(1000);
  second.props.code = editedCode;
  second.render();
  await second.click('retry-submit');
  expect(second.calls[0].options.body).toBe(first.calls[0].options.body);
  expect(second.calls[0].options.headers['Idempotency-Key']).toBe(
    first.calls[0].options.headers['Idempotency-Key'],
  );
  const otherAccount = host(
    'SUBMIT',
    () => {
      throw new Error('must not dispatch');
    },
    local,
    { ...scope, userId: id(20) },
  );
  expect(otherAccount.find('retry-submit')).toBeUndefined();
  expect(otherAccount.find('recover-submit')).toBeUndefined();
  expect(otherAccount.calls).toHaveLength(0);
  otherAccount.dispose();
  second.dispose();
  const remount = host(
    'SUBMIT',
    () => {
      throw new Error('must not dispatch');
    },
    local,
  );
  expect(remount.find('recover-submit')).toBeDefined();
  expect(remount.find('retry-submit')).toBeUndefined();
  finish(success('SUBMIT', second.calls[0].options));
  await flush();
  expect(remount.find('recover-submit')).toBeDefined();
  expect(remount.calls).toHaveLength(0);
  remount.dispose();
});

test('RUN retains the real TIMEOUT duration and does not present it as uncertain delivery or busy', async () => {
  const h = host('RUN', (mode, options) => success(mode, options, 'TIMEOUT'));
  await h.start();
  expect(h.text()).toContain(
    'La ejecución se detuvo al alcanzar el presupuesto de tiempo.',
  );
  expect(h.text()).toContain('2956 ms');
  expect(h.text()).not.toContain('superó los 3 segundos');
  expect(h.find('retry-run')).toBeUndefined();
  expect(h.find('recover-run')).toBeUndefined();
  h.dispose();
});
