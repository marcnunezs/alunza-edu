import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';

const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
const targetSchema = z.strictObject({
  subscriptionId: z.uuid(),
  resourceGroup: identifier,
  appName: identifier,
  revision: identifier,
  replica: identifier,
  container: z.literal('api'),
});
const killCommand = 'node -e process.kill(1,9)';
const maximumBytes = 262144;

/** Arguments are closed constants or validated identifiers, never fixture code. */
export function azureProcessInvocation(args, platform = process.platform) {
  if (
    !Array.isArray(args) ||
    args.some(
      (value) =>
        typeof value !== 'string' ||
        (value !== killCommand && !/^[A-Za-z0-9_-]+$/.test(value)),
    )
  )
    throw new Error('ACA_COMMAND_ARGUMENT_INVALID');
  return platform === 'win32'
    ? {
        command: 'cmd.exe',
        args: [
          '/d',
          '/s',
          '/c',
          `az ${args.map((value) => `"${value}"`).join(' ')}`,
        ],
      }
    : { command: 'az', args };
}

async function azureCommand(args, signal) {
  const invocation = azureProcessInvocation(args);
  return new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
      signal,
      timeout: 25000,
    });
    const chunks = [];
    let size = 0;
    let rejected = false;
    const fail = () => {
      if (rejected) return;
      rejected = true;
      child.kill();
      reject(new Error('ACA_COMMAND_FAILED'));
    };
    child.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (size > maximumBytes) fail();
      else chunks.push(chunk);
    });
    child.once('error', fail);
    child.once('close', (code) => {
      if (!rejected)
        resolve({ code, stdout: Buffer.concat(chunks).toString('utf8') });
    });
  });
}

function objectResponse(response) {
  if (
    response.code !== 0 ||
    typeof response.stdout !== 'string' ||
    Buffer.byteLength(response.stdout) > maximumBytes
  )
    throw new Error('ACA_OBSERVATION_UNAVAILABLE');
  try {
    return JSON.parse(response.stdout);
  } catch {
    throw new Error('ACA_OBSERVATION_INVALID');
  }
}

function runningReplica(value, revisionId, containerName) {
  if (
    !value ||
    !identifier.safeParse(value.name).success ||
    typeof value.id !== 'string' ||
    value.id.toLowerCase() !==
      `${revisionId}/replicas/${value.name}`.toLowerCase()
  )
    throw new Error('ACA_REPLICA_SCOPE_INVALID');
  const matches = value.properties?.containers?.filter(
    (item) => item.name === containerName,
  );
  if (
    !Array.isArray(matches) ||
    matches.length !== 1 ||
    !Number.isSafeInteger(matches[0].restartCount) ||
    matches[0].restartCount < 0
  )
    throw new Error('ACA_RESTART_COUNT_UNAVAILABLE');
  const container = matches[0];
  return {
    name: value.name,
    restartCount: container.restartCount,
    running:
      value.properties.runningState === 'Running' &&
      container.runningState === 'Running' &&
      container.started === true &&
      container.ready === true,
  };
}

/**
 * Called only by an explicitly authorized recovery/performance stage.
 * Preparation performs reads; interrupt dispatches one fixed SIGKILL command.
 * Tests inject a pure command function; they do not invoke az or any account.
 * Replica REST fields: https://learn.microsoft.com/en-us/rest/api/resource-manager/containerapps/container-apps-revision-replicas/list-replicas?view=rest-resource-manager-containerapps-2025-07-01
 */
