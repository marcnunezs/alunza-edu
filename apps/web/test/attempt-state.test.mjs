import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';

const exports = {};
vm.runInNewContext(
  ts.transpileModule(
    readFileSync(
      new URL('../src/lib/attempt-state.ts', import.meta.url),
      'utf8',
    ),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
      },
    },
  ).outputText,
  { exports, require: createRequire(import.meta.url) },
);
const {
  readPendingAttempts,
  savePendingAttempts,
  pendingAttemptsKey,
  PENDING_RETENTION_MS,
  compareAttempts,
} = exports;
const scope = {
  userId: 'student-a',
  organizationId: 'organization-a',
  classId: 'class-a',
  assignmentId: 'assignment-a',
  exerciseVersionId: '10000000-0000-4000-8000-000000000001',
};
const operation = {
  key: '10000000-0000-4000-8000-000000000002',
  input: {
    code: 'module.exports.solve=()=>1;',
    exerciseVersionId: scope.exerciseVersionId,
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

test('an uncertain submission recovers its original key and snapshot only inside its authorized account and resource scope', () => {
  const local = storage();
  expect(savePendingAttempts(local, scope, [operation])).toBe(true);
  expect(readPendingAttempts(local, scope, 1001)).toEqual({
    operations: [operation],
    unavailable: false,
  });
  for (const field of Object.keys(scope))
    expect(
      readPendingAttempts(local, { ...scope, [field]: 'other' }, 1001)
        .operations,
    ).toEqual([]);
  expect(savePendingAttempts(local, scope, [], [operation.key])).toBe(true);
  expect(readPendingAttempts(local, scope, 1001).operations).toEqual([]);
});

test('storage denied, corrupt, expired, duplicate or cross-version requests never authorize a replay', () => {
  const local = storage();
  for (const value of [
    'broken',
    '{}',
    JSON.stringify([
      {
        ...operation,
        input: {
          ...operation.input,
          exerciseVersionId: '10000000-0000-4000-8000-000000000003',
        },
      },
    ]),
    JSON.stringify([operation, operation]),
    JSON.stringify([{ ...operation, createdAt: 3000 }]),
  ]) {
    local.setItem(pendingAttemptsKey(scope), value);
    expect(readPendingAttempts(local, scope, 2000)).toEqual({
      operations: [],
      unavailable: true,
    });
  }
  savePendingAttempts(local, scope, [operation]);
  expect(
    readPendingAttempts(local, scope, 1000 + PENDING_RETENTION_MS - 1)
      .operations,
  ).toHaveLength(1);
  expect(
    readPendingAttempts(local, scope, 1000 + PENDING_RETENTION_MS).unavailable,
  ).toBe(true);
  const denied = {
    getItem() {
      throw Error('denied');
    },
    setItem() {
      throw Error('denied');
    },
    removeItem() {
      throw Error('denied');
    },
  };
  expect(readPendingAttempts(denied, scope, 1001).unavailable).toBe(true);
  expect(savePendingAttempts(denied, scope, [operation])).toBe(false);
});

test('two intentional submissions retain independent keys and code without replacing one another', () => {
  const local = storage();
  const second = {
    ...operation,
    key: '10000000-0000-4000-8000-000000000004',
    input: { ...operation.input, code: 'module.exports.solve=()=>2;' },
  };
  savePendingAttempts(local, scope, [operation, second]);
  expect(readPendingAttempts(local, scope, 1001).operations).toEqual([
    operation,
    second,
  ]);
  savePendingAttempts(local, scope, [second], [operation.key]);
  expect(readPendingAttempts(local, scope, 1001).operations).toEqual([second]);
});

test('completing a second browser mount preserves the first mount pending snapshot across reload', () => {
  const local = storage();
  const second = {
    ...operation,
    key: '10000000-0000-4000-8000-000000000004',
    input: { ...operation.input, code: 'module.exports.solve=()=>2;' },
  };
  // A and B each know only their own in-memory operation.
  expect(savePendingAttempts(local, scope, [operation])).toBe(true);
  expect(savePendingAttempts(local, scope, [second])).toBe(true);
  expect(savePendingAttempts(local, scope, [], [second.key])).toBe(true);
  expect(readPendingAttempts(local, scope, 1001)).toEqual({
    operations: [operation],
    unavailable: false,
  });
});

test('legacy array migration preserves recovery and expires only the old operation', () => {
  const local = storage();
  const second = {
    ...operation,
    key: '10000000-0000-4000-8000-000000000004',
    createdAt: operation.createdAt + 100,
  };
  local.setItem(pendingAttemptsKey(scope), JSON.stringify([operation, second]));
  expect(readPendingAttempts(local, scope, 1200).operations).toEqual([
    operation,
    second,
  ]);
  expect(local.getItem(pendingAttemptsKey(scope))).toBe(null);
  expect(
    readPendingAttempts(local, scope, 1000 + PENDING_RETENTION_MS),
  ).toEqual({ operations: [second], unavailable: true });
});

test('several browser mounts retain more than two saved operations without silently discarding recovery', () => {
  const local = storage();
  const saved = [2, 4, 5].map((suffix) => ({
    ...operation,
    key: `10000000-0000-4000-8000-00000000000${suffix}`,
  }));
  for (const item of saved)
    expect(savePendingAttempts(local, scope, [item])).toBe(true);
  expect(readPendingAttempts(local, scope, 1001)).toEqual({
    operations: saved,
    unavailable: false,
  });
  expect(savePendingAttempts(local, scope, [], [saved[1].key])).toBe(true);
  expect(readPendingAttempts(local, scope, 1001).operations).toEqual([
    saved[0],
    saved[2],
  ]);
});

test('comparison follows server attempt order and counts only comparable visible evidence', () => {
  const first = {
    attemptId: 'first',
    assignmentId: 'assignment',
    exerciseVersionId: 'version',
    testsVersion: 'a'.repeat(64),
    attemptNumber: 1,
    technicalResult: { visiblePassed: 1, visibleTotal: 4 },
  };
  const second = {
    ...first,
    attemptId: 'second',
    attemptNumber: 2,
    technicalResult: { visiblePassed: 3, visibleTotal: 4 },
  };
  expect(compareAttempts(second, first)).toMatchObject({
    comparable: true,
    earlier: first,
    later: second,
    difference: 2,
  });
  for (const changed of [
    { ...second, testsVersion: 'b'.repeat(64) },
    { ...second, exerciseVersionId: 'other' },
    { ...second, assignmentId: 'other' },
    first,
  ])
    expect(compareAttempts(first, changed)).toEqual({ comparable: false });
});
