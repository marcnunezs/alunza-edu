import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { root, run } from './local.mjs';

export async function sourceFingerprint() {
  const listed = await run('git', [
    'ls-files',
    '--cached',
    '--others',
    '--exclude-standard',
    '-z',
  ]);
  const files = [
    ...new Set(
      listed.stdout
        .split('\0')
        .filter(
          (path) =>
            /^(apps|packages|scripts|tests|fixtures|supabase|infra|\.github)\//.test(
              path,
            ) ||
            /^(package(-lock)?\.json|cypress\.config\.cjs|tsconfig\.base\.json|eslint\.config\.mjs|\.prettierrc\.json|\.node-version|\.npmrc|\.nvmrc)$/.test(
              path,
            ),
        ),
    ),
  ].sort();
  const hash = createHash('sha256');
  for (const path of files) {
    hash
      .update(path)
      .update('\0')
      .update(await readFile(join(root, path)))
      .update('\0');
  }
  return {
    algorithm: 'sha256',
    value: hash.digest('hex'),
    files: files.length,
    scope:
      'source-contracts-migrations-tests-fixtures-tooling-infra; excludes docs and private/ignored files',
  };
}