export async function prepareApiInterruption(
  azure,
  signal,
  candidate,
  dependencies = {},
) {
  const parsed = targetSchema.safeParse(azure);
  if (
    !parsed.success ||
    !/^[a-f0-9]{40}$/.test(candidate?.commit ?? '') ||
    !azure.revision.startsWith(`${azure.appName}--`)
  )
    throw new Error('ACA_TARGET_INVALID');
  const target = parsed.data;
  const run = dependencies.run ?? azureCommand;
  const now = dependencies.now ?? Date.now;
  const wait = dependencies.wait ?? delay;
  const revisionId = `/subscriptions/${target.subscriptionId}/resourceGroups/${target.resourceGroup}/providers/Microsoft.App/containerApps/${target.appName}/revisions/${target.revision}`;
  const scope = [
    '--subscription',
    target.subscriptionId,
    '--resource-group',
    target.resourceGroup,
    '--name',
    target.appName,
    '--revision',
    target.revision,
  ];
  let cliInvocations = 0;
  const call = async (args, selectedSignal = signal) => {
    selectedSignal?.throwIfAborted();
    // Check injected runners as well as the production subprocess path.
    azureProcessInvocation(args);
    cliInvocations++;
    try {
      return await run(args, selectedSignal);
    } catch {
      throw new Error('ACA_COMMAND_FAILED');
    }
  };
  const revision = objectResponse(
    await call([
      'containerapp',
      'revision',
      'show',
      ...scope,
      '--output',
      'json',
      '--only-show-errors',
    ]),
  );
  if (
    revision.name !== target.revision ||
    typeof revision.id !== 'string' ||
    revision.id.toLowerCase() !== revisionId.toLowerCase()
  )
    throw new Error('ACA_REVISION_SCOPE_INVALID');
  const apiContainers = revision.properties?.template?.containers?.filter(
    (value) => value.name === target.container,
  );
  if (!Array.isArray(apiContainers) || apiContainers.length !== 1)
    throw new Error('ACA_API_CONTAINER_REQUIRED');
  const variables = new Map(
    (apiContainers[0].env ?? []).map((value) => [value.name, value.value]),
  );
  if (
    variables.get('ENVIRONMENT') !== 'preproduction' ||
    variables.get('RELEASE_ID') !== candidate.commit
  )
    throw new Error('ACA_REVISION_CANDIDATE_MISMATCH');
  const list = async (selectedSignal) => {
    const value = objectResponse(
      await call(
        [
          'containerapp',
          'replica',
          'list',
          ...scope,
          '--output',
          'json',
          '--only-show-errors',
        ],
        selectedSignal,
      ),
    );
    if (!Array.isArray(value) || value.length > 1)
      throw new Error('ACA_EXACT_REPLICA_REQUIRED');
    return value.length
      ? runningReplica(value[0], revisionId, target.container)
      : null;
  };
  const before = await list(signal);
  if (!before?.running) throw new Error('ACA_RUNNING_REPLICA_REQUIRED');
  let dispatchedAt;
  let dispatchPromise;
  let verification;
  let restartSignal;
  const interrupt = () => {
    if (dispatchPromise) return dispatchPromise;
    signal?.throwIfAborted();
    dispatchedAt = now();
    const timeout = AbortSignal.timeout(60000);
    restartSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    dispatchPromise = call(
      [
        'containerapp',
        'exec',
        ...scope,
        '--replica',
        before.name,
        '--container',
        target.container,
        '--command',
        killCommand,
        '--only-show-errors',
      ],
      restartSignal,
    ).then(() => undefined);
    // A disconnected exec can return a non-zero code after killing PID1.
    // Neither that code nor UNKNOWN from the runner proves a restart.
    return dispatchPromise;
  };
  const verifyRestart = () => {
    if (!dispatchPromise)
      return Promise.reject(new Error('ACA_INTERRUPTION_NOT_DISPATCHED'));
    if (verification) return verification;
    verification = (async () => {
      await dispatchPromise;
      for (
        let observation = 0;
        observation < 31 && now() < dispatchedAt + 60000;
        observation++
      ) {
        restartSignal.throwIfAborted();
        const after = await list(restartSignal);
        if (
          after?.running &&
          (after.name !== before.name ||
            after.restartCount > before.restartCount)
        ) {
          return {
            restarted: true,
            method:
              after.name !== before.name
                ? 'REPLICA_REPLACED'
                : 'CONTAINER_RESTART_COUNT_INCREASED',
            revision: target.revision,
            container: target.container,
            previousReplica: before.name,
            replica: after.name,
            previousRestartCount: before.restartCount,
            restartCount: after.restartCount,
            observedAt: new Date(now()).toISOString(),
            durationMs: now() - dispatchedAt,
            cliInvocations,
          };
        }
        await wait(
          Math.min(2000, Math.max(1, dispatchedAt + 60000 - now())),
          undefined,
          { signal: restartSignal },
        );
      }
      throw new Error('ACA_RESTART_NOT_OBSERVED');
    })();
    return verification;
  };
  return { interrupt, verifyRestart };
}
