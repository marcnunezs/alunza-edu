import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { constants, existsSync } from 'node:fs';
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rm,
  rmdir,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import {
  delimiter,
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from 'node:path';
import { root, redactDiagnostics } from './local.mjs';

// Jest 30 on Windows preserves the separator before a dot-prefixed directory
// as a glob escape. An OS temporary directory keeps the real configs unchanged.
const probeRoot = join(tmpdir(), 'alunza-gate-probes');
const reportPath = join(root, '.local/reports/imp-00-05/gates.json');
const lockPath = join(root, '.local/gate-probes.lock');
const deadline = Date.now() + 30 * 60_000;
const records = [];
const excludedDirectories = new Set([
  '.git',
  '.local',
  '.tools',
  '.cache',
  'node_modules',
  'dist',
  'coverage',
]);
const sourceDirectories = [
  'apps',
  'packages',
  'scripts',
  'tests',
  'infra',
  'docs/work',
  'fixtures',
  '.github',
];
const sourceFiles = [
  'package.json',
  'package-lock.json',
  'tsconfig.base.json',
  'eslint.config.mjs',
  '.prettierrc.json',
  '.prettierignore',
  '.npmrc',
  'cypress.config.cjs',
];
const probes = [
  {
    command: 'format:check',
    path: 'scripts/__gate_probe_format__.mjs',
    content: 'export const gateProbe={value:1}\n',
    diagnostic: /__gate_probe_format__\.mjs/,
  },
  {
    command: 'lint',
    path: 'scripts/__gate_probe_lint__.mjs',
    content: 'export const gateProbe = gateProbeUndefinedIdentifier;\n',
    diagnostic: /gateProbeUndefinedIdentifier.*(?:not defined|no-undef)/,
  },
  {
    command: 'typecheck',
    path: 'apps/api/src/__gate_probe_typecheck__.ts',
    content: 'export const gateProbe: string = 123;\n',
    diagnostic: /__gate_probe_typecheck__\.ts[^\r\n]*TS2322/,
  },
  {
    command: 'test',
    path: 'apps/api/src/__gate_probe_test__.spec.ts',
    content:
      "test('gate probe rejects a deliberate failing assertion', () => {\n  expect('gate-probe-actual').toBe('gate-probe-expected');\n});\n",
    diagnostic: /gate probe rejects a deliberate failing assertion/,
  },
  {
    command: 'build',
    path: 'apps/web/src/app/gate-probe-build/page.tsx',
    content:
      "import missing from './__gate_probe_missing_module__';\n\nexport default function GateProbePage() {\n  return <div>{missing}</div>;\n}\n",
    diagnostic:
      /(?:Module not found|Cannot find module|Can't resolve)[^\r\n]*__gate_probe_missing_module__/,
  },
];

function assertInside(path, parent) {
  const child = relative(resolve(parent), resolve(path));
  if (!child || child.startsWith('..') || isAbsolute(child)) {
    throw new Error('La ruta del probe salió de su directorio exclusivo.');
  }
}

function checkDeadline() {
  if (Date.now() >= deadline)
    throw new Error('Los probes excedieron 30 minutos.');
}

function included(path) {
  return path
    .split(/[\\/]/)
    .every(
      (part) =>
        !excludedDirectories.has(part) &&
        !part.startsWith('.next') &&
        !part.startsWith('.env') &&
        !part.endsWith('.tsbuildinfo') &&
        part !== 'next-env.d.ts',
    );
}

async function copySources(workspace) {
  for (const path of [...sourceDirectories, ...sourceFiles]) {
    checkDeadline();
    await cp(join(root, path), join(workspace, path), {
      recursive: true,
      dereference: false,
      filter: (candidate) => included(relative(root, candidate)),
    });
  }
}

// Physical dependency copies avoid writes through hard links and avoid Next's
// filesystem-root restrictions for links to the original installation.
async function copyDependencies(source, destination, workspace) {
  const links = [];
  await cp(source, destination, {
    recursive: true,
    mode: constants.COPYFILE_FICLONE,
    filter: async (from) => {
      checkDeadline();
      if (basename(from) === '.cache') return false;
      if (!(await lstat(from)).isSymbolicLink()) return true;
      links.push(from);
      return false;
    },
  });
  for (const from of links) {
    const original = await realpath(from);
    assertInside(original, root);
    const local = relative(root, original);
    if (!/^(?:apps|packages|node_modules)[\\/]/.test(local))
      throw new Error(
        'Un enlace instalado apunta fuera de los workspaces/dependencias.',
      );
    const to = join(workspace, relative(root, from));
    const target = join(workspace, local);
    const type = (await lstat(original)).isDirectory()
      ? process.platform === 'win32'
        ? 'junction'
        : 'dir'
      : 'file';
    await symlink(
      type === 'junction' ? target : relative(dirname(to), target),
      to,
      type,
    );
  }
}

async function sourceManifest(workspace) {
  const manifest = [];
  async function visit(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const absolute = join(path, entry.name);
      const local = relative(workspace, absolute);
      if (!included(local)) continue;
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile())
        manifest.push(
          `${local}:${createHash('sha256')
            .update(await readFile(absolute))
            .digest('hex')}`,
        );
    }
  }
  for (const directory of sourceDirectories)
    await visit(join(workspace, directory));
  for (const path of sourceFiles)
    manifest.push(
      `${path}:${createHash('sha256')
        .update(await readFile(join(workspace, path)))
        .digest('hex')}`,
    );
  return manifest.sort().join('\n');
}

