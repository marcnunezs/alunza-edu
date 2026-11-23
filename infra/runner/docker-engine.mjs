import { Agent, request } from 'node:http';
import { measureTiming, recordDriverFailure } from './timing.mjs';

const RESPONSE_LIMIT = 524288;
let endpointPromise;
// Process-owned IPC pool. It caches sockets, never responses, permissions or
// container state. Node keys socketPath separately and unreferences idle sockets.
// https://nodejs.org/docs/latest-v24.x/api/http.html#class-httpagent
const ipcAgent = new Agent({
  keepAlive: true,
  maxSockets: 16,
  maxTotalSockets: 16,
  maxFreeSockets: 4,
  scheduling: 'lifo',
});
process.once('exit', () => ipcAgent.destroy());

// A lost create response can precede a late daemon-side creation. An early 404
// is not sufficient while that bounded ownership lease remains uncertain.
export class CreationTracker {
  constructor(now = Date.now) {
    this.now = now;
    this.pending = new Map();
  }
  begin(executionId, name, expiresAt) {
    this.pending.set(name, { executionId, expiresAt });
  }
  observed(name) {
    this.pending.delete(name.replace(/^\//, ''));
  }
  uncertain(executionId) {
    for (const [name, item] of this.pending) {
      if (item.expiresAt <= this.now()) this.pending.delete(name);
    }
    return [...this.pending.values()].some(
      (item) => item.executionId === executionId,
    );
  }
  has(name) {
    return this.pending.has(name);
  }
}

// Docker Engine is reached only through local IPC, never TCP/TLS/SSH.
// https://docs.docker.com/engine/manage-resources/contexts/
// https://docs.docker.com/reference/api/engine/version/v1.45/
export function localSocketPath(endpoint, platform = process.platform) {
  if (typeof endpoint !== 'string' || /[\0\r\n]/.test(endpoint))
    throw new Error('Local Docker endpoint required');
  if (
    platform === 'win32' &&
    /^npipe:\/\/\/\/\.\/pipe\/[a-zA-Z0-9_.-]+$/.test(endpoint)
  )
    return endpoint.slice('npipe://'.length).replaceAll('/', '\\');
  if (
    platform !== 'win32' &&
    /^unix:\/\/\/[^/]/.test(endpoint) &&
    !/[\\?#]/.test(endpoint)
  )
    return endpoint.slice('unix://'.length);
  throw new Error('Local Docker endpoint required');
}

export async function resolveDockerEndpoint(
  command,
  environment = process.env,
) {
  if (environment.DOCKER_HOST && !environment.DOCKER_CONTEXT)
    return environment.DOCKER_HOST;
  const context = await command(
    [
      'context',
      'inspect',
      ...(environment.DOCKER_CONTEXT ? [environment.DOCKER_CONTEXT] : []),
      '--format',
      '{{json .Endpoints.docker.Host}}',
    ],
    { timeoutMs: 10000 },
  );
  if (context.code !== 0 || context.stopped)
    throw new Error('Docker context unavailable');
  return JSON.parse(context.stdout);
}

export function negotiateApiVersion(data) {
  const maximum = /^1\.(\d{1,3})$/.exec(data?.ApiVersion ?? '');
  const minimum = /^1\.(\d{1,3})$/.exec(data?.MinAPIVersion ?? '');
  const selected = maximum && Math.min(45, Number(maximum[1]));
  if (!selected || !minimum || selected < 41 || Number(minimum[1]) > selected)
    throw new Error('Docker API version incompatible');
  return `1.${selected}`;
}

export function pinnedDockerEnvironment(
  endpoint,
  apiVersion,
  environment = process.env,
) {
  localSocketPath(endpoint);
  if (!/^1\.4[1-5]$/.test(apiVersion))
    throw new Error('Docker API version incompatible');
  const copy = { ...environment };
  for (const name of [
    'DOCKER_CONTEXT',
    'DOCKER_HOST',
    'DOCKER_TLS',
    'DOCKER_TLS_VERIFY',
    'DOCKER_CERT_PATH',
  ])
    delete copy[name];
  copy.DOCKER_API_VERSION = apiVersion;
  return copy;
}

// Keep transport diagnostics independent of the contents of the Docker reply.
class DockerExchangeError extends Error {
  constructor(outcome, httpStatus) {
    super('Local Docker request failed');
    this.outcome = outcome;
    this.httpStatus = httpStatus;
  }
}

function abortOutcome(signal) {
  return signal?.reason?.name === 'TimeoutError' ? 'DEADLINE' : 'CANCELLED';
}

export function engineRequest(
  socketPath,
  method,
  path,
  { body, signal, timeoutMs = 15000, maxBytes = RESPONSE_LIMIT } = {},
) {
  signal?.throwIfAborted();
  const encoded = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    let settled = false;
    let exchangeSocket,
      httpStatus = null;
    const finish = (failure, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (failure) {
        // A failed, cancelled or incomplete exchange never returns its socket
        // to the shared pool. There are no transport retries of mutations.
        // ClientRequest can release its own socket reference before JSON
        // validation at response end, so retain and discard the actual socket.
        exchangeSocket?.destroy();
        req.destroy();
        reject(new DockerExchangeError(failure, httpStatus));
      } else resolve(value);
    };
    const abort = () => finish(abortOutcome(signal));
    const req = request(
      {
        socketPath,
        method,
        path,
        agent: ipcAgent,
        headers: {
          ...(encoded === undefined
            ? {}
            : {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(encoded),
              }),
        },
      },
      (response) => {
        if (response.statusCode < 100 || response.statusCode > 599) {
          finish('INVALID_RESPONSE');
          response.destroy();
          return;
        }
        httpStatus = response.statusCode;
        let length = 0;
        const chunks = [];
        response.on('data', (chunk) => {
          length += chunk.length;
          if (length > maxBytes) {
            finish('RESPONSE_LIMIT');
            response.destroy();
          } else chunks.push(chunk);
        });
        response.on('error', () => finish('INCOMPLETE_RESPONSE'));
        response.on('end', () => {
          if (!response.complete) {
            finish('INCOMPLETE_RESPONSE');
            return;
          }
          try {
            const text = Buffer.concat(chunks).toString('utf8');
            finish(null, {
              status: response.statusCode,
              data: text ? JSON.parse(text) : null,
            });
          } catch {
            finish('INVALID_RESPONSE');
          }
        });
      },
    );
    const timer = setTimeout(() => finish('DEADLINE'), Math.max(1, timeoutMs));
    req.on('socket', (socket) => {
      exchangeSocket = socket;
    });
    req.on('error', (error) => {
      if (httpStatus !== null) finish('INCOMPLETE_RESPONSE');
      else if (error.code?.startsWith('HPE_')) finish('INVALID_RESPONSE');
      else finish('SOCKET_ERROR');
    });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    else req.end(encoded);
  });
}

// Docker's non-TTY stream has an eight-byte header per stdout/stderr frame.
// https://docs.docker.com/reference/api/engine/version/v1.45/#tag/Container/operation/ContainerAttach
function multiplexedOutput(maxBytes) {
  let pending = Buffer.alloc(0),
    size = 0,
    wireBytes = 0;
  const stdout = [],
    stderr = [];
  return {
    push(chunk) {
      wireBytes += chunk.length;
      // Bound framing overhead too, including an endless sequence of empty frames.
      if (wireBytes > maxBytes + 65536) throw new Error('Docker stream limit');
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= 8) {
        const type = pending[0];
        const length = pending.readUInt32BE(4);
        if (
          ![1, 2].includes(type) ||
          pending[1] !== 0 ||
          pending[2] !== 0 ||
          pending[3] !== 0 ||
          length > maxBytes - size
        )
          throw new Error('Invalid Docker stream frame');
        if (pending.length < 8 + length) return;
        size += length;
        (type === 1 ? stdout : stderr).push(pending.subarray(8, 8 + length));
        pending = pending.subarray(8 + length);
      }
    },
    end() {
      if (pending.length) throw new Error('Incomplete Docker stream frame');
      return {
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      };
    },
  };
}

