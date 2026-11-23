import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  writeFile,
} from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs, promisify } from 'node:util';

const execute = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const encoded = (value) => JSON.stringify(value, null, 2) + '\n';
const digest = /^[a-f0-9]{64}$/;
const rootFiles = new Set([
  'AGENTS.md',
  'README.md',
  '.gitignore',
  '.gitattributes',
  '.dockerignore',
  '.npmrc',
  '.node-version',
  '.nvmrc',
  '.env.example',
  '.prettierrc.json',
  '.prettierignore',
  'package.json',
  'package-lock.json',
  'tsconfig.base.json',
  'eslint.config.mjs',
  'cypress.config.cjs',
]);
const generated = new Set([
  'apps/web/next-env.d.ts',
  'packages/contracts/openapi.json',
]);
const fixtureHashes = {
  'tests/fixtures/tls/local-test-only.key':
    'f990eb7320bd44bc785caf8dc9c26f1331dc98f79dab94638ed4d422fab1ee9b',
  'tests/fixtures/tls/local-test-only.crt':
    '2a19dfae85a4ebad042f5bc99b5df1978fa46f7f73bd1af161fda3e3e2e1ee3f',
};
const pdfFixtures = new Set([
  'fixtures/demo/materials/a1-funciones.pdf',
  'fixtures/demo/materials/a2-pruebas.pdf',
]);
const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const blockedParts = new Set([
  '.git',
  '.local',
  '.codex-remote-attachments',
  'node_modules',
  '__pycache__',
  'dist',
  'coverage',
  '.next',
  '.next-e2e',
  '.temp',
  '.branches',
  'screenshots',
  'videos',
]);

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

export function sourcePathAllowed(path) {
  if (typeof path !== 'string' || !/^[A-Za-z0-9_@.()[\]/-]+$/.test(path))
    return false;
  const parts = path.split('/');
  if (
    parts.some(
      (part) =>
        !part ||
        part === '.' ||
        part === '..' ||
        part.endsWith('.') ||
        reserved.test(part) ||
        blockedParts.has(part),
    )
  )
    return false;
  if (generated.has(path)) return false;
  if (
    rootFiles.has(path) ||
    Object.hasOwn(fixtureHashes, path) ||
    pdfFixtures.has(path)
  )
    return true;
  if (
    [
      'apps/web/.env.example',
      'infra/preproduction/runtime.env.example',
      'supabase/.gitignore',
    ].includes(path)
  )
    return true;
  if (
    parts.some(
      (part) =>
        part.startsWith('.env') ||
        /(?:^|[._-])(secret|credentials|signing_keys)(?:[._-]|$)/i.test(part),
    )
  )
    return false;
  return (
    /^(apps|packages|scripts|tests|supabase|fixtures|infra|specs|docs|\.github)\//.test(
      path,
    ) &&
    (/\.(?:[cm]?[jt]sx?|json|md|sql|ya?ml|bicep|toml|css|html|txt|py|ps1|sh|c)$/.test(
      path,
    ) ||
      /(?:^|\/)(?:Dockerfile(?:\.[a-z-]+)?|[A-Za-z-]+\.Dockerfile(?:\.dockerignore)?|\.dockerignore)$/.test(
        path,
      ))
  );
}

async function regularPath(base, path, directory = false) {
  const basePath = await realpath(base);
  let current = basePath;
  const parts = path.split('/');
  for (let index = 0; index < parts.length; index++) {
    current = resolve(current, parts[index]);
    const info = await lstat(current);
    requireCondition(!info.isSymbolicLink(), 'LINK_REJECTED');
    if (index < parts.length - 1 || directory)
      requireCondition(info.isDirectory(), 'DIRECTORY_REQUIRED');
    else
      requireCondition(
        info.isFile() && info.nlink === 1,
        'REGULAR_FILE_REQUIRED',
      );
  }
  const resolved = await realpath(current);
  const inside = relative(basePath, resolved);
  requireCondition(
    inside &&
      !isAbsolute(inside) &&
      inside !== '..' &&
      !inside.startsWith('../') &&
      !inside.startsWith('..\\'),
    'PATH_ESCAPE',
  );
  return current;
}

