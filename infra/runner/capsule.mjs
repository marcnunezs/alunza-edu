import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { measureTiming } from './timing.mjs';
import {
  localDockerEngine,
  pinnedDockerEnvironment,
  capsuleConfiguration,
  removeAndVerify,
  CreationTracker,
} from './docker-engine.mjs';

const OWNER_VALUE = 'alunza-edu-laboratorio';
export const OWNER_LABEL = `org.alunza.runner=${OWNER_VALUE}`;
export const IMAGE_TAG = 'alunza-laboratorio-runner-capsule:imp-03-quickjs-2';
export const RUNNER_PREFIX = 'alunza-laboratorio-runner-';
const ownedName = new RegExp(`^/${RUNNER_PREFIX}[a-f0-9-]{36}$`);
const creationTracker = new CreationTracker();
// No shell and bounded diagnostics. These commands execute trusted Docker tooling only.
export function command(
  args,
  {
    input,
    timeoutMs = 15000,
    maxBytes = 524288,
    signal,
    dockerHost,
    apiVersion,
  } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'docker',
      dockerHost ? ['--host', dockerHost, ...args] : args,
      {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        ...(dockerHost
          ? { env: pinnedDockerEnvironment(dockerHost, apiVersion) }
          : {}),
      },
    );
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
export async function imageIdentity(image = IMAGE_TAG, signal) {
  const engine = await localDockerEngine(command, signal);
  const result = await engine.request(
    'GET',
    `/images/${encodeURIComponent(image)}/json`,
    { signal },
  );
  const id = result.data?.Id;
  if (result.status !== 200 || !/^sha256:[a-f0-9]{64}$/.test(id ?? ''))
    throw new Error('Prepared runner image unavailable');
  return id;
}
export async function runCapsule(input, options = {}) {
  options = {
    ...options,
    signal: options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(30000)])
      : AbortSignal.timeout(30000),
  };
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      input.executionId ?? '',
    )
  )
    throw new Error('Execution UUID required');
  if (
    options.probe &&
    ![
      'identity',
      'memory',
      'descendant-memory',
      'processes',
      'network',
      'permissions',
    ].includes(options.probe)
  )
    throw new Error('Invalid fixed probe');
  options.signal?.throwIfAborted();
  const engine = await measureTiming(
    options.observeTiming,
    'engineResolve',
    () => localDockerEngine(command, options.signal),
  );
  const image =
    options.image ??
    (await measureTiming(options.observeTiming, 'imageResolve', () =>
      imageIdentity(IMAGE_TAG, options.signal),
    ));
  if (!/^sha256:[a-f0-9]{64}$/.test(image))
    throw new Error('Runner requires immutable local image ID');
  const name = `${RUNNER_PREFIX}${randomUUID()}`;
  const started = performance.now();
  let created = false,
    cleanupVerified = false;
  let packet,
    exitCode = null,
    acknowledgedExitCode,
    oomKilled = false,
    programWallMs,
    containerWallMs = null,
    failure;
  try {
    // A timed-out client can lose the create response after Docker accepted it.
    // Always attempt cleanup of this generated name, including that uncertain case.
    created = true;
    const expiresAt = Date.now() + 60000;
    options.signal?.throwIfAborted();
    creationTracker.begin(input.executionId, name, expiresAt);
    await measureTiming(options.observeTiming, 'create', async () => {
      const create = await engine.request(
        'POST',
        `/containers/create?name=${encodeURIComponent(name)}`,
        {
          signal: options.signal,
          body: capsuleConfiguration(
            image,
            {
              'org.alunza.runner': OWNER_VALUE,
              'org.alunza.expires': String(expiresAt),
              'org.alunza.execution': input.executionId,
            },
            options.probe,
          ),
        },
      );
      // A definitive HTTP response has completed this create operation. Transport
      // failures leave the marker until observed or the ownership lease expires.
      creationTracker.observed(name);
      if (create.status !== 201)
        throw new Error('Runner container creation failed');
    });
    created = true;
    const inspect = await measureTiming(
      options.observeTiming,
      'preInspect',
      () =>
        engine.request('GET', `/containers/${name}/json`, {
          signal: options.signal,
        }),
    );
    if (inspect.status !== 200) throw new Error('Runner inspection failed');
    const effective = inspect.data;
    const h = effective.HostConfig;
    if (
      effective.Config?.Tty !== false ||
      effective.Config?.OpenStdin !== true ||
      effective.Config?.StdinOnce !== true ||
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
    // The trusted bridge, outside the student worker, owns its 3000 ms budget.
    // Docker startup and transport are bounded by the operation deadline;
    // they must not consume the student's execution allowance.
    const abort = () => {
      void engine
        .request('POST', `/containers/${name}/kill?signal=SIGKILL`, {
          timeoutMs: 10000,
        })
        .catch(() => {});
    };
    options.signal?.addEventListener('abort', abort, { once: true });
    try {
      if (options.signal?.aborted)
        throw new Error('Execution cancelled before launch');
      const programStart = performance.now();
      const result = await engine.startAttach(name, {
        input: JSON.stringify(input),
        timeoutMs: 30000,
        signal: options.signal,
        observeTiming: options.observeTiming,
      });
      programWallMs = performance.now() - programStart;
      acknowledgedExitCode = result.exitCode;
      try {
        packet = JSON.parse(result.stdout);
      } catch {
        /* incomplete or forged protocol */
      }
    } finally {
      options.signal?.removeEventListener('abort', abort);
    }
    const state = await measureTiming(
      options.observeTiming,
      'postInspect',
      () =>
        engine.request('GET', `/containers/${name}/json`, {
          signal: options.signal,
        }),
    );
    if (state.status === 200) {
      const data = state.data.State;
      if (
        data.Running !== false ||
        !Number.isInteger(data.ExitCode) ||
        data.ExitCode !== acknowledgedExitCode ||
        typeof data.OOMKilled !== 'boolean'
      )
        throw new Error('Runner final state unconfirmed');
      exitCode = data.ExitCode;
      oomKilled = data.OOMKilled;
      const startedAt = Date.parse(data.StartedAt);
      const finishedAt = Date.parse(data.FinishedAt);
      if (startedAt > 0 && finishedAt >= startedAt)
        containerWallMs = finishedAt - startedAt;
    }
  } catch (error) {
    failure = error;
  } finally {
    if (created) {
      try {
        const cleanupSignal = AbortSignal.timeout(10000);
        if (creationTracker.has(name)) {
          const observed = await engine.request(
            'GET',
            `/containers/${name}/json`,
            { signal: cleanupSignal },
          );
          if (observed.status === 200) creationTracker.observed(name);
        }
        cleanupVerified = await removeAndVerify(
          engine,
          name,
          cleanupSignal,
          options.observeTiming,
        );
        cleanupVerified &&= !creationTracker.uncertain(input.executionId);
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
    timedOut: false,
    cancelled: options.signal?.aborted ?? false,
    cleanupVerified,
    programWallMs,
    containerWallMs,
    lifecycleMs: performance.now() - started,
    image,
  };
}
export async function getDockerAvailability(
  signal = AbortSignal.timeout(10000),
) {
  try {
    const engine = await localDockerEngine(command, signal);
    const info = await engine.request('GET', '/info', {
      signal,
      timeoutMs: 10000,
    });
    const data = info.data;
    if (
      info.status !== 200 ||
      data.OSType !== 'linux' ||
      data.CgroupVersion !== '2' ||
      !data.MemoryLimit ||
      !data.SwapLimit ||
      !data.PidsLimit
    )
      return { available: false, image: null };
    const image = await imageIdentity(IMAGE_TAG, signal);
    return { available: true, image };
  } catch {
    return { available: false, image: null };
  }
}
export async function cleanupDockerExecution(
  executionId,
  signal = AbortSignal.timeout(10000),
) {
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      executionId ?? '',
    )
  )
    throw new Error('Execution UUID required');
  let removed = 0;
  try {
    const engine = await localDockerEngine(command, signal);
    const list = () =>
      engine.request(
        'GET',
        `/containers/json?all=true&filters=${encodeURIComponent(JSON.stringify({ label: [OWNER_LABEL, `org.alunza.execution=${executionId}`] }))}`,
        { signal, timeoutMs: 10000 },
      );
    const found = await list();
    if (found.status !== 200 || !Array.isArray(found.data))
      return { cleanupVerified: false, removed };
    for (const { Id: id } of found.data) {
      if (!/^[a-f0-9]{12,64}$/.test(id))
        return { cleanupVerified: false, removed };
      const inspected = await engine.request('GET', `/containers/${id}/json`, {
        signal,
        timeoutMs: 10000,
      });
      if (inspected.status === 404) continue;
      if (inspected.status !== 200) return { cleanupVerified: false, removed };
      const item = inspected.data;
      const labels = item.Config.Labels ?? {};
      if (
        !ownedName.test(item.Name) ||
        labels['org.alunza.runner'] !== OWNER_VALUE ||
        labels['org.alunza.execution'] !== executionId
      )
        return { cleanupVerified: false, removed };
      creationTracker.observed(item.Name);
      if (!(await removeAndVerify(engine, id, signal)))
        return { cleanupVerified: false, removed };
      removed++;
    }
    const remaining = await list();
    return {
      cleanupVerified:
        remaining.status === 200 &&
        Array.isArray(remaining.data) &&
        remaining.data.length === 0 &&
        !creationTracker.uncertain(executionId),
      removed,
    };
  } catch {
    return { cleanupVerified: false, removed };
  }
}
export async function collectExpired(
  signal = AbortSignal.timeout(10000),
  observation,
) {
  // A controlled clock is only safe with an exact fixture scope. Production
  // callers omit this internal probe seam and retain the real-clock sweep.
  if (
    observation !== undefined &&
    (!Number.isSafeInteger(observation?.nowMs) ||
      observation.nowMs < 0 ||
      !Array.isArray(observation.containerIds) ||
      observation.containerIds.length < 1 ||
      observation.containerIds.length > 10 ||
      !observation.containerIds.every(
        (id) => typeof id === 'string' && /^[a-f0-9]{64}$/.test(id),
      ) ||
      new Set(observation.containerIds).size !==
        observation.containerIds.length)
  )
    throw new Error('Controlled orphan observation requires exact fixture IDs');
  const scope = observation && new Set(observation.containerIds);
  const nowMs = observation?.nowMs;
  const engine = await localDockerEngine(command, signal);
  const found = await engine.request(
    'GET',
    `/containers/json?all=true&filters=${encodeURIComponent(JSON.stringify({ label: [OWNER_LABEL] }))}`,
    { signal },
  );
  if (found.status !== 200 || !Array.isArray(found.data))
    throw new Error('Runner orphan inspection failed');
  let removed = 0;
  for (const { Id: id } of found.data) {
    if (!/^[a-f0-9]{12,64}$/.test(id))
      throw new Error('Unexpected Docker identifier');
    if (scope && !scope.has(id)) continue;
    const inspected = await engine.request('GET', `/containers/${id}/json`, {
      signal,
    });
    if (inspected.status === 404) continue;
    if (inspected.status !== 200)
      throw new Error('Runner orphan inspection failed');
    const item = inspected.data;
    const labels = item.Config.Labels ?? {};
    const expiry = Number(labels['org.alunza.expires']);
    if (
      labels['org.alunza.runner'] === OWNER_VALUE &&
      ownedName.test(item.Name) &&
      Number.isFinite(expiry) &&
      expiry < (nowMs ?? Date.now())
    ) {
      if (!(await removeAndVerify(engine, id, signal)))
        throw new Error('Runner orphan cleanup failed');
      creationTracker.observed(item.Name);
      removed++;
    }
  }
  return removed;
}
export async function sweepExpiredDockerExecutions(
  signal = AbortSignal.timeout(10000),
) {
  try {
    return { cleanupVerified: true, removed: await collectExpired(signal) };
  } catch {
    return { cleanupVerified: false, removed: 0 };
  }
}
