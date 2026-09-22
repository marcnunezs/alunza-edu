import { describe, test, expect } from '@jest/globals';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertVercelRuntime,
  assertRootPolicy,
  validateEngineEntries,
  policy,
} from '../../scripts/vercel-runtime.mjs';
const require = createRequire(import.meta.url);
const { satisfies } = require('semver');
const root = {
  engines: { node: '24.21.0', npm: '11.19.0' },
  packageManager: 'npm@11.19.0',
};
describe('Vercel engine exception', () => {
  test.each(['22.0.0', '25.0.0', '24.22.0-rc.1'])(
    'rejects runtime %s',
    (version) =>
      expect(() => assertVercelRuntime({ VERCEL: '1' }, version)).toThrow(),
  );
  test('rejects invocation outside Vercel', () =>
    expect(() => assertVercelRuntime({}, '24.21.0')).toThrow());
  test('global exact policy must remain unchanged', () => {
    expect(() =>
      assertRootPolicy(root, 'engine-strict=true\r\n'),
    ).not.toThrow();
    expect(() =>
      assertRootPolicy(
        { ...root, engines: { ...root.engines, node: '24.x' } },
        'engine-strict=true',
      ),
    ).toThrow();
    expect(() => assertRootPolicy(root, 'engine-strict=false')).toThrow();
    expect(() =>
      assertRootPolicy(root, 'engine-strict=true\nengine-strict=false'),
    ).toThrow();
  });
  test('only root exact Node mismatch is accepted', () => {
    const entries = {
      '': root,
      'node_modules/example': { engines: { node: '>=24 <25', npm: '>=11' } },
    };
    expect(() =>
      validateEngineEntries(entries, '24.22.0', '11.19.0', satisfies),
    ).not.toThrow();
    entries['node_modules/example'].engines.node = '22.x';
    expect(() =>
      validateEngineEntries(entries, '24.22.0', '11.19.0', satisfies),
    ).toThrow();
  });
  test('dependency npm mismatch is not excused', () => {
    expect(() =>
      validateEngineEntries(
        { '': root, 'node_modules/example': { engines: { npm: '>=12' } } },
        '24.22.0',
        '11.19.0',
        satisfies,
      ),
    ).toThrow();
    expect(() =>
      validateEngineEntries({ '': root }, '24.22.0', '11.20.0', satisfies),
    ).toThrow();
  });
  test('a forged lock cannot remove or widen the root engine policy', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'alunza-vercel-policy-'));
    try {
      await writeFile(join(directory, 'package.json'), JSON.stringify(root));
      await writeFile(join(directory, '.npmrc'), 'engine-strict=true\n');
      await writeFile(
        join(directory, 'package-lock.json'),
        JSON.stringify({
          packages: { '': { engines: { node: '24.x', npm: '11.19.0' } } },
        }),
      );
      await expect(policy(directory)).rejects.toThrow('lockfile');
      await writeFile(
        join(directory, 'package-lock.json'),
        JSON.stringify({ packages: { '': root } }),
      );
      await expect(policy(directory)).resolves.toHaveProperty('hash');
    } finally {
      for (const file of ['package.json', '.npmrc', 'package-lock.json'])
        await unlink(join(directory, file)).catch(() => {});
      await rmdir(directory);
    }
  });
});
