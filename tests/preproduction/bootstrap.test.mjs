import { describe, test, expect } from '@jest/globals';
import { readFile } from 'node:fs/promises';
import { bootstrapArtifacts } from '../../scripts/preprod-bootstrap.mjs';

const fixture = JSON.parse(
  await readFile(
    new URL('../../fixtures/foundation/identity.json', import.meta.url),
    'utf8',
  ),
);
describe('offline preparation of remote bootstrap', () => {
  test('reuses six stable Auth identities and transactional inserts without resetting existing accounts', () => {
    const output = bootstrapArtifacts(fixture);
    expect(output.authUsers).toHaveLength(6);
    expect(
      output.authUsers.every((user) => !Object.hasOwn(user, 'password')),
    ).toBe(true);
    expect(output.sql).toContain('BEGIN;');
    expect(output.sql).toContain('COMMIT;');
    expect(output.sql).toContain('FROM auth.users WHERE id');
    expect(output.sql).toContain('ON CONFLICT DO NOTHING');
    expect(output.sql).not.toMatch(/\b(?:DELETE|TRUNCATE|DROP|UPDATE)\b/);
  });
  test('rejects an inconsistent role distribution before producing SQL', () => {
    const changed = JSON.parse(JSON.stringify(fixture));
    changed.users[0].role = 'TEACHER';
    expect(() => bootstrapArtifacts(changed)).toThrow();
  });
  test('SQL literal escaping prevents text from escaping its value', () => {
    const changed = JSON.parse(JSON.stringify(fixture));
    changed.organizations[0].name = "O'Brien";
    expect(bootstrapArtifacts(changed).sql).toContain("'O''Brien'");
  });
});
