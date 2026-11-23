import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { z } from 'zod';

const require = createRequire(import.meta.url);
const compile = (path) =>
  ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText;
const helper = {};
vm.runInNewContext(compile('../../../tests/e2e/phase-browser-diagnostics.ts'), {
  exports: helper,
});
const requestId = '10000000-0000-4000-8000-000000000001';
const classId = '20000000-0000-4000-8000-000000000001';
const route = `/api/v1/classes/${classId}/dashboard`;
const progressRoute = '/api/v1/me/progress';
const apiCode = compile('../src/lib/api.ts');

function host(fetch, options = {}) {
  let time = 100,
    runnerTime = 1000,
    mutationCallback;
  let domReady = false;
  let renderedSurface = options.surface ?? 'dashboard',
    renderedSummary = '',
    renderedRows = 0;
  const oracle = options.oracle ?? {
    completed: 1,
    required: 360,
    attempts: 201,
    students: 60,
    studentCompleted: 1,
    studentRequired: 6,
    studentAttempts: 51,
  };
  const summary = {
    get textContent() {
      return domReady ? renderedSummary : '';
    },
    querySelector: () => ({ textContent: '201' }),
  };
  const root = {
    querySelector: (selector) => {
      if (selector === `[data-cy="${renderedSurface}-summary"]`) return summary;
      return renderedSurface === 'dashboard' &&
        selector ===
          '[data-cy="dashboard-signals"] [data-cy="dashboard-processing"]'
        ? {}
        : null;
    },
    querySelectorAll: (selector) => {
      const selectors =
        renderedSurface === 'progress'
          ? ['[data-cy="progress-recent-attempt-row"]']
          : [
              '[data-cy="dashboard-student-row"]',
              '[data-cy="dashboard-signal-row"]',
            ];
      return domReady && selectors.includes(selector)
        ? Array(renderedRows).fill({})
        : [];
    },
  };
  const window = {
    URL,
    fetch,
    location: { href: 'http://127.0.0.1:3300/clases/private/tablero' },
    performance: {
      now: () => (time += 0.01),
      timeOrigin: 100000,
      getEntriesByType: () => [
        {
          startTime: 0,
          responseEnd: 20,
          domInteractive: 40,
          domContentLoadedEventEnd: 50,
          loadEventEnd: 80,
        },
      ],
    },
    document: {
      querySelector: (selector) =>
        selector ===
        (renderedSurface === 'progress'
          ? '[data-cy="student-progress"]'
          : '[data-cy="class-dashboard"]')
          ? root
          : null,
    },
    MutationObserver: class {
      constructor(callback) {
        mutationCallback = callback;
      }
      observe() {}
      disconnect() {}
    },
  };
  const collector = helper.installPhaseBrowserDiagnostics(window, {
    navIndex: 1,
    profile: 4,
    runnerStart: 900,
    runnerNow: () => (runnerTime += 0.01),
    oracle,
    ...options,
  });
  return {
    window,
    collector,
    ready: (rendered = {}) => {
      domReady = true;
      renderedSurface = rendered.surface ?? renderedSurface;
      renderedSummary =
        rendered.summary ??
        (renderedSurface === 'progress'
          ? `${oracle.studentCompleted}/${oracle.studentRequired}`
          : `${oracle.completed}/${oracle.required}`);
      renderedRows =
        rendered.rows ??
        (renderedSurface === 'progress'
          ? Math.min(oracle.studentAttempts, 50)
          : 50);
      mutationCallback();
    },
  };
}
function loadApi(window, enabled = true) {
  const api = {};
  vm.runInNewContext(apiCode, {
    exports: api,
    require,
    window,
    fetch: window.fetch.bind(window),
    FormData: globalThis.FormData,
    AbortSignal,
    process: {
      env: {
        NEXT_PUBLIC_API_BASE_URL: 'http://127.0.0.1:4300',
        ALUNZA_E2E_BUILD: '1',
        ALUNZA_TEST_DASHBOARD_TIMINGS: enabled ? '1' : '0',
      },
    },
  });
  return api;
}