function attachDockerStream(socketPath, path, { signal, output, maxBytes }) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    let socket,
      settled = false,
      sent = false,
      written = false,
      ended = false,
      complete,
      fail;
    const captured = output ? multiplexedOutput(maxBytes) : null;
    const finished = new Promise((done, error) => {
      complete = done;
      fail = error;
    });
    // The stream may fail while its sibling handshake or start is pending.
    // Its owner still awaits this original promise before accepting a result.
    void finished.catch(() => {});
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      socket?.destroy();
      req.destroy();
      if (error) {
        const safeError = new Error('Local Docker attachment failed');
        reject(safeError);
        fail(safeError);
      } else complete(value);
    };
    const abort = () => finish(new Error('Docker attachment cancelled'));
    const consume = (chunk) => {
      if (settled || chunk.length === 0) return;
      try {
        if (!captured) throw new Error('Unexpected stdin-only output');
        captured.push(chunk);
      } catch (error) {
        finish(error);
      }
    };
    const req = request({
      socketPath,
      method: 'POST',
      path,
      agent: false,
      headers: { Connection: 'Upgrade', Upgrade: 'tcp', 'Content-Length': 0 },
    });
    req.on('error', (error) => finish(error));
    req.on('response', (response) => {
      response.destroy();
      finish(new Error('Docker attachment upgrade required'));
    });
    req.on('upgrade', (response, connection, head) => {
      socket = connection;
      if (settled) {
        socket.destroy();
        return;
      }
      if (
        response.statusCode !== 101 ||
        response.headers.upgrade?.toLowerCase() !== 'tcp' ||
        ![
          'application/vnd.docker.raw-stream',
          'application/vnd.docker.multiplexed-stream',
        ].includes(response.headers['content-type'])
      ) {
        finish(new Error('Invalid Docker attachment upgrade'));
        return;
      }
      socket.on('error', (error) => finish(error));
      socket.on('data', consume);
      socket.on('end', () => {
        ended = true;
        try {
          if (!output && !written)
            throw new Error('Docker stdin closed before delivery');
          finish(null, captured?.end());
        } catch (error) {
          finish(error);
        }
      });
      socket.on('close', () => {
        if (settled) return;
        if (!output && written) finish(null);
        else if (!ended) finish(new Error('Docker attachment interrupted'));
      });
      consume(head);
      if (settled) return;
      resolve({
        finished,
        isOpen: () => !settled,
        close: abort,
        send(input) {
          if (output || sent || settled)
            throw new Error('Docker stdin unavailable');
          sent = true;
          return new Promise((done, rejectInput) => {
            // On Windows libuv flushes a pipe before closing it; it does not
            // implement go-winio's message-mode half-close. Only this dedicated
            // stdin attachment is closed. The output attachment stays open.
            socket.end(input, (error) => {
              if (error || settled) {
                finish(error ?? new Error('Docker stdin interrupted'));
                rejectInput(new Error('Local Docker attachment failed'));
                return;
              }
              written = true;
              done();
            });
            finished.catch(rejectInput);
          });
        },
      });
    });
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    else req.end();
  });
}

