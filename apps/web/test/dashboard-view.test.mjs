import { readFileSync } from 'node:fs';
import { URLSearchParams } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const exports = {};
vm.runInNewContext(
  ts.transpileModule(
    readFileSync(
      new URL('../src/lib/dashboard-view.ts', import.meta.url),
      'utf8',
    ),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
      },
    },
  ).outputText,
  { exports, URLSearchParams },
);
const {
  dashboardQuery,
  dashboardEvidenceScope,
  dashboardSignalScope,
  signalPresentation,
  signalNarrativeParts,
  signalProcessingPresentation,
} = exports;

const scope = {
  asOf: '2026-10-26T12:00:00.123456Z',
  filters: {
    activityId: 'activity-a',
    conceptId: 'concept-a',
    from: '2026-10-26T10:00:00.000001Z',
  },
};

test('observation retains its period while completion evidence remains cumulative at the same exact cut', () => {
  for (const kind of ['ATTEMPT', 'EVENT', 'HINT']) {
    expect(dashboardEvidenceScope(scope, kind)).toEqual({
      kind,
      asOf: scope.asOf,
      ...scope.filters,
    });
  }
  const completion = dashboardEvidenceScope(scope, 'COMPLETION');
  expect(completion).toEqual({
    kind: 'COMPLETION',
    asOf: scope.asOf,
    activityId: 'activity-a',
    conceptId: 'concept-a',
  });
  expect(scope.filters.from).toBe('2026-10-26T10:00:00.000001Z');
});

test('signal queries cannot inherit a period or override the confirmed dashboard context', () => {
  const result = dashboardSignalScope(scope, {
    state: 'ALL',
    type: 'REPEATED_ERROR',
    cursor: 'page_2',
    limit: 50,
    from: '2099-01-01T00:00:00Z',
    asOf: '2099-01-01T00:00:00Z',
    activityId: 'wrong-activity',
    conceptId: 'wrong-concept',
  });
  expect(result).toEqual({
    asOf: scope.asOf,
    activityId: 'activity-a',
    conceptId: 'concept-a',
    state: 'ALL',
    type: 'REPEATED_ERROR',
    cursor: 'page_2',
    limit: 50,
  });
  const query = new URLSearchParams(dashboardQuery(result));
  expect(query.get('asOf')).toBe('2026-10-26T12:00:00.123456Z');
  expect(query.has('from')).toBe(false);
  expect(query.get('state')).toBe('ALL');
});

test('ACTIVE history and REVIEWED open accumulation keep review, history, membership and evidence independent', () => {
  const activeHistory = signalPresentation({
    state: 'ACTIVE',
    stoppedAt: scope.asOf,
    verification: 'VERIFIABLE',
    currentMember: false,
  });
  expect(activeHistory).toMatchObject({
    reviewState: 'ACTIVE',
    historical: true,
    verifiable: true,
    currentMember: false,
  });
  const reviewed = signalPresentation({
    state: 'REVIEWED',
    stoppedAt: null,
    verification: 'UNVERIFIABLE',
    currentMember: true,
  });
  expect(reviewed).toMatchObject({
    reviewState: 'REVIEWED',
    historical: false,
    verifiable: false,
    currentMember: true,
  });
  expect(activeHistory.reviewLabel).not.toBe(reviewed.reviewLabel);
});

test('pending, failed and absent evaluation never present an empty list as completed evaluation', () => {
  const base = {
    evaluatedAt: null,
    processedThrough: null,
    pendingLanes: 0,
    failedLanes: 0,
    unconfiguredTypes: [],
  };
  for (const status of ['PENDING', 'FAILED', 'NOT_EVALUATED']) {
    expect(signalProcessingPresentation({ ...base, status })).toMatchObject({
      status,
      unfinished: true,
      missingRules: false,
    });
  }
  expect(
    signalProcessingPresentation({
      ...base,
      status: 'UP_TO_DATE',
      unconfiguredTypes: ['INACTIVITY'],
    }),
  ).toMatchObject({ unfinished: false, missingRules: true });
});

test('query serialization preserves microseconds and opaque cursor bytes without injecting additional filters', () => {
  const cursor = 'safe_cursor+asOf=wrong&studentId=another';
  const query = new URLSearchParams(
    dashboardQuery({
      ...dashboardEvidenceScope(scope, 'ATTEMPT'),
      cursor,
      unused: undefined,
      empty: '',
      absent: null,
    }),
  );
  expect(query.get('asOf')).toBe(scope.asOf);
  expect(query.get('from')).toBe(scope.filters.from);
  expect(query.get('cursor')).toBe(cursor);
  expect(query.has('studentId')).toBe(false);
  expect(query.has('unused')).toBe(false);
  expect(query.has('empty')).toBe(false);
  expect(query.has('absent')).toBe(false);
});

test('signal narrative identifies both exact UTC instants and preserves all canonical wording', () => {
  const start = '2026-10-18T18:09:20.401001Z';
  const cut = '2026-10-26T18:09:18.261552Z';
  const cause = 'Desde ' + start + ', al corte ' + cut + ': FAILED_TEST.';
  const parts = signalNarrativeParts(cause);
  expect(parts).toEqual([
    { kind: 'text', value: 'Desde ' },
    { kind: 'instant', value: start },
    { kind: 'text', value: ', al corte ' },
    { kind: 'instant', value: cut },
    { kind: 'text', value: ': FAILED_TEST.' },
  ]);
  expect(parts.map((part) => part.value).join('')).toBe(cause);
});

test('signal narrative without dates, including unavailable evidence, remains unchanged', () => {
  for (const text of [
    '',
    'Los últimos 3 envíos no aumentaron las pruebas visibles superadas.',
    'La evidencia persistida no puede verificarse completamente.',
  ]) {
    expect(signalNarrativeParts(text)).toEqual([{ kind: 'text', value: text }]);
  }
});

test('signal narrative never normalizes invalid UTC or partially interprets unsupported timestamps', () => {
  for (const invalid of [
    '2026-02-30T12:00:00Z',
    '2025-02-29T12:00:00Z',
    '2026-10-26T24:00:00Z',
    '2026-10-26T12:60:00Z',
    '2026-10-26T12:00:00.1234567Z',
    '2026-10-26T12:00:00-03:00',
    '2026-10-26T12:00:00Z+00:00',
    '-2026-10-26T12:00:00Z',
  ]) {
    const text = 'Referencia ' + invalid + '.';
    expect(signalNarrativeParts(text)).toEqual([{ kind: 'text', value: text }]);
  }
  const mixed = 'No válida 2026-02-30T12:00:00Z; válida 2024-02-29T12:00:00Z.';
  expect(signalNarrativeParts(mixed)).toEqual([
    { kind: 'text', value: 'No válida 2026-02-30T12:00:00Z; válida ' },
    { kind: 'instant', value: '2024-02-29T12:00:00Z' },
    { kind: 'text', value: '.' },
  ]);
});

test('narrative tokenization preserves microsecond extremes and instants without a fraction exactly', () => {
  const instants = [
    '2026-10-26T00:00:00.000001Z',
    '2026-10-26T00:00:01.999999Z',
    '2026-10-26T00:00:02Z',
  ];
  const cause = 'Referencias: ' + instants.join('; ') + '.';
  const parts = signalNarrativeParts(cause);
  expect(
    parts.filter((part) => part.kind === 'instant').map((part) => part.value),
  ).toEqual(instants);
  expect(parts.map((part) => part.value).join('')).toBe(cause);
});
