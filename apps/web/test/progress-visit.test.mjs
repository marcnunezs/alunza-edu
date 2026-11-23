import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function module(name) {
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
    { exports, atob: globalThis.atob },
  );
  return exports;
}
const visits = module('activity-visit');
const view = module('progress-view');
const scope = {
  actorId: 'student',
  sessionId: 'session',
  activityId: 'activity',
};
const path = '/actividades/activity';
const key = '10000000-0000-4000-8000-000000000001';
const next = '10000000-0000-4000-8000-000000000002';
function storage() {
  const records = new Map();
  return {
    getItem: (id) => records.get(id) ?? null,
    setItem: (id, value) => records.set(id, value),
  };
}

test('a deliberate visit retains one transport key across remount, refresh and a lost response', () => {
  const local = storage();
  const currentScope = { ...scope, sessionId: 'remount-session' };
  visits.beginActivityVisit(local, currentScope, path, key);
  const marker = visits.resolveActivityVisit(
    local,
    currentScope,
    path,
    null,
    () => next,
  );
  expect(marker.key).toBe(key);
  expect(
    visits.resolveActivityVisit(local, currentScope, path, marker, () => next),
  ).toEqual(marker);
  // A fresh module models a browser reload with memory erased.
  const reloaded = module('activity-visit');
  expect(
    reloaded.resolveActivityVisit(local, currentScope, path, marker, () => next)
      .key,
  ).toBe(key);
  const confirmed = reloaded.confirmActivityVisit(local, currentScope, marker);
  expect(
    reloaded.resolveActivityVisit(
      local,
      currentScope,
      path,
      confirmed,
      () => next,
    ).confirmed,
  ).toBe(true);
});

test('a new explicit click creates a new visit while back navigation keeps its existing entry', () => {
  const local = storage();
  const currentScope = { ...scope, sessionId: 'new-click-session' };
  const first = visits.resolveActivityVisit(
    local,
    currentScope,
    path,
    null,
    () => key,
  );
  const confirmed = visits.confirmActivityVisit(local, currentScope, first);
  visits.beginActivityVisit(local, currentScope, path, next);
  const second = visits.resolveActivityVisit(
    local,
    currentScope,
    path,
    confirmed,
    () => key,
  );
  expect(second.key).toBe(next);
  visits.confirmActivityVisit(local, currentScope, second);
  expect(
    visits.resolveActivityVisit(
      local,
      currentScope,
      path,
      confirmed,
      () => next,
    ).key,
  ).toBe(key);
});

test('account and session changes cannot reuse another visit key or its confirmed marker', () => {
  const local = storage();
  const currentScope = { ...scope, sessionId: 'isolated-session' };
  const first = visits.resolveActivityVisit(
    local,
    currentScope,
    path,
    null,
    () => key,
  );
  for (const changed of [
    { ...currentScope, actorId: 'other' },
    { ...currentScope, sessionId: 'other' },
    { ...currentScope, activityId: 'other' },
  ])
    expect(
      visits.resolveActivityVisit(local, changed, path, first, () => next).key,
    ).toBe(next);
});

test('denied storage retains the key in the current navigation marker and memory', () => {
  const denied = {
    getItem() {
      throw Error('denied');
    },
    setItem() {
      throw Error('denied');
    },
  };
  const currentScope = { ...scope, sessionId: 'denied-session' };
  visits.beginActivityVisit(denied, currentScope, path, key);
  const marker = visits.resolveActivityVisit(
    denied,
    currentScope,
    path,
    null,
    () => next,
  );
  expect(marker.key).toBe(key);
  expect(
    module('activity-visit').resolveActivityVisit(
      denied,
      currentScope,
      path,
      marker,
      () => next,
    ).key,
  ).toBe(key);
});

test('display rounds ratios only for presentation and preserves the non-calculable state', () => {
  expect(view.progressPercentage(1 / 3)).toBe('33 %');
  expect(view.progressPercentage(2 / 3)).toBe('67 %');
  expect(view.progressPercentage(null)).toBe('No calculable');
  expect(view.progressEvidenceLabel('NO_ATTEMPTS')).toBe('Sin intentos.');
  expect(view.progressEvidenceLabel('NO_REQUIRED_EXERCISES')).toBe(
    'Sin ejercicios requeridos.',
  );
});
