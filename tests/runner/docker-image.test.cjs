const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { setImmediate } = require('node:timers/promises');

let readImageIdentity;
const image = 'fixture:latest';
const id = 'sha256:' + 'a'.repeat(64);
const nextId = 'sha256:' + 'b'.repeat(64);
const available = { status: 200, data: { Id: id } };
beforeAll(async () => {
  ({ readImageIdentity } = await import('../../infra/runner/docker-image.mjs'));
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function engine(request) {
  return { endpoint: 'fixture:' + randomUUID(), apiVersion: '1.45', request };
}

test('Distinct engine wrappers share only a pending image read, then observe a fresh tag', async () => {
  const held = deferred();
  const request = jest
    .fn()
    .mockReturnValueOnce(held.promise)
    .mockResolvedValueOnce({
      status: 200,
      data: { Id: nextId },
    });
  const source = engine(request);
  const callers = Array.from({ length: 4 }, () =>
    readImageIdentity({ ...source }, image),
  );
  await Promise.resolve();
  expect(request).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0].slice(0, 2)).toEqual([
    'GET',
    '/images/fixture%3Alatest/json',
  ]);
  expect(request.mock.calls[0][2].timeoutMs).toBe(10000);
  held.resolve(available);
  await expect(Promise.all(callers)).resolves.toEqual(Array(4).fill(id));
  await expect(readImageIdentity(source, image)).resolves.toBe(nextId);
  expect(request).toHaveBeenCalledTimes(2);
});

test.each(['image', 'endpoint', 'apiVersion'])(
  'Pending image reads remain separate for different %s values',
  async (field) => {
    const left = deferred(),
      right = deferred();
    const first = engine(jest.fn().mockReturnValue(left.promise));
    const second = {
      ...first,
      request: jest.fn().mockReturnValue(right.promise),
    };
    if (field !== 'image') second[field] += '-different';
    const a = readImageIdentity(first, image);
    const b = readImageIdentity(
      second,
      field === 'image' ? 'other:tag' : image,
    );
    await Promise.resolve();
    expect(first.request).toHaveBeenCalledTimes(1);
    expect(second.request).toHaveBeenCalledTimes(1);
    left.resolve(available);
    right.resolve({ status: 200, data: { Id: nextId } });
    await expect(Promise.all([a, b])).resolves.toEqual([id, nextId]);
  },
);

test.each([
  ['transport rejection', null],
  ['unavailable image', { status: 404, data: { Id: id } }],
  ['invalid immutable ID', { status: 200, data: { Id: image } }],
  ['missing immutable ID', { status: 200, data: {} }],
])(
  'A shared %s is discarded and the next call retries',
  async (_label, result) => {
    const held = deferred();
    const request = jest
      .fn()
      .mockReturnValueOnce(held.promise)
      .mockResolvedValueOnce(available);
    const source = engine(request);
    const callers = [
      readImageIdentity(source, image),
      readImageIdentity({ ...source }, image),
    ];
    const observed = Promise.allSettled(callers);
    if (result) held.resolve(result);
    else held.reject(new Error('Transport unavailable'));
    expect((await observed).map((item) => item.status)).toEqual([
      'rejected',
      'rejected',
    ]);
    expect(request).toHaveBeenCalledTimes(1);
    await expect(readImageIdentity(source, image)).resolves.toBe(id);
    expect(request).toHaveBeenCalledTimes(2);
  },
);

test('A preaborted caller starts no read and cannot cancel an existing read', async () => {
  const held = deferred();
  const source = engine(jest.fn().mockReturnValue(held.promise));
  const reason = new Error('Caller already cancelled');
  const signal = AbortSignal.abort(reason);
  await expect(readImageIdentity(source, image, signal)).rejects.toBe(reason);
  expect(source.request).not.toHaveBeenCalled();
  const healthy = readImageIdentity(source, image);
  await expect(readImageIdentity(source, image, signal)).rejects.toBe(reason);
  expect(source.request).toHaveBeenCalledTimes(1);
  expect(source.request.mock.calls[0][2].signal.aborted).toBe(false);
  held.resolve(available);
  await expect(healthy).resolves.toBe(id);
});

