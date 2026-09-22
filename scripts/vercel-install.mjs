import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  root,
  assertVercelRuntime,
  policy,
  bootstrapNpm,
  run,
  verifyInstalledEngines,
} from './vercel-runtime.mjs';

try {
  assertVercelRuntime();
  const before = await policy();
  const npmCli = await bootstrapNpm();
  // Scope the exception to this subprocess. No config set, force, legacy peers,
  // package updates or lifecycle scripts are allowed by this install path.
  await run(process.execPath, [
    npmCli,
    'ci',
    '--engine-strict=false',
    '--ignore-scripts',
    '--include=dev',
    '--no-audit',
    '--no-fund',
  ]);
  const after = await policy();
  if (before.hash !== after.hash)
    throw new Error('La instalación cambió el lockfile.');
  await verifyInstalledEngines(npmCli, after.lock);
  await mkdir(join(root, '.local'), { recursive: true });
  await writeFile(
    join(root, '.local/vercel-tooling.json'),
    JSON.stringify({
      npmCli,
      nodeVersion: process.versions.node,
      lockSha256: after.hash,
    }),
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      stage: 'vercel-install',
      status: 'passed',
      node: process.versions.node,
      npm: '11.19.0',
      lockSha256: after.hash,
      exception: 'root-node-engine-only',
      execution: /^dpl_[a-zA-Z0-9]+$/.test(
        process.env.VERCEL_DEPLOYMENT_ID ?? '',
      )
        ? 'vercel-build-context'
        : 'local-probe',
    }),
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
