import { readFile } from 'node:fs/promises';
import { platform } from 'node:os';

const leafLimits = Object.freeze({
  'memory.max': '134217728',
  'memory.swap.max': '0',
  'pids.max': '32',
  'cpu.max': '100000 100000',
});
const containerId = /^[a-f0-9]{64}$/;

function groupPath(value, id) {
  const match = /^0::(\/[^\r\n\0]*)$/.exec(value.trim());
  const parts = match?.[1].split('/').slice(1);
  const scope = `docker-${id}.scope`;
  const index = parts?.indexOf(scope) ?? -1;
  if (
    !parts ||
    parts.some((part) => !part || part === '.' || part === '..') ||
    index < 1 ||
    parts.lastIndexOf(scope) !== index ||
    (parts.length !== index + 1 &&
      !(parts.length === index + 2 && parts[index + 1] === 'container'))
  )
    throw new Error('Capsule cgroup ownership mismatch');
  return { path: `/sys/fs/cgroup${match[1]}`, parts, scope: index };
}

function validateLive(value, id, pid) {
  if (
    value?.Id !== id ||
    value.State?.Running !== true ||
    !Number.isSafeInteger(value.State.Pid) ||
    value.State.Pid < 1 ||
    (pid !== undefined && value.State.Pid !== pid)
  )
    throw new Error('Capsule running PID unconfirmed');
  return value.State.Pid;
}

/**
 * Read-only proof for an explicitly configured runner on the daemon's Linux
 * host. A local IPC socket alone is not evidence that a remote VM's PID is a
 * local PID: its fresh Docker ID must also identify the local cgroup scope.
 * Generic Docker Desktop callers do not invoke this host observer.
 */
export async function verifyKernelControls(
  engine,
  { engineId, id, pid, expectedBoundary, signal },
) {
  signal?.throwIfAborted();
  if (
    platform() !== 'linux' ||
    typeof engine?.endpoint !== 'string' ||
    !/^unix:\/\/\/[^/]/.test(engine.endpoint) ||
    /[\\?#\0\r\n]/.test(engine.endpoint) ||
    !containerId.test(id ?? '') ||
    typeof engineId !== 'string' ||
    !engineId
  )
    throw new Error('Kernel controls require the local Linux Docker host');
  const info = await engine.request('GET', '/info', { signal });
  if (
    info.status !== 200 ||
    info.data?.ID !== engineId ||
    info.data?.OSType !== 'linux' ||
    info.data?.CgroupVersion !== '2' ||
    info.data?.CgroupDriver !== 'systemd'
  )
    throw new Error('Capsule Docker engine identity changed');
  const route = `/containers/${id}/json`;
  const running = await engine.request('GET', route, { signal });
  if (running.status !== 200)
    throw new Error('Capsule running state unavailable');
  const observedPid = validateLive(running.data, id, pid);
  const procPath = `/proc/${observedPid}/cgroup`;
  const membership = await readFile(procPath, 'utf8');
  const group = groupPath(membership, id);
  for (const [file, expected] of Object.entries(leafLimits)) {
    signal?.throwIfAborted();
    if ((await readFile(`${group.path}/${file}`, 'utf8')).trim() !== expected)
      throw new Error('Capsule kernel limit mismatch');
  }
  let boundary;
  for (let depth = group.scope; depth > 0; depth--) {
    signal?.throwIfAborted();
    const ancestor = `/sys/fs/cgroup/${group.parts.slice(0, depth).join('/')}`;
    const memory = (await readFile(`${ancestor}/memory.max`, 'utf8')).trim();
    const cpu = (await readFile(`${ancestor}/cpu.max`, 'utf8')).trim();
    const cpuParts = /^(\d+) (\d+)$/.exec(cpu);
    if (
      /^\d+$/.test(memory) &&
      BigInt(memory) > 0n &&
      BigInt(memory) <= 2147483648n &&
      cpuParts &&
      BigInt(cpuParts[1]) > 0n &&
      BigInt(cpuParts[2]) > 0n &&
      BigInt(cpuParts[1]) <= BigInt(cpuParts[2])
    ) {
      boundary = ancestor;
      break;
    }
  }
  if (!boundary) throw new Error('Capsule shared executor limits unavailable');
  if (expectedBoundary !== undefined && boundary !== expectedBoundary)
    throw new Error('Capsule executor boundary changed');
  // Re-read after the controls: a stopped/restarted container or a PID moved to
  // another cgroup cannot reuse the earlier observation as dispatch authority.
  const final = await engine.request('GET', route, { signal });
  if (final.status !== 200)
    throw new Error('Capsule running state unavailable');
  validateLive(final.data, id, observedPid);
  if ((await readFile(procPath, 'utf8')).trim() !== membership.trim())
    throw new Error('Capsule cgroup membership changed');
  signal?.throwIfAborted();
  return boundary;
}
