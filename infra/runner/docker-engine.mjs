import { Agent, request } from 'node:http';

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
    let exchangeSocket;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (error) {
        // A failed, cancelled or incomplete exchange never returns its socket
        // to the shared pool. There are no transport retries of mutations.
        // ClientRequest can release its own socket reference before JSON
        // validation at response end, so retain and discard the actual socket.
        exchangeSocket?.destroy();
        req.destroy();
        reject(new Error('Local Docker request failed'));
      } else resolve(value);
    };
    const abort = () => {
      req.destroy();
      finish(new Error('Local Docker request cancelled'));
    };
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
        let length = 0;
        const chunks = [];
        response.on('data', (chunk) => {
          length += chunk.length;
          if (length > maxBytes) {
            response.destroy();
            abort();
          } else chunks.push(chunk);
        });
        response.on('error', (error) => finish(error));
        response.on('end', () => {
          if (!response.complete) {
            finish(new Error('Incomplete Docker response'));
            return;
          }
          try {
            const text = Buffer.concat(chunks).toString('utf8');
            finish(null, {
              status: response.statusCode,
              data: text ? JSON.parse(text) : null,
            });
          } catch (error) {
            finish(error);
          }
        });
      },
    );
    const timer = setTimeout(abort, Math.max(1, timeoutMs));
    req.on('socket', (socket) => {
      exchangeSocket = socket;
    });
    req.on('error', (error) => finish(error));
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

export async function engineStartAttach(
  socketPath,
  apiVersion,
  name,
  { input, signal, timeoutMs = 30000, maxBytes = RESPONSE_LIMIT },
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
  const deadline = setTimeout(() => scope.abort(), Math.max(1, timeoutMs));
  const operationSignal = signal
    ? AbortSignal.any([signal, scope.signal])
    : scope.signal;
  const path = `/v${apiVersion}/containers/${encodeURIComponent(name)}`;
  let output, stdin;
  try {
    // Register output before input and start, so no packet can be lost.
    // Separate attachments preserve output through Windows named-pipe EOF.
    output = await attachDockerStream(
      socketPath,
      `${path}/attach?stream=1&logs=0&stdin=0&stdout=1&stderr=1`,
      { signal: operationSignal, output: true, maxBytes },
    );
    void output.finished.catch(() => scope.abort());
    stdin = await attachDockerStream(
      socketPath,
      `${path}/attach?stream=1&logs=0&stdin=1&stdout=0&stderr=0`,
      { signal: operationSignal, output: false, maxBytes },
    );
    void stdin.finished.catch(() => scope.abort());
    if (!output.isOpen() || !stdin.isOpen())
      throw new Error('Docker attachment closed before start');
    const started = await engineRequest(socketPath, 'POST', `${path}/start`, {
      signal: operationSignal,
      timeoutMs,
    });
    if (started.status !== 204) throw new Error('Docker start failed');
    await stdin.send(input);
    const [result] = await Promise.all([output.finished, stdin.finished]);
    // Stream EOF is not an exit acknowledgement. Wait through daemon state
    // publication, then let the caller inspect state independently as well.
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
    return { ...result, exitCode: exited.data.StatusCode };
  } finally {
    clearTimeout(deadline);
    scope.abort();
    output?.close();
    stdin?.close();
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
  };
}

export function capsuleConfiguration(image, labels, probe) {
  if (!/^sha256:[a-f0-9]{64}$/.test(image))
    throw new Error('Runner requires immutable local image ID');
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
      NetworkMode: 'none',
      ReadonlyRootfs: true,
      Privileged: false,
      CapDrop: ['ALL'],
      CapAdd: ['SETUID', 'SETGID', 'SETPCAP'],
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

export async function removeAndVerify(engine, name, signal) {
  const path = `/containers/${encodeURIComponent(name)}`;
  const removed = await engine.request('DELETE', `${path}?force=true`, {
    signal,
    timeoutMs: 10000,
  });
  const remaining = await engine.request('GET', `${path}/json`, {
    signal,
    timeoutMs: 10000,
  });
  return [204, 404].includes(removed.status) && remaining.status === 404;
}
