import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

export const OWNER_LABEL = 'org.alunza.runner=imp-00-06';
export const IMAGE_TAG = 'alunza-runner-capsule:imp-00-06';
// No shell and bounded diagnostics. These commands execute trusted Docker tooling only.
export function command(
  args,
  { input, timeoutMs = 15000, maxBytes = 524288, signal } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = Buffer.alloc(0),
      stderr = Buffer.alloc(0),
      stopped = false;
    const abort = () => {
      stopped = true;
      child.kill('SIGKILL');
    };
    const timer = setTimeout(abort, timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const capture = (name, chunk) => {
      if (stdout.length + stderr.length + chunk.length > maxBytes) {
        abort();
        return;
      }
      if (name === 'stdout') stdout = Buffer.concat([stdout, chunk]);
      else stderr = Buffer.concat([stderr, chunk]);
    };
    child.stdout.on('data', (chunk) => capture('stdout', chunk));
    child.stderr.on('data', (chunk) => capture('stderr', chunk));
    child.stdin.on('error', () => {});
    child.on('error', () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(new Error('Docker command unavailable'));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      resolve({
        code,
        stdout: stdout.toString('utf8'),
        stderr: stderr.toString('utf8'),
        stopped,
      });
    });
    child.stdin.end(input);
  });
}
export async function imageIdentity(image = IMAGE_TAG) {
  const result = await command([
    'image',
    'inspect',
    image,
    '--format',
    '{{.Id}}',
  ]);
  const id = result.stdout.trim();
  if (result.code !== 0 || !/^sha256:[a-f0-9]{64}$/.test(id))
    throw new Error('Prepared runner image unavailable');
  return id;
}
export async function runCapsule(input, options = {}) {
  const image = options.image ?? (await imageIdentity());
  if (!/^sha256:[a-f0-9]{64}$/.test(image))
    throw new Error('Runner requires immutable local image ID');
  const name = `alunza-runner-${randomUUID()}`;
  const started = performance.now();
  let created = false,
    timedOut = false,
    cleanupVerified = false;
  let packet,
    exitCode = null,
    oomKilled = false,
    programWallMs,
    failure;
  try {
    const create = await command([
      'create',
      '--name',
      name,
      '--label',
      OWNER_LABEL,
      '--label',
      `org.alunza.expires=${Date.now() + 120000}`,
      '--interactive',
      '--pull=never',
      '--network=none',
      '--read-only',
      '--cap-drop=ALL',
      '--cap-add=SETUID',
      '--cap-add=SETGID',
      '--cap-add=SETPCAP',
      '--security-opt=no-new-privileges:true',
      '--memory=134217728',
      '--memory-swap=134217728',
      '--cpus=1',
      '--pids-limit=32',
      '--ulimit',
      'nofile=64:64',
      '--tmpfs',
      '/tmp:rw,noexec,nosuid,nodev,size=8388608,mode=1777',
      '--log-driver=none',
      image,
    ]);
    if (create.code !== 0) throw new Error('Runner container creation failed');
    created = true;
    const inspect = await command(['inspect', name]);
    const effective = JSON.parse(inspect.stdout)[0];
    const h = effective.HostConfig;
    if (
      h.Memory !== 134217728 ||
      h.MemorySwap !== 134217728 ||
      h.NanoCpus !== 1000000000 ||
      h.PidsLimit !== 32 ||
      h.NetworkMode !== 'none' ||
      !h.ReadonlyRootfs ||
      h.Privileged ||
      h.Binds?.length ||
      h.CapDrop?.join(',') !== 'ALL' ||
      [...(h.CapAdd ?? [])]
        .map((value) => value.replace(/^CAP_/, ''))
        .sort()
        .join(',') !== 'SETGID,SETPCAP,SETUID' ||
      !h.SecurityOpt?.includes('no-new-privileges:true') ||
      Object.keys(h.PortBindings ?? {}).length > 0 ||
      h.PidMode === 'host' ||
      h.IpcMode === 'host'
    )
      throw new Error('Runner resource configuration mismatch');
    const kill = () => {
      timedOut = true;
      void command(['kill', name]).catch(() => {});
    };
    const timer = setTimeout(kill, Math.max(0, input.budgetMs));
    const abort = () => {
      void command(['kill', name]).catch(() => {});
    };
    options.signal?.addEventListener('abort', abort, { once: true });
    try {
      if (options.signal?.aborted)
        throw new Error('Execution cancelled before launch');
      const programStart = performance.now();
      const result = await command(
        ['start', '--attach', '--interactive', name],
        { input: JSON.stringify(input), timeoutMs: input.budgetMs + 10000 },
      );
      programWallMs = performance.now() - programStart;
      if (result.code === 0 && !result.stopped) {
        try {
          packet = JSON.parse(result.stdout);
        } catch {
          /* incomplete or forged protocol */
        }
      }
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
    }
    const state = await command([
      'inspect',
      name,
      '--format',
      '{{json .State}}',
    ]);
    if (state.code === 0) {
      const data = JSON.parse(state.stdout);
      exitCode = data.ExitCode;
      oomKilled = data.OOMKilled;
    }
  } catch (error) {
    failure = error;
  } finally {
    if (created) {
      try {
        const removed = await command(['rm', '--force', name]);
        cleanupVerified = removed.code === 0;
      } catch {
        cleanupVerified = false;
      }
    }
  }
  if (created && !cleanupVerified)
    throw new Error('Runner owned container cleanup failed');
  if (failure) throw failure;
  return {
    packet: packet ?? null,
    exitCode,
    oomKilled,
    timedOut,
    cancelled: options.signal?.aborted ?? false,
    cleanupVerified,
    programWallMs,
    lifecycleMs: performance.now() - started,
    image,
  };
}
export async function collectExpired() {
  const found = await command([
    'ps',
    '--all',
    '--quiet',
    '--filter',
    `label=${OWNER_LABEL}`,
  ]);
  if (found.code !== 0) throw new Error('Runner orphan inspection failed');
  let removed = 0;
  for (const id of found.stdout.trim().split(/\s+/).filter(Boolean)) {
    if (!/^[a-f0-9]{12,64}$/.test(id))
      throw new Error('Unexpected Docker identifier');
    const inspected = await command(['inspect', id]);
    if (inspected.code !== 0) continue;
    const item = JSON.parse(inspected.stdout)[0];
    const labels = item.Config.Labels ?? {};
    const expiry = Number(labels['org.alunza.expires']);
    if (
      labels['org.alunza.runner'] === 'imp-00-06' &&
      /^\/alunza-runner-[a-f0-9-]{36}$/.test(item.Name) &&
      Number.isFinite(expiry) &&
      expiry < Date.now()
    ) {
      if ((await command(['rm', '--force', id])).code !== 0)
        throw new Error('Runner orphan cleanup failed');
      removed++;
    }
  }
  return removed;
}