function startRuntimeCause(status, message) {
  // Docker 20.10 can report an OCI runtime denial as HTTP 400.
  if (status < 400 || status > 599 || typeof message !== 'string') return null;
  // The provider's free text is inspected in memory only. Return a known
  // symptom, never the message, path or mount/cgroup name.
  if (
    /\b(?:unable to apply cgroup configuration|error setting cgroup config|cgroup mountpoint does not exist)\b/i.test(
      message,
    )
  )
    return 'CGROUP';
  if (
    /\b(?:error mounting|failed to mount rootfs|mount through procfd)\b/i.test(
      message,
    )
  )
    return 'MOUNT';
  if (/\b(?:permission denied|operation not permitted)\b/i.test(message))
    return 'PERMISSION';
  return null;
}

const dockerStates = new Set([
  'created',
  'running',
  'paused',
  'restarting',
  'removing',
  'exited',
  'dead',
]);

async function observeFailedStart({
  exchange,
  observer,
  socketPath,
  apiVersion,
  containerId,
  signal,
  deadlineMs,
}) {
  const detail = {
    ...exchange,
    containerState: 'unknown',
    hasStarted: null,
    oomKilled: null,
  };
  // Only an immutable ID matched across create and preinspection is eligible.
  // Diagnostics never enter the cleanup budget or wait for an entire request timeout.
  const timeoutMs = Math.min(500, deadlineMs - Date.now() - 500);
  if (
    !signal.aborted &&
    timeoutMs >= 1 &&
    /^[a-f0-9]{64}$/.test(containerId ?? '')
  ) {
    try {
      const response = await engineRequest(
        socketPath,
        'GET',
        `/v${apiVersion}/containers/${containerId}/json`,
        { signal, timeoutMs },
      );
      if (response.status === 404) detail.containerState = 'absent';
      const state = response.data?.State;
      if (
        response.status === 200 &&
        response.data?.Id === containerId &&
        dockerStates.has(state?.Status)
      ) {
        detail.containerState = state.Status;
        if (typeof state.OOMKilled === 'boolean')
          detail.oomKilled = state.OOMKilled;
        if (typeof state.StartedAt === 'string') {
          const started = Date.parse(state.StartedAt);
          if (started > 0) detail.hasStarted = true;
          else if (/^0001-01-01T00:00:00(?:\.0+)?Z$/.test(state.StartedAt))
            detail.hasStarted = false;
        }
      }
    } catch {
      // A failed observation leaves the state unknown and cannot mask START.
    }
  }
  try {
    const result = observer(Object.freeze(detail));
    if (result && typeof result.then === 'function')
      void Promise.resolve(result).catch(() => undefined);
  } catch {
    // Observation must never hold up removal of the owned container.
  }
}

