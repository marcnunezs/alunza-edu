import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { URLSearchParams } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function load(name) {
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
      URLSearchParams,
      require: (id) => (id.startsWith('./') ? load(id.slice(2)) : require(id)),
    },
  );
  return exports;
}
const {
  readDashboardQuery,
  readStudentDetailQuery,
  studentDetailHref,
  studentDetailSearch,
  selectedInstant,
} = load('student-detail-view');
const classId = '10000000-0000-4000-8000-000000000001';
const studentId = '20000000-0000-4000-8000-000000000001';
const activityId = '30000000-0000-4000-8000-000000000001';
const conceptId = '40000000-0000-4000-8000-000000000001';
const asOf = '2026-10-27T12:34:56.123456Z';
const from = '2026-10-26T12:00:00.000001Z';

test('detail keeps the exact dashboard cut and filters but separates the roster cursor from attempts', () => {
  const filters = {
    activityId,
    conceptId,
    from,
    cursor: 'roster_page_2',
    limit: 20,
  };
  const url = new URL(
    studentDetailHref(classId, studentId, filters, asOf),
    'https://alunza.test',
  );
  expect(url.pathname).toBe(`/clases/${classId}/estudiantes/${studentId}`);
  const location = readStudentDetailQuery(url.search);
  expect(location.filters).toEqual({
    activityId,
    conceptId,
    from,
    asOf,
    limit: 20,
  });
  expect(readDashboardQuery(location.returnQuery)).toEqual({
    ...filters,
    asOf,
  });
  const paged = studentDetailSearch(
    { ...location.filters, cursor: 'attempt_page_2' },
    location.returnQuery,
  );
  expect(readStudentDetailQuery(paged)).toEqual({
    filters: { ...location.filters, cursor: 'attempt_page_2' },
    returnQuery: location.returnQuery,
  });
  expect(
    readDashboardQuery(readStudentDetailQuery(paged).returnQuery).cursor,
  ).toBe('roster_page_2');
});

test('invalid and duplicate URL fields cannot silently broaden a detail or redirect its fixed local return path', () => {
  for (const search of [
    'activityId=bad',
    `asOf=${asOf}&asOf=${asOf}`,
    'studentId=' + studentId,
    '__proto__=hidden',
    'constructor=hidden',
    'returnURL=https://external.test',
    'returnQuery=' + encodeURIComponent('https://external.test'),
    'returnQuery=' + encodeURIComponent('redirect=https://external.test'),
    'returnQuery=' + encodeURIComponent(`asOf=${asOf}&asOf=${asOf}`),
    `asOf=${from}&from=${asOf}`,
  ])
    expect(() => readStudentDetailQuery(search)).toThrow();
});

test('editing another filter retains microsecond precision, while an edited local time uses institutional timezone rules', () => {
  expect(selectedInstant('2026-10-27T09:34', asOf, 'America/Santiago')).toBe(
    asOf,
  );
  expect(selectedInstant('2026-10-27T09:35', asOf, 'America/Santiago')).toBe(
    '2026-10-27T12:35:00.000Z',
  );
  expect(selectedInstant('', asOf, 'America/Santiago')).toBeNull();
  expect(() =>
    selectedInstant('2026-03-08T02:30', undefined, 'America/New_York'),
  ).toThrow();
  expect(() =>
    selectedInstant('2026-11-01T01:30', undefined, 'America/New_York'),
  ).toThrow();
});