test.each([
  ['dashboard', route],
  ['progress', progressRoute],
])(
  '%s fetch observation preserves exact arguments, receiver, promise and unread response',
  async (surface, requestRoute) => {
    const response = new Response('private-body-sentinel', {
      headers: { 'X-Request-Id': requestId },
    });
    const result = Promise.resolve(response);
    let received;
    function original(...args) {
      received = { receiver: this, args };
      return result;
    }
    const h = host(original, { surface });
    const options = {
      headers: { Authorization: 'private-token-sentinel' },
      signal: new AbortController().signal,
    };
    expect(
      h.window.fetch(
        `http://127.0.0.1:4300${requestRoute}?private=private-query-sentinel`,
        options,
      ),
    ).toBe(result);
    expect(received.receiver).toBe(h.window);
    expect(received.args[1]).toBe(options);
    expect(await result).toBe(response);
    expect(response.bodyUsed).toBe(false);
    h.ready();
    h.ready();
    const report = h.collector.finish(1250, true);
    expect(report.surface).toBe(surface);
    expect(report.runnerEnd - report.runnerStart).toBe(350);
    expect(report.domReadyAt).toBeGreaterThanOrEqual(report.clockSync.autNow);
    expect(report.requests[0]).toMatchObject({
      route: surface,
      requestId,
      status: 200,
      outcome: 'fulfilled',
    });
    expect(report.requestIds).toEqual([requestId]);
    expect(
      report.events.filter((event) => event.name === 'dom:ready'),
    ).toHaveLength(1);
    expect(JSON.stringify(report)).not.toMatch(
      /private-|Authorization|http:|\?private/,
    );
    expect(JSON.stringify(report)).not.toContain(classId);
    expect(h.window.fetch).toBe(original);
    expect(h.window.__alunzaPhaseTiming).toBeUndefined();
  },
);

test.each([
  ['dashboard', route],
  ['progress', progressRoute],
])(
  '%s rejections and synchronous errors retain identity without leaking their message',
  async (surface, requestRoute) => {
    const controller = new AbortController();
    controller.abort();
    const error = new Error('private-error-sentinel');
    const result = Promise.reject(error);
    const h = host(() => result, { surface });
    expect(h.window.fetch(requestRoute, { signal: controller.signal })).toBe(
      result,
    );
    await expect(result).rejects.toBe(error);
    expect(h.collector.finish(1300, false).requests[0]).toMatchObject({
      outcome: 'rejected',
      aborted: true,
    });
    const sync = host(
      () => {
        throw error;
      },
      { surface },
    );
    expect(() => sync.window.fetch(requestRoute)).toThrow(error);
    expect(JSON.stringify(sync.collector.finish(1300, false))).not.toContain(
      error.message,
    );
  },
);

test.each([
  ['dashboard', route],
  ['progress', progressRoute],
])(
  '%s bounded buffers report dropped records and unknown routes never leak input',
  async (surface, requestRoute) => {
    const result = Promise.resolve(new Response('{}'));
    const h = host(() => result, { surface });
    for (let i = 0; i < 70; i++) h.window.fetch(requestRoute);
    h.window.fetch('https://private.invalid/private-body?token=sentinel');
    for (let i = 0; i < 150; i++)
      h.window.__alunzaPhaseTiming({ name: 'session:state' }, 101);
    h.window.__alunzaPhaseTiming(
      { name: 'private-event', route: 'private-route' },
      101,
    );
    await result;
    const report = h.collector.finish(1400, true);
    expect(report.requests).toHaveLength(64);
    expect(report.events).toHaveLength(128);
    expect(report.dropped).toBeGreaterThanOrEqual(29);
    expect(JSON.stringify(report)).not.toMatch(/private-|sentinel/);
    expect(report.unsupported).toContain('longtask');
  },
);

test.each([
  ['dashboard', route],
  ['progress', progressRoute],
])(
  '%s product marks require opt-in, sanitize routes and cannot change API success',
  async (surface, requestRoute) => {
    const h = host(
      () =>
        Promise.resolve(
          new Response(JSON.stringify({ data: 'private-payload' }), {
            headers: { 'X-Request-Id': requestId },
          }),
        ),
      { surface },
    );
    const api = loadApi(h.window);
    const response = await api.apiRequest(
      requestRoute + '?secret=private-query',
      z.object({ data: z.string() }),
    );
    expect(response.body.data).toBe('private-payload');
    api.markDashboardTiming(
      'json:start',
      '/api/v1/private-secret',
      'private-header',
    );
    const report = h.collector.finish(1500, true);
    expect(report.events.map((event) => event.name)).toEqual([
      'observer:installed',
      'json:start',
      'json:end',
      'validation:start',
      'validation:end',
    ]);
    expect(
      report.events
        .slice(1)
        .every(
          (event) => event.requestId === requestId && event.route === surface,
        ),
    ).toBe(true);
    expect(JSON.stringify(report)).not.toMatch(/private-/);
    const captured = [];
    const disabled = loadApi(
      {
        fetch: h.window.fetch,
        performance: h.window.performance,
        __alunzaPhaseTiming: (...args) => captured.push(args),
      },
      false,
    );
    disabled.markDashboardTiming('session:effect');
    disabled.markDashboardTiming('json:start', requestRoute, {
      get: () => {
        throw new Error('must not inspect headers while disabled');
      },
    });
    expect(captured).toEqual([]);
    const broken = loadApi({
      fetch: h.window.fetch,
      performance: h.window.performance,
      __alunzaPhaseTiming: () => {
        throw new Error('observer failure');
      },
    });
    await expect(
      broken.apiRequest(requestRoute, z.object({ data: z.string() })),
    ).resolves.toMatchObject({ body: { data: 'private-payload' } });
  },
);

