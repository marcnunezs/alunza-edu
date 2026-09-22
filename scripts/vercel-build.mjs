import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  root,
  assertVercelRuntime,
  policy,
  verifyPinnedNpm,
  verifyInstalledEngines,
  run,
} from './vercel-runtime.mjs';

try {
  assertVercelRuntime();
  const state = JSON.parse(
    await readFile(join(root, '.local/vercel-tooling.json'), 'utf8'),
  );
  const candidate = await policy();
  if (
    state.nodeVersion !== process.versions.node ||
    state.lockSha256 !== candidate.hash
  )
    throw new Error('El candidato cambió después de instalar.');
  const npmCli = await verifyPinnedNpm(state.npmCli);
  await verifyInstalledEngines(npmCli, candidate.lock);
  const environment = { ...process.env };
  delete environment.npm_config_engine_strict;
  delete environment.NPM_CONFIG_ENGINE_STRICT;
  delete environment.ALUNZA_E2E_BUILD;
  const commands = [
    ['run', 'typecheck'],
    ['test'],
    ['run', 'build', '--workspace', '@alunza/contracts'],
    ['run', 'build', '--workspace', '@alunza/web'],
  ];
  for (const args of commands) {
    await run(process.execPath, [npmCli, ...args], { env: environment });
    console.log(
      JSON.stringify({ stage: `npm ${args.join(' ')}`, status: 'passed' }),
    );
  }
  if ((await policy()).hash !== candidate.hash)
    throw new Error('El build cambió el lockfile.');
  const summary = {
    status: 'passed',
    node: process.versions.node,
    npm: '11.19.0',
    lockSha256: candidate.hash,
    exception: 'root-node-engine-only',
    execution: /^dpl_[a-zA-Z0-9]+$/.test(process.env.VERCEL_DEPLOYMENT_ID ?? '')
      ? 'vercel-build-context'
      : 'local-probe',
  };
  await mkdir(join(root, '.local/reports/imp-00-06-08'), { recursive: true });
  await writeFile(
    join(root, '.local/reports/imp-00-06-08/vercel-build.json'),
    JSON.stringify(summary, null, 2) + '\n',
  );
  console.log(JSON.stringify(summary));
} catch (error) {
  // Do not surface arbitrary child diagnostics or environment values.
  console.error(
    error.code
      ? 'Build Vercel incompleto; ejecutar primero su instalación controlada.'
      : error.message,
  );
  process.exitCode = 1;
}