test.each([0, 1])(
  'Cancelling pending caller %i leaves its sibling and the underlying read active',
  async (cancelledIndex) => {
    const held = deferred();
    const source = engine(jest.fn().mockReturnValue(held.promise));
    const controllers = [new AbortController(), new AbortController()];
    const removals = controllers.map(({ signal }) =>
      jest.spyOn(signal, 'removeEventListener'),
    );
    const callers = controllers.map(({ signal }) =>
      readImageIdentity(source, image, signal),
    );
    const reason = new Error('Independent caller cancelled');
    const rejected = expect(callers[cancelledIndex]).rejects.toBe(reason);
    controllers[cancelledIndex].abort(reason);
    await rejected;
    expect(source.request).toHaveBeenCalledTimes(1);
    expect(source.request.mock.calls[0][2].signal.aborted).toBe(false);
    held.resolve(available);
    await expect(callers[1 - cancelledIndex]).resolves.toBe(id);
    for (const removal of removals) expect(removal).toHaveBeenCalledTimes(1);
  },
);

test('After all callers cancel, a late failed read is handled and a later lookup retries', async () => {
  const held = deferred();
  const source = engine(
    jest
      .fn()
      .mockReturnValueOnce(held.promise)
      .mockResolvedValueOnce(available),
  );
  const controllers = [new AbortController(), new AbortController()];
  const callers = controllers.map(({ signal }) =>
    readImageIdentity(source, image, signal),
  );
  const observed = Promise.allSettled(callers);
  controllers.forEach((controller) => controller.abort());
  expect((await observed).map((item) => item.status)).toEqual([
    'rejected',
    'rejected',
  ]);
  expect(source.request.mock.calls[0][2].signal.aborted).toBe(false);
  held.reject(new Error('Late transport failure'));
  await setImmediate();
  await expect(readImageIdentity(source, image)).resolves.toBe(id);
  expect(source.request).toHaveBeenCalledTimes(2);
});