function npmPath() {
  const candidates = [
    process.env.npm_execpath,
    join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
    join(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js'),
    join(dirname(process.execPath), '../share/nodejs/npm/bin/npm-cli.js'),
  ];
  const path = candidates.find(
    (candidate) => candidate && existsSync(candidate),
  );
  if (!path) throw new Error('Ejecuta los probes mediante npm run test:gates.');
  return path;
}

function environment(workspace) {
  const inherited = Object.fromEntries(
    [
      'SystemRoot',
      'WINDIR',
      'ComSpec',
      'PATHEXT',
      'HOME',
      'USERPROFILE',
      'APPDATA',
      'LOCALAPPDATA',
      'TEMP',
      'TMP',
      'TMPDIR',
    ]
      .filter((name) => process.env[name] !== undefined)
      .map((name) => [name, process.env[name]]),
  );
  return {
    ...inherited,
    PATH: [dirname(process.execPath), process.env.PATH]
      .filter(Boolean)
      .join(delimiter),
    CI: '1',
    NO_COLOR: '1',
    NEXT_TELEMETRY_DISABLED: '1',
    npm_config_cache: join(workspace, '.local/npm-cache'),
    NEXT_PUBLIC_API_BASE_URL: 'http://127.0.0.1:4100',
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:16421',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      'sb_publishable_gate_probe_public_placeholder',
  };
}

async function stopTree(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null)
    return;
  if (process.platform === 'win32') {
    await new Promise((done) => {
      const killer = spawn(
        'taskkill.exe',
        ['/PID', String(child.pid), '/T', '/F'],
        { windowsHide: true, stdio: 'ignore', timeout: 5000 },
      );
      killer.once('error', done);
      killer.once('exit', done);
    });
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  }
}

async function command(workspace, script) {
  checkDeadline();
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [npmPath(), 'run', script], {
      cwd: workspace,
      env: environment(workspace),
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let timedOut = false;
    const collect = (data) => {
      output = (output + data.toString()).slice(-2_000_000);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const timer = setTimeout(
      () => {
        timedOut = true;
        void stopTree(child).catch(() => child.kill('SIGKILL'));
      },
      Math.min(10 * 60_000, deadline - Date.now()),
    );
    child.once('error', () => {
      clearTimeout(timer);
      reject(new Error(`No se pudo ejecutar npm run ${script}.`));
    });
    child.once('close', (exitCode) => {
      clearTimeout(timer);
      resolveResult({ exitCode: timedOut ? 124 : exitCode, output, timedOut });
    });
  });
}

async function showDiagnosticPaths(output) {
  await writeFile(
    join(root, '.local/gate-probes-error.log'),
    redactDiagnostics(output),
    { mode: 0o600 },
  );
  const paths =
    output
      .replaceAll('\\', '/')
      .match(
        /(?:apps|packages|scripts|tests|infra|docs\/work|\.github)\/[A-Za-z0-9_./-]+\.(?:tsx?|[cm]?js|json|ya?ml|md)|cypress\.config\.cjs/g,
      ) ?? [];
  for (const path of [...new Set(paths)].slice(0, 10))
    console.error(`Revisar archivo: ${path}`);
  if (/No files matching/.test(output))
    console.error('Diagnóstico: falta una entrada del gate en la copia.');
}

