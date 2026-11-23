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
vm.runInNewContext(compile('../src/lib/signal-rule-operation.ts'), {
  exports: recovery,
  require,
});
const hookCode = compile(
  '../src/components/signal-rules/use-rule-operation.ts',
);
const scope = {
  userId: '10000000-0000-4000-8000-000000000001',
  organizationId: '20000000-0000-4000-8000-000000000001',
};
const otherOrg = '20000000-0000-4000-8000-000000000002';
const versionId = '30000000-0000-4000-8000-000000000001';
const input = {
  operation: 'create',
  payload: {
    type: 'INACTIVITY',
    schemaVersion: 1,
    algorithmVersion: 'DEC005_V1',
    parameters: { inactivityDays: 7 },
  },
};
const activation = {
  operation: 'activate',
  versionId,
  payload: { expectedCurrentVersionId: null },
};
const pending = (body = input) => ({
  formatVersion: 1,
  ...scope,
  key: randomUUID(),
  ...body,
});
const version = (extra = {}) => ({
  ...input.payload,
  id: versionId,
  organizationId: scope.organizationId,
  version: 1,
  createdBy: scope.userId,
  createdAt: '2026-10-25T12:00:00.000001Z',
  activatedBy: null,
  validFrom: null,
  validTo: null,
  state: 'DRAFT',
  ...extra,
});
function storage() {
  const data = new Map();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  };
}

test('journal preserves exact payload and key, rejects overwrite, and isolates account/organization', () => {
  const store = storage();
  const record = pending();
  expect(recovery.saveRuleOperation(store, record)).toBe(true);
  expect(recovery.readRuleOperation(store, scope)).toEqual({
    status: 'ready',
    operation: record,
  });
  expect(
    recovery.readRuleOperation(store, { ...scope, organizationId: otherOrg }),
  ).toEqual({ status: 'empty' });
  expect(
    recovery.readRuleOperation(store, { ...scope, userId: otherOrg }),
  ).toEqual({ status: 'empty' });
  expect(recovery.saveRuleOperation(store, pending())).toBe(false);
  expect(recovery.clearRuleOperation(store, pending())).toBe(false);
  expect(recovery.clearRuleOperation(store, record)).toBe(true);
});

test.each([
  (record) => ({ ...record, path: '/api/v1/organizations/foreign/archive' }),
  (record) => ({ ...record, accessToken: 'never-persist-this' }),
  (record) => ({ ...record, organizationId: otherOrg }),
  (record) => ({ ...record, formatVersion: 2 }),
  (record) => ({
    ...record,
    payload: { ...record.payload, parameters: { inactivityDays: '7' } },
  }),
  () => ({ operation: 'activate', versionId: '../foreign' }),
])(
  'untrusted pending record is rejected, never converted to an arbitrary request',
  (modify) => {
    const store = storage();
    store.setItem(
      recovery.ruleOperationKey(scope),
      JSON.stringify(modify(pending())),
    );
    expect(recovery.readRuleOperation(store, scope)).toEqual({
      status: 'invalid',
    });
  },
);

test('request path is derived from validated operation and no token enters storage', () => {
  const record = pending(activation);
  expect(recovery.ruleOperationRequest(record)).toEqual({
    path: `/api/v1/signal-rules/${versionId}/activate`,
    body: { expectedCurrentVersionId: null },
    idempotencyKey: record.key,
  });
  expect(recovery.ruleOperationRequest(pending()).path).toBe(
    `/api/v1/organizations/${scope.organizationId}/signal-rules`,
  );
});

test('blank numeric fields remain absent; strict contract rejects invalid days/counts', () => {
  const { signalRuleCreateSchema } = require('@alunza/contracts');
  for (const value of ['', ' ', '-1', '0', '1.5', '2147483648']) {
    const form = new globalThis.FormData();
    form.set('parameters.inactivityDays', value);
    expect(
      signalRuleCreateSchema.safeParse(
        recovery.ruleFormInput('INACTIVITY', form),
      ).success,
    ).toBe(false);
  }
  const form = new globalThis.FormData();
  form.set('parameters.stagnationAttempts', '2');
  expect(
    signalRuleCreateSchema.parse(recovery.ruleFormInput('STAGNATION', form))
      .parameters,
  ).toEqual({ stagnationAttempts: 2 });
  form.set('parameters.stagnationAttempts', '1');
  expect(
    signalRuleCreateSchema.safeParse(recovery.ruleFormInput('STAGNATION', form))
      .success,
  ).toBe(false);
});

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
async function host(store, request, options = {}) {
  const slots = [];
  let cursor = 0;
  const effects = [];
  const cleanups = new Map();
  let authorized = options.authorized ?? true;
  let token = 'token-one';
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
    useEffect(effect, dependencies) {
      const index = cursor++;
      const previous = slots[index];
      if (!previous || dependencies.some((value, i) => value !== previous[i])) {
        slots[index] = dependencies;
        effects.push(() => {
          cleanups.get(index)?.();
          cleanups.set(index, effect());
        });
      }
    },
  };
  const hookExports = {};
  const refreshIdentity = jest.fn();
  vm.runInNewContext(hookCode, {
    exports: hookExports,
    AbortController,
    crypto: { randomUUID },
    window: { sessionStorage: store },
    require: (name) => {
      if (name === 'react') return hooks;
      if (name === '@/components/session-provider')
        return {
          useSession: () => ({
            session: { user: { id: scope.userId }, access_token: token },
            refreshIdentity,
          }),
        };
      if (name === '@/lib/signal-rule-operation') return recovery;
      if (name === '@/lib/api')
        return {
          apiRequest: request,
          ApiError,
          asApiError: (error) =>
            error instanceof ApiError
              ? error
              : new ApiError(503, 'API_UNAVAILABLE', 'Unavailable'),
        };
      return require(name);
    },
  });
  function render() {
    cursor = 0;
    const operation = hookExports.useRuleOperation(
      scope.organizationId,
      authorized,
      authorized,
    );
    for (const effect of effects.splice(0)) effect();
    return operation;
  }
  render();
  await Promise.resolve();
  return {
    render,
    refreshIdentity,
    unmount: () => {
      for (const cleanup of cleanups.values()) cleanup?.();
    },
    refreshToken: (value) => {
      token = value;
    },
    setAuthorized: (value) => {
      authorized = value;
    },
  };
}

