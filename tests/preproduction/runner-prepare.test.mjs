import { afterEach, beforeEach, expect, test } from '@jest/globals';
import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { prepareSandboxContext } from '../../scripts/runner-prepare.mjs';

const names = [
  'capsule.mjs',
  'docker-engine.mjs',
  'docker-runtime.mjs',
  'kernel-controls.mjs',
  'remote-driver.mjs',
  'remote-init.mjs',
  'timing.mjs',
];
const archive = Buffer.from([0, 255, 8, 12, 255, 1]);
const digest = createHash('sha256').update(archive).digest('hex');
let directory, source, output, capsuleTar;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'alunza-runner-prepare-'));
  source = join(directory, 'source');
  output = join(directory, 'image-context');
  capsuleTar = join(directory, 'historical.tar');
  await mkdir(source);
  await writeFile(capsuleTar, archive);
  await writeFile(join(source, 'Dockerfile.sandbox'), 'FROM scratch\n');
  for (const name of names) await writeFile(join(source, name), 'export {};\n');
});

afterEach(async () => {
  if (directory && dirname(directory) === tmpdir())
    await rm(directory, { recursive: true, force: true });
});

const prepare = (overrides = {}) =>
  prepareSandboxContext({
    source,
    output,
    capsuleTar,
    capsuleSha256: digest,
    ...overrides,
  });

test('assembles the complete supervisor modules and preserves an existing capsule byte for byte', async () => {
  await mkdir(output);
  const inPlace = join(output, 'capsule.tar');
  await writeFile(inPlace, archive);
  const prepared = await prepare({ source: undefined, capsuleTar: inPlace });
  expect(prepared.capsuleSha256).toBe(digest);
  expect((await readdir(output)).sort()).toEqual([
    'Dockerfile',
    'capsule.tar',
    'supervisor',
  ]);
  expect((await readdir(join(output, 'supervisor'))).sort()).toEqual(names);
  for (const name of names) {
    const original = new URL(`../../infra/runner/${name}`, import.meta.url);
    expect(await readFile(join(output, 'supervisor', name))).toEqual(
      await readFile(original),
    );
  }
  expect(await readFile(inPlace)).toEqual(archive);
});

test('copies only the allowlisted sources and fails before creating a context when the archive hash changes', async () => {
  await writeFile(join(source, 'unexpected.env'), 'PRIVATE_FIXTURE');
  await writeFile(
    join(source, 'remote-driver.mjs'),
    "export { } from './capsule.mjs';\nawait import('node:fs/promises');\n",
  );
  await expect(prepare({ capsuleSha256: '0'.repeat(64) })).rejects.toThrow(
    'SHA-256 mismatch',
  );
  await expect(readdir(output)).rejects.toMatchObject({ code: 'ENOENT' });
  await prepare();
  expect(await readFile(join(output, 'capsule.tar'))).toEqual(archive);
  expect((await readdir(join(output, 'supervisor'))).sort()).toEqual(names);
});

test.each(['unexpected.env', 'supervisor/foreign.mjs'])(
  'rejects leftover content %s in a reused context',
  async (extra) => {
    await mkdir(join(output, 'supervisor'), { recursive: true });
    await writeFile(join(output, extra), 'preserve');
    await expect(prepare()).rejects.toThrow('Unexpected entry');
    expect(await readFile(join(output, extra), 'utf8')).toBe('preserve');
    await expect(readFile(join(output, 'Dockerfile'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  },
);

test.each([
  "import missing from './not-packaged.mjs';",
  "export * from '../outside.mjs';",
  "import 'external-package';",
  "await import('./outside.mjs');",
  'await import(process.env.MODULE);',
])(
  'rejects a dependency that cannot be supplied by the fixed image: %s',
  async (code) => {
    await writeFile(join(source, 'capsule.mjs'), code);
    await expect(prepare()).rejects.toThrow(/supervisor import/i);
    await expect(readdir(output)).rejects.toMatchObject({ code: 'ENOENT' });
  },
);