export async function engineStartAttach(
  socketPath,
  apiVersion,
  name,
  {
    input,
    signal,
    timeoutMs = 30000,
    maxBytes = RESPONSE_LIMIT,
    observeTiming,
    observeFailure,
    observeStartFailure,
    ownedContainerId,
    deadlineMs,
    beforeSend,
  },
) {
  signal?.throwIfAborted();
  if (
    !/^1\.4[1-5]$/.test(apiVersion) ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(name) ||
    typeof input !== 'string' ||
    Buffer.byteLength(input) > 262144 ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > RESPONSE_LIMIT ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 30000
  )
    throw new Error('Invalid Docker attachment input');
  const scope = new AbortController();
  const operationEnd = Date.now() + timeoutMs;
  const deadline = setTimeout(
    () =>
      scope.abort(
        new globalThis.DOMException('Docker deadline', 'TimeoutError'),
      ),
    Math.max(1, timeoutMs),
  );
  const operationSignal = signal
    ? AbortSignal.any([signal, scope.signal])
    : scope.signal;
  const path = `/v${apiVersion}/containers/${encodeURIComponent(name)}`;
  let output, stdin;
  let startResponse;
  let phase = 'ATTACH_OUTPUT';
  try {
    // Register output before input and start, so no packet can be lost.
    // Separate attachments preserve output through Windows named-pipe EOF.
    output = await measureTiming(observeTiming, 'attachOutput', () =>
      attachDockerStream(
        socketPath,
        `${path}/attach?stream=1&logs=0&stdin=0&stdout=1&stderr=1`,
        { signal: operationSignal, output: true, maxBytes },
      ),
    );
    void output.finished.catch(() => {
      if (!operationSignal.aborted)
        recordDriverFailure(observeFailure, 'STREAMS');
      scope.abort();
    });
    phase = 'ATTACH_INPUT';
    stdin = await measureTiming(observeTiming, 'attachInput', () =>
      attachDockerStream(
        socketPath,
        `${path}/attach?stream=1&logs=0&stdin=1&stdout=0&stderr=0`,
        { signal: operationSignal, output: false, maxBytes },
      ),
    );
    void stdin.finished.catch(() => {
      if (!operationSignal.aborted)
        recordDriverFailure(
          observeFailure,
          phase === 'SEND' ? 'SEND' : 'STREAMS',
        );
      scope.abort();
    });
    if (!output.isOpen() || !stdin.isOpen()) {
      phase = !output.isOpen() ? 'ATTACH_OUTPUT' : 'ATTACH_INPUT';
      throw new Error('Docker attachment closed before start');
    }
    phase = 'START';
    await measureTiming(observeTiming, 'start', async () => {
      const started = await engineRequest(socketPath, 'POST', `${path}/start`, {
        signal: operationSignal,
        timeoutMs,
      });
      if (started.status !== 204) {
        startResponse = {
          httpStatus: started.status,
          outcome: 'HTTP_RESPONSE',
          runtimeCause: startRuntimeCause(
            started.status,
            started.data?.message,
          ),
        };
        throw new Error('Docker start failed');
      }
    });
    phase = 'SEND';
    if (beforeSend) await waitForAuthority(beforeSend, operationSignal);
    operationSignal.throwIfAborted();
    await measureTiming(observeTiming, 'send', () => stdin.send(input));
    phase = 'STREAMS';
    const streams = measureTiming(observeTiming, 'streams', () =>
      Promise.all([output.finished, stdin.finished]),
    );
    // Start the daemon exit acknowledgement while output is still draining.
    // Neither wait nor stream EOF alone confirms the complete exchange; the
    // caller still inspects state independently after both have completed.
    const wait = measureTiming(observeTiming, 'wait', async () => {
      const exited = await engineRequest(
        socketPath,
        'POST',
        `${path}/wait?condition=not-running`,
        { signal: operationSignal, timeoutMs },
      );
      if (
        exited.status !== 200 ||
        !Number.isInteger(exited.data?.StatusCode) ||
        (exited.data.Error != null && exited.data.Error.Message !== '')
      )
        throw new Error('Docker exit unconfirmed');
      return exited;
    });
    const observedWait = observeFailure
      ? wait.catch((error) => {
          recordDriverFailure(observeFailure, 'WAIT');
          throw error;
        })
      : wait;
    const [[result], exited] = await Promise.all([streams, observedWait]);
    return { ...result, exitCode: exited.data.StatusCode };
  } catch (error) {
    recordDriverFailure(observeFailure, phase);
    if (phase === 'START' && typeof observeStartFailure === 'function') {
      const exchange = startResponse ?? {
        httpStatus:
          error instanceof DockerExchangeError ? error.httpStatus : null,
        outcome:
          error instanceof DockerExchangeError
            ? error.outcome
            : operationSignal.aborted
              ? abortOutcome(operationSignal)
              : 'SOCKET_ERROR',
        runtimeCause: null,
      };
      await observeFailedStart({
        exchange,
        observer: observeStartFailure,
        socketPath,
        apiVersion,
        containerId: ownedContainerId,
        signal: operationSignal,
        deadlineMs: Math.min(operationEnd, deadlineMs ?? operationEnd),
      });
    }
    throw error;
  } finally {
    clearTimeout(deadline);
    scope.abort();
    output?.close();
    stdin?.close();
  }
}