async function realDirectory(path) {
  const absolute = resolve(path);
  let cursor = absolute;
  for (;;) {
    const info = await lstat(cursor);
    requireCondition(
      info.isDirectory() && !info.isSymbolicLink(),
      'REAL_DIRECTORY_REQUIRED',
    );
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return absolute;
}

function inspectContent(path, bytes) {
  if (Object.hasOwn(fixtureHashes, path)) {
    requireCondition(
      hash(bytes) === fixtureHashes[path],
      'TEST_TLS_FIXTURE_CHANGED',
    );
    return;
  }
  if (!pdfFixtures.has(path))
    requireCondition(!bytes.includes(0), 'BINARY_SOURCE_REJECTED');
  if (path === '.npmrc') {
    requireCondition(
      bytes
        .toString('utf8')
        .split(/\r?\n/)
        .every(
          (line) =>
            !line.trim() || /^(?:engine-strict|save-exact)=true$/.test(line),
        ),
      'UNREVIEWED_NPM_CONFIGURATION',
    );
  }
  if (path === '.env.example' || path.endsWith('.env.example')) {
    for (const line of bytes.toString('utf8').split(/\r?\n/)) {
      const entry = /^\s*(?:#\s*)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (
        entry &&
        /(?:KEY|TOKEN|PASSWORD|SECRET|DATABASE_URL)$/.test(entry[1])
      ) {
        let safe =
          !entry[2] ||
          /^(?:REPLACE[A-Z0-9_]*|sb_publishable_REPLACE[A-Z0-9_]*)(?: \([^\r\n]*\))?$/.test(
            entry[2],
          );
        if (entry[1] === 'DATABASE_URL' && entry[2]) {
          try {
            const url = new URL(entry[2]);
            safe =
              ['postgres:', 'postgresql:'].includes(url.protocol) &&
              /^REPLACE[A-Z0-9_]*$/.test(url.password) &&
              ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
              !url.search;
          } catch {
            safe = false;
          }
        }
        requireCondition(safe, 'UNSAFE_ENV_EXAMPLE');
      }
    }
  }
}

async function git(directory, args) {
  return (
    await execute('git', args, {
      cwd: directory,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    })
  ).stdout;
}

async function capture(directory) {
  requireCondition(
    (await realpath(directory)) ===
      (await realpath(
        (await git(directory, ['rev-parse', '--show-toplevel'])).trim(),
      )),
    'GIT_ROOT_REQUIRED',
  );
  const [head, index, names, status] = await Promise.all([
    git(directory, ['rev-parse', 'HEAD']),
    git(directory, ['ls-files', '--stage', '-z']),
    git(directory, [
      'ls-files',
      '--cached',
      '--others',
      '--exclude-standard',
      '-z',
    ]),
    git(directory, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
  ]);
  const executable = new Set();
  for (const entry of index.split('\0').filter(Boolean)) {
    const match = /^(\d+) [a-f0-9]+ (\d)\t(.+)$/.exec(entry);
    requireCondition(match && match[2] === '0', 'UNMERGED_INDEX');
    if (match[1] === '100755') executable.add(match[3]);
  }
  const changes = [];
  const records = status.split('\0').filter(Boolean);
  for (let i = 0; i < records.length; i++) {
    const state = records[i].slice(0, 2);
    const path = records[i].slice(3);
    if (sourcePathAllowed(path)) changes.push({ path, status: state });
    if (/[RC]/.test(state)) {
      const previous = records[++i];
      if (sourcePathAllowed(previous))
        changes.push({ path: previous, status: 'previous-path' });
    }
  }
  changes.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  const files = new Map();
  const inventory = [];
  const deletedPaths = [];
  for (const path of [
    ...new Set(names.split('\0').filter(sourcePathAllowed)),
  ].sort()) {
    let selected;
    try {
      selected = await regularPath(directory, path);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      deletedPaths.push(path);
      continue;
    }
    const bytes = await readFile(selected);
    requireCondition(bytes.length <= 20 * 1024 * 1024, 'SOURCE_FILE_TOO_LARGE');
    inspectContent(path, bytes);
    files.set(path, bytes);
    inventory.push({
      path,
      sha256: hash(bytes),
      bytes: bytes.length,
      executable: executable.has(path),
    });
  }
  requireCondition(
    inventory.reduce((total, file) => total + file.bytes, 0) <=
      256 * 1024 * 1024,
    'SOURCE_SET_TOO_LARGE',
  );
  return {
    files,
    inventory,
    deletedPaths,
    git: {
      baseCommit: head.trim(),
      workingTreeDirty: status.length > 0,
      includedChanges: changes,
    },
  };
}

function declarations(files) {
  const pkg = JSON.parse(files.get('package.json')?.toString('utf8') ?? 'null');
  requireCondition(
    pkg && files.has('package-lock.json') && files.has('.node-version'),
    'REQUIRED_SOURCE_MISSING',
  );
  const images = [];
  for (const [path, bytes] of files) {
    if (
      !/(?:^|\/)(?:Dockerfile(?:\.[a-z-]+)?|[A-Za-z-]+\.Dockerfile)$/.test(path)
    )
      continue;
    for (const match of bytes
      .toString('utf8')
      .matchAll(/^FROM\s+([^\s]+@sha256:[a-f0-9]{64})(?:\s|$)/gm))
      images.push({
        path,
        reference: match[1],
        verification: 'declared-in-source-only',
      });
  }
  return {
    runtime: {
      node: pkg.engines?.node ?? null,
      npm: pkg.engines?.npm ?? null,
      packageManager: pkg.packageManager ?? null,
      nodeVersionFile: files.get('.node-version').toString('utf8').trim(),
    },
    lockfile: {
      path: 'package-lock.json',
      sha256: hash(files.get('package-lock.json')),
    },
    migrations: [...files]
      .filter(([path]) => /^supabase\/migrations\/[^/]+\.sql$/.test(path))
      .map(([path, bytes]) => ({ path, sha256: hash(bytes) })),
    images,
    testFixtureOnly: [...files.keys()].filter((path) =>
      Object.hasOwn(fixtureHashes, path),
    ),
  };
}

export async function prepareCandidate(directory, label) {
  requireCondition(/^[a-z0-9][a-z0-9-]{0,79}$/.test(label), 'INVALID_LABEL');
  await realDirectory(directory);
  const first = await capture(directory);
  const second = await capture(directory);
  requireCondition(
    encoded({ ...first, files: null }) === encoded({ ...second, files: null }),
    'SOURCE_CHANGED_DURING_CAPTURE',
  );
  const manifest = {
    schemaVersion: 1,
    kind: 'alunza-source-candidate',
    claims: {
      productTests: 'not-run-by-packager',
      remoteValidation: 'not-assessed',
      humanAcceptance: 'not-recorded',
      imageOrVmSnapshot: false,
    },
    git: first.git,
    sourceDigest: hash(JSON.stringify(first.inventory)),
    inventory: first.inventory,
    deletedPaths: first.deletedPaths,
    generatedExclusions: [...generated],
    ...declarations(first.files),
  };
  for (const segment of ['.local', '.local/candidates']) {
    await mkdir(resolve(directory, segment)).catch((error) => {
      if (error.code !== 'EEXIST') throw error;
    });
    await regularPath(directory, segment, true);
  }
  const destination = resolve(directory, '.local/candidates', label);
  await mkdir(destination); // Never reuse or overwrite a previous candidate.
  await mkdir(resolve(destination, 'source'));
  for (const file of first.inventory) {
    const output = resolve(destination, 'source', file.path);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, first.files.get(file.path), {
      flag: 'wx',
      mode: file.executable ? 0o755 : 0o644,
    });
  }
  const manifestBytes = encoded(manifest);
  await writeFile(resolve(destination, 'manifest.json'), manifestBytes, {
    flag: 'wx',
  });
  await writeFile(
    resolve(destination, 'manifest.sha256'),
    hash(manifestBytes) + '\n',
    { flag: 'wx' },
  );
  return { candidate: destination, ...(await verifyCandidate(destination)) };
}

async function treeInventory(directory, prefix = '') {
  const files = [];
  const directories = [];
  for (const entry of await readdir(resolve(directory, prefix), {
    withFileTypes: true,
  })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await regularPath(directory, path, true);
      directories.push(path);
      const child = await treeInventory(directory, path);
      files.push(...child.files);
      directories.push(...child.directories);
    } else {
      await regularPath(directory, path);
      files.push(path);
    }
  }
  return { files: files.sort(), directories: directories.sort() };
}

