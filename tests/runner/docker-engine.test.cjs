const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
let engine;
beforeAll(async () => {
  engine = await import('../../infra/runner/docker-engine.mjs');
});

test('Queued mutations retain their deadlines and cancellation without reaching the daemon', async () => {
  // This first IPC test starts with an empty process-owned connection pool.
  const held = [];
  let ready;
  const full = new Promise((resolve) => {
    ready = resolve;
  });
  let mutations = 0;
  await withServer(
    (req, res) => {
      if (req.url === '/hold') {
        held.push(res);
        if (held.length === 16) ready();
      } else {
        if (req.method === 'POST') mutations++;
        res.end(JSON.stringify({ ok: true }));
      }
    },
    async (socket) => {
      const cleanup = new AbortController();
      const running = Array.from({ length: 16 }, () =>
        engine.engineRequest(socket, 'GET', '/hold', {
          signal: cleanup.signal,
        }),
      );
      try {
        await full;
        const timedOut = engine.engineRequest(socket, 'POST', '/mutation', {
          timeoutMs: 40,
        });
        const cancelled = engine.engineRequest(socket, 'POST', '/mutation', {
          signal: AbortSignal.timeout(40),
        });
        await Promise.all([
          expect(timedOut).rejects.toThrow('Local Docker request failed'),
          expect(cancelled).rejects.toThrow('Local Docker request failed'),
        ]);
        held.forEach((response) => response.end(JSON.stringify({ ok: true })));
        await Promise.all(running);
        await expect(
          engine.engineRequest(socket, 'GET', '/healthy'),
        ).resolves.toEqual({ status: 200, data: { ok: true } });
        expect(mutations).toBe(0);
      } finally {
        cleanup.abort();
        await Promise.allSettled(running);
      }
    },
  );
});

test('Docker endpoints reject remote and Windows UNC forms', () => {
  for (const endpoint of [
    'tcp://localhost:2375',
    'https://localhost:2376',
    'ssh://localhost',
    'npipe:////remote/pipe/docker_engine',
    'unix:////server/pipe/docker',
    'unix:///\\server\\pipe\\docker',
  ]) {
    expect(() => engine.localSocketPath(endpoint, 'win32')).toThrow();
    expect(() => engine.localSocketPath(endpoint, 'linux')).toThrow();
  }
  expect(() =>
    engine.localSocketPath('unix:///var/run/docker.sock', 'win32'),
  ).toThrow();
  expect(engine.localSocketPath('unix:///var/run/docker.sock', 'linux')).toBe(
    '/var/run/docker.sock',
  );
  expect(
    engine.localSocketPath('npipe:////./pipe/docker_engine', 'win32'),
  ).toBe('\\\\.\\pipe\\docker_engine');
});

test('Docker endpoint resolution preserves explicit context over host and otherwise active context', async () => {
  const command = jest.fn(async () => ({
    code: 0,
    stopped: false,
    stdout: JSON.stringify('npipe:////./pipe/fixture'),
  }));
  expect(
    await engine.resolveDockerEndpoint(command, {
      DOCKER_HOST: 'tcp://remote',
    }),
  ).toBe('tcp://remote');
  expect(command).not.toHaveBeenCalled();
  expect(
    await engine.resolveDockerEndpoint(command, {
      DOCKER_CONTEXT: 'chosen',
      DOCKER_HOST: 'tcp://remote',
    }),
  ).toBe('npipe:////./pipe/fixture');
  expect(command.mock.calls[0][0]).toEqual([
    'context',
    'inspect',
    'chosen',
    '--format',
    '{{json .Endpoints.docker.Host}}',
  ]);
  await engine.resolveDockerEndpoint(command, {});
  expect(command.mock.calls[1][0]).toEqual([
    'context',
    'inspect',
    '--format',
    '{{json .Endpoints.docker.Host}}',
  ]);
});

