import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { root } from './local.mjs';

const execute = promisify(execFile);
const hash = (value) => createHash('sha256').update(value).digest('hex');

/** Includes dirty and new authored sources; private diff never enters reports. */
export async function captureSignalCandidate(label) {
  if (!/^[a-z0-9-]+$/.test(label)) throw new Error('Invalid candidate label.');
  const git = async (args) =>
    (
      await execute('git', args, {
        cwd: root,
        windowsHide: true,
        maxBuffer: 64 * 1024 * 1024,
      })
    ).stdout;
  const [head, status, diff, names] = await Promise.all([
    git(['rev-parse', 'HEAD']),
    git(['status', '--porcelain=v1']),
    git(['diff', '--binary', 'HEAD']),
    git(['ls-files', '--cached', '--others', '--exclude-standard', '-z']),
  ]);
  const files = [...new Set(names.split('\0').filter(Boolean))]
    .filter(
      (name) =>
        /^(apps|packages|scripts|tests|supabase|fixtures|infra|\.github)\//.test(
          name,
        ) ||
        [
          'package.json',
          'package-lock.json',
          'tsconfig.base.json',
          'eslint.config.mjs',
          'cypress.config.cjs',
          '.env.example',
          '.prettierrc.json',
        ].includes(name),
    )
    .filter(
      (name) =>
        name !== 'apps/web/next-env.d.ts' &&
        name !== 'packages/contracts/openapi.json',
    )
    .sort();
  const inventory = [];
  for (const path of files) {
    try {
      inventory.push({ path, digest: hash(await readFile(join(root, path))) });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      inventory.push({ path, deleted: true });
    }
  }
  const candidate = {
    head: head.trim(),
    sourceDigest: hash(JSON.stringify(inventory)),
    sourceFiles: inventory.length,
    diffDigest: hash(diff),
    statusDigest: hash(status),
    generatedExclusions: [
      'apps/web/next-env.d.ts',
      'packages/contracts/openapi.json',
    ],
  };
  const directory = join(root, '.local/evidence/imp-05-05');
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, `${label}-candidate.json`),
    JSON.stringify({ ...candidate, inventory }, null, 2) + '\n',
  );
  await writeFile(join(directory, `${label}-status.txt`), status);
  await writeFile(join(directory, `${label}-tracked.patch`), diff);
  return candidate;
}
