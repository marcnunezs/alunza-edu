import { afterEach, describe, expect, test } from '@jest/globals';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import {
  prepareCandidate,
  restoreCandidate,
  sourcePathAllowed,
  verifyCandidate,
} from '../../scripts/runner-candidate.mjs';
import { readCoverageCandidate } from '../../scripts/quality-coverage.mjs';

const execute = promisify(execFile);
const temporary = [];
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

async function put(directory, path, content) {
  const destination = join(directory, path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, content);
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'alunza-candidate-test-'));
  temporary.push(directory);
  const git = (args) =>
    execute('git', args, { cwd: directory, windowsHide: true });
  await git(['init', '--quiet']);
  await put(directory, '.gitignore', '.local/\n.env*\n!.env.example\n');
  await put(directory, '.node-version', '24.21.0\n');
  await put(
    directory,
    'package.json',
    JSON.stringify({
      engines: { node: '24.21.0', npm: '11.19.0' },
      packageManager: 'npm@11.19.0',
    }),
  );
  await put(directory, 'package-lock.json', '{"lockfileVersion":3}\n');
  await put(directory, 'scripts/example.mjs', 'export const answer = 1;\n');
  await put(directory, 'scripts/deleted.mjs', 'export const old = true;\n');
  await put(
    directory,
    'supabase/migrations/20261116000000_example.sql',
    'select 1;\n',
  );
  await put(
    directory,
    'infra/runner/Dockerfile',
    `FROM node:24.21.0@sha256:${'b'.repeat(64)}\n`,
  );
  await git(['add', '--all']);
  await git([
    '-c',
    'user.name=Candidate fixture',
    '-c',
    'user.email=fixture@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '--quiet',
    '-m',
    'Synthetic source only',
  ]);
  await put(directory, 'scripts/example.mjs', 'export const answer = 2;\n');
  await unlink(join(directory, 'scripts/deleted.mjs'));
  await put(
    directory,
    '.env.example',
    'DATABASE_URL=postgresql://user:REPLACE@localhost/db\nAPI_SECRET_KEY=REPLACE\n',
  );
  await put(
    directory,
    'docs/work/decision.md',
    'Proposal; no approval or test result.\n',
  );
  await put(directory, '.env.private', 'SHOULD_NOT_BE_COPIED\n');
  await put(directory, 'apps/api/.env.local', 'SHOULD_NOT_BE_COPIED\n');
  await put(directory, 'scripts/credentials.json', 'SHOULD_NOT_BE_COPIED\n');
  await put(
    directory,
    '.local/evidence/private.json',
    'SHOULD_NOT_BE_COPIED\n',
  );
  await put(
    directory,
    '.codex-remote-attachments/private.md',
    'SHOULD_NOT_BE_COPIED\n',
  );
  await put(
    directory,
    'Evidencias CAPSTONE/private.docx',
    'SHOULD_NOT_BE_COPIED\n',
  );
  return directory;
}

afterEach(async () => {
  const tempRoot = await realpath(tmpdir());
  for (const directory of temporary.splice(0)) {
    const target = await realpath(directory);
    if (
      dirname(target) !== tempRoot ||
      !basename(target).startsWith('alunza-candidate-test-')
    )
      throw new Error('Unsafe test cleanup');
    await rm(target, { recursive: true, force: true });
  }
});