let workspace;
let lock;
try {
  await mkdir(probeRoot, { recursive: true });
  await mkdir(dirname(lockPath), { recursive: true });
  lock = await open(lockPath, 'wx');
  await lock.writeFile(String(process.pid));
  console.log('Preflight de formato, sólo lectura del workspace original...');
  const preflight = await command(root, 'format:check');
  records.push({
    stage: 'format:check:preflight',
    result: preflight.exitCode === 0 ? 'passed' : 'failed',
    exitCode: preflight.exitCode,
  });
  if (preflight.exitCode !== 0) {
    await showDiagnosticPaths(preflight.output);
    throw new Error(
      'Corrige el formato de la fuente antes de copiar los probes.',
    );
  }
  workspace = await mkdtemp(join(probeRoot, 'run-'));
  assertInside(workspace, probeRoot);
  console.log(
    'Copiando código y dependencias instaladas para gates aislados...',
  );
  await copySources(workspace);
  await copyDependencies(
    join(root, 'node_modules'),
    join(workspace, 'node_modules'),
    workspace,
  );
  // npm may isolate incompatible peers inside a workspace (OpenAI 7/ws 8
  // alongside the runner SDK and Cypress). Preserve that installed topology.
  const packageLock = JSON.parse(
    await readFile(join(root, 'package-lock.json'), 'utf8'),
  );
  for (const path of Object.keys(packageLock.packages)) {
    if (!/^(?:apps|packages)\/[^/]+$/.test(path)) continue;
    const source = join(root, path, 'node_modules');
    if (!existsSync(source)) continue;
    await copyDependencies(
      source,
      join(workspace, path, 'node_modules'),
      workspace,
    );
  }
  for (const probe of probes) {
    console.log(`Baseline: npm run ${probe.command}`);
    const result = await command(workspace, probe.command);
    records.push({
      stage: `${probe.command}:baseline`,
      result: result.exitCode === 0 ? 'passed' : 'failed',
      exitCode: result.exitCode,
    });
    if (result.exitCode !== 0) {
      await showDiagnosticPaths(result.output);
      throw new Error(
        `Baseline de ${probe.command} falló; no acredita el defecto deliberado.`,
      );
    }
  }
  const before = await sourceManifest(workspace);
  for (const probe of probes) {
    const target = join(workspace, probe.path);
    assertInside(target, workspace);
    const createdDirectory =
      probe.command === 'build' ? dirname(target) : undefined;
    let createdFile = false;
    let directoryOwned = false;
    let restored = false;
    try {
      if (createdDirectory) {
        await mkdir(createdDirectory);
        directoryOwned = true;
      }
      await writeFile(target, probe.content, { flag: 'wx' });
      createdFile = true;
      console.log(`Defecto deliberado: npm run ${probe.command}`);
      const result = await command(workspace, probe.command);
      const rejected =
        Number.isInteger(result.exitCode) &&
        result.exitCode > 0 &&
        !result.timedOut &&
        probe.diagnostic.test(result.output);
      records.push({
        stage: `${probe.command}:defect`,
        result: rejected ? 'rejected_expected_defect' : 'failed',
        exitCode: result.exitCode,
      });
      if (!rejected) {
        await showDiagnosticPaths(result.output);
        throw new Error(
          `${probe.command} no rechazó el defecto esperado con su diagnóstico específico.`,
        );
      }
    } finally {
      if (createdFile) await unlink(target);
      if (directoryOwned) await rmdir(createdDirectory);
      restored = (await sourceManifest(workspace)) === before;
      records.push({
        stage: `${probe.command}:restore`,
        result: restored ? 'passed' : 'failed',
        exitCode: restored ? 0 : 1,
      });
    }
    if (!restored)
      throw new Error(
        'Los archivos fuente de la copia no quedaron exactamente restaurados.',
      );
  }
  console.log(
    'Los cinco gates rechazaron defectos reales y restauraron la copia.',
  );
} catch (error) {
  console.error(error.message);
  records.push({ stage: 'verification', result: 'failed', exitCode: 1 });
  process.exitCode = 1;
} finally {
  if (workspace) {
    assertInside(workspace, probeRoot);
    await rm(workspace, { recursive: true, force: true })
      .then(() =>
        records.push({ stage: 'cleanup', result: 'passed', exitCode: 0 }),
      )
      .catch(() => {
        records.push({ stage: 'cleanup', result: 'failed', exitCode: 1 });
        process.exitCode = 1;
      });
  }
  if (lock) {
    await lock.close();
    await unlink(lockPath);
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(records, null, 2)}\n`);
  }
}
