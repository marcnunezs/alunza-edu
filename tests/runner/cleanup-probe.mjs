import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  command,
  imageIdentity,
  cleanupDockerExecution,
  OWNER_LABEL,
  RUNNER_PREFIX,
} from '../../infra/runner/capsule.mjs';

// Real Docker regression: execution cleanup must preserve a live sibling and a
// foreign owner even when the latter carries the same execution identifier.
export async function probeExecutionCleanup() {
  const image = await imageIdentity();
  const executionId = randomUUID();
  const target = `${RUNNER_PREFIX}${randomUUID()}`;
  const sibling = `${RUNNER_PREFIX}${randomUUID()}`;
  const foreign = `${RUNNER_PREFIX}${randomUUID()}`;
  const created = [];
  let result, failure;
  let cleanupFailed = false;
  try {
    for (const [name, owner, execution] of [
      [target, OWNER_LABEL, executionId],
      [sibling, OWNER_LABEL, randomUUID()],
      [foreign, 'org.alunza.runner=foreign-fixture', executionId],
    ]) {
      const response = await command([
        'run',
        '--detach',
        '--name',
        name,
        '--label',
        owner,
        '--label',
        `org.alunza.execution=${execution}`,
        '--label',
        `org.alunza.expires=${Date.now() + 60000}`,
        '--network=none',
        '--read-only',
        '--cap-drop=ALL',
        '--security-opt=no-new-privileges:true',
        '--user=10001:10001',
        '--memory=134217728',
        '--memory-swap=134217728',
        '--cpus=1',
        '--pids-limit=32',
        '--log-driver=none',
        '--entrypoint=/bin/sleep',
        image,
        '45',
      ]);
      if (response.code !== 0) throw new Error('Cleanup probe setup failed');
      created.push(name);
    }
    const cleanup = await cleanupDockerExecution(executionId);
    const targetCheck = await command([
      'ps',
      '--all',
      '--quiet',
      '--filter',
      `name=^/${target}$`,
    ]);
    const preserved = [];
    for (const name of [sibling, foreign]) {
      const response = await command([
        'inspect',
        name,
        '--format',
        '{{.State.Running}}',
      ]);
      preserved.push(response.code === 0 && response.stdout.trim() === 'true');
    }
    const pass =
      cleanup.cleanupVerified &&
      cleanup.removed === 1 &&
      targetCheck.code === 0 &&
      targetCheck.stdout.trim() === '' &&
      preserved.every(Boolean);
    result = {
      id: 'execution-cleanup-isolation',
      status: pass ? 'PASS' : 'FAIL',
      cleanup,
      siblingPreserved: preserved[0],
      foreignPreserved: preserved[1],
    };
  } catch (error) {
    failure = error;
  } finally {
    for (const name of created) {
      try {
        const exists = await command([
          'ps',
          '--all',
          '--quiet',
          '--filter',
          `name=^/${name}$`,
        ]);
        if (exists.code !== 0) cleanupFailed = true;
        if (
          exists.stdout.trim() &&
          (await command(['rm', '--force', name])).code !== 0
        )
          cleanupFailed = true;
      } catch {
        cleanupFailed = true;
      }
    }
  }
  if (cleanupFailed) throw new Error('Cleanup probe teardown failed');
  if (failure) throw failure;
  return result;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const result = await probeExecutionCleanup();
  console.log(JSON.stringify(result));
  if (result.status !== 'PASS') process.exitCode = 1;
}