test('Pinned CLI environment removes all daemon and TLS overrides', () => {
  const endpoint =
    process.platform === 'win32'
      ? 'npipe:////./pipe/docker_engine'
      : 'unix:///var/run/docker.sock';
  expect(
    engine.pinnedDockerEnvironment(endpoint, '1.41', {
      PATH: 'fixture',
      DOCKER_CONTEXT: 'remote',
      DOCKER_HOST: 'tcp://remote',
      DOCKER_TLS: '1',
      DOCKER_TLS_VERIFY: '1',
      DOCKER_CERT_PATH: 'fixture',
      DOCKER_API_VERSION: '1.99',
    }),
  ).toEqual({ PATH: 'fixture', DOCKER_API_VERSION: '1.41' });
});

test('Docker API negotiates supported versions without assuming the local daemon is newest', () => {
  expect(
    engine.negotiateApiVersion({ ApiVersion: '1.56', MinAPIVersion: '1.44' }),
  ).toBe('1.45');
  expect(
    engine.negotiateApiVersion({ ApiVersion: '1.41', MinAPIVersion: '1.12' }),
  ).toBe('1.41');
  expect(
    engine.negotiateApiVersion({ ApiVersion: '1.44', MinAPIVersion: '1.24' }),
  ).toBe('1.44');
  for (const value of [
    { ApiVersion: '1.40', MinAPIVersion: '1.12' },
    { ApiVersion: '1.56', MinAPIVersion: '1.46' },
    { ApiVersion: 'invalid', MinAPIVersion: '1.44' },
  ])
    expect(() => engine.negotiateApiVersion(value)).toThrow();
});

