import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = readFileSync(
  new URL('../src/lib/academic-local.ts', import.meta.url),
  'utf8',
);
const output = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const local = {};
runInNewContext(output, { exports: local, Intl, Date, Error });
const scope = {
  accountId: 'student-a',
  organizationId: 'org-a',
  classId: 'class-a',
  assignmentId: 'assignment-a',
  versionId: 'version-1',
};
function storage() {
  const values = new Map();
  return {
    get length() {
      return values.size;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

describe('RF-008 scoped local draft', () => {
  it('preserves an intentionally empty solution and recovers after a reload', () => {
    const store = storage();
    expect(local.writeDraft(store, scope, '')).toBe(true);
    expect(local.readDraft(store, scope, 'template')).toEqual({
      code: '',
      recovered: true,
      failed: false,
    });
  });
  it.each([
    'accountId',
    'organizationId',
    'classId',
    'assignmentId',
    'versionId',
  ])('does not expose a draft from another %s', (field) => {
    const store = storage();
    local.writeDraft(store, scope, 'private solution');
    expect(
      local.readDraft(store, { ...scope, [field]: 'other' }, 'template'),
    ).toEqual({ code: 'template', recovered: false, failed: false });
  });
  it('retains the template and reports a failed read without claiming recovery', () => {
    expect(
      local.readDraft(
        {
          getItem() {
            throw new Error('blocked');
          },
        },
        scope,
        'template',
      ),
    ).toEqual({ code: 'template', recovered: false, failed: true });
  });
  it('reports a quota failure without claiming the draft was saved', () => {
    expect(
      local.writeDraft(
        {
          setItem() {
            throw new Error('quota');
          },
        },
        scope,
        'my code',
      ),
    ).toBe(false);
  });
  it('clears all account drafts at logout and preserves unrelated storage', () => {
    const store = storage();
    local.writeDraft(store, scope, 'a');
    local.writeDraft(store, { ...scope, accountId: 'b' }, 'b');
    store.setItem('unrelated', 'keep');
    expect(local.clearDrafts(store)).toBe(true);
    expect(store.length).toBe(1);
    expect(store.getItem('unrelated')).toBe('keep');
  });
  it('reports failed removal and can confirm a later successful cleanup', () => {
    const store = storage();
    local.writeDraft(store, scope, 'must not survive logout');
    let removalBlocked = true;
    const controlled = {
      get length() {
        return store.length;
      },
      key: store.key,
      removeItem(key) {
        if (removalBlocked) throw new Error('removal blocked');
        store.removeItem(key);
      },
    };
    expect(local.clearDrafts(controlled)).toBe(false);
    expect(store.getItem(local.draftKey(scope))).toBe(
      'must not survive logout',
    );
    removalBlocked = false;
    expect(local.clearDrafts(controlled)).toBe(true);
    expect(local.readDraft(store, scope, 'template')).toEqual({
      code: 'template',
      recovered: false,
      failed: false,
    });
  });
});

describe('Santiago activity instants', () => {
  it('converts summer and winter independently of the browser timezone', () => {
    expect(local.santiagoInstant('2026-01-15T09:00')).toBe(
      '2026-01-15T12:00:00.000Z',
    );
    expect(local.santiagoInstant('2026-07-15T09:00')).toBe(
      '2026-07-15T13:00:00.000Z',
    );
  });
  it('roundtrips an instant to the specified form timezone', () => {
    expect(local.santiagoInput('2026-09-28T15:30:00Z')).toBe(
      '2026-09-28T12:30',
    );
  });
  it('rejects an impossible hour at the spring clock change', () => {
    expect(() => local.santiagoInstant('2026-09-06T00:30')).toThrow(
      /cambio de horario/,
    );
  });
  it('rejects an ambiguous hour at the autumn clock change', () => {
    expect(() => local.santiagoInstant('2026-04-04T23:30')).toThrow(
      /cambio de horario/,
    );
  });
  it('allows an unspecified activity boundary', () => {
    expect(local.santiagoInstant('')).toBeNull();
  });
});