test('legacy options retain an explicit dashboard surface and its own DOM oracle', () => {
  const h = host(() => Promise.resolve(new Response('{}')));
  h.ready();
  const report = h.collector.finish(1500, true);
  expect(report.surface).toBe('dashboard');
  expect(report.domReadyAt).not.toBeNull();
  expect(report.dropped).toBe(0);
});

test.each([0, 3, 51])(
  'progress observes the student oracle with %i attempts and a separate clock',
  (studentAttempts) => {
    const h = host(() => Promise.resolve(new Response('{}')), {
      surface: 'progress',
      navIndex: 0,
      profile: 1,
      oracle: {
        completed: 1,
        required: 360,
        attempts: 201,
        students: 60,
        studentCompleted: 2,
        studentRequired: 6,
        studentAttempts,
      },
    });
    h.ready();
    h.ready();
    const report = h.collector.finish(1500, true);
    expect(report).toMatchObject({
      schemaVersion: 1,
      surface: 'progress',
      navIndex: 0,
      isFirst: true,
      profile: 1,
      runnerStart: 900,
      runnerEnd: 1500,
      autTimeOrigin: 100000,
      dropped: 0,
    });
    expect(
      report.events.filter((event) => event.name === 'dom:ready'),
    ).toHaveLength(1);
    expect(report.domReadyAt).toBeGreaterThanOrEqual(report.clockSync.autNow);
    expect(report.clockSync.offsetMin).toBeLessThanOrEqual(
      report.clockSync.offsetMax,
    );
    expect(report.selfCostMs).toBeGreaterThan(0);
    expect(report.runnerSelfCostMs).toBeGreaterThan(0);
    expect(h.collector.finish(9999, false)).toBe(report);
  },
);

test.each([
  ['wrong student summary', { summary: '1/360' }],
  ['incomplete first page', { rows: 49 }],
  ['uncapped page', { rows: 51 }],
  ['other surface', { surface: 'dashboard', summary: '1/6', rows: 50 }],
])('progress never reports DOM ready for %s', (_name, rendered) => {
  const h = host(() => Promise.resolve(new Response('{}')), {
    surface: 'progress',
  });
  h.ready(rendered);
  const report = h.collector.finish(1500, false);
  expect(report.domReadyAt).toBeNull();
  expect(report.events.some((event) => event.name === 'dom:ready')).toBe(false);
});

test('progress preserves Request cancellation and stops observing late settlement', async () => {
  const controller = new AbortController();
  controller.abort();
  const input = new Request(
    `http://127.0.0.1:4300${progressRoute}?private=sentinel`,
    {
      signal: controller.signal,
    },
  );
  const error = new Error('private-cancellation');
  const rejected = Promise.reject(error);
  const cancelled = host(() => rejected, { surface: 'progress' });
  expect(cancelled.window.fetch(input)).toBe(rejected);
  await expect(rejected).rejects.toBe(error);
  expect(cancelled.collector.finish(1500, false).requests[0]).toMatchObject({
    route: 'progress',
    outcome: 'rejected',
    aborted: true,
  });

  let settle;
  const pending = new Promise((resolve) => {
    settle = resolve;
  });
  const h = host(() => pending, { surface: 'progress' });
  expect(h.window.fetch(input)).toBe(pending);
  const report = h.collector.finish(1500, false);
  const before = JSON.stringify(report);
  const response = new Response('private-body', {
    headers: { 'X-Request-Id': requestId },
  });
  settle(response);
  await pending;
  expect(response.bodyUsed).toBe(false);
  expect(JSON.stringify(report)).toBe(before);
  expect(report.requests[0]).toMatchObject({ outcome: 'pending', end: null });
  expect(before).not.toMatch(/private-|sentinel|http:/);
});