test('The shared read has its own 10 second deadline even after every caller leaves', async () => {
  jest.useFakeTimers();
  const held = deferred();
  const source = engine(
    jest
      .fn()
      .mockReturnValueOnce(held.promise)
      .mockResolvedValueOnce(available),
  );
  const controller = new AbortController();
  try {
    const cancelled = readImageIdentity(source, image, controller.signal);
    const observed = expect(cancelled).rejects.toThrow();
    controller.abort();
    await observed;
    const sharedSignal = source.request.mock.calls[0][2].signal;
    await jest.advanceTimersByTimeAsync(9999);
    expect(sharedSignal.aborted).toBe(false);
    expect(jest.getTimerCount()).toBe(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(sharedSignal.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
    await expect(readImageIdentity(source, image)).resolves.toBe(id);
    expect(source.request).toHaveBeenCalledTimes(2);
    expect(jest.getTimerCount()).toBe(0);
    // Even a noncooperating transport that fails after the deadline is observed.
    held.reject(new Error('Late timed-out transport failure'));
    await Promise.resolve();
  } finally {
    jest.useRealTimers();
  }
});

test('An active caller sees the shared timeout and can immediately retry', async () => {
  jest.useFakeTimers();
  const held = deferred();
  const source = engine(
    jest
      .fn()
      .mockReturnValueOnce(held.promise)
      .mockResolvedValueOnce(available),
  );
  try {
    const result = readImageIdentity(source, image);
    const observed = expect(result).rejects.toThrow(
      'Docker image lookup timed out',
    );
    await jest.advanceTimersByTimeAsync(10000);
    await observed;
    await expect(readImageIdentity(source, image)).resolves.toBe(id);
    held.resolve(available);
    await Promise.resolve();
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    jest.useRealTimers();
  }
});

// A local IPC protocol fixture verifies the public capsule wiring without
// starting Docker, executing student code, or modifying a TEST environment.
test('Availability overlaps daemon and image reads, requires both validations, and handles late failures', async () => {
  const socketPath =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\alunza-image-${randomUUID()}`
      : join(tmpdir(), `alunza-image-${randomUUID()}.sock`);
  const sockets = new Set();
  const goodInfo = {
    OSType: 'linux',
    CgroupVersion: '2',
    MemoryLimit: true,
    SwapLimit: true,
    PidsLimit: true,
  };
  let stage;
  const json = (res, status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };
  const server = http.createServer((req, res) => {
    if (req.url === '/version')
      return json(res, 200, { ApiVersion: '1.45', MinAPIVersion: '1.41' });
    if (req.url === '/v1.45/info') stage.info.resolve(res);
    else if (req.url.startsWith('/v1.45/images/')) stage.image.resolve(res);
    else json(res, 500, { message: 'Unexpected fixture path' });
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(socketPath, resolve));
  const oldHost = process.env.DOCKER_HOST,
    oldContext = process.env.DOCKER_CONTEXT;
  process.env.DOCKER_HOST =
    process.platform === 'win32'
      ? 'npipe://' + socketPath.replaceAll('\\', '/')
      : 'unix://' + socketPath;
  delete process.env.DOCKER_CONTEXT;
  try {
    const { getDockerAvailability, imageIdentity } =
      await import('../../infra/runner/capsule.mjs');
    const begin = async () => {
      stage = { info: deferred(), image: deferred() };
      const result = getDockerAvailability();
      // Neither response is released until both requests have reached IPC.
      const [info, imageResponse] = await Promise.all([
        stage.info.promise,
        stage.image.promise,
      ]);
      return { result, info, imageResponse };
    };
    const valid = await begin();
    let completed = false;
    void valid.result.then(() => {
      completed = true;
    });
    json(valid.info, 200, goodInfo);
    await setImmediate();
    expect(completed).toBe(false);
    json(valid.imageResponse, 200, { Id: id });
    await expect(valid.result).resolves.toEqual({ available: true, image: id });

    for (const patch of [
      { OSType: 'windows' },
      { CgroupVersion: '1' },
      { MemoryLimit: false },
      { SwapLimit: false },
      { PidsLimit: false },
    ]) {
      const attempt = await begin();
      json(attempt.info, 200, { ...goodInfo, ...patch });
      json(attempt.imageResponse, 200, { Id: id });
      await expect(attempt.result).resolves.toEqual({
        available: false,
        image: null,
      });
    }
    for (const kind of ['info-http', 'image-http', 'image-id']) {
      const attempt = await begin();
      json(attempt.info, kind === 'info-http' ? 500 : 200, goodInfo);
      json(attempt.imageResponse, kind === 'image-http' ? 404 : 200, {
        Id: kind === 'image-id' ? image : id,
      });
      await expect(attempt.result).resolves.toEqual({
        available: false,
        image: null,
      });
    }
    for (const first of ['info', 'imageResponse']) {
      const attempt = await begin();
      const imageSettled = imageIdentity().then(
        () => 'fulfilled',
        () => 'rejected',
      );
      // Join this pending read before either transport fails; the next round
      // must begin after its cleanup, rather than accidentally joining it.
      await Promise.resolve();
      attempt[first].destroy();
      await expect(attempt.result).resolves.toEqual({
        available: false,
        image: null,
      });
      attempt[first === 'info' ? 'imageResponse' : 'info'].destroy();
      expect(await imageSettled).toBe('rejected');
      await setImmediate();
    }
  } finally {
    if (oldHost === undefined) delete process.env.DOCKER_HOST;
    else process.env.DOCKER_HOST = oldHost;
    if (oldContext === undefined) delete process.env.DOCKER_CONTEXT;
    else process.env.DOCKER_CONTEXT = oldContext;
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
});