describe('offline source candidate', () => {
  test('Python cache changes preserve both source identities and files while authored Python changes remain visible', async () => {
    const directory = await fixture();
    // Exercise the repository rules, not a duplicate ignore policy in a fixture.
    await put(
      directory,
      '.gitignore',
      await readFile(new URL('../../.gitignore', import.meta.url)),
    );
    const source = 'infra/runner/linux-vm/broker.py';
    await put(directory, source, 'answer = 1\n');
    const caches = [
      'infra/runner/linux-vm/__pycache__/broker.cpython-312.pyc',
      'tests/runner/linux-vm/__pycache__/test_broker.cpython-312.pyc',
      'scripts/legacy.pyc',
      'scripts/legacy.pyo',
    ];
    for (const path of caches)
      await put(directory, path, Buffer.from([0, 1, 2, 3]));
    const first = await prepareCandidate(directory, 'python-before');
    const coverageBefore = await readCoverageCandidate(directory);
    const manifest = JSON.parse(
      await readFile(join(first.candidate, 'manifest.json'), 'utf8'),
    );
    expect(manifest.inventory.some((file) => file.path === source)).toBe(true);
    expect(manifest.inventory.some((file) => caches.includes(file.path))).toBe(
      false,
    );

    caches.push(
      'infra/runner/linux-vm/__pycache__/broker.cpython-312.opt-1.pyc',
    );
    const updated = Buffer.from([0, 7, 8, 9]);
    for (const path of caches) await put(directory, path, updated);
    const second = await prepareCandidate(directory, 'python-caches-changed');
    expect(second.sourceDigest).toBe(first.sourceDigest);
    expect(second.manifestSha256).toBe(first.manifestSha256);
    expect(await readCoverageCandidate(directory)).toEqual(coverageBefore);
    for (const path of caches)
      expect(await readFile(join(directory, path))).toEqual(updated);

    await put(directory, source, 'answer = 2\n');
    const changed = await prepareCandidate(directory, 'python-source-changed');
    expect(changed.sourceDigest).not.toBe(first.sourceDigest);
    expect((await readCoverageCandidate(directory)).sourceDigest).not.toBe(
      coverageBefore.sourceDigest,
    );
    // Unknown/native artifacts must stay visible to the inventory audit.
    const unknown = 'infra/runner/linux-vm/unreviewed.pyd';
    await put(directory, unknown, updated);
    const { stdout } = await execute(
      'git',
      ['ls-files', '--others', '--exclude-standard', '-z'],
      { cwd: directory, windowsHide: true },
    );
    expect(stdout.split('\0')).toContain(unknown);
    expect(sourcePathAllowed(unknown)).toBe(false);
  });

  test('captures dirty sources, restores exact bytes and keeps metadata reproducible without private files', async () => {
    const directory = await fixture();
    const first = await prepareCandidate(directory, 'one');
    const second = await prepareCandidate(directory, 'two');
    expect(first.sourceDigest).toBe(second.sourceDigest);
    expect(first.manifestSha256).toBe(second.manifestSha256);
    expect(first.workingTreeDirty).toBe(true);
    const manifest = JSON.parse(
      await readFile(join(first.candidate, 'manifest.json'), 'utf8'),
    );
    expect(manifest.inventory.map((file) => file.path)).toEqual([
      '.env.example',
      '.gitignore',
      '.node-version',
      'docs/work/decision.md',
      'infra/runner/Dockerfile',
      'package-lock.json',
      'package.json',
      'scripts/example.mjs',
      'supabase/migrations/20261116000000_example.sql',
    ]);
    expect(manifest.deletedPaths).toEqual(['scripts/deleted.mjs']);
    expect(
      manifest.git.includedChanges.some(
        (item) => item.path === 'scripts/example.mjs' && item.status === ' M',
      ),
    ).toBe(true);
    expect(manifest.images).toEqual([
      {
        path: 'infra/runner/Dockerfile',
        reference: `node:24.21.0@sha256:${'b'.repeat(64)}`,
        verification: 'declared-in-source-only',
      },
    ]);
    expect(manifest.claims.productTests).toBe('not-run-by-packager');
    expect(manifest.lockfile.sha256).toBe(sha256('{"lockfileVersion":3}\n'));
    const target = join(directory, '.local', 'restored');
    await restoreCandidate(first.candidate, target, {
      expectedManifestSha256: first.manifestSha256,
    });
    await expect(
      verifyCandidate(first.candidate, { tree: target }),
    ).resolves.toMatchObject({ sourceDigest: first.sourceDigest });
    expect(await readFile(join(target, 'scripts/example.mjs'), 'utf8')).toBe(
      'export const answer = 2;\n',
    );
    expect(await readdir(target)).not.toContain('.git');
    expect(await readdir(target)).not.toContain('manifest.json');
    await expect(prepareCandidate(directory, 'one')).rejects.toMatchObject({
      code: 'EEXIST',
    });
    await expect(
      restoreCandidate(first.candidate, target),
    ).rejects.toMatchObject({ code: 'EEXIST' });
  });

  test.each([
    [
      'modified',
      async (candidate) =>
        put(candidate, 'source/scripts/example.mjs', 'changed\n'),
      'SOURCE_HASH_MISMATCH',
    ],
    [
      'missing',
      async (candidate) =>
        unlink(join(candidate, 'source/scripts/example.mjs')),
      'SOURCE_ENTRIES_MISMATCH',
    ],
    [
      'extra file',
      async (candidate) =>
        put(candidate, 'source/scripts/extra.mjs', 'extra\n'),
      'SOURCE_ENTRIES_MISMATCH',
    ],
    [
      'extra empty directory',
      async (candidate) => mkdir(join(candidate, 'source/extra')),
      'SOURCE_ENTRIES_MISMATCH',
    ],
    [
      'extra candidate metadata',
      async (candidate) => put(candidate, 'secret.json', '{}'),
      'CANDIDATE_ENTRIES_MISMATCH',
    ],
    [
      'manifest tamper',
      async (candidate) => put(candidate, 'manifest.json', '{}\n'),
      'MANIFEST_HASH_MISMATCH',
    ],
  ])(
    'rejects %s instead of reporting a verified candidate',
    async (_name, mutate, error) => {
      const candidate = await prepareCandidate(await fixture(), 'case');
      await mutate(candidate.candidate);
      await expect(verifyCandidate(candidate.candidate)).rejects.toThrow(error);
    },
  );

  test('checks the independently recorded manifest digest', async () => {
    const candidate = await prepareCandidate(await fixture(), 'case');
    await expect(
      verifyCandidate(candidate.candidate, {
        expectedManifestSha256: '0'.repeat(64),
      }),
    ).rejects.toThrow('EXTERNAL_MANIFEST_HASH_MISMATCH');
  });

  test('rejects traversal even when the manifest checksums were recalculated', async () => {
    const directory = await fixture();
    const candidate = await prepareCandidate(directory, 'case');
    const manifest = JSON.parse(
      await readFile(join(candidate.candidate, 'manifest.json'), 'utf8'),
    );
    manifest.inventory[0].path = '../../outside.txt';
    manifest.sourceDigest = sha256(JSON.stringify(manifest.inventory));
    const bytes = JSON.stringify(manifest, null, 2) + '\n';
    await put(candidate.candidate, 'manifest.json', bytes);
    await put(candidate.candidate, 'manifest.sha256', sha256(bytes) + '\n');
    const target = join(directory, '.local', 'must-not-exist');
    await expect(restoreCandidate(candidate.candidate, target)).rejects.toThrow(
      'INVALID_INVENTORY_ENTRY',
    );
    await expect(
      readFile(join(directory, 'outside.txt')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readdir(join(directory, '.local'))).not.toContain(
      'must-not-exist',
    );
  });

  test('rejects source directory links and restore parent junctions', async () => {
    const directory = await fixture();
    const candidate = await prepareCandidate(directory, 'case');
    const realScripts = join(directory, '.local', 'detached-scripts');
    await rename(join(candidate.candidate, 'source/scripts'), realScripts);
    await symlink(
      realScripts,
      join(candidate.candidate, 'source/scripts'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await expect(verifyCandidate(candidate.candidate)).rejects.toThrow(
      'LINK_REJECTED',
    );
    const second = await prepareCandidate(directory, 'other');
    const parentLink = join(directory, 'parent-link');
    await symlink(
      join(directory, '.local'),
      parentLink,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await expect(
      restoreCandidate(second.candidate, join(parentLink, 'restored')),
    ).rejects.toThrow('REAL_DIRECTORY_REQUIRED');
  });

  test('rejects populated credential examples and altered TLS fixtures', async () => {
    const directory = await fixture();
    await put(
      directory,
      '.env.example',
      'SUPABASE_SECRET_KEY=not-a-placeholder\n',
    );
    await expect(prepareCandidate(directory, 'bad-env')).rejects.toThrow(
      'UNSAFE_ENV_EXAMPLE',
    );
    await put(directory, '.env.example', 'SUPABASE_SECRET_KEY=REPLACE\n');
    await put(
      directory,
      'tests/fixtures/tls/local-test-only.key',
      'unreviewed replacement\n',
    );
    await expect(prepareCandidate(directory, 'bad-key')).rejects.toThrow(
      'TEST_TLS_FIXTURE_CHANGED',
    );
  });

  test('rejects credential-bearing npm configuration before creating a candidate', async () => {
    const directory = await fixture();
    await put(
      directory,
      '.npmrc',
      '//registry.example.invalid/:_authToken=private-value\n',
    );
    await expect(prepareCandidate(directory, 'bad-npm')).rejects.toThrow(
      'UNREVIEWED_NPM_CONFIGURATION',
    );
  });

  test.each([
    'apps/web/src/app/actividades/[activityId]/ejercicios/[assignmentId]/page.tsx',
    'apps/web/src/app/clases/[classId]/estudiantes/[studentId]/page.tsx',
    'apps/web/src/app/(grupo)/[[...ruta]]/page.tsx',
    'apps/web/.env.example',
    '.nvmrc',
    '.prettierignore',
    'infra/preproduction/Job.Dockerfile',
    'infra/preproduction/Job.Dockerfile.dockerignore',
    'supabase/.gitignore',
    'infra/runner/linux-vm/broker.py',
    'tests/runner/linux-vm/test_broker.py',
    'tests/fixtures/tls/local-test-only.key',
    'tests/fixtures/tls/local-test-only.crt',
  ])('preserves source or reviewed fixture %s', (path) => {
    expect(sourcePathAllowed(path)).toBe(true);
  });

  test('the current authored source tree has only the two declared generated exclusions', async () => {
    const { stdout } = await execute(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      { windowsHide: true },
    );
    const omitted = [
      ...new Set(
        stdout
          .split('\0')
          .filter(
            (path) =>
              /^(apps|packages|scripts|tests|supabase|fixtures|infra|specs|docs|\.github)\//.test(
                path,
              ) && !sourcePathAllowed(path),
          ),
      ),
    ].sort();
    expect(omitted).toEqual([
      'apps/web/next-env.d.ts',
      'packages/contracts/openapi.json',
    ]);
  });

  test.each(['../escape', '/absolute', 'C:/escape', 'x\\y', 'with space'])(
    'rejects unsafe label %s',
    async (label) => {
      await expect(prepareCandidate(await fixture(), label)).rejects.toThrow(
        'INVALID_LABEL',
      );
    },
  );

  test.each([
    '.env',
    'apps/api/.env.local',
    '.local/a.mjs',
    '.git/config',
    'scripts/../outside.mjs',
    'scripts/C:/escape.mjs',
    'scripts/CON.mjs',
    'scripts/foo./bar.mjs',
    'scripts/node_modules/secret.json',
    'infra/runner/linux-vm/__pycache__/broker.cpython-312.pyc',
    'infra/runner/linux-vm/__pycache__/generated.py',
    'tests/runner/linux-vm/__pycache__/metadata.json',
    'scripts/legacy.pyc',
    'scripts/legacy.pyo',
    'scripts/credentials.json',
    'tests/private.key',
    'supabase/signing_keys.json',
    'apps/web/next-env.d.ts',
    'packages/contracts/openapi.json',
  ])('excludes %s from both capture and restoration', (path) => {
    expect(sourcePathAllowed(path)).toBe(false);
  });
});
