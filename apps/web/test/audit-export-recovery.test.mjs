import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import { jest } from '@jest/globals';

const require = createRequire(import.meta.url);
const compile = (path) =>
  ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText;
const recovery = {};
vm.runInNewContext(compile('../src/lib/audit-export-operation.ts'), {
  exports: recovery,
  require,
});
const hookCode = compile('../src/components/audit/use-audit-export.ts');
const scope = {
  userId: '10000000-0000-4000-8000-000000000001',
  organizationId: '20000000-0000-4000-8000-000000000001',
};
const otherOrg = '20000000-0000-4000-8000-000000000002';
const payload = {
  from: '2026-09-01T00:00:00.000001Z',
  asOf: '2026-11-02T12:00:00.123456Z',
  action: ' historical.action ',
  entityType: ' exercise ',
};
const pending = () => ({
  formatVersion: 1,
  ...scope,
  key: randomUUID(),
  payload,
});
function metadata(extra = {}) {
  const exportId = '30000000-0000-4000-8000-000000000001';
  return {
    state: 'READY',
    exportId,
    organizationId: scope.organizationId,
    filters: payload,
    snapshotAt: '2026-11-02T12:00:01.000001Z',
    generatedAt: '2026-11-02T12:00:02.000001Z',
    expiresAt: '2026-11-03T12:00:02.000001Z',
    rowCount: 1,
    byteLength: 200,
    sha256: 'a'.repeat(64),
    formatVersion: 'audit-csv-v1',
    fileName: `auditoria-${scope.organizationId}-${exportId}.csv`,
    downloadPath: `/api/v1/organizations/${scope.organizationId}/audit-exports/${exportId}/content`,
    ...extra,
  };
}
function storage() {
  const data = new Map();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  };
}

test('export request drops pagination, preserves exact text and microseconds, and compares equivalent UTC instants', () => {
  const request = recovery.auditExportInput(
    { ...payload, limit: 100, cursor: 'cursor' },
    payload.asOf,
  );
  expect(request).toEqual(payload);
  expect(recovery.auditExportFingerprint(request)).toBe(
    recovery.auditExportFingerprint({
      ...request,
      asOf: '2026-11-02T09:00:00.123456-03:00',
    }),
  );
  expect(recovery.auditExportMatches(pending(), metadata())).toBe(true);
  expect(
    recovery.auditExportMatches(
      pending(),
      metadata({ organizationId: otherOrg }),
    ),
  ).toBe(false);
  expect(
    recovery.auditExportMatches(
      pending(),
      metadata({ filters: { ...payload, action: 'historical.action' } }),
    ),
  ).toBe(false);
});

test('journal is immutable, untrusted and isolated by account and organization', () => {
  const store = storage(),
    record = pending();
  expect(recovery.saveAuditExport(store, record)).toBe(true);
  expect(recovery.readAuditExport(store, scope)).toEqual({
    status: 'ready',
    operation: record,
  });
  expect(recovery.saveAuditExport(store, pending())).toBe(false);
  expect(recovery.clearAuditExport(store, pending())).toBe(false);
  expect(
    recovery.readAuditExport(store, { ...scope, organizationId: otherOrg }),
  ).toEqual({ status: 'empty' });
  expect(
    recovery.readAuditExport(store, { ...scope, userId: randomUUID() }),
  ).toEqual({ status: 'empty' });
  store.setItem(
    recovery.auditExportStorageKey(scope),
    JSON.stringify({ ...record, accessToken: 'not-allowed' }),
  );
  expect(recovery.readAuditExport(store, scope)).toEqual({ status: 'invalid' });
  expect(recovery.saveAuditExport(store, record)).toBe(false);
  store.setItem(recovery.auditExportStorageKey(scope), '{bad-json');
  expect(recovery.readAuditExport(store, scope)).toEqual({ status: 'invalid' });
});

test.each([
  [422, 'AUDIT_EXPORT_LIMIT_EXCEEDED', false, true],
  [422, 'VALIDATION_FAILED', false, true],
  [410, 'AUDIT_EXPORT_EXPIRED', false, true],
  [503, 'AUDIT_EXPORT_FAILED', false, true],
  [503, 'AUDIT_EXPORT_INTERRUPTED', false, true],
  [503, 'AUDIT_EXPORT_FAILED', true, false],
  [503, 'PERSISTENCE_UNAVAILABLE', true, false],
  [409, 'REQUEST_IN_PROGRESS', true, false],
  [409, 'IDEMPOTENCY_CONFLICT', false, false],
  [401, 'UNAUTHENTICATED', false, false],
])(
  'terminal outcome classifier keeps uncertainty for %s/%s/%s',
  (status, code, retryable, terminal) => {
    expect(
      recovery.auditExportTerminalFailure({ status, code, retryable }),
    ).toBe(terminal);
  },
);

