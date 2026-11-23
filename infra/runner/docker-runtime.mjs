import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, open } from 'node:fs/promises';
import { posix } from 'node:path';

const versions = Object.freeze({ runc: '1.3.4', crun: '1.31' });
const keys = [
  'runtime',
  'runtimeName',
  'runtimeVersion',
  'runtimeSha256',
  'strategy',
];

export function validateDockerRuntimeConfig(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Object.keys(value).sort().join(',') !== [...keys].sort().join(',') ||
    !Object.hasOwn(versions, value.runtime) ||
    value.runtimeVersion !== versions[value.runtime] ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(value.runtimeName ?? '') ||
    !/^[a-f0-9]{64}$/.test(value.runtimeSha256 ?? '') ||
    !['cold', 'prepared-pair-v1'].includes(value.strategy)
  )
    throw new Error('Invalid configured Docker runtime');
  return Object.freeze({ ...value });
}

export function validateDockerRuntimeEvidence(config, info, evidence) {
  config = validateDockerRuntimeConfig(config);
  const path = info?.Runtimes?.[config.runtimeName]?.path;
  if (
    info?.OSType !== 'linux' ||
    info?.CgroupVersion !== '2' ||
    info?.CgroupDriver !== 'systemd' ||
    typeof info?.ID !== 'string' ||
    !/^[a-zA-Z0-9:_-]{1,128}$/.test(info.ID) ||
    typeof path !== 'string' ||
    !posix.isAbsolute(path) ||
    path.includes('\0') ||
    path !== posix.normalize(path) ||
    evidence?.path !== path ||
    evidence?.sha256 !== config.runtimeSha256 ||
    evidence?.elf !== true ||
    evidence?.exitCode !== 0 ||
    evidence?.versionLine !==
      `${config.runtime} version ${config.runtimeVersion}`
  )
    throw new Error('Configured Docker runtime unavailable');
  return Object.freeze({
    engineId: info.ID,
    runtimeName: config.runtimeName,
    runtimeVersion: config.runtimeVersion,
    runtimeSha256: config.runtimeSha256,
    strategy: config.strategy,
  });
}

async function binaryIdentity(path, signal) {
  signal?.throwIfAborted();
  const link = await lstat(path);
  if (!link.isFile() || link.isSymbolicLink())
    throw new Error('Invalid runtime executable');
  const file = await open(path, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size < 4 || stat.size > 67108864)
      throw new Error('Invalid runtime executable');
    const digest = createHash('sha256');
    const block = Buffer.alloc(65536);
    let bytes = 0,
      elf = false;
    for (;;) {
      signal?.throwIfAborted();
      const { bytesRead } = await file.read(block, 0, block.length, null);
      if (!bytesRead) break;
      if (bytes === 0)
        elf = block.subarray(0, 4).equals(Buffer.from([127, 69, 76, 70]));
      bytes += bytesRead;
      if (bytes > 67108864)
        throw new Error('Runtime executable exceeded bound');
      digest.update(block.subarray(0, bytesRead));
    }
    if (!elf || bytes !== stat.size)
      throw new Error('Invalid runtime executable');
    return { sha256: digest.digest('hex'), elf };
  } finally {
    await file.close();
  }
}

function versionOf(path, signal) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const child = spawn(path, ['--version'], {
      cwd: '/',
      env: { PATH: '/usr/bin:/bin', LANG: 'C' },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '',
      bytes = 0,
      failed = false;
    const abort = () => {
      failed = true;
      child.kill('SIGKILL');
    };
    const timer = setTimeout(abort, 5000);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    child.stdout.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > 16384) abort();
      else output += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > 16384) abort();
    });
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    };
    child.once('error', () => {
      failed = true;
      finish();
      reject(new Error('Runtime version unavailable'));
    });
    child.once('close', (exitCode) => {
      finish();
      if (failed || exitCode !== 0)
        reject(new Error('Runtime version unavailable'));
      else resolve({ exitCode, versionLine: output.split(/\r?\n/)[0] });
    });
  });
}

/** Read-only capability check; never creates, starts or changes a container. */
export async function inspectDockerRuntime(engine, config, signal) {
  config = validateDockerRuntimeConfig(config);
  if (process.platform !== 'linux')
    throw new Error('Configured runtime requires local Linux');
  signal?.throwIfAborted();
  const info = await engine.request('GET', '/info', { signal });
  if (info.status !== 200) throw new Error('Docker information unavailable');
  const path = info.data?.Runtimes?.[config.runtimeName]?.path;
  if (
    typeof path !== 'string' ||
    !posix.isAbsolute(path) ||
    path.includes('\0') ||
    path !== posix.normalize(path)
  )
    throw new Error('Runtime must name an absolute local executable');
  const before = await binaryIdentity(path, signal);
  // Verify the trusted hash before launching even this metadata-only command.
  if (before.sha256 !== config.runtimeSha256)
    throw new Error('Runtime identity mismatch');
  const version = await versionOf(path, signal);
  const after = await binaryIdentity(path, signal);
  signal?.throwIfAborted();
  if (before.sha256 !== after.sha256)
    throw new Error('Runtime identity changed');
  return validateDockerRuntimeEvidence(config, info.data, {
    path,
    ...after,
    ...version,
  });
}

export function runtimeConfigFromIdentity(identity) {
  const runtime = Object.keys(versions).find(
    (name) => versions[name] === identity?.runtimeVersion,
  );
  return validateDockerRuntimeConfig({
    runtime,
    runtimeName: identity?.runtimeName,
    runtimeVersion: identity?.runtimeVersion,
    runtimeSha256: identity?.runtimeSha256,
    strategy: identity?.strategy,
  });
}