test('storage failure prevents the first mutation', async () => {
  const store = storage();
  store.setItem = () => {
    throw new Error('quota');
  };
  const request = jest.fn();
  const app = await host(store, request);
  const result = await app.render().run(input);
  expect(request).not.toHaveBeenCalled();
  expect(result).toMatchObject({ status: 'failed', uncertain: false });
  expect(app.render().error.code).toBe('RULE_RECOVERY_UNAVAILABLE');
});

test('lost response survives unmount/reload; manual reconciliation uses identical payload/key and current token', async () => {
  const store = storage();
  const request = jest.fn(async () => {
    throw new ApiError(503, 'API_UNAVAILABLE', 'lost response');
  });
  const app = await host(store, request);
  await app.render().run(input);
  const first = request.mock.calls[0];
  const record = recovery.readRuleOperation(store, scope).operation;
  expect(first[2].idempotencyKey).toBe(record.key);
  app.unmount();
  const replay = jest.fn(async () => ({ body: { data: version() } }));
  const next = await host(store, replay);
  expect(replay).not.toHaveBeenCalled();
  next.refreshToken('renewed-token');
  await next.render().reconcile();
  expect(replay.mock.calls[0][0]).toBe(first[0]);
  expect(replay.mock.calls[0][2]).toMatchObject({
    body: first[2].body,
    idempotencyKey: first[2].idempotencyKey,
    accessToken: 'renewed-token',
  });
  expect(recovery.readRuleOperation(store, scope)).toEqual({ status: 'empty' });
});

test('double click has one POST, journal exists before request, and unmount preserves uncertain commit', async () => {
  const store = storage();
  let finish;
  const request = jest.fn(() => {
    expect(recovery.readRuleOperation(store, scope).status).toBe('ready');
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const app = await host(store, request);
  const operation = app.render();
  const running = operation.run(input);
  await operation.run(input);
  expect(request).toHaveBeenCalledTimes(1);
  app.unmount();
  finish({ body: { data: version() } });
  await running;
  expect(recovery.readRuleOperation(store, scope).status).toBe('ready');
});

test.each([401, 403, 404])(
  'authorization failure %s preserves earlier pending operation',
  async (status) => {
    const store = storage();
    const record = pending();
    recovery.saveRuleOperation(store, record);
    const app = await host(store, async () => {
      throw new ApiError(status, 'FORBIDDEN', 'denied');
    });
    await app.render().reconcile();
    expect(recovery.readRuleOperation(store, scope)).toEqual({
      status: 'ready',
      operation: record,
    });
    expect(app.refreshIdentity).toHaveBeenCalledTimes(status === 404 ? 0 : 1);
  },
);

test('current permission is required even with a valid saved operation', async () => {
  const store = storage();
  recovery.saveRuleOperation(store, pending());
  const request = jest.fn();
  const app = await host(store, request, { authorized: false });
  await app.render().reconcile();
  expect(request).not.toHaveBeenCalled();
  expect(app.render().journal.status).toBe('loading');
});

test('activation preflight rejects foreign organization before POST', async () => {
  const store = storage();
  recovery.saveRuleOperation(store, pending(activation));
  const request = jest.fn(async () => ({
    body: { data: version({ organizationId: otherOrg }) },
  }));
  const app = await host(store, request);
  await app.render().reconcile();
  expect(request).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0][2].method).toBeUndefined();
  expect(app.render().error.code).toBe('RULE_RECOVERY_SCOPE');
  expect(recovery.readRuleOperation(store, scope).status).toBe('ready');
});

test('confirmed CAS conflict clears request for deliberate new action; changed payload cannot overwrite uncertainty', async () => {
  const store = storage();
  const record = pending(activation);
  recovery.saveRuleOperation(store, record);
  const request = jest.fn(async (_path, _schema, options) => {
    if (!options.method) return { body: { data: version() } };
    throw new ApiError(409, 'RULE_VERSION_CONFLICT', 'conflict');
  });
  const app = await host(store, request);
  await app.render().run(input);
  expect(request).not.toHaveBeenCalled();
  await app.render().reconcile();
  expect(recovery.readRuleOperation(store, scope).status).toBe('empty');
  expect(app.render().error.code).toBe('RULE_VERSION_CONFLICT');
});

test('cleanup failure retains confirmed receipt and exact pending record for safe replay', async () => {
  const store = storage();
  store.removeItem = () => {
    throw new Error('unavailable');
  };
  const app = await host(store, async () => ({ body: { data: version() } }));
  expect((await app.render().run(input)).status).toBe('confirmed');
  expect(app.render().receipt.id).toBe(versionId);
  expect(recovery.readRuleOperation(store, scope).status).toBe('ready');
});