function validateManifest(manifest) {
  requireCondition(
    manifest &&
      Object.keys(manifest).sort().join(',') ===
        [
          'schemaVersion',
          'kind',
          'claims',
          'git',
          'sourceDigest',
          'inventory',
          'deletedPaths',
          'generatedExclusions',
          'runtime',
          'lockfile',
          'migrations',
          'images',
          'testFixtureOnly',
        ]
          .sort()
          .join(','),
    'INVALID_MANIFEST_FIELDS',
  );
  requireCondition(
    manifest?.schemaVersion === 1 &&
      manifest.kind === 'alunza-source-candidate',
    'INVALID_MANIFEST',
  );
  requireCondition(
    /^[a-f0-9]{40}$/.test(manifest.git?.baseCommit) &&
      typeof manifest.git?.workingTreeDirty === 'boolean',
    'INVALID_GIT_METADATA',
  );
  requireCondition(
    Array.isArray(manifest.inventory) &&
      manifest.inventory.length > 0 &&
      manifest.inventory.length <= 20000,
    'INVALID_INVENTORY',
  );
  const paths = new Set();
  for (const file of manifest.inventory) {
    requireCondition(
      file &&
        Object.keys(file).sort().join(',') === 'bytes,executable,path,sha256',
      'INVALID_INVENTORY_FIELDS',
    );
    requireCondition(
      sourcePathAllowed(file.path) &&
        digest.test(file.sha256) &&
        Number.isSafeInteger(file.bytes) &&
        file.bytes >= 0 &&
        file.bytes <= 20 * 1024 * 1024 &&
        typeof file.executable === 'boolean',
      'INVALID_INVENTORY_ENTRY',
    );
    requireCondition(!paths.has(file.path.toLowerCase()), 'DUPLICATE_PATH');
    paths.add(file.path.toLowerCase());
  }
  requireCondition(
    manifest.inventory.reduce((total, file) => total + file.bytes, 0) <=
      256 * 1024 * 1024,
    'SOURCE_SET_TOO_LARGE',
  );
  requireCondition(
    encoded(manifest.inventory.map((file) => file.path)) ===
      encoded(manifest.inventory.map((file) => file.path).sort()),
    'UNSORTED_INVENTORY',
  );
  requireCondition(
    hash(JSON.stringify(manifest.inventory)) === manifest.sourceDigest,
    'SOURCE_DIGEST_MISMATCH',
  );
  requireCondition(
    Array.isArray(manifest.deletedPaths) &&
      manifest.deletedPaths.every(sourcePathAllowed),
    'INVALID_DELETED_PATHS',
  );
  requireCondition(
    Array.isArray(manifest.git.includedChanges) &&
      manifest.git.includedChanges.every(
        (item) =>
          sourcePathAllowed(item.path) &&
          /^(?:[ MADRCU?!]{2}|previous-path)$/.test(item.status),
      ),
    'INVALID_CHANGE_METADATA',
  );
  requireCondition(
    encoded(manifest.generatedExclusions) === encoded([...generated]),
    'INVALID_EXCLUSIONS',
  );
  requireCondition(
    encoded(manifest.claims) ===
      encoded({
        productTests: 'not-run-by-packager',
        remoteValidation: 'not-assessed',
        humanAcceptance: 'not-recorded',
        imageOrVmSnapshot: false,
      }),
    'INVALID_CLAIMS',
  );
}