async function waitForAuthority(check, signal) {
  signal.throwIfAborted();
  let remove;
  const cancelled = new Promise((_, reject) => {
    const abort = () =>
      reject(new Error('Docker execution authority cancelled'));
    signal.addEventListener('abort', abort, { once: true });
    remove = () => signal.removeEventListener('abort', abort);
    if (signal.aborted) abort();
  });
  try {
    return await Promise.race([Promise.resolve().then(check), cancelled]);
  } finally {
    remove();
  }
}

export async function localDockerEngine(command, signal) {
  signal?.throwIfAborted();
  // Resolve once per API process, then pin both HTTP and start/attach to that
  // endpoint. A context change requires an API restart, never a mixed daemon.
  endpointPromise ??= (async () => {
    const endpoint = await resolveDockerEndpoint(command);
    const socketPath = localSocketPath(endpoint);
    const version = await engineRequest(socketPath, 'GET', '/version', {
      timeoutMs: 10000,
    });
    if (version.status !== 200)
      throw new Error('Docker API version unavailable');
    return {
      endpoint,
      socketPath,
      apiVersion: negotiateApiVersion(version.data),
    };
  })().catch((error) => {
    endpointPromise = undefined;
    throw error;
  });
  // Each caller can cancel its wait without cancelling another caller's lookup.
  let removeAbort;
  const cancelled = new Promise((_, reject) => {
    const abort = () => reject(new Error('Docker context cancelled'));
    signal?.addEventListener('abort', abort, { once: true });
    removeAbort = () => signal?.removeEventListener('abort', abort);
  });
  let resolved;
  try {
    resolved = await Promise.race([endpointPromise, cancelled]);
    signal?.throwIfAborted();
  } finally {
    removeAbort();
  }
  return {
    endpoint: resolved.endpoint,
    apiVersion: resolved.apiVersion,
    request: (method, path, options) =>
      engineRequest(
        resolved.socketPath,
        method,
        `/v${resolved.apiVersion}${path}`,
        options,
      ),
    startAttach: (name, options) =>
      engineStartAttach(
        resolved.socketPath,
        resolved.apiVersion,
        name,
        options,
      ),
    prepareAttach: (name, options) =>
      enginePrepareAttach(
        resolved.socketPath,
        resolved.apiVersion,
        name,
        options,
      ),
  };
}

