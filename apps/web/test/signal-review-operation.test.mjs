import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const exports = {};
vm.runInNewContext(
  ts.transpileModule(
    readFileSync(
      new URL('../src/lib/signal-review-operation.ts', import.meta.url),
      'utf8',
    ),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
      },
    },
  ).outputText,
  { exports, require },
);
const {
  signalReviewRequest,
  signalReviewFromCurrent,
  signalReviewDenied,
  presentSignalFilters,
} = exports;
const signalId = '10000000-0000-4000-8000-000000000001';
const classId = '20000000-0000-4000-8000-000000000001';
const studentId = '30000000-0000-4000-8000-000000000001';
const reviewedBy = '40000000-0000-4000-8000-000000000001';
const reviewedAt = '2026-11-01T14:00:00.123456Z';

test('review retries address the same episode without client actor, timestamp, key or cut', () => {
  expect(signalReviewRequest(signalId)).toEqual({
    path: `/api/v1/signals/${signalId}/review`,
    method: 'PUT',
    body: {},
  });
  expect(signalReviewRequest(signalId)).toEqual(signalReviewRequest(signalId));
  expect(() => signalReviewRequest('../other')).toThrow();
});
test('recovery reports only a fully confirmed current review with original identity and precision', () => {
  const signal = {
    id: signalId,
    studentId,
    state: 'REVIEWED',
    reviewedBy,
    reviewedByName: 'Docente',
    reviewedAt,
  };
  expect(signalReviewFromCurrent(signal, classId)).toEqual({
    signalId,
    studentId,
    classId,
    state: 'REVIEWED',
    reviewedBy,
    reviewedByName: 'Docente',
    reviewedAt,
  });
  for (const patch of [
    { state: 'ACTIVE' },
    { reviewedBy: null },
    { reviewedAt: null },
  ])
    expect(
      signalReviewFromCurrent({ ...signal, ...patch }, classId),
    ).toBeNull();
});
test('authorization errors withdraw private content; transport uncertainty is recoverable', () => {
  for (const status of [401, 403, 404])
    expect(signalReviewDenied({ status })).toBe(true);
  for (const status of [409, 422, 503, 504])
    expect(signalReviewDenied({ status })).toBe(false);
});
test('moving to present discards cut and cursor while retaining meaningful filters', () => {
  const filters = {
    asOf: reviewedAt,
    cursor: 'page-two',
    activityId: signalId,
    from: '2026-10-01T00:00:00Z',
    limit: 50,
  };
  expect(presentSignalFilters(filters)).toEqual({
    activityId: signalId,
    from: filters.from,
    limit: 50,
  });
  expect(filters.asOf).toBe(reviewedAt);
  expect(filters.cursor).toBe('page-two');
});