export async function verifyCandidate(
  candidate,
  { tree, expectedManifestSha256 } = {},
) {
  await realDirectory(candidate);
  const names = (await readdir(candidate)).sort();
  requireCondition(
    encoded(names) === encoded(['manifest.json', 'manifest.sha256', 'source']),
    'CANDIDATE_ENTRIES_MISMATCH',
  );
  const bytes = await readFile(await regularPath(candidate, 'manifest.json'));
  requireCondition(bytes.length <= 8 * 1024 * 1024, 'MANIFEST_TOO_LARGE');
  const expected = await readFile(
    await regularPath(candidate, 'manifest.sha256'),
    'utf8',
  );
  const manifestSha256 = hash(bytes);
  requireCondition(
    expected === manifestSha256 + '\n',
    'MANIFEST_HASH_MISMATCH',
  );
  if (expectedManifestSha256 !== undefined)
    requireCondition(
      digest.test(expectedManifestSha256) &&
        manifestSha256 === expectedManifestSha256,
      'EXTERNAL_MANIFEST_HASH_MISMATCH',
    );
  const manifest = JSON.parse(bytes.toString('utf8'));
  validateManifest(manifest);
  const source = tree
    ? await realDirectory(tree)
    : await regularPath(candidate, 'source', true);
  const actual = await treeInventory(source);
  const expectedDirectories = new Set();
  for (const file of manifest.inventory) {
    const parts = file.path.split('/');
    for (let i = 1; i < parts.length; i++)
      expectedDirectories.add(parts.slice(0, i).join('/'));
  }
  requireCondition(
    encoded(actual.files) ===
      encoded(manifest.inventory.map((file) => file.path)) &&
      encoded(actual.directories) === encoded([...expectedDirectories].sort()),
    'SOURCE_ENTRIES_MISMATCH',
  );
  const files = new Map();
  for (const file of manifest.inventory) {
    const content = await readFile(await regularPath(source, file.path));
    requireCondition(
      content.length === file.bytes && hash(content) === file.sha256,
      'SOURCE_HASH_MISMATCH',
    );
    inspectContent(file.path, content);
    files.set(file.path, content);
  }
  for (const [key, value] of Object.entries(declarations(files)))
    requireCondition(
      encoded(manifest[key]) === encoded(value),
      'DECLARATION_MISMATCH',
    );
  return {
    status: 'verified-source-only',
    sourceDigest: manifest.sourceDigest,
    manifestSha256,
    sourceFiles: manifest.inventory.length,
    workingTreeDirty: manifest.git.workingTreeDirty,
    productTests: manifest.claims.productTests,
  };
}

