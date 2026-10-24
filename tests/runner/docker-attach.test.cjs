const http = require('node:http');
const { setImmediate } = require('node:timers');
const { randomUUID } = require('node:crypto');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

let engine;
beforeAll(async () => {
  engine = await import('../../infra/runner/docker-engine.mjs');
});

function frame(type, value = Buffer.alloc(0)) {
  const body = Buffer.isBuffer(value) ? value : Buffer.from(value);
  const header = Buffer.alloc(8);
  header[0] = type;
  header.writeUInt32BE(body.length, 4);
  return Buffer.concat([header, body]);
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

// This is a protocol fixture, not Docker. It uses real local named pipes on
// Windows (Unix sockets elsewhere), so input EOF crosses the same Node IPC
// boundary as production. No student code or container is run by these tests.
async function withDaemon(options, action) {
  const socketPath =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\alunza-attach-${randomUUID()}`
      : join(tmpdir(), `alunza-attach-${randomUUID()}.sock`);
  const sockets = new Set();
  const timers = new Set();
  const stages = new Map();
  const attachmentClosures = [];
  const state = {
    socketPath,
    events: [],
    requests: [],
    input: [],
    handshakes: {},
    output: null,
    stdin: null,
    errors: [],
    stage(name) {
      if (!stages.has(name)) stages.set(name, deferred());
      return stages.get(name).promise;
    },
    mark(name) {
      this.events.push(name);
      if (!stages.has(name)) stages.set(name, deferred());
      stages.get(name).resolve();
    },
    delay(ms, callback) {
      const timer = setTimeout(() => {
        timers.delete(timer);
        callback();
      }, ms);
      timers.add(timer);
    },
  };
  const server = http.createServer({ allowHalfOpen: true }, (req, res) => {
    state.requests.push({ method: req.method, url: req.url });
    if (req.url.endsWith('/wait?condition=not-running')) {
      state.mark('wait');
      state.replyWait = (body = { StatusCode: 0 }) => {
        res.writeHead(options.waitStatus ?? 200, {
          'Content-Type': 'application/json',
        });
        res.end(JSON.stringify(body));
        state.mark('wait-response');
      };
      if (options.hold === 'wait') return;
      if (options.dropWait) {
        res.destroy();
        return;
      }
      state.replyWait(options.waitBody);
      return;
    }
    state.mark('start');
    if (options.hold === 'start') return;
    if (options.dropStart) {
      res.destroy();
      return;
    }
    res.writeHead(options.startStatus ?? 204);
    res.end();
    state.mark('start-response');
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
  });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://local');
    const output = url.searchParams.get('stdout') === '1';
    const role = output ? 'output' : 'stdin';
    state.requests.push({ method: req.method, url: req.url });
    state[role] = socket;
    attachmentClosures.push(
      new Promise((resolve) => socket.once('close', resolve)),
    );
    socket.once('end', () => socket.end());
    socket.resume();
    state.mark(`${role}-attach`);
    if (head.length) state.errors.push('Unexpected bytes before HTTP upgrade');
    state.handshakes[role] = () => {
      if (options.rejectRole === role || options.rejectRoles?.includes(role)) {
        socket.end(options.rejection);
        return;
      }
      const headers = Buffer.from(
        'HTTP/1.1 101 Switching Protocols\r\n' +
          'Connection: Upgrade\r\nUpgrade: tcp\r\n' +
          'Content-Type: application/vnd.docker.raw-stream\r\n\r\n',
      );
      socket.write(
        Buffer.concat([
          headers,
          output ? (options.outputHead ?? Buffer.alloc(0)) : Buffer.alloc(0),
        ]),
      );
      if (output) return;
      socket.on('data', (chunk) => {
        state.input.push(chunk);
        state.mark('stdin-data');
      });
      socket.on('end', () => {
        state.mark('stdin-eof');
        socket.end();
        if (options.hold === 'stream') return;
        if (options.afterInput) options.afterInput(state);
        else state.output.end(frame(1, 'result'));
      });
      socket.resume();
    };
    if (
      options.hold === `${role}-handshake` ||
      options.holdHandshakes?.includes(role)
    )
      return;
    state.handshakes[role]();
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, resolve);
  });
  try {
    await action(state);
    expect(state.errors).toEqual([]);
    let closeDeadline;
    try {
      await Promise.race([
        Promise.all(attachmentClosures),
        new Promise((_, reject) => {
          closeDeadline = setTimeout(
            () => reject(new Error('Client left an attachment open')),
            1000,
          );
        }),
      ]);
    } finally {
      clearTimeout(closeDeadline);
    }
  } finally {
    for (const timer of timers) clearTimeout(timer);
    const closed = [...sockets].map(
      (socket) =>
        new Promise((resolve) => {
          socket.once('close', resolve);
          socket.destroy();
        }),
    );
    server.closeAllConnections();
    await Promise.all([
      ...closed,
      new Promise((resolve) => server.close(resolve)),
    ]);
    expect(sockets.size).toBe(0);
  }
}

function execute(state, options = {}) {
  return engine.engineStartAttach(state.socketPath, '1.45', 'fixture-capsule', {
    input: JSON.stringify({ code: 'module.exports.solve=()=>1', args: [] }),
    timeoutMs: 2000,
    ...options,
  });
}

function expectTiming(events, phases) {
  expect(events.map((event) => event.phase)).toEqual(phases);
  for (const event of events) {
    expect(Object.keys(event).sort()).toEqual([
      'completed',
      'durationMs',
      'phase',
    ]);
    expect(typeof event.completed).toBe('boolean');
    expect(Number.isFinite(event.durationMs)).toBe(true);
    expect(event.durationMs).toBeGreaterThanOrEqual(0);
  }
}

function expectAttachmentTiming(events, remainingPhases = []) {
  expectTiming(
    [...events.slice(0, 2)].sort((left, right) =>
      left.phase.localeCompare(right.phase),
    ),
    ['attachInput', 'attachOutput'],
  );
  expectTiming(events.slice(2), remainingPhases);
}

function expectSuccessfulTiming(events) {
  expectAttachmentTiming(events.slice(0, 4), ['start', 'send']);
  expectTiming(
    [...events.slice(4)].sort((left, right) =>
      left.phase.localeCompare(right.phase),
    ),
    ['streams', 'wait'],
  );
  expect(events.every((event) => event.completed)).toBe(true);
}

async function within(promise, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), 500);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

test.each(['output', 'stdin'])(
  'Handshakes proceed independently but start waits for both, with %s ready first',
  async (first) => {
    await withDaemon({ holdHandshakes: ['output', 'stdin'] }, async (state) => {
      const controller = new AbortController();
      const timings = [];
      const pending = execute(state, {
        signal: controller.signal,
        observeTiming(event) {
          timings.push(event);
          state.mark(`observed-${event.phase}`);
        },
      });
      void pending.catch(() => {});
      try {
        await within(
          Promise.all([
            state.stage('output-attach'),
            state.stage('stdin-attach'),
          ]),
          'A handshake remained serialized behind its sibling',
        );
        expect(state.events).not.toContain('start');
        expect(state.input).toEqual([]);
        state.handshakes[first]();
        const firstPhase = first === 'output' ? 'attachOutput' : 'attachInput';
        await within(
          state.stage(`observed-${firstPhase}`),
          'The first handshake did not complete independently',
        );
        expect(timings).toHaveLength(1);
        expect(timings[0]).toMatchObject({
          phase: firstPhase,
          completed: true,
        });
        expect(state.events).not.toContain('start');
        expect(state.input).toEqual([]);
        state.handshakes[first === 'output' ? 'stdin' : 'output']();
        await expect(pending).resolves.toEqual({
          stdout: 'result',
          stderr: '',
          exitCode: 0,
        });
        expectSuccessfulTiming(timings);
        for (const phase of ['attachOutput', 'attachInput'])
          expect(state.events.indexOf(`observed-${phase}`)).toBeLessThan(
            state.events.indexOf('start'),
          );
        expect(state.events.filter((event) => event === 'start')).toHaveLength(
          1,
        );
        expect(
          state.events.filter((event) => event === 'stdin-eof'),
        ).toHaveLength(1);
        expect(state.requests).toHaveLength(4);
      } finally {
        controller.abort();
        await Promise.allSettled([pending]);
      }
    });
  },
);

test('Attaches output and stdin before starting; input EOF preserves independent output and demultiplexes fragmented UTF-8', async () => {
  const letter = Buffer.from('á');
  const prefix = frame(
    1,
    Buffer.concat([Buffer.from('head:'), letter.subarray(0, 1)]),
  );
  const tail = Buffer.concat([
    frame(2, 'error:é'),
    frame(1, Buffer.concat([letter.subarray(1), Buffer.from(' fin🧪')])),
  ]);
  await withDaemon(
    {
      // The first stream frame shares the HTTP101 write and exercises upgrade head.
      outputHead: prefix,
      afterInput(state) {
        // Exceed libuv's 50ms pipe EOF grace: output must survive on its own pipe.
        state.delay(80, () => {
          let offset = 0;
          const send = () => {
            if (offset === tail.length) {
              state.mark('output-end');
              state.output.end();
              return;
            }
            const end = Math.min(offset + 3, tail.length);
            state.output.write(tail.subarray(offset, end));
            offset = end;
            setImmediate(send);
          };
          send();
        });
      },
    },
    async (state) => {
      const timings = [];
      await expect(
        execute(state, { observeTiming: (event) => timings.push(event) }),
      ).resolves.toEqual({
        stdout: 'head:á fin🧪',
        stderr: 'error:é',
        exitCode: 0,
      });
      expectSuccessfulTiming(timings);
      expect(state.events.slice(0, 4)).toEqual([
        'output-attach',
        'stdin-attach',
        'start',
        'start-response',
      ]);
      expect(state.events.indexOf('stdin-data')).toBeGreaterThan(
        state.events.indexOf('start-response'),
      );
      expect(state.events.indexOf('output-end')).toBeGreaterThan(
        state.events.indexOf('stdin-eof'),
      );
      expect(Buffer.concat(state.input).toString()).toBe(
        JSON.stringify({ code: 'module.exports.solve=()=>1', args: [] }),
      );
      expect(state.requests).toEqual([
        {
          method: 'POST',
          url: '/v1.45/containers/fixture-capsule/attach?stream=1&logs=0&stdin=0&stdout=1&stderr=1',
        },
        {
          method: 'POST',
          url: '/v1.45/containers/fixture-capsule/attach?stream=1&logs=0&stdin=1&stdout=0&stderr=0',
        },
        { method: 'POST', url: '/v1.45/containers/fixture-capsule/start' },
        {
          method: 'POST',
          url: '/v1.45/containers/fixture-capsule/wait?condition=not-running',
        },
      ]);
    },
  );
});

test('Accepts coalesced stdout/stderr frames at the exact combined byte limit', async () => {
  await withDaemon(
    {
      afterInput: ({ output }) =>
        output.end(Buffer.concat([frame(1, 'abc'), frame(2, 'dé'), frame(1)])),
    },
    async (state) => {
      await expect(execute(state, { maxBytes: 6 })).resolves.toEqual({
        stdout: 'abc',
        stderr: 'dé',
        exitCode: 0,
      });
    },
  );
});

test.each([
  ['partial header', Buffer.from([1, 0, 0])],
  ['partial payload', frame(1, 'abc').subarray(0, 10)],
  ['stdin frame', frame(0, 'untrusted')],
  ['unknown frame type', frame(3, 'untrusted')],
  ['reserved header bytes', Buffer.from([1, 1, 0, 0, 0, 0, 0, 0])],
  [
    'length larger than budget',
    Buffer.from([1, 0, 0, 0, 0xff, 0xff, 0xff, 0xff]),
  ],
  [
    'combined stdout/stderr overflow',
    Buffer.concat([frame(1, '12345'), frame(2, '6789')]),
  ],
  ['unbounded empty-frame overhead', Buffer.alloc(8 * 8194).fill(frame(1))],
])('Rejects %s without returning partial output', async (_label, bytes) => {
  await withDaemon(
    { afterInput: ({ output }) => output.end(bytes) },
    async (state) => {
      await expect(execute(state, { maxBytes: 8 })).rejects.toThrow(
        'Local Docker attachment failed',
      );
      expect(state.events.filter((event) => event === 'start')).toHaveLength(1);
    },
  );
});

test.each([
  ['ordinary HTTP response', 'HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}'],
  [
    'missing content type',
    'HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n\r\n',
  ],
  [
    'wrong content type',
    'HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: tcp\r\nContent-Type: text/plain\r\n\r\n',
  ],
  [
    'wrong protocol',
    'HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nContent-Type: application/vnd.docker.raw-stream\r\n\r\n',
  ],
])('Requires a valid attachment upgrade: %s', async (_label, rejection) => {
  await withDaemon({ rejectRole: 'output', rejection }, async (state) => {
    await expect(execute(state)).rejects.toThrow(
      'Local Docker attachment failed',
    );
    expect(state.events).toContain('output-attach');
    expect(state.events).not.toContain('start');
    expect(state.requests.length).toBeLessThanOrEqual(2);
    expect(state.input).toEqual([]);
  });
});

test.each(
  ['output', 'stdin'].flatMap((failedRole) =>
    ['held', 'ready', 'resolving'].map((peerState) => [failedRole, peerState]),
  ),
)(
  'Rejecting %s releases a %s peer without starting or waiting for the deadline',
  async (failedRole, peerState) => {
    await withDaemon(
      {
        holdHandshakes: ['output', 'stdin'],
        rejectRole: failedRole,
        rejection: 'HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n',
      },
      async (state) => {
        const controller = new AbortController();
        const timings = [];
        const pending = execute(state, {
          signal: controller.signal,
          observeTiming(event) {
            timings.push(event);
            state.mark(`observed-${event.phase}`);
          },
        });
        void pending.catch(() => {});
        try {
          await within(
            Promise.all([
              state.stage('output-attach'),
              state.stage('stdin-attach'),
            ]),
            'A handshake remained serialized behind its sibling',
          );
          const peer = failedRole === 'output' ? 'stdin' : 'output';
          const peerPhase = peer === 'output' ? 'attachOutput' : 'attachInput';
          if (peerState === 'ready') {
            state.handshakes[peer]();
            await within(
              state.stage(`observed-${peerPhase}`),
              'Peer handshake was not ready before failure',
            );
          }
          state.handshakes[failedRole]();
          if (peerState === 'resolving') state.handshakes[peer]();
          await within(
            expect(pending).rejects.toThrow('Local Docker attachment failed'),
            'Handshake failure did not release its peer',
          );
          expectAttachmentTiming(timings);
          expect(
            timings.find((event) => event.phase !== peerPhase).completed,
          ).toBe(false);
          if (peerState !== 'resolving')
            expect(
              timings.find((event) => event.phase === peerPhase).completed,
            ).toBe(peerState === 'ready');
          expect(state.events).not.toContain('start');
          expect(state.input).toEqual([]);
          expect(state.requests).toHaveLength(2);
        } finally {
          controller.abort();
          await Promise.allSettled([pending]);
        }
      },
    );
  },
);

test.each(['output', 'stdin'])(
  'Simultaneous upgrade rejections are both settled with %s released first',
  async (first) => {
    await withDaemon(
      {
        holdHandshakes: ['output', 'stdin'],
        rejectRoles: ['output', 'stdin'],
        rejection: 'HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n',
      },
      async (state) => {
        const controller = new AbortController();
        const timings = [];
        const pending = execute(state, {
          signal: controller.signal,
          observeTiming: (event) => timings.push(event),
        });
        void pending.catch(() => {});
        try {
          await within(
            Promise.all([
              state.stage('output-attach'),
              state.stage('stdin-attach'),
            ]),
            'A handshake remained serialized behind its sibling',
          );
          state.handshakes[first]();
          state.handshakes[first === 'output' ? 'stdin' : 'output']();
          await within(
            expect(pending).rejects.toThrow('Local Docker attachment failed'),
            'Concurrent rejections were not settled',
          );
          expectAttachmentTiming(timings);
          expect(timings.every((event) => !event.completed)).toBe(true);
          expect(state.events).not.toContain('start');
          expect(state.input).toEqual([]);
          expect(state.requests).toHaveLength(2);
        } finally {
          controller.abort();
          await Promise.allSettled([pending]);
        }
      },
    );
  },
);

test.each(['output-handshake', 'stdin-handshake', 'start', 'stream', 'wait'])(
  'Cancellation during %s stops the exchange without retries',
  async (hold) => {
    await withDaemon({ hold }, async (state) => {
      const controller = new AbortController();
      const timings = [];
      const pending = execute(state, {
        signal: controller.signal,
        observeTiming: (event) => timings.push(event),
      });
      const rejected = expect(pending).rejects.toThrow();
      const reached =
        hold === 'stream' ? 'stdin-eof' : hold.replace('-handshake', '-attach');
      await state.stage(reached);
      controller.abort();
      await rejected;
      const phase = {
        'output-handshake': 'attachOutput',
        'stdin-handshake': 'attachInput',
        start: 'start',
        stream: 'streams',
        wait: 'wait',
      }[hold];
      expect(timings.find((event) => event.phase === phase)).toMatchObject({
        phase,
        completed: false,
      });
      expect(state.events.filter((event) => event === 'start')).toHaveLength(
        ['start', 'stream', 'wait'].includes(hold) ? 1 : 0,
      );
    });
  },
);

test.each(['output-handshake', 'stdin-handshake', 'start', 'stream', 'wait'])(
  'Deadline during %s stops the exchange without retries',
  async (hold) => {
    await withDaemon({ hold }, async (state) => {
      await expect(execute(state, { timeoutMs: 200 })).rejects.toThrow();
      const reached =
        hold === 'stream' ? 'stdin-eof' : hold.replace('-handshake', '-attach');
      expect(state.events).toContain(reached);
      expect(state.events.filter((event) => event === 'start')).toHaveLength(
        ['start', 'stream', 'wait'].includes(hold) ? 1 : 0,
      );
    });
  },
);

test.each(['cancellation', 'deadline'])(
  'Both pending handshakes settle on %s before any start or input',
  async (termination) => {
    await withDaemon({ holdHandshakes: ['output', 'stdin'] }, async (state) => {
      const controller = new AbortController();
      const timings = [];
      const pending = execute(state, {
        signal: controller.signal,
        timeoutMs: termination === 'deadline' ? 200 : 2000,
        observeTiming: (event) => timings.push(event),
      });
      void pending.catch(() => {});
      try {
        await within(
          Promise.all([
            state.stage('output-attach'),
            state.stage('stdin-attach'),
          ]),
          'Both handshakes did not begin before termination',
        );
        if (termination === 'cancellation') controller.abort();
        await within(
          expect(pending).rejects.toThrow(),
          'Termination did not settle both pending handshakes',
        );
        expectAttachmentTiming(timings);
        expect(timings.every((event) => !event.completed)).toBe(true);
        expect(state.events).not.toContain('start');
        expect(state.input).toEqual([]);
        expect(state.requests).toHaveLength(2);
      } finally {
        controller.abort();
        await Promise.allSettled([pending]);
      }
    });
  },
);

test('A lost POST start response never retries start or delivers input', async () => {
  await withDaemon({ dropStart: true }, async (state) => {
    const timings = [];
    await expect(
      execute(state, { observeTiming: (event) => timings.push(event) }),
    ).rejects.toThrow('Local Docker request failed');
    expectAttachmentTiming(timings, ['start']);
    expect(timings.map((event) => event.completed)).toEqual([
      true,
      true,
      false,
    ]);
    expect(state.events).toEqual(['output-attach', 'stdin-attach', 'start']);
    expect(state.input).toEqual([]);
  });
});

test.each([304, 404, 500])(
  'A start status %i fails without delivering input',
  async (startStatus) => {
    await withDaemon({ startStatus }, async (state) => {
      await expect(execute(state)).rejects.toThrow('Docker start failed');
      expect(state.events.filter((event) => event === 'start')).toHaveLength(1);
      expect(state.input).toEqual([]);
    });
  },
);

test('Input byte limit is inclusive and rejects oversized UTF-8 or prior cancellation before any IPC', async () => {
  await withDaemon({}, async (state) => {
    await expect(execute(state, { input: 'é'.repeat(131073) })).rejects.toThrow(
      'Invalid Docker attachment input',
    );
    const controller = new AbortController();
    controller.abort();
    await expect(
      execute(state, { signal: controller.signal }),
    ).rejects.toThrow();
    expect(state.requests).toEqual([]);
    await expect(
      execute(state, { input: 'é'.repeat(131072) }),
    ).resolves.toEqual({ stdout: 'result', stderr: '', exitCode: 0 });
    expect(Buffer.concat(state.input).byteLength).toBe(262144);
    expect(Buffer.concat(state.input).toString()).toBe('é'.repeat(131072));
  });
});

test.each([
  { maxBytes: 0 },
  { maxBytes: -1 },
  { maxBytes: 1.5 },
  { maxBytes: 524289 },
  { maxBytes: Infinity },
  { maxBytes: NaN },
  { timeoutMs: 0 },
  { timeoutMs: 30001 },
  { timeoutMs: Infinity },
  { timeoutMs: NaN },
  { input: null },
])(
  'Rejects invalid transport budgets or input before opening IPC: %p',
  async (options) => {
    await withDaemon({}, async (state) => {
      await expect(execute(state, options)).rejects.toThrow(
        'Invalid Docker attachment input',
      );
      expect(state.requests).toEqual([]);
    });
  },
);

test('A malformed output frame aborts a sibling handshake without waiting for the operation deadline', async () => {
  await withDaemon({ hold: 'stdin-handshake' }, async (state) => {
    const pending = execute(state);
    const rejected = expect(pending).rejects.toThrow(
      'Local Docker attachment failed',
    );
    await state.stage('stdin-attach');
    state.output.write(frame(3, 'unexpected'));
    // The deadline sentinel only observes a hung sibling; it never cancels it.
    let timer;
    try {
      await Promise.race([
        rejected,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Sibling handshake was not aborted')),
            500,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    expect(state.events).toEqual(['output-attach', 'stdin-attach']);
    expect(state.input).toEqual([]);
  });
});

test.each(['unexpected output', 'premature EOF'])(
  'Stdin %s aborts a pending output handshake before start',
  async (failure) => {
    await withDaemon({ hold: 'output-handshake' }, async (state) => {
      const controller = new AbortController();
      const timings = [];
      const pending = execute(state, {
        signal: controller.signal,
        observeTiming(event) {
          timings.push(event);
          state.mark(`observed-${event.phase}`);
        },
      });
      void pending.catch(() => {});
      try {
        await within(
          Promise.all([
            state.stage('output-attach'),
            state.stage('observed-attachInput'),
          ]),
          'Stdin handshake remained blocked behind output',
        );
        if (failure === 'premature EOF') state.stdin.end();
        else state.stdin.write(frame(1, 'unexpected'));
        await within(
          expect(pending).rejects.toThrow('Local Docker attachment failed'),
          'Stdin failure did not abort the output handshake',
        );
        expectAttachmentTiming(timings);
        expect(
          timings.find((event) => event.phase === 'attachInput'),
        ).toMatchObject({ completed: true });
        expect(
          timings.find((event) => event.phase === 'attachOutput'),
        ).toMatchObject({ completed: false });
        expect(state.events).not.toContain('start');
        expect(state.input).toEqual([]);
        expect(state.requests).toHaveLength(2);
      } finally {
        controller.abort();
        await Promise.allSettled([pending]);
      }
    });
  },
);

test('Output EOF does not confirm completion until wait returns the independent exit code', async () => {
  await withDaemon(
    {
      hold: 'wait',
      afterInput(state) {
        state.mark('output-end');
        state.output.end(frame(1, 'captured'));
      },
    },
    async (state) => {
      let settled = false;
      const timings = [];
      const pending = execute(state, {
        observeTiming(event) {
          timings.push(event);
          if (event.phase === 'streams') state.mark('streams-observed');
        },
      }).finally(() => {
        settled = true;
      });
      void pending.catch(() => {});
      await within(
        Promise.all([state.stage('wait'), state.stage('streams-observed')]),
        'Output EOF and wait were not observed',
      );
      expect(settled).toBe(false);
      expect(timings.find((event) => event.phase === 'streams')).toMatchObject({
        completed: true,
      });
      expect(timings.some((event) => event.phase === 'wait')).toBe(false);
      state.replyWait({ StatusCode: 7 });
      await expect(pending).resolves.toEqual({
        stdout: 'captured',
        stderr: '',
        exitCode: 7,
      });
      expectSuccessfulTiming(timings);
      expect(state.events.filter((event) => event === 'wait')).toHaveLength(1);
    },
  );
});

test('Wait is requested before output EOF and an early acknowledgement still waits for the complete tail', async () => {
  await withDaemon(
    { hold: 'wait', outputHead: frame(1, 'head:'), afterInput() {} },
    async (state) => {
      let settled = false;
      const timings = [];
      const pending = execute(state, {
        observeTiming(event) {
          timings.push(event);
          if (event.phase === 'wait') state.mark('wait-observed');
        },
      }).finally(() => {
        settled = true;
      });
      void pending.catch(() => {});
      await within(
        state.stage('wait'),
        'Wait was serialized behind output EOF',
      );
      expect(state.events).not.toContain('output-end');
      expect(settled).toBe(false);
      state.replyWait({ StatusCode: 7 });
      await within(
        state.stage('wait-observed'),
        'Wait acknowledgement was not observed',
      );
      expect(timings.find((event) => event.phase === 'wait')).toMatchObject({
        completed: true,
      });
      expect(timings.some((event) => event.phase === 'streams')).toBe(false);
      expect(settled).toBe(false);
      state.output.write(frame(1, 'tail'));
      await new Promise((resolve) => setImmediate(resolve));
      expect(settled).toBe(false);
      state.mark('output-end');
      state.output.end();
      await expect(pending).resolves.toEqual({
        stdout: 'head:tail',
        stderr: '',
        exitCode: 7,
      });
      expectSuccessfulTiming(timings);
      expect(state.events.indexOf('wait')).toBeLessThan(
        state.events.indexOf('output-end'),
      );
      expect(state.events.filter((event) => event === 'start')).toHaveLength(1);
      expect(
        state.events.filter((event) => event === 'stdin-eof'),
      ).toHaveLength(1);
      expect(state.events.filter((event) => event === 'wait')).toHaveLength(1);
    },
  );
});

test.each([
  ['invalid acknowledgement', { waitStatus: 500 }, 'Docker exit unconfirmed'],
  ['lost response', { dropWait: true }, 'Local Docker request failed'],
])(
  'A wait %s aborts pending output without waiting for its EOF or retrying',
  async (_label, options, failure) => {
    await withDaemon({ ...options, hold: 'stream' }, async (state) => {
      const timings = [];
      const pending = execute(state, {
        observeTiming: (event) => timings.push(event),
      });
      await within(
        expect(pending).rejects.toThrow(failure),
        'Wait failure remained blocked behind output EOF',
      );
      await within(
        state.stage('stdin-eof'),
        'Input EOF was not observed after the wait failure',
      );
      expect(timings.find((event) => event.phase === 'wait')).toMatchObject({
        completed: false,
      });
      expect(timings.find((event) => event.phase === 'streams')).toMatchObject({
        completed: false,
      });
      expect(state.events).not.toContain('output-end');
      expect(state.events.filter((event) => event === 'start')).toHaveLength(1);
      expect(
        state.events.filter((event) => event === 'stdin-eof'),
      ).toHaveLength(1);
      expect(state.events.filter((event) => event === 'wait')).toHaveLength(1);
    });
  },
);

test.each([
  ['non-success HTTP status', { waitStatus: 500 }],
  ['missing status', { waitBody: {} }],
  ['fractional status', { waitBody: { StatusCode: 0.5 } }],
  ['string status', { waitBody: { StatusCode: '0' } }],
  ['null body', { waitBody: null }],
  [
    'daemon error',
    {
      waitBody: {
        StatusCode: 0,
        Error: { Message: 'private daemon diagnostic' },
      },
    },
  ],
  ['malformed error', { waitBody: { StatusCode: 0, Error: {} } }],
])(
  'Rejects wait %s instead of accepting the captured result',
  async (_label, options) => {
    await withDaemon(options, async (state) => {
      await expect(execute(state)).rejects.toThrow('Docker exit unconfirmed');
      expect(state.events.filter((event) => event === 'start')).toHaveLength(1);
      expect(state.events.filter((event) => event === 'wait')).toHaveLength(1);
    });
  },
);

test.each([null, { Message: '' }])(
  'Accepts an empty wait error representation: %p',
  async (error) => {
    await withDaemon(
      { waitBody: { StatusCode: 0, Error: error } },
      async (state) => {
        await expect(execute(state)).resolves.toEqual({
          stdout: 'result',
          stderr: '',
          exitCode: 0,
        });
      },
    );
  },
);

test('A lost wait response never repeats start, input delivery or wait', async () => {
  await withDaemon({ dropWait: true }, async (state) => {
    await expect(execute(state)).rejects.toThrow('Local Docker request failed');
    await within(
      state.stage('stdin-eof'),
      'Input EOF was not observed after the lost wait response',
    );
    expect(state.events.filter((event) => event === 'start')).toHaveLength(1);
    expect(state.events.filter((event) => event === 'stdin-eof')).toHaveLength(
      1,
    );
    expect(state.events.filter((event) => event === 'wait')).toHaveLength(1);
  });
});

test.each(['throw', 'rejected promise'])(
  'An observer %s preserves the attachment result, single delivery and socket cleanup',
  async (kind) => {
    await withDaemon({}, async (state) => {
      const observeTiming = jest.fn(() => {
        if (kind === 'throw') throw new Error('private observer failure');
        return Promise.reject(new Error('private observer failure'));
      });
      await expect(execute(state, { observeTiming })).resolves.toEqual({
        stdout: 'result',
        stderr: '',
        exitCode: 0,
      });
      await new Promise((resolve) => setImmediate(resolve));
      expectSuccessfulTiming(observeTiming.mock.calls.map(([event]) => event));
      expect(state.events.filter((event) => event === 'start')).toHaveLength(1);
      expect(
        state.events.filter((event) => event === 'stdin-eof'),
      ).toHaveLength(1);
      expect(state.events.filter((event) => event === 'wait')).toHaveLength(1);
    });
  },
);

test('An asynchronously rejected observer cannot mask a transport failure or retain attachments', async () => {
  await withDaemon({ dropStart: true }, async (state) => {
    const observeTiming = jest.fn(() =>
      Promise.reject(new Error('private observer failure')),
    );
    await expect(execute(state, { observeTiming })).rejects.toThrow(
      'Local Docker request failed',
    );
    await new Promise((resolve) => setImmediate(resolve));
    expectAttachmentTiming(
      observeTiming.mock.calls.map(([event]) => event),
      ['start'],
    );
    expect(observeTiming.mock.calls.at(-1)[0].completed).toBe(false);
    expect(state.events).toEqual(['output-attach', 'stdin-attach', 'start']);
    expect(state.input).toEqual([]);
  });
});
