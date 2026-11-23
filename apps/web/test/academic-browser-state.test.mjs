import { spawnSync } from 'node:child_process';

const draftModule = new URL('../src/lib/exercise-draft.ts', import.meta.url)
  .href;
const timeModule = new URL('../src/lib/academic-time.ts', import.meta.url).href;

function verify(source) {
  // Node 24 strips TypeScript directly; assertions exercise the production helper.
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `
    import assert from 'node:assert/strict';
    import { draftKey, readDraft, saveDraft, discardDraft, DRAFT_RETENTION_MS } from ${JSON.stringify(draftModule)};
    import { localDateTime, toInstant } from ${JSON.stringify(timeModule)};
    const scope = {userId:'student-a',organizationId:'org-a',classId:'class-a',assignmentId:'assignment-a',exerciseVersionId:'version-a'};
    const map = new Map();
    const storage = {getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value),removeItem:key=>map.delete(key)};
    ${source}
  `,
    ],
    { encoding: 'utf8', timeout: 10_000 },
  );
  if (result.status !== 0)
    throw new Error(result.stderr || 'Falló la comprobación del estado local.');
}

test('draft cannot be recovered by another account, organization, class, assignment or version', () => {
  verify(`
    assert.equal(saveDraft(storage,scope,'// private',1000),true);
    assert.equal(readDraft(storage,scope,1001).code,'// private');
    for (const key of Object.keys(scope)) {
      assert.equal(readDraft(storage,{...scope,[key]:'different'},1001).status,'missing');
    }
  `);
});

test('opening a draft does not renew its retention; expiration is enforced at exactly 30 days', () => {
  verify(`
    saveDraft(storage,scope,'work',1000);
    assert.equal(readDraft(storage,scope,1000+DRAFT_RETENTION_MS-1).status,'ready');
    assert.equal(readDraft(storage,scope,1000+DRAFT_RETENTION_MS).status,'expired');
    assert.equal(storage.getItem(draftKey(scope)),null);
    saveDraft(storage,scope,'new work',2000);
    assert.equal(discardDraft(storage,scope),true);
    assert.equal(readDraft(storage,scope,2001).status,'missing');
  `);
});

test('malformed or unavailable storage never pretends recovery or successful persistence', () => {
  verify(`
    for(const value of ['bad json','{}',JSON.stringify({version:1,code:'future',updatedAt:3000})]) {
      storage.setItem(draftKey(scope),value);
      assert.equal(readDraft(storage,scope,2000).status,'unavailable');
    }
    const unavailable = {getItem(){throw new Error('denied')},setItem(){throw new Error('quota')},removeItem(){throw new Error('denied')}};
    assert.equal(readDraft(unavailable,scope,2000).status,'unavailable');
    assert.equal(saveDraft(unavailable,scope,'work',2000),false);
    assert.equal(discardDraft(unavailable,scope),false);
  `);
});

test('activity input follows the institution timezone and rejects nonexistent DST hours', () => {
  verify(`
    assert.equal(toInstant('2026-06-15T09:30','America/Santiago'),'2026-06-15T13:30:00.000Z');
    assert.equal(localDateTime('2026-06-15T13:30:00Z','America/Santiago'),'2026-06-15T09:30');
    assert.equal(toInstant('','America/Santiago'),null);
    assert.throws(()=>toInstant('2026-03-08T02:30','America/New_York'));
    assert.throws(()=>toInstant('2026-11-01T01:30','America/New_York'));
  `);
});