export async function restoreCandidate(candidate, target, options = {}) {
  const verified = await verifyCandidate(candidate, options);
  const manifestBytes = await readFile(
    await regularPath(candidate, 'manifest.json'),
  );
  requireCondition(
    hash(manifestBytes) === verified.manifestSha256,
    'MANIFEST_CHANGED_DURING_RESTORE',
  );
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  validateManifest(manifest);
  const absolute = resolve(target);
  await realDirectory(dirname(absolute));
  await mkdir(absolute); // Existing files/directories always reject; no merge or deletion.
  for (const file of manifest.inventory) {
    const bytes = await readFile(
      await regularPath(resolve(candidate, 'source'), file.path),
    );
    requireCondition(
      hash(bytes) === file.sha256,
      'SOURCE_CHANGED_DURING_RESTORE',
    );
    const output = resolve(absolute, file.path);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, bytes, {
      flag: 'wx',
      mode: file.executable ? 0o755 : 0o644,
    });
  }
  await verifyCandidate(candidate, {
    tree: absolute,
    expectedManifestSha256: verified.manifestSha256,
  });
  return { target: absolute, ...verified };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const { positionals, values } = parseArgs({
      allowPositionals: true,
      options: {
        label: { type: 'string' },
        candidate: { type: 'string' },
        target: { type: 'string' },
        tree: { type: 'string' },
        expect: { type: 'string' },
      },
    });
    requireCondition(positionals.length === 1, 'COMMAND_REQUIRED');
    const command = positionals[0];
    let result;
    if (command === 'prepare') {
      requireCondition(
        Object.keys(values).every((key) => key === 'label') && values.label,
        'PREPARE_REQUIRES_LABEL',
      );
      result = await prepareCandidate(root, values.label);
    } else if (command === 'verify' || command === 'restore') {
      const keys =
        command === 'verify'
          ? ['candidate', 'tree', 'expect']
          : ['candidate', 'target', 'expect'];
      requireCondition(
        Object.keys(values).every((key) => keys.includes(key)) &&
          values.candidate &&
          (command !== 'restore' || values.target),
        'INVALID_COMMAND_ARGUMENTS',
      );
      const options = {
        expectedManifestSha256: values.expect,
        tree: values.tree,
      };
      result =
        command === 'verify'
          ? await verifyCandidate(resolve(values.candidate), options)
          : await restoreCandidate(
              resolve(values.candidate),
              values.target,
              options,
            );
    } else throw new Error('UNKNOWN_COMMAND');
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    // Do not print file contents, Git output, absolute private paths or child diagnostics.
    console.error(
      JSON.stringify({
        status: 'failed',
        code: /^[A-Z_]+$/.test(error.message)
          ? error.message
          : 'CANDIDATE_OPERATION_FAILED',
      }),
    );
    process.exitCode = 1;
  }
}
