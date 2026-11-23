import {
  mkdir,
  cp,
  readFile,
  writeFile,
  realpath,
  open,
  unlink,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  root,
  context,
  up,
  migrate,
  seed,
  readState,
  down,
  portAvailable,
  apiEnvironment,
  redactDiagnostics,
} from './local.mjs';
import {
  developmentTarget,
  evaluationTarget,
  evaluationWorkspaceDirectory,
} from './local-target.mjs';
import { seedAcademic } from './academic-fixture.mjs';

export const evaluationContext = context(
  join(root, evaluationWorkspaceDirectory),
  'evaluation',
);
export function buildEvaluationConfig(source) {
  if (!source.includes(`project_id = "${developmentTarget.projectId}"`))
    throw new Error('INVALID_EVALUATION_SOURCE');
  let result = source.replace(
    `project_id = "${developmentTarget.projectId}"`,
    `project_id = "${evaluationTarget.projectId}"`,
  );
  for (const key of [
    'authPort',
    'dbPort',
    'shadowPort',
    'studioPort',
    'mailPort',
    'webPort',
  ])
    result = result.replaceAll(
      new RegExp(`\\b${developmentTarget[key]}\\b`, 'g'),
      String(evaluationTarget[key]),
    );
  return result;
}
async function ownPath(path) {
  await mkdir(path, { recursive: true });
  if (resolve(await realpath(path)) !== resolve(path))
    throw new Error('EVALUATION_PATH_LINK');
}
export async function prepareEvaluationEnvironment() {
  const ctx = evaluationContext;
  await ownPath(join(root, '.local'));
  await ownPath(ctx.projectDir);
  const lockPath = join(ctx.projectDir, '.local-setup.lock');
  const lock = await open(lockPath, 'wx', 0o600);
  try {
    for (const port of [ctx.apiPort, ctx.webPort, ctx.operationsPort])
      if (!(await portAvailable(port)))
        throw new Error(`EVALUATION_PORT_OCCUPIED_${port}`);
    await ownPath(join(ctx.projectDir, 'supabase'));
    for (const name of ['migrations', 'templates']) {
      const target = join(ctx.projectDir, 'supabase', name);
      await ownPath(target);
      await cp(join(root, 'supabase', name), target, { recursive: true });
    }
    const configPath = join(ctx.projectDir, 'supabase/config.toml');
    try {
      if (resolve(await realpath(configPath)) !== resolve(configPath))
        throw new Error('EVALUATION_CONFIG_LINK');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await writeFile(
      configPath,
      buildEvaluationConfig(
        await readFile(join(root, 'supabase/config.toml'), 'utf8'),
      ),
    );
    // No reset: authorized runs, material versions and receipts survive setup.
    await up(ctx);
    await migrate(ctx);
    await seed(ctx);
    const state = await readState(ctx);
    await seedAcademic(state);
    await writeFile(
      join(ctx.projectDir, '.local/api-environment.json'),
      JSON.stringify(
        {
          ...apiEnvironment(ctx, state),
          EVALUATION_ENABLED: 'true',
          EVALUATION_OPERATIONS_PORT: String(ctx.operationsPort),
        },
        null,
        2,
      ) + '\n',
      { mode: 0o600 },
    );
    return {
      projectId: ctx.projectId,
      apiOrigin: ctx.apiUrl,
      webOrigin: ctx.webUrl,
      operationsOrigin: `http://127.0.0.1:${ctx.operationsPort}`,
      status: 'prepared-local-only',
      azureCalls: 0,
    };
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    if (process.argv[2] === 'prepare')
      console.log(JSON.stringify(await prepareEvaluationEnvironment()));
    else if (process.argv[2] === 'stop') await down(evaluationContext);
    else throw new Error('Use prepare or stop.');
  } catch (error) {
    console.error(redactDiagnostics(error.message));
    process.exitCode = 1;
  }
}