async function withServer(handler, action) {
  const socket =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\alunza-engine-test-${randomUUID()}`
      : join(tmpdir(), `alunza-engine-${randomUUID()}.sock`);
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socket, resolve);
  });
  try {
    await action(socket);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

test('Engine response, JSON failure and redirects remain explicit', async () => {
  await withServer(
    (req, res) => {
      if (req.url === '/invalid') res.end('invalid');
      else if (req.url === '/redirect') {
        res.writeHead(302, { Location: 'http://remote.invalid' });
        res.end();
      } else {
        res.writeHead(404);
        res.end(JSON.stringify({ message: 'absent' }));
      }
    },
    async (socket) => {
      expect(await engine.engineRequest(socket, 'GET', '/absent')).toEqual({
        status: 404,
        data: { message: 'absent' },
      });
      expect(await engine.engineRequest(socket, 'GET', '/redirect')).toEqual({
        status: 302,
        data: null,
      });
      await expect(
        engine.engineRequest(socket, 'GET', '/invalid'),
      ).rejects.toThrow('Local Docker request failed');
    },
  );
});

test('IPC keep-alive reuses a connection without caching replies or crossing endpoints', async () => {
  const firstConnections = new Set();
  let requests = 0;
  await withServer(
    (req, res) => {
      firstConnections.add(req.socket);
      res.end(JSON.stringify({ request: ++requests }));
    },
    async (first) => {
      expect((await engine.engineRequest(first, 'GET', '/state')).data).toEqual(
        { request: 1 },
      );
      expect((await engine.engineRequest(first, 'GET', '/state')).data).toEqual(
        { request: 2 },
      );
      expect(firstConnections.size).toBe(1);
      await withServer(
        (_req, res) => res.end(JSON.stringify({ endpoint: 'other' })),
        async (second) => {
          expect(
            (await engine.engineRequest(second, 'GET', '/state')).data,
          ).toEqual({ endpoint: 'other' });
          expect(
            (await engine.engineRequest(first, 'GET', '/state')).data,
          ).toEqual({ request: 3 });
        },
      );
    },
  );
});

test.each(['cancel', 'timeout', 'truncated', 'oversized', 'invalid'])(
  'A %s IPC exchange is discarded without replaying mutations or contaminating the next reply',
  async (failure) => {
    const sockets = [];
    let mutations = 0;
    await withServer(
      (req, res) => {
        sockets.push(req.socket);
        if (req.url === '/mutation') {
          mutations++;
          if (failure === 'truncated') {
            res.writeHead(200, { 'Content-Length': '100' });
            res.write('{');
            res.socket.end();
          } else if (failure === 'oversized')
            res.end(JSON.stringify('x'.repeat(1000)));
          else if (failure === 'invalid') res.end('{');
          // Cancellation and deadline deliberately receive no response.
        } else res.end(JSON.stringify({ unchanged: true }));
      },
      async (socket) => {
        await expect(
          engine.engineRequest(socket, 'POST', '/mutation', {
            body: { fictitious: true },
            maxBytes: 100,
            timeoutMs: 80,
            ...(failure === 'cancel'
              ? { signal: AbortSignal.timeout(40) }
              : {}),
          }),
        ).rejects.toThrow('Local Docker request failed');
        expect(
          (await engine.engineRequest(socket, 'GET', '/state')).data,
        ).toEqual({ unchanged: true });
        expect(mutations).toBe(1);
        expect(sockets).toHaveLength(2);
        expect(sockets[0]).not.toBe(sockets[1]);
      },
    );
  },
);

test('Cancelling one pooled request leaves concurrent requests intact', async () => {
  await withServer(
    (req, res) => {
      if (req.url === '/healthy') res.end(JSON.stringify({ ok: true }));
    },
    async (socket) => {
      const cancelled = engine.engineRequest(socket, 'GET', '/blocked', {
        signal: AbortSignal.timeout(40),
      });
      const healthy = engine.engineRequest(socket, 'GET', '/healthy');
      await expect(healthy).resolves.toEqual({
        status: 200,
        data: { ok: true },
      });
      await expect(cancelled).rejects.toThrow('Local Docker request failed');
      await expect(
        engine.engineRequest(socket, 'GET', '/healthy'),
      ).resolves.toEqual({ status: 200, data: { ok: true } });
    },
  );
});

test('Engine bounds successful and error response bodies', async () => {
  await withServer(
    (req, res) => {
      res.writeHead(req.url === '/error' ? 500 : 200);
      res.end(JSON.stringify('x'.repeat(1000)));
    },
    async (socket) => {
      for (const path of ['/success', '/error'])
        await expect(
          engine.engineRequest(socket, 'GET', path, { maxBytes: 100 }),
        ).rejects.toThrow();
    },
  );
});

test('Engine enforces absolute deadlines and cancellation including a preaborted caller', async () => {
  let received = 0;
  await withServer(
    () => {
      received++;
    },
    async (socket) => {
      await expect(
        engine.engineRequest(socket, 'GET', '/wait', { timeoutMs: 40 }),
      ).rejects.toThrow();
      await expect(
        engine.engineRequest(socket, 'GET', '/wait', {
          signal: AbortSignal.timeout(40),
        }),
      ).rejects.toThrow();
      expect(received).toBe(2);
      expect(() =>
        engine.engineRequest(socket, 'GET', '/wait', {
          signal: AbortSignal.abort(),
        }),
      ).toThrow();
      expect(received).toBe(2);
    },
  );
});

test('Engine capsule configuration retains explicit isolation and lifecycle controls', () => {
  const value = engine.capsuleConfiguration('sha256:' + 'a'.repeat(64), {
    execution: 'fixture',
  });
  expect(value).toMatchObject({
    OpenStdin: true,
    StdinOnce: true,
    Tty: false,
    HostConfig: {
      Memory: 134217728,
      MemorySwap: 134217728,
      NanoCpus: 1000000000,
      PidsLimit: 32,
      NetworkMode: 'none',
      ReadonlyRootfs: true,
      Privileged: false,
      CapDrop: ['ALL'],
      CapAdd: ['SETUID', 'SETGID', 'SETPCAP'],
      SecurityOpt: ['no-new-privileges:true'],
      AutoRemove: false,
      Ulimits: [{ Name: 'nofile', Soft: 64, Hard: 64 }],
      Tmpfs: { '/tmp': 'rw,noexec,nosuid,nodev,size=8388608,mode=1777' },
      LogConfig: { Type: 'none' },
      Binds: [],
      PortBindings: {},
    },
  });
  expect(() => engine.capsuleConfiguration('mutable:tag', {})).toThrow();
});

test('Cleanup requires an accepted delete and an explicit 404 absence observation', async () => {
  for (const [removed, observed, expected] of [
    [204, 404, true],
    [404, 404, true],
    [500, 404, false],
    [204, 500, false],
    [204, 200, false],
    [204, 302, false],
  ]) {
    const request = jest
      .fn()
      .mockResolvedValueOnce({ status: removed })
      .mockResolvedValueOnce({ status: observed });
    const timings = [];
    expect(
      await engine.removeAndVerify(
        { request },
        'owned-name',
        undefined,
        (event) => timings.push(event),
      ),
    ).toBe(expected);
    expect(request.mock.calls.map((args) => args[0])).toEqual([
      'DELETE',
      'GET',
    ]);
    expect(timings.map((event) => event.phase)).toEqual([
      'delete',
      'verifyAbsent',
    ]);
    for (const event of timings) {
      expect(Object.keys(event).sort()).toEqual([
        'completed',
        'durationMs',
        'phase',
      ]);
      expect(Number.isFinite(event.durationMs)).toBe(true);
      expect(event.durationMs).toBeGreaterThanOrEqual(0);
    }
  }
});

test.each(['delete', 'verifyAbsent'])(
  'A %s transport rejection retains its identity and incomplete timing without repeating cleanup',
  async (phase) => {
    const failure = new Error('private cleanup diagnostic');
    const request = jest.fn();
    if (phase === 'verifyAbsent')
      request.mockResolvedValueOnce({ status: 204 });
    request.mockRejectedValueOnce(failure);
    const timings = [];
    await expect(
      engine.removeAndVerify({ request }, 'owned-name', undefined, (event) =>
        timings.push(event),
      ),
    ).rejects.toBe(failure);
    expect(request.mock.calls.map((args) => args[0])).toEqual(
      phase === 'delete' ? ['DELETE'] : ['DELETE', 'GET'],
    );
    expect(timings.at(-1)).toMatchObject({ phase, completed: false });
    expect(JSON.stringify(timings)).not.toContain(failure.message);
  },
);

test.each(['throw', 'rejected promise'])(
  'An observer %s cannot suppress deletion or change verified absence',
  async (kind) => {
    for (const [observed, expected] of [
      [404, true],
      [200, false],
    ]) {
      const request = jest
        .fn()
        .mockResolvedValueOnce({ status: 204 })
        .mockResolvedValueOnce({ status: observed });
      const observe = jest.fn(() => {
        if (kind === 'throw') throw new Error('private observer failure');
        return Promise.reject(new Error('private observer failure'));
      });
      await expect(
        engine.removeAndVerify({ request }, 'owned-name', undefined, observe),
      ).resolves.toBe(expected);
      expect(request.mock.calls.map((args) => args[0])).toEqual([
        'DELETE',
        'GET',
      ]);
      expect(observe.mock.calls.map(([event]) => event.phase)).toEqual([
        'delete',
        'verifyAbsent',
      ]);
    }
  },
);

test('A controlled orphan clock rejects missing, invalid, or unbounded fixture scope before Docker access', async () => {
  const { collectExpired } = await import('../../infra/runner/capsule.mjs');
  const id = 'a'.repeat(64);
  for (const observation of [
    null,
    { nowMs: Date.now() },
    { containerIds: [id] },
    { nowMs: Infinity, containerIds: [id] },
    { nowMs: -1, containerIds: [id] },
    { nowMs: Date.now(), containerIds: [] },
    { nowMs: Date.now(), containerIds: ['a'.repeat(12)] },
    { nowMs: Date.now(), containerIds: [id, id] },
    { nowMs: Date.now(), containerIds: Array(11).fill(id) },
  ])
    await expect(collectExpired(undefined, observation)).rejects.toThrow(
      'Controlled orphan observation requires exact fixture IDs',
    );
});

test('Lost and cancelled create responses retain cleanup uncertainty; a late expired capsule is swept', async () => {
  const {
    runCapsule,
    cleanupDockerExecution,
    sweepExpiredDockerExecutions,
    collectExpired,
  } = await import('../../infra/runner/capsule.mjs');
  let pending,
    visible = false,
    mode = 'lost',
    inspections = 0;
  const id = 'a'.repeat(64);
  const json = (res, status, value) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(value === undefined ? undefined : JSON.stringify(value));
  };
  await withServer(
    (req, res) => {
      const url = new URL(req.url, 'http://local');
      if (url.pathname === '/version') {
        json(res, 200, { ApiVersion: '1.45', MinAPIVersion: '1.41' });
      } else if (url.pathname.endsWith('/containers/create')) {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
          const value = JSON.parse(Buffer.concat(chunks));
          pending = {
            Name: '/' + url.searchParams.get('name'),
            Config: { Labels: value.Labels },
            HostConfig: value.HostConfig,
          };
          if (mode === 'lost') res.destroy();
          // Cancellation deliberately leaves the server's create outcome unknown.
        });
      } else if (url.pathname.endsWith('/containers/json')) {
        json(res, 200, visible ? [{ Id: id }] : []);
      } else if (req.method === 'DELETE') {
        const status = visible ? 204 : 404;
        visible = false;
        json(res, status, status === 404 ? { message: 'absent' } : undefined);
      } else if (url.pathname.endsWith('/json')) {
        inspections++;
        json(
          res,
          visible ? 200 : 404,
          visible ? pending : { message: 'absent' },
        );
      } else json(res, 500, { message: 'unexpected test route' });
    },
    async (socket) => {
      const previousHost = process.env.DOCKER_HOST;
      const previousContext = process.env.DOCKER_CONTEXT;
      process.env.DOCKER_HOST =
        process.platform === 'win32'
          ? 'npipe://' + socket.replaceAll('\\', '/')
          : 'unix://' + socket;
      delete process.env.DOCKER_CONTEXT;
      try {
        for (mode of ['lost', 'cancelled']) {
          const executionId = randomUUID();
          const timings = [];
          await expect(
            runCapsule(
              {
                executionId,
                code: 'module.exports.solve=()=>1',
                args: [],
                budgetMs: 3000,
                outputRemaining: 65536,
              },
              {
                image: 'sha256:' + 'b'.repeat(64),
                observeTiming(event) {
                  timings.push(event);
                  if (mode === 'lost')
                    throw new Error('private observer failure');
                  return Promise.reject(new Error('private observer failure'));
                },
                ...(mode === 'cancelled'
                  ? { signal: AbortSignal.timeout(60) }
                  : {}),
              },
            ),
          ).rejects.toThrow('cleanup failed');
          expect(timings.map((event) => event.phase)).toEqual([
            'engineResolve',
            'create',
            'delete',
            'verifyAbsent',
          ]);
          expect(
            timings.find((event) => event.phase === 'create'),
          ).toMatchObject({
            completed: false,
          });
          for (const event of timings)
            expect(Object.keys(event).sort()).toEqual([
              'completed',
              'durationMs',
              'phase',
            ]);
          expect(JSON.stringify(timings)).not.toContain(executionId);
          expect(JSON.stringify(timings)).not.toContain('module.exports.solve');
          expect(await cleanupDockerExecution(executionId)).toEqual({
            cleanupVerified: false,
            removed: 0,
          });
          expect(pending.Config.Labels['org.alunza.execution']).toBe(
            executionId,
          );
          visible = true;
          const future = Date.now() + 61000;
          // The controlled future must not even inspect/delete an expired
          // container outside the exact probe scope returned by Docker's list.
          const inspectionsBefore = inspections;
          expect(
            await collectExpired(undefined, {
              nowMs: future,
              containerIds: ['c'.repeat(64)],
            }),
          ).toBe(0);
          expect(inspections).toBe(inspectionsBefore);
          expect(visible).toBe(true);
          const date = jest.spyOn(Date, 'now').mockReturnValue(future);
          try {
            expect(await sweepExpiredDockerExecutions()).toEqual({
              cleanupVerified: true,
              removed: 1,
            });
          } finally {
            date.mockRestore();
          }
          expect(visible).toBe(false);
          expect(await cleanupDockerExecution(executionId)).toEqual({
            cleanupVerified: true,
            removed: 0,
          });
        }
      } finally {
        if (previousHost === undefined) delete process.env.DOCKER_HOST;
        else process.env.DOCKER_HOST = previousHost;
        if (previousContext === undefined) delete process.env.DOCKER_CONTEXT;
        else process.env.DOCKER_CONTEXT = previousContext;
      }
    },
  );
});