class ApiError extends Error {
  constructor(
    status,
    code,
    message,
    _requestId,
    _fields = [],
    retryable = false,
  ) {
    super(message);
    Object.assign(this, { status, code, retryable });
  }
}
async function host(store, request) {
  const slots = [],
    effects = [],
    cleanups = new Map();
  let cursor = 0,
    token = 'token-one';
  const denied = jest.fn();
  const hooks = {
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = initial;
      return [
        slots[i],
        (value) => {
          slots[i] = typeof value === 'function' ? value(slots[i]) : value;
        },
      ];
    },
    useRef(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = { current: initial };
      return slots[i];
    },
    useEffect(effect, dependencies) {
      const i = cursor++,
        previous = slots[i];
      if (!previous || dependencies.some((value, n) => value !== previous[n])) {
        slots[i] = dependencies;
        effects.push(() => {
          cleanups.get(i)?.();
          cleanups.set(i, effect());
        });
      }
    },
  };
  const exports = {};
  vm.runInNewContext(hookCode, {
    exports,
    AbortController,
    crypto: { randomUUID },
    window: { sessionStorage: store },
    require: (name) => {
      if (name === 'react') return hooks;
      if (name === '@/components/session-provider')
        return {
          useSession: () => ({
            session: { user: { id: scope.userId }, access_token: token },
          }),
        };
      if (name === '@/lib/audit-export-operation') return recovery;
      if (name === '@/lib/api')
        return {
          apiRequest: request,
          ApiError,
          asApiError: (error) =>
            error instanceof ApiError
              ? error
              : new ApiError(
                  503,
                  'API_UNAVAILABLE',
                  'Unavailable',
                  undefined,
                  [],
                  true,
                ),
        };
      return require(name);
    },
  });
  function render() {
    cursor = 0;
    const result = exports.useAuditExport(scope.organizationId, denied);
    for (const effect of effects.splice(0)) effect();
    return result;
  }
  render();
  await Promise.resolve();
  return {
    render,
    denied,
    unmount: () => {
      for (const cleanup of cleanups.values()) cleanup?.();
    },
    renewToken: () => {
      token = 'renewed-token';
    },
  };
}

test('storage failure prevents the first POST', async () => {
  const store = storage(),
    request = jest.fn();
  store.setItem = () => {
    throw new Error('quota');
  };
  const app = await host(store, request);
  await app.render().generate(payload);
  expect(request).not.toHaveBeenCalled();
  expect(app.render().error.code).toBe('AUDIT_EXPORT_RECOVERY_UNAVAILABLE');
});

test('lost response survives reload and recovers the same payload/key using current credentials', async () => {
  const store = storage();
  const request = jest.fn(async () => {
    throw new ApiError(
      503,
      'PERSISTENCE_UNAVAILABLE',
      'unknown',
      undefined,
      [],
      true,
    );
  });
  const app = await host(store, request);
  await app.render().generate(payload);
  const first = request.mock.calls[0][2];
  expect(recovery.readAuditExport(store, scope).status).toBe('ready');
  app.unmount();
  const replay = jest.fn(async () => ({ body: { data: metadata() } }));
  const next = await host(store, replay);
  expect(replay).not.toHaveBeenCalled();
  next.renewToken();
  await next.render().recover();
  expect(replay.mock.calls[0][2]).toMatchObject({
    body: first.body,
    idempotencyKey: first.idempotencyKey,
    accessToken: 'renewed-token',
  });
  expect(recovery.readAuditExport(store, scope)).toEqual({ status: 'empty' });
  expect(next.render().receipt).toEqual(metadata());
});

test('double click sends one POST; late completion after unmount cannot install a receipt', async () => {
  const store = storage();
  let finish;
  const request = jest.fn(() => {
    expect(recovery.readAuditExport(store, scope).status).toBe('ready');
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const app = await host(store, request),
    operation = app.render();
  const running = operation.generate(payload);
  await operation.generate(payload);
  expect(request).toHaveBeenCalledTimes(1);
  app.unmount();
  expect(request.mock.calls[0][2].signal.aborted).toBe(true);
  finish({ body: { data: metadata() } });
  await running;
  expect(app.render().receipt).toBe(null);
  expect(recovery.readAuditExport(store, scope).status).toBe('ready');
});

test.each([401, 403, 404])(
  'access loss %s retires the surface and preserves the uncertain request',
  async (status) => {
    const store = storage(),
      record = pending();
    recovery.saveAuditExport(store, record);
    const app = await host(store, async () => {
      throw new ApiError(status, 'FORBIDDEN', 'denied');
    });
    await app.render().recover();
    expect(app.denied).toHaveBeenCalledTimes(1);
    expect(recovery.readAuditExport(store, scope)).toEqual({
      status: 'ready',
      operation: record,
    });
  },
);

test('scope mismatch keeps uncertainty; a durable terminal failure releases it without automatic retry', async () => {
  const store = storage();
  const wrong = await host(store, async () => ({
    body: { data: metadata({ organizationId: otherOrg }) },
  }));
  await wrong.render().generate(payload);
  expect(wrong.render().error.code).toBe('INVALID_RESPONSE');
  expect(recovery.readAuditExport(store, scope).status).toBe('ready');
  wrong.unmount();
  const request = jest.fn(async () => {
    throw new ApiError(
      503,
      'AUDIT_EXPORT_INTERRUPTED',
      'interrupted',
      undefined,
      [],
      false,
    );
  });
  const next = await host(store, request);
  await next.render().recover();
  expect(recovery.readAuditExport(store, scope)).toEqual({ status: 'empty' });
  expect(request).toHaveBeenCalledTimes(1);
  expect(next.render().receipt).toBe(null);
});
