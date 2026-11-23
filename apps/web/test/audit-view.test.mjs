import { readFileSync } from 'node:fs';
import { URLSearchParams } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

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
    { exports, URLSearchParams, require: (name) => load(name.slice(2)) },
  );
  return exports;
}
const {
  auditQuery,
  auditTextFilters,
  auditSelectedInstant,
  auditPageQuery,
  auditRefreshFilters,
  auditOutcomeLabel,
} = load('audit-view');
const cut = '2026-11-02T15:34:56.123456Z';
const filters = {
  from: '2026-11-01T15:00:00.000001Z',
  action: 'exercise.version.created',
};

test('exact action and entity-type filters preserve historical whitespace while UUID inputs trim it', () => {
  const result = auditTextFilters({
    actorId: ' 10000000-0000-4000-8000-000000000001 ',
    entityId: ' 20000000-0000-4000-8000-000000000002 ',
    action: ' fixture.updated ',
    entityType: ' exercise ',
  });
  expect(result).toEqual({
    actorId: '10000000-0000-4000-8000-000000000001',
    entityId: '20000000-0000-4000-8000-000000000002',
    action: ' fixture.updated ',
    entityType: ' exercise ',
  });
  const query = new URLSearchParams(auditQuery(result));
  expect(query.get('action')).toBe(' fixture.updated ');
  expect(query.get('entityType')).toBe(' exercise ');
  expect(
    auditTextFilters({
      actorId: '',
      entityId: '',
      action: '',
      entityType: ' ',
    }),
  ).toEqual({
    actorId: undefined,
    entityId: undefined,
    action: undefined,
    entityType: ' ',
  });
});

test('pagination keeps exact scope and cutoff while cursor remains opaque', () => {
  const next = auditPageQuery(filters, cut, 'next_page');
  expect(next).toEqual({
    ...filters,
    asOf: cut,
    limit: 20,
    cursor: 'next_page',
  });
  expect(auditPageQuery(filters, cut, null)).toEqual({
    ...filters,
    asOf: cut,
    limit: 20,
  });
  const query = new URLSearchParams(
    auditQuery({ ...next, unknown: 'secret', actorId: undefined }),
  );
  expect(query.get('asOf')).toBe(cut);
  expect(query.get('from')).toBe(filters.from);
  expect(query.has('unknown')).toBe(false);
  expect(query.has('actorId')).toBe(false);
});

test('filter values cannot inject another query parameter', () => {
  const action = 'action&actorId=other+value';
  const parsed = new URLSearchParams(auditQuery({ action, limit: 20 }));
  expect(parsed.get('action')).toBe(action);
  expect(parsed.has('actorId')).toBe(false);
});

test('refresh removes a selected cutoff and keeps every actual filter', () => {
  const scoped = {
    ...filters,
    asOf: cut,
    entityType: 'exercise',
    entityId: 'entity',
    actorId: 'actor',
  };
  expect(auditRefreshFilters(scoped)).toEqual({
    ...filters,
    entityType: 'exercise',
    entityId: 'entity',
    actorId: 'actor',
  });
  expect(scoped.asOf).toBe(cut);
});

test('unchanged local fields preserve server microseconds; deliberate changes use organization time', () => {
  expect(
    auditSelectedInstant('2026-11-02T12:34', cut, 'America/Santiago'),
  ).toBe(cut);
  expect(
    auditSelectedInstant('2026-11-02T12:35', cut, 'America/Santiago'),
  ).toBe('2026-11-02T15:35:00.000Z');
  expect(auditSelectedInstant('', cut, 'America/Santiago')).toBeUndefined();
  expect(() =>
    auditSelectedInstant('2026-02-30T12:00', undefined, 'America/Santiago'),
  ).toThrow();
  expect(() =>
    auditSelectedInstant('2026-09-06T00:30', undefined, 'America/Santiago'),
  ).toThrow();
});

test('historical outcomes keep their exact value when no known translation exists', () => {
  expect(auditOutcomeLabel('SUCCESS')).toBe('Completado');
  expect(auditOutcomeLabel('SUCCEEDED')).toBe('Completado');
  expect(auditOutcomeLabel('DENIED')).toBe('Denegado');
  expect(auditOutcomeLabel('FAILED')).toBe('Fallido');
  expect(auditOutcomeLabel('HISTORICAL_RESULT')).toBe('HISTORICAL_RESULT');
});
