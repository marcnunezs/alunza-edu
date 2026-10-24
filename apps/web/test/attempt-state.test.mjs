import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function load(name, dependencies = {}) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync(new URL(`../src/lib/${name}.ts`, import.meta.url), 'utf8'),
      {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.CommonJS,
        },
      },
    ).outputText,
    {
      exports,
      require: (key) => dependencies[key] ?? require(key),
      Intl,
      Date,
      Error,
    },
  );
  return exports;
}
const local = load('academic-local');
const attempts = load('attempt-state', { './academic-local': local });
const scope = {
  accountId: 'student-a',
  organizationId: 'org-a',
  classId: 'class-a',
  assignmentId: 'assignment-a',
  versionId: '10000000-0000-4000-8000-000000000001',
};
const operation = {
  key: '10000000-0000-4000-8000-000000000002',
  input: {
    code: 'function solve() { return 1; }',
    exerciseVersionId: scope.versionId,
  },
  createdAt: 1000,
};
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

test('a lost response retains its original snapshot and key only for the same account and assignment', () => {
  const store = storage();
  attempts.savePendingAttempts(store, scope, [operation]);
  expect(attempts.readPendingAttempts(store, scope)).toEqual({
    operations: [operation],
    unavailable: false,
  });
  for (const field of Object.keys(scope))
    expect(
      attempts.readPendingAttempts(store, { ...scope, [field]: 'other' })
        .operations,
    ).toEqual([]);
  attempts.savePendingAttempts(store, scope, [], [operation.key]);
  expect(attempts.readPendingAttempts(store, scope).operations).toEqual([]);
});
test('finishing one intentional submission preserves the other pending submission', () => {
  const store = storage();
  const second = {
    ...operation,
    key: '10000000-0000-4000-8000-000000000003',
    input: { ...operation.input, code: 'function solve() { return 2; }' },
  };
  attempts.savePendingAttempts(store, scope, [operation]);
  attempts.savePendingAttempts(store, scope, [second]);
  attempts.savePendingAttempts(store, scope, [], [operation.key]);
  expect(attempts.readPendingAttempts(store, scope).operations).toEqual([
    second,
  ]);
});
test('closed-route recovery discovers only records for the current account, organization and assignment', () => {
  const store = storage();
  attempts.savePendingAttempts(store, scope, [operation]);
  expect(
    attempts.pendingScopesForAssignment(
      store,
      scope.accountId,
      scope.organizationId,
      scope.assignmentId,
    ),
  ).toEqual([scope]);
  expect(
    attempts.pendingScopesForAssignment(
      store,
      'other',
      scope.organizationId,
      scope.assignmentId,
    ),
  ).toEqual([]);
  expect(
    attempts.pendingScopesForAssignment(
      store,
      scope.accountId,
      'other',
      scope.assignmentId,
    ),
  ).toEqual([]);
  expect(
    attempts.pendingScopesForAssignment(
      store,
      scope.accountId,
      scope.organizationId,
      'other',
    ),
  ).toEqual([]);
  attempts.savePendingAttempts(store, scope, [], [operation.key]);
  expect(
    attempts.pendingScopesForAssignment(
      store,
      scope.accountId,
      scope.organizationId,
      scope.assignmentId,
    ),
  ).toEqual([]);
});
test('logout clears drafts and pending code snapshots while preserving unrelated storage', () => {
  const store = storage();
  local.writeDraft(store, scope, 'private draft');
  attempts.savePendingAttempts(store, scope, [operation]);
  store.setItem('unrelated', 'preserved');
  expect(local.clearDrafts(store)).toBe(true);
  expect(store.length).toBe(1);
  expect(store.getItem('unrelated')).toBe('preserved');
});
test('invalid or cross-version recovery records cannot be replayed and failed storage is explicit', () => {
  for (const value of [
    'bad-json',
    JSON.stringify({
      ...operation,
      input: {
        ...operation.input,
        exerciseVersionId: '10000000-0000-4000-8000-000000000009',
      },
    }),
  ]) {
    const store = storage();
    store.setItem(
      `${attempts.pendingAttemptsKey(scope)}${operation.key}`,
      value,
    );
    expect(attempts.readPendingAttempts(store, scope)).toEqual({
      operations: [],
      unavailable: true,
    });
  }
  expect(
    attempts.savePendingAttempts(
      {
        setItem() {
          throw new Error('blocked');
        },
      },
      scope,
      [operation],
    ),
  ).toBe(false);
});
test('comparison is scoped to a single assignment and exact test version, in intentional order', () => {
  const first = {
    attemptId: 'a',
    assignmentId: 'assignment',
    exerciseVersionId: 'v1',
    testsVersion: 'suite1',
    attemptNumber: 1,
    technicalResult: { visiblePassed: 1 },
  };
  const second = {
    ...first,
    attemptId: 'b',
    attemptNumber: 2,
    technicalResult: { visiblePassed: 2 },
  };
  expect(attempts.compareAttempts(second, first)).toMatchObject({
    comparable: true,
    difference: 1,
    earlier: first,
    later: second,
  });
  for (const field of ['assignmentId', 'exerciseVersionId', 'testsVersion'])
    expect(
      attempts.compareAttempts(first, { ...second, [field]: 'different' }),
    ).toEqual({ comparable: false });
});
