import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const expectedNode = '24.21.0';
export const expectedNpm = '11.19.0';
export function assertVercelRuntime(
  environment = process.env,
  version = process.versions.node,
) {
  if (environment.VERCEL !== '1' || !/^24\.\d+\.\d+$/.test(version))
    throw new Error('Wrapper exclusivo de Vercel con Node 24 estable.');
}
export function assertRootPolicy(manifest, npmrc) {
  if (
    manifest.engines?.node !== expectedNode ||
    manifest.engines?.npm !== expectedNpm ||
    manifest.packageManager !== `npm@${expectedNpm}` ||
    npmrc
      .split(/\r?\n/)
      .filter((line) => /^\s*engine-strict\s*=/.test(line))
      .join('\n') !== 'engine-strict=true'
  )
    throw new Error('La política exacta local/API debe permanecer vigente.');
}
export async function policy(directory = root) {
  const [manifest, npmrc, lockText] = await Promise.all([
    readFile(join(directory, 'package.json'), 'utf8'),
    readFile(join(directory, '.npmrc'), 'utf8'),
    readFile(join(directory, 'package-lock.json'), 'utf8'),
  ]);
  const packageJson = JSON.parse(manifest);
  assertRootPolicy(packageJson, npmrc);
  const lock = JSON.parse(lockText);
  if (
    lock.packages?.['']?.engines?.node !== expectedNode ||
    lock.packages?.['']?.engines?.npm !== expectedNpm
  )
    throw new Error('El lockfile no conserva los engines exactos raíz.');
  return {
    packageJson,
    lock,
    hash: createHash('sha256').update(lockText).digest('hex'),
  };
}
export function validateEngineEntries(
  entries,
  nodeVersion,
  npmVersion,
  satisfies,
) {
  if (npmVersion !== expectedNpm || !/^24\.\d+\.\d+$/.test(nodeVersion))
    throw new Error('Runtime Vercel incompatible.');
  for (const [path, entry] of Object.entries(entries)) {
    // Only the root's exact local Node requirement is exempted. All npm engines
    // and all dependency/workspace Node engines remain mandatory.
    if (entry.engines?.npm && !satisfies(npmVersion, entry.engines.npm))
      throw new Error('Engine npm incompatible en el candidato.');
    if (path === '') {
      if (entry.engines?.node !== expectedNode)
        throw new Error('Excepción Node raíz inesperada.');
    } else if (
      entry.engines?.node &&
      !satisfies(nodeVersion, entry.engines.node)
    )
      throw new Error('Engine Node incompatible en una dependencia.');
  }
}
export async function run(
  command,
  args,
  { cwd = root, env = process.env } = {},
) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      if (output.length < 2_000_000) output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      if (output.length < 2_000_000) output += chunk;
    });
    child.once('error', () =>
      reject(new Error('No se pudo iniciar herramienta de build.')),
    );
    child.once('exit', (code) =>
      code === 0
        ? resolveResult(output.trim())
        : reject(
            new Error(
              'Comprobación Vercel fallida; no se publica el candidato.',
            ),
          ),
    );
  });
}
export async function verifyPinnedNpm(npmCli) {
  const path = await realpath(npmCli);
  const packagePath = join(dirname(dirname(path)), 'package.json');
  const manifest = JSON.parse(await readFile(packagePath, 'utf8'));
  if (
    manifest.name !== 'npm' ||
    manifest.version !== expectedNpm ||
    (await run(process.execPath, [path, '--version'])) !== expectedNpm
  )
    throw new Error('El ejecutable npm no corresponde a la versión fijada.');
  return path;
}
export async function bootstrapNpm() {
  assertVercelRuntime();
  // npm exec downloads the exact package into npm's cache, never globally and
  // never into the project manifest. The inner npm exec exposes its own CLI path.
  const bootstrap = process.env.npm_execpath;
  const args = [
    'exec',
    '--yes',
    '--package=npm@11.19.0',
    '--',
    'npm',
    'exec',
    '--',
    'node',
    'scripts/vercel-runtime.mjs',
    'inspect-npm',
  ];
  const output = bootstrap
    ? await run(process.execPath, [bootstrap, ...args])
    : await run('npm', args);
  const lines = output.split(/\r?\n/);
  const record = lines.findLast((line) => line.startsWith('{"npmCli":'));
  if (!record) throw new Error('No se pudo resolver npm fijado.');
  return verifyPinnedNpm(JSON.parse(record).npmCli);
}
export async function verifyInstalledEngines(npmCli, lock, directory = root) {
  const require = createRequire(await verifyPinnedNpm(npmCli));
  const { satisfies } = require('semver');
  const entries = { '': lock.packages[''] };
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!path || entry.link) continue;
    const target = resolve(directory, path, 'package.json');
    if (
      !target.startsWith(`${resolve(directory)}/`) &&
      !target.startsWith(`${resolve(directory)}\\`)
    )
      throw new Error('Ruta de lockfile inválida.');
    try {
      entries[path] = JSON.parse(await readFile(target, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT' && entry.optional) continue;
      throw new Error('Falta una dependencia declarada del candidato.', {
        cause: error,
      });
    }
  }
  validateEngineEntries(entries, process.versions.node, expectedNpm, satisfies);
}

if (
  process.argv[2] === 'inspect-npm' &&
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  assertVercelRuntime();
  console.log(
    JSON.stringify({ npmCli: await verifyPinnedNpm(process.env.npm_execpath) }),
  );
}