/** A running, input-free capsule. The returned channel is single-use. */
export async function enginePrepareAttach(
  socketPath,
  apiVersion,
  name,
  options,
) {
  const { signal, containerId, expiresAtMs, observeTiming } = options;
  if (
    !/^1\.4[1-5]$/.test(apiVersion) ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(name) ||
    !/^[a-f0-9]{64}$/.test(containerId) ||
    !Number.isSafeInteger(expiresAtMs) ||
    expiresAtMs <= Date.now() ||
    expiresAtMs > Date.now() + 61000
  )
    throw new Error('Invalid prepared capsule channel');
  signal?.throwIfAborted();
  const scope = new AbortController();
  const path = `/v${apiVersion}/containers/${containerId}`;
  let output,
    stdin,
    used = false,
    closed = false;
  const abort = () => scope.abort();
  const expiry = setTimeout(abort, Math.max(1, expiresAtMs - Date.now()));
  const preparation = setTimeout(
    abort,
    Math.min(30000, expiresAtMs - Date.now()),
  );
  signal?.addEventListener('abort', abort, { once: true });
  const close = () => {
    closed = true;
    clearTimeout(expiry);
    clearTimeout(preparation);
    signal?.removeEventListener('abort', abort);
    scope.abort();
    output?.close();
    stdin?.close();
  };
  try {
    output = await measureTiming(observeTiming, 'attachOutput', () =>
      attachDockerStream(
        socketPath,
        `${path}/attach?stream=1&logs=0&stdin=0&stdout=1&stderr=1`,
        { signal: scope.signal, output: true, maxBytes: RESPONSE_LIMIT },
      ),
    );
    void output.finished.then(() => {
      if (!used) abort();
    }, abort);
    stdin = await measureTiming(observeTiming, 'attachInput', () =>
      attachDockerStream(
        socketPath,
        `${path}/attach?stream=1&logs=0&stdin=1&stdout=0&stderr=0`,
        { signal: scope.signal, output: false, maxBytes: RESPONSE_LIMIT },
      ),
    );
    void stdin.finished.then(() => {
      if (!used) abort();
    }, abort);
    if (!output.isOpen() || !stdin.isOpen())
      throw new Error('Prepared capsule channel closed');
    const started = await measureTiming(observeTiming, 'start', () =>
      engineRequest(socketPath, 'POST', `${path}/start`, {
        signal: scope.signal,
        timeoutMs: 30000,
      }),
    );
    if (started.status !== 204)
      throw new Error('Prepared capsule start failed');
    const running = await engineRequest(socketPath, 'GET', `${path}/json`, {
      signal: scope.signal,
    });
    if (
      running.status !== 200 ||
      running.data?.Id !== containerId ||
      running.data.State?.Running !== true ||
      !Number.isInteger(running.data.State.Pid) ||
      running.data.State.Pid <= 0
    )
      throw new Error('Prepared capsule running state unconfirmed');
    scope.signal.throwIfAborted();
    clearTimeout(preparation);
    signal?.removeEventListener('abort', abort);
    return {
      containerId,
      inspection: running.data,
      usable: () =>
        !used &&
        !closed &&
        !scope.signal.aborted &&
        output.isOpen() &&
        stdin.isOpen(),
      close,
      async consume(
        input,
        { signal: executionSignal, deadlineMs, beforeSend },
      ) {
        if (
          used ||
          closed ||
          scope.signal.aborted ||
          typeof input !== 'string' ||
          Buffer.byteLength(input) > 262144 ||
          !Number.isSafeInteger(deadlineMs) ||
          deadlineMs <= Date.now() ||
          typeof beforeSend !== 'function'
        )
          throw new Error('Prepared capsule consumption denied');
        used = true;
        const end = Math.min(deadlineMs, expiresAtMs, Date.now() + 30000);
        const deadline = setTimeout(abort, Math.max(1, end - Date.now()));
        executionSignal?.addEventListener('abort', abort, { once: true });
        try {
          executionSignal?.throwIfAborted();
          if (!output.isOpen() || !stdin.isOpen())
            throw new Error('Prepared capsule channel lost');
          // The durable assignment and execution lease are checked last, before
          // any student bytes can enter the already-running trusted bridge.
          await waitForAuthority(beforeSend, scope.signal);
          executionSignal?.throwIfAborted();
          scope.signal.throwIfAborted();
          if (Date.now() >= end) throw new Error('Prepared capsule deadline');
          await measureTiming(observeTiming, 'send', () => stdin.send(input));
          const streams = Promise.all([output.finished, stdin.finished]);
          const wait = engineRequest(
            socketPath,
            'POST',
            `${path}/wait?condition=not-running`,
            {
              signal: scope.signal,
              timeoutMs: Math.max(1, end - Date.now()),
            },
          );
          const [[result], exited] = await Promise.all([streams, wait]);
          if (
            exited.status !== 200 ||
            !Number.isInteger(exited.data?.StatusCode) ||
            (exited.data.Error != null && exited.data.Error.Message !== '')
          )
            throw new Error('Prepared capsule exit unconfirmed');
          return { ...result, exitCode: exited.data.StatusCode };
        } finally {
          clearTimeout(deadline);
          executionSignal?.removeEventListener('abort', abort);
          close();
        }
      },
    };
  } catch (error) {
    close();
    throw error;
  }
}

