import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  mkdir,
  copyFile,
  cp,
  lstat,
  readdir,
  readFile,
  realpath,
  writeFile,
} from 'node:fs/promises';
import { isBuiltin } from 'node:module';
import { parseArgs } from 'node:util';
import { command, imageIdentity, IMAGE_TAG } from '../infra/runner/capsule.mjs';
const context = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../infra/runner',
);
const buildContext = resolve(context, '../../.local/runner-capsule-build');
const defaultSandboxContext = resolve(
  context,
  '../../.local/runner-sandbox-build',
);
const supervisorFiles = [
  'capsule.mjs',
  'docker-engine.mjs',
  'docker-runtime.mjs',
  'kernel-controls.mjs',
  'timing.mjs',
  'remote-init.mjs',
  'remote-driver.mjs',
];

async function buildCapsule() {
  await mkdir(buildContext, { recursive: true });
  for (const file of [
    'Dockerfile',
    'bridge.cjs',
    'watchdog-observation.cjs',
    'worker.cjs',
    'worker-identity.cjs',
    'os-probe.cjs',
  ]) {
    await copyFile(resolve(context, file), resolve(buildContext, file));
  }
  for (const name of [
    'quickjs-emscripten-core',
    '@jitl/quickjs-wasmfile-release-sync',
    '@jitl/quickjs-ffi-types',
  ]) {
    await cp(
      resolve(context, '../../node_modules', name),
      resolve(buildContext, 'node_modules', name),
      { recursive: true },
    );
  }
  const result = await command(
    ['build', '--network=none', '--tag', IMAGE_TAG, buildContext],
    { timeoutMs: 180000, maxBytes: 1048576 },
  );
  if (result.code !== 0)
    throw new Error(
      'Runner image build failed (inspect Docker build locally; no student input involved).',
    );
  console.log(
    JSON.stringify({
      stage: 'runner:prepare',
      image: await imageIdentity(),
      node: '24.21.0',
    }),
  );
}

async function sha256File(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

// Validate the same source bytes that will be copied into the image. Parse only;
// evaluating remote-init.mjs would attempt to boot the nested Docker daemon.
async function loadSupervisor(source) {
  const { default: ts } = await import('typescript');
  const relativeImports = new Set(supervisorFiles.map((name) => `./${name}`));
  const modules = new Map();
  for (const name of supervisorFiles) {
    const path = resolve(source, name);
    if (!(await lstat(path)).isFile())
      throw new Error(`Expected regular supervisor module: ${name}`);
    const bytes = await readFile(path);
    const tree = ts.createSourceFile(
      name,
      bytes.toString('utf8'),
      ts.ScriptTarget.Latest,
      false,
      ts.ScriptKind.JS,
    );
    if (tree.parseDiagnostics.length)
      throw new Error(`Invalid supervisor module: ${name}`);
    function visit(node) {
      let specifier;
      if (
        ts.isImportDeclaration(node) ||
        (ts.isExportDeclaration(node) && node.moduleSpecifier)
      ) {
        specifier = node.moduleSpecifier;
      } else if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword
      ) {
        specifier = node.arguments[0];
        if (!specifier || !ts.isStringLiteral(specifier))
          throw new Error(
            `Dynamic supervisor import must be a literal in ${name}`,
          );
      }
      if (
        specifier &&
        !(
          ts.isStringLiteral(specifier) &&
          (relativeImports.has(specifier.text) || isBuiltin(specifier.text))
        )
      ) {
        throw new Error(
          `Supervisor import outside the fixed image context: ${name}`,
        );
      }
      ts.forEachChild(node, visit);
    }
    visit(tree);
    modules.set(name, bytes);
  }
  return modules;
}

async function validateDirectory(directory, allowed, supervisor = false) {
  const info = await lstat(directory).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  if (!info) return;
  if (!info.isDirectory())
    throw new Error('Expected a real Sandbox build directory');
  for (const name of await readdir(directory)) {
    if (!allowed.includes(name))
      throw new Error(
        'Unexpected entry in Sandbox build context; choose an empty directory',
      );
    const path = resolve(directory, name);
    if (!supervisor && name === 'supervisor') {
      await validateDirectory(path, supervisorFiles, true);
    } else {
      const entry = await lstat(path);
      if (!entry.isFile() || entry.nlink !== 1)
        throw new Error('Expected a regular, unlinked Sandbox context file');
    }
  }
}

export async function prepareSandboxContext({
  output = defaultSandboxContext,
  source = context,
  capsuleTar,
  capsuleSha256,
} = {}) {
  const allowed = ['Dockerfile', 'capsule.tar', 'supervisor'];
  if (capsuleTar !== undefined || capsuleSha256 !== undefined) {
    if (
      !capsuleTar ||
      !/^[a-f0-9]{64}$/.test(capsuleSha256 ?? '') ||
      !(await lstat(capsuleTar)).isFile()
    ) {
      throw new Error(
        'Reusing a capsule requires a regular archive and its expected SHA-256',
      );
    }
    if ((await sha256File(capsuleTar)) !== capsuleSha256)
      throw new Error('Capsule archive SHA-256 mismatch');
  }
  await validateDirectory(output, allowed);
  const modules = await loadSupervisor(source);
  const dockerfile = await readFile(resolve(source, 'Dockerfile.sandbox'));
  await mkdir(resolve(output, 'supervisor'), { recursive: true });
  const archive = resolve(await realpath(output), 'capsule.tar');
  if (capsuleTar) {
    if ((await realpath(capsuleTar)) !== archive)
      await copyFile(capsuleTar, archive);
  } else {
    const saved = await command(['save', '--output', archive, IMAGE_TAG], {
      timeoutMs: 120000,
    });
    if (saved.code !== 0) throw new Error('Prepared capsule export failed');
  }
  const sha256 = await sha256File(archive);
  if (capsuleSha256 && sha256 !== capsuleSha256)
    throw new Error('Copied capsule archive SHA-256 mismatch');
  for (const [name, bytes] of modules)
    await writeFile(resolve(output, 'supervisor', name), bytes);
  await writeFile(resolve(output, 'Dockerfile'), dockerfile);
  await validateDirectory(output, allowed);
  return { capsuleSha256: sha256, supervisorFiles: [...modules.keys()] };
}

async function main() {
  const { values } = parseArgs({
    options: {
      'sandbox-context': { type: 'boolean' },
      'capsule-tar': { type: 'string' },
      'capsule-sha256': { type: 'string' },
      output: { type: 'string' },
    },
  });
  if (!values['sandbox-context'] && Object.keys(values).length)
    throw new Error('Archive and output options require --sandbox-context');
  if (
    (values['capsule-tar'] !== undefined) !==
    (values['capsule-sha256'] !== undefined)
  )
    throw new Error('Provide both --capsule-tar and --capsule-sha256');
  if (values['capsule-tar'] === undefined) await buildCapsule();
  if (!values['sandbox-context']) return;
  const prepared = await prepareSandboxContext({
    output: values.output,
    capsuleTar: values['capsule-tar'],
    capsuleSha256: values['capsule-sha256'],
  });
  console.log(
    JSON.stringify({
      stage: 'runner:prepare:sandbox-context',
      status: 'LOCAL_CONTEXT_READY',
      remote: 'NOT_RUN',
      ...prepared,
    }),
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
