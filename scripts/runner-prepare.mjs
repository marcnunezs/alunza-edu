import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdir, copyFile, cp } from 'node:fs/promises';
import { command, imageIdentity, IMAGE_TAG } from '../infra/runner/capsule.mjs';
const context = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../infra/runner',
);
const buildContext = resolve(context, '../../.local/runner-capsule-build');
await mkdir(buildContext, { recursive: true });
for (const file of [
  'Dockerfile',
  'bridge.cjs',
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
if (process.argv.includes('--sandbox-context')) {
  const output = resolve(context, '../../.local/runner-sandbox-build');
  await mkdir(output, { recursive: true });
  await copyFile(
    resolve(context, 'Dockerfile.sandbox'),
    resolve(output, 'Dockerfile'),
  );
  const saved = await command(
    ['save', '--output', resolve(output, 'capsule.tar'), IMAGE_TAG],
    { timeoutMs: 120000 },
  );
  if (saved.code !== 0) throw new Error('Prepared capsule export failed');
  console.log(
    JSON.stringify({
      stage: 'runner:prepare:sandbox-context',
      status: 'LOCAL_CONTEXT_READY',
      remote: 'NOT_RUN',
    }),
  );
}