export function capsuleConfiguration(image, labels, probe, runtimeName) {
  if (!/^sha256:[a-f0-9]{64}$/.test(image))
    throw new Error('Runner requires immutable local image ID');
  if (
    runtimeName !== undefined &&
    !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(runtimeName)
  )
    throw new Error('Invalid explicit Docker runtime');
  return {
    Image: image,
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    OpenStdin: true,
    StdinOnce: true,
    Tty: false,
    Labels: labels,
    ...(probe ? { Env: [`ALUNZA_RUNNER_PROBE=${probe}`] } : {}),
    HostConfig: {
      ...(runtimeName === undefined ? {} : { Runtime: runtimeName }),
      NetworkMode: 'none',
      PidMode: '',
      ReadonlyRootfs: true,
      Privileged: false,
      CapDrop: ['ALL'],
      // Only the trusted root bridge retains KILL. It must terminate the
      // different-UID worker; setpriv drops every capability before student code.
      CapAdd: ['SETUID', 'SETGID', 'SETPCAP', 'KILL'],
      SecurityOpt: ['no-new-privileges:true'],
      Memory: 134217728,
      MemorySwap: 134217728,
      NanoCpus: 1000000000,
      PidsLimit: 32,
      Ulimits: [{ Name: 'nofile', Soft: 64, Hard: 64 }],
      Tmpfs: { '/tmp': 'rw,noexec,nosuid,nodev,size=8388608,mode=1777' },
      LogConfig: { Type: 'none', Config: {} },
      RestartPolicy: { Name: 'no', MaximumRetryCount: 0 },
      AutoRemove: false,
      Binds: [],
      PortBindings: {},
    },
  };
}

export async function removeAndVerify(engine, name, signal, observeTiming) {
  const path = `/containers/${encodeURIComponent(name)}`;
  const removed = await measureTiming(observeTiming, 'delete', () =>
    engine.request('DELETE', `${path}?force=true`, {
      signal,
      timeoutMs: 10000,
    }),
  );
  const remaining = await measureTiming(observeTiming, 'verifyAbsent', () =>
    engine.request('GET', `${path}/json`, {
      signal,
      timeoutMs: 10000,
    }),
  );
  return [204, 404].includes(removed.status) && remaining.status === 404;
}
