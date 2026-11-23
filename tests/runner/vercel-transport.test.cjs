const { randomUUID } = require('node:crypto');
const { ReadableStream } = require('node:stream/web');
let VercelAdapter, Sandbox;
const image = 'runner@sha256:' + 'a'.repeat(64);
const digest = 'sha256:' + 'c'.repeat(64);
const repository = 'fixture-team/fixture-project/practice-runner';
const canonicalImage = `${repository}@${digest}`;
let originalFetch,
  calls,
  metadata,
  session,
  deleted,
  mode,
  driverCalls,
  driverResults,
  fileResponse,
  bootstrapCapabilities,
  createResponse;
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
const input = () => ({
  executionId: randomUUID(),
  code: 'module.exports.solve=()=>true;',
  args: [],
  budgetMs: 3000,
  outputRemaining: 65536,
});
const capsule = () => ({
  packet: {
    status: 'exited',
    runtimeMs: 10,
    outputBytes: 0,
    stdout: '',
    stderr: '',
    outputTruncated: false,
    exitCode: 0,
    signal: null,
    returnData: Buffer.from(
      JSON.stringify({
        kind: 'value',
        value: true,
        invocation: 'QUICKJS_SYNC_CALL',
      }),
    ).toString('base64'),
    cgroup: {
      'memory.max': '134217728',
      'memory.swap.max': '0',
      'pids.max': '32',
      'cpu.max': '100000 100000',
    },
  },
  exitCode: 0,
  oomKilled: false,
  timedOut: false,
  cancelled: false,
  cleanupVerified: true,
  programWallMs: 10,
  containerWallMs: 10,
  lifecycleMs: 20,
  image: 'sha256:' + 'b'.repeat(64),
});
function commandResponse(body) {
  const command = {
    id: 'cmd_test',
    name: body.command,
    args: body.args,
    cwd: '/vercel/sandbox',
    sessionId: session.id,
    startedAt: Date.now(),
    exitCode: null,
  };
  const lines = [{ command }];
  const bootstrap = body.args[0].endsWith('remote-init.mjs');
  const driver = !bootstrap && driverResults[body.args[1]];
  const exitCode =
    bootstrap && mode === 'bootstrap-node-unavailable'
      ? 127
      : (driver?.exitCode ?? 0);
  if (bootstrap && exitCode === 0)
    lines.push({
      stream: 'stdout',
      data: JSON.stringify({
        ready: true,
        node: 'v24.21.0',
        image: 'sha256:' + 'b'.repeat(64),
        ...bootstrapCapabilities,
      }),
    });
  else if (!bootstrap) {
    driverCalls.push(body.args);
    lines.push(...(driver?.logs ?? []));
  }
  lines.push({ command: { ...command, exitCode } });
  return new Response(
    lines.map((line) => JSON.stringify(line)).join('\n') + '\n',
    { headers: { 'content-type': 'application/x-ndjson' } },
  );
}
beforeAll(async () => {
  originalFetch = globalThis.fetch;
  ({ VercelAdapter } = await import('../../packages/runner/dist/vercel.js'));
  ({ Sandbox } = await import('@vercel/sandbox'));
});
afterAll(() => {
  globalThis.fetch = originalFetch;
});
beforeEach(() => {
  calls = [];
  deleted = false;
  mode = 'normal';
  driverCalls = [];
  driverResults = {};
  fileResponse = () =>
    new Response(JSON.stringify(capsule()), {
      headers: { 'content-type': 'application/octet-stream' },
    });
  bootstrapCapabilities = {};
  createResponse = { sandbox: {}, session: {} };
  globalThis.fetch = jest.fn(async (url, init) => {
    const address = new URL(url),
      path = address.pathname;
    calls.push({
      path,
      method: init.method,
      resume: address.searchParams.get('resume'),
    });
    expect(address.origin).toBe('https://vercel.com');
    if (path === '/api/v3/sandboxes' && init.method === 'POST') {
      const body = JSON.parse(init.body),
        now = Date.now();
      session = {
        id: 'sbx_real_sdk_fixture',
        vcpus: 1,
        memory: 2048,
        region: 'iad1',
        timeout: body.timeout,
        status: 'running',
        requestedAt: now,
        createdAt: now,
        updatedAt: now,
        cwd: '/vercel/sandbox',
        ...createResponse.session,
      };
      metadata = {
        name: body.name,
        persistent: false,
        region: body.region,
        vcpus: 1,
        memory: 2048,
        image: body.image,
        timeout: body.timeout,
        networkPolicy: { mode: 'deny-all' },
        tags: body.tags,
        currentSessionId: session.id,
        status: 'running',
        createdAt: now,
        updatedAt: now,
        ...createResponse.sandbox,
      };
      if (mode === 'lost-create')
        return json({ error: { message: 'uncertain create' } }, 503);
      return json({ sandbox: metadata, session, routes: [] });
    }
    if (path === `/api/v2/sandboxes/${metadata?.name}`) {
      if (init.method === 'DELETE') {
        deleted = true;
        return json({ sandbox: { ...metadata, status: 'stopped' } });
      }
      if (deleted) return json({ error: { message: 'missing' } }, 404);
      return json({ sandbox: metadata, session, routes: [] });
    }
    if (path === '/api/v2/sandboxes/snapshots')
      return json({ snapshots: [], pagination: { count: 0, next: null } });
    if (path === `/api/v2/sandboxes/sessions/${session?.id}/stop`)
      return json({
        session: { ...session, status: 'stopped' },
        sandbox: { ...metadata, status: 'stopped' },
      });
    if (path.endsWith('/fs/write')) return json({});
    if (path.endsWith('/fs/read')) return fileResponse();
    if (path.endsWith('/cmd')) {
      if (mode === 'stopped')
        return json({ error: { message: 'stopped' } }, 410);
      return commandResponse(JSON.parse(init.body));
    }
    throw new Error('Unmodeled request; network is disabled by this fixture');
  });
});
const config = () => ({
  authorized: true,
  expiresAtMs: Date.now() + 120000,
  token: 'fixture-token',
  teamId: 'team_fixture',
  projectId: 'prj_fixture',
  image,
  region: 'iad1',
  recordCorrelation: jest.fn(async () => {}),
  recordResource: jest.fn(async () => {}),
  allowRequest: jest.fn(async () => {}),
  assertActive: jest.fn(async () => {}),
});

function sessionCommands() {
  return globalThis.fetch.mock.calls
    .filter(
      ([url, init]) =>
        init.method === 'POST' &&
        new URL(url).pathname ===
          `/api/v2/sandboxes/sessions/${session.id}/cmd`,
    )
    .map(([, init]) => JSON.parse(init.body));
}

test('installed SDK uses /api/v3 and bounded private file transport through the admitted session', async () => {
  const settings = config(),
    adapter = new VercelAdapter(settings);
  expect(await adapter.execute(input())).toEqual(capsule());
  expect(settings.recordResource).toHaveBeenCalledWith(
    expect.objectContaining({ sandboxId: session.id }),
  );
  const commands = sessionCommands();
  expect(commands).toHaveLength(3);
  const inputFile = commands[1].args[2];
  expect(inputFile).toMatch(
    /^\/vercel\/sandbox\/alunza-input-[a-f0-9-]{36}\.json$/,
  );
  const outputFile = inputFile.replace('alunza-input-', 'alunza-result-');
  const driver = '/opt/alunza/supervisor/remote-driver.mjs';
  const common = {
    command: '/usr/local/bin/node',
    sudo: true,
    wait: true,
    logs: true,
    timeout: expect.any(Number),
  };
  expect(commands).toEqual([
    {
      ...common,
      args: ['/opt/alunza/supervisor/remote-init.mjs'],
      env: { ALUNZA_SANDBOX_BOOTSTRAP: '1' },
    },
    {
      ...common,
      args: [
        driver,
        'execute',
        inputFile,
        outputFile,
        expect.stringMatching(/^--deadline-ms=\d+$/),
      ],
      env: {},
    },
    { ...common, args: [driver, 'cleanup', inputFile, outputFile], env: {} },
  ]);
  for (const { timeout } of commands) {
    expect(timeout).toBeGreaterThan(0);
    expect(timeout).toBeLessThanOrEqual(30000);
  }
  expect(calls.filter((call) => call.path.endsWith('/fs/read'))).toHaveLength(
    1,
  );
  await adapter.close();
  expect(adapter.evidence).toMatchObject({
    createDispatches: 1,
    cleanupVerified: true,
  });
  expect(
    calls.filter((call) => call.path === '/api/v3/sandboxes'),
  ).toHaveLength(1);
});

test('unavailable supervisor Node ends bootstrap without dispatching a fallback command', async () => {
  mode = 'bootstrap-node-unavailable';
  const adapter = new VercelAdapter(config());
  try {
    await expect(adapter.execute(input())).rejects.toThrow(
      'Nested Docker bootstrap capability gap',
    );
    expect(
      sessionCommands().map(({ command, args }) => [command, ...args]),
    ).toEqual([
      ['/usr/local/bin/node', '/opt/alunza/supervisor/remote-init.mjs'],
    ]);
    expect(calls.some(({ path }) => path.endsWith('/fs/write'))).toBe(false);
  } finally {
    await adapter.close();
  }
  expect(adapter.evidence.cleanupVerified).toBe(true);
  expect(adapter.evidence.driverCommand).toBeNull();
  expect(adapter.evidence.driverCleanupCommand).toBeNull();
});

const fixedMarker = 'REMOTE_CAPSULE_FAILED\n';
const silentCommand = {
  exitCode: 0,
  stdoutPresent: false,
  stderrPresent: false,
  failureMarker: false,
  phase: null,
};
const stdout = (data) => ({ stream: 'stdout', data });
const stderr = (data) => ({ stream: 'stderr', data });
const startReceipt = {
  kind: 'START_FAILURE',
  schemaVersion: 1,
  detail: {
    httpStatus: 500,
    outcome: 'HTTP_RESPONSE',
    runtimeCause: null,
    containerState: 'created',
    hasStarted: false,
    oomKilled: false,
  },
};
const privateResponse = (body) =>
  new Response(body, {
    headers: { 'content-type': 'application/octet-stream' },
  });
const startCommand = { exitCode: 75, logs: [stderr(fixedMarker)] };

test.each([
  ['valid receipt', () => privateResponse(JSON.stringify(startReceipt)), true],
  [
    'unrecognized key',
    () =>
      privateResponse(
        JSON.stringify({ ...startReceipt, extra: 'PRIVATE_SENTINEL' }),
      ),
    false,
  ],
  [
    'foreign detail',
    () =>
      privateResponse(
        JSON.stringify({
          ...startReceipt,
          detail: { ...startReceipt.detail, runtimeCause: 'PRIVATE_SENTINEL' },
        }),
      ),
    false,
  ],
  [
    'wrong version',
    () =>
      privateResponse(JSON.stringify({ ...startReceipt, schemaVersion: 2 })),
    false,
  ],
  ['student envelope', () => privateResponse(JSON.stringify(capsule())), false],
  ['malformed JSON', () => privateResponse('PRIVATE_SENTINEL'), false],
  [
    'exactly 4 KiB',
    () => privateResponse(JSON.stringify(startReceipt).padEnd(4096)),
    true,
  ],
  [
    'over 4 KiB',
    () => privateResponse(JSON.stringify(startReceipt).padEnd(4097)),
    false,
  ],
  ['missing receipt', () => json({ error: 'PRIVATE_SENTINEL' }, 404), false],
  [
    'retryable provider error',
    () => json({ error: 'PRIVATE_SENTINEL' }, 503),
    false,
  ],
  [
    'network error',
    () => {
      throw Error('PRIVATE_SENTINEL');
    },
    false,
  ],
])(
  'START attempts one private read for %s and keeps the execution failure',
  async (_case, read, valid) => {
    const settings = config(),
      adapter = new VercelAdapter(settings);
    driverResults.execute = startCommand;
    driverResults.cleanup = { exitCode: 85, logs: [stderr(fixedMarker)] };
    fileResponse = read;
    try {
      await expect(adapter.execute(input())).rejects.toThrow(
        'Remote capsule failed',
      );
    } finally {
      await adapter.close();
    }
    expect(adapter.evidence.driverCommand.phase).toBe('START');
    expect(adapter.evidence.driverStartFailure).toEqual(
      valid ? startReceipt.detail : null,
    );
    expect(adapter.evidence.driverCleanupCommand.phase).toBe('FILE_CLEANUP');
    expect(JSON.stringify(adapter.evidence)).not.toContain('PRIVATE_SENTINEL');
    expect(calls.filter((c) => c.path.endsWith('/fs/read'))).toHaveLength(1);
    expect(
      settings.allowRequest.mock.calls.filter(([cleanup]) => !cleanup),
    ).toHaveLength(6);
    expect(
      settings.allowRequest.mock.calls.filter(([cleanup]) => cleanup),
    ).toHaveLength(4);
    expect(adapter.evidence.cleanupVerified).toBe(true);
  },
);

test('lost lease before diagnostic read prevents that dispatch', async () => {
  const settings = config(),
    adapter = new VercelAdapter(settings);
  driverResults.execute = startCommand;
  settings.assertActive.mockImplementation(async () => {
    if (driverCalls.length) throw new Error('lease expired');
  });
  try {
    await expect(adapter.execute(input())).rejects.toThrow(
      'Remote capsule failed',
    );
  } finally {
    await adapter.close();
  }
  expect(calls.some((c) => c.path.endsWith('/fs/read'))).toBe(false);
  expect(adapter.evidence.driverStartFailure).toBeNull();
  expect(adapter.evidence.cleanupVerified).toBe(true);
});

test('late diagnostic cannot retain authority after the response arrives', async () => {
  const settings = config(),
    adapter = new VercelAdapter(settings);
  driverResults.execute = startCommand;
  let active = true;
  fileResponse = () => {
    active = false;
    return privateResponse(JSON.stringify(startReceipt));
  };
  settings.assertActive.mockImplementation(async () => {
    if (!active) throw new Error('lease expired');
  });
  try {
    await expect(adapter.execute(input())).rejects.toThrow(
      'Remote capsule failed',
    );
  } finally {
    await adapter.close();
  }
  expect(calls.filter((c) => c.path.endsWith('/fs/read'))).toHaveLength(1);
  expect(driverCalls.map((args) => args[1])).toEqual(['execute']);
  expect(adapter.evidence.driverStartFailure).toBeNull();
  expect(adapter.evidence.cleanupVerified).toBe(true);
});

test('a START receipt on the silent success path is rejected as an invalid result', async () => {
  const adapter = new VercelAdapter(config());
  fileResponse = () => privateResponse(JSON.stringify(startReceipt));
  try {
    await expect(adapter.execute(input())).rejects.toThrow(
      'Remote supervisor protocol invalid',
    );
  } finally {
    await adapter.close();
  }
  expect(adapter.evidence.driverStartFailure).toBeNull();
});

test('close during the final diagnostic lease check discards an already read receipt', async () => {
  const settings = config(),
    adapter = new VercelAdapter(settings);
  const checking = Promise.withResolvers(),
    release = Promise.withResolvers();
  let read = false;
  driverResults.execute = startCommand;
  fileResponse = () => {
    read = true;
    return privateResponse(JSON.stringify(startReceipt));
  };
  settings.assertActive.mockImplementation(async () => {
    if (read) {
      checking.resolve();
      await release.promise;
    }
  });
  const failed = expect(adapter.execute(input())).rejects.toThrow(
    'Remote capsule failed',
  );
  try {
    await checking.promise;
    await adapter.close();
    await failed;
    expect(adapter.evidence.driverStartFailure).toBeNull();
    expect(driverCalls.map((args) => args[1])).toEqual(['execute']);
    expect(adapter.evidence.cleanupVerified).toBe(true);
  } finally {
    release.resolve();
    await adapter.close();
  }
});

test('close cancels a stalled private diagnostic stream while cleaning the VM', async () => {
  const adapter = new VercelAdapter(config());
  const reading = Promise.withResolvers(),
    cancelled = Promise.withResolvers();
  driverResults.execute = startCommand;
  fileResponse = () =>
    privateResponse(
      new ReadableStream({
        pull() {
          reading.resolve();
        },
        cancel() {
          cancelled.resolve();
        },
      }),
    );
  const failed = expect(adapter.execute(input())).rejects.toThrow(
    'Remote capsule failed',
  );
  try {
    await reading.promise;
    await Promise.all([adapter.close(), cancelled.promise, failed]);
    expect(adapter.evidence.driverStartFailure).toBeNull();
    expect(adapter.evidence.cleanupVerified).toBe(true);
  } finally {
    await adapter.close();
  }
});

test('a diagnostic reservation outliving its lease cannot dispatch the file read', async () => {
  const settings = config(),
    adapter = new VercelAdapter(settings);
  let active = true;
  driverResults.execute = startCommand;
  settings.allowRequest.mockImplementation(async (cleanup) => {
    if (!cleanup && driverCalls.length) active = false;
  });
  settings.assertActive.mockImplementation(async () => {
    if (!active) throw new Error('worker fenced during reservation');
  });
  try {
    await expect(adapter.execute(input())).rejects.toThrow(
      'Remote capsule failed',
    );
  } finally {
    await adapter.close();
  }
  expect(calls.some((c) => c.path.endsWith('/fs/read'))).toBe(false);
  expect(adapter.evidence.driverStartFailure).toBeNull();
  expect(adapter.evidence.cleanupVerified).toBe(true);
});

test('START diagnostics are reset before the next case in the same sandbox', async () => {
  const adapter = new VercelAdapter(config());
  try {
    driverResults.execute = startCommand;
    fileResponse = () => privateResponse(JSON.stringify(startReceipt));
    await expect(adapter.execute(input())).rejects.toThrow(
      'Remote capsule failed',
    );
    expect(adapter.evidence.driverStartFailure).toEqual(startReceipt.detail);
    driverResults.execute = {
      exitCode: 75,
      logs: [stderr(fixedMarker + 'PRIVATE_SENTINEL')],
    };
    await expect(adapter.execute(input())).rejects.toThrow(
      'Remote capsule failed',
    );
    expect(adapter.evidence.driverCommand.phase).toBeNull();
    expect(adapter.evidence.driverStartFailure).toBeNull();
    expect(calls.filter((c) => c.path.endsWith('/fs/read'))).toHaveLength(1);
  } finally {
    await adapter.close();
  }
});

test.each([
  ['nonzero without output', 1, [], false, false, false, null],
  [
    'stdout only at zero',
    0,
    [stdout('PRIVATE_STDOUT')],
    true,
    false,
    false,
    null,
  ],
  [
    'stderr only at zero',
    0,
    [stderr('PRIVATE_STDERR')],
    false,
    true,
    false,
    null,
  ],
  [
    'both channels',
    1,
    [stdout('PRIVATE_STDOUT'), stderr('PRIVATE_STDERR')],
    true,
    true,
    false,
    null,
  ],
  [
    'reserved exit with split exact marker',
    71,
    [stderr('REMOTE_CAPSULE_'), stderr('FAILED\n')],
    false,
    true,
    true,
    'CREATE',
  ],
  [
    'unexpected stdout with the marker',
    71,
    [stdout('PRIVATE_STDOUT'), stderr(fixedMarker)],
    true,
    true,
    true,
    null,
  ],
  [
    'reserved exit plus decorated marker',
    71,
    [stderr(fixedMarker + 'PRIVATE_STDERR')],
    false,
    true,
    false,
    null,
  ],
  ['reserved exit without marker', 71, [], false, false, false, null],
  [
    'legacy exit with marker',
    1,
    [stderr(fixedMarker)],
    false,
    true,
    true,
    null,
  ],
  ['zero exit with marker', 0, [stderr(fixedMarker)], false, true, true, null],
  [
    'cleanup-only exit on execute',
    85,
    [stderr(fixedMarker)],
    false,
    true,
    true,
    null,
  ],
  ['out-of-range exit', 1000, [], false, false, false, null],
])(
  'driver evidence for %s uses only the cached command result',
  async (
    _name,
    exitCode,
    logs,
    stdoutPresent,
    stderrPresent,
    failureMarker,
    phase,
  ) => {
    driverResults.execute = { exitCode, logs };
    const settings = config();
    const adapter = new VercelAdapter(settings);
    try {
      await expect(adapter.execute(input())).rejects.toThrow(
        'Remote capsule failed',
      );
    } finally {
      await adapter.close();
    }
    expect(adapter.evidence.driverCommand).toEqual({
      exitCode: exitCode > 255 ? null : exitCode,
      stdoutPresent,
      stderrPresent,
      failureMarker,
      phase,
    });
    expect(adapter.evidence.driverCleanupCommand).toEqual(silentCommand);
    expect(JSON.stringify(adapter.evidence)).not.toMatch(
      /PRIVATE_STD|REMOTE_CAPSULE_FAILED/,
    );
    expect(driverCalls.map((args) => args[1])).toEqual(['execute', 'cleanup']);
    expect(calls.some((call) => call.path.endsWith('/fs/read'))).toBe(false);
    expect(calls).toHaveLength(9);
    expect(
      settings.allowRequest.mock.calls.map(([cleanup]) => cleanup),
    ).toEqual([false, false, false, false, false, true, true, true, true]);
    expect(adapter.evidence.cleanupVerified).toBe(true);
  },
);

test.each([
  [
    'valid CPU quota and period flags',
    { cpuCfsQuota: false, cpuCfsPeriod: true },
    false,
    true,
  ],
  ['absent capability flags', {}, null, null],
  ['non-boolean flags', { cpuCfsQuota: 'true', cpuCfsPeriod: 1 }, null, null],
])(
  '%s are observed independently of driver success',
  async (_name, capabilities, quota, period) => {
    bootstrapCapabilities = capabilities;
    const adapter = new VercelAdapter(config());
    try {
      expect(await adapter.execute(input())).toEqual(capsule());
    } finally {
      await adapter.close();
    }
    expect(adapter.evidence).toMatchObject({
      cpuCfsQuota: quota,
      cpuCfsPeriod: period,
      driverCommand: silentCommand,
      driverCleanupCommand: silentCommand,
    });
    expect(calls).toHaveLength(10);
  },
);

test.each([
  ['successful execute', true, 85, 'FILE_CLEANUP'],
  ['failed execute', false, 85, 'FILE_CLEANUP'],
  ['execute-only exit on cleanup', true, 71, null],
])(
  'file cleanup after %s retains the primary error and separate command evidence',
  async (_name, success, cleanupExit, cleanupPhase) => {
    if (!success)
      driverResults.execute = { exitCode: 69, logs: [stderr(fixedMarker)] };
    driverResults.cleanup = {
      exitCode: cleanupExit,
      logs: [stderr(fixedMarker)],
    };
    const adapter = new VercelAdapter(config());
    try {
      await expect(adapter.execute(input())).rejects.toThrow(
        success ? 'Private result cleanup failed' : 'Remote capsule failed',
      );
    } finally {
      await adapter.close();
    }
    expect(adapter.evidence.driverCommand).toEqual(
      success
        ? silentCommand
        : {
            exitCode: 69,
            stdoutPresent: false,
            stderrPresent: true,
            failureMarker: true,
            phase: 'ENGINE_RESOLVE',
          },
    );
    expect(adapter.evidence.driverCleanupCommand).toEqual({
      exitCode: cleanupExit,
      stdoutPresent: false,
      stderrPresent: true,
      failureMarker: true,
      phase: cleanupPhase,
    });
    expect(adapter.evidence.cleanupVerified).toBe(true);
    expect(calls).toHaveLength(success ? 10 : 9);
  },
);

test('the canonical team/project/repository and digest reach the image bootstrap before any upload', async () => {
  // Model the provider's canonical response independently of the request body.
  createResponse.sandbox = { image: canonicalImage };
  const adapter = new VercelAdapter({ ...config(), image: canonicalImage });
  try {
    await adapter.execute(input());
    const [url, init] = globalThis.fetch.mock.calls[0];
    expect(new URL(url).pathname).toBe('/api/v3/sandboxes');
    expect(JSON.parse(init.body).image).toBe(canonicalImage);
    expect(calls[1]).toMatchObject({
      method: 'POST',
      path: `/api/v2/sandboxes/sessions/${session.id}/cmd`,
    });
    expect(sessionCommands()[0].args).toEqual([
      '/opt/alunza/supervisor/remote-init.mjs',
    ]);
  } finally {
    await adapter.close();
  }
  expect(adapter.evidence.cleanupVerified).toBe(true);
});

test.each([
  [
    'a different team',
    { image: `other-team/fixture-project/practice-runner@${digest}` },
  ],
  [
    'a different project',
    { image: `fixture-team/other-project/practice-runner@${digest}` },
  ],
  [
    'a different repository',
    { image: `fixture-team/fixture-project/other-runner@${digest}` },
  ],
  ['a different digest', { image: `${repository}@sha256:${'d'.repeat(64)}` }],
  ['a current snapshot', { currentSnapshotId: 'snap_current' }],
  ['a source snapshot', {}, { sourceSnapshotId: 'snap_source' }],
  [
    'a short request and a canonical response',
    {},
    {},
    `practice-runner@${digest}`,
  ],
])(
  'the SDK response with %s is rejected before bootstrap or upload',
  async (
    _case,
    sandbox,
    returnedSession = {},
    requestedImage = canonicalImage,
  ) => {
    createResponse = {
      sandbox: { image: canonicalImage, ...sandbox },
      session: returnedSession,
    };
    const adapter = new VercelAdapter({ ...config(), image: requestedImage });
    try {
      await expect(adapter.execute(input())).rejects.toThrow(
        'Unexpected Sandbox resources, identity or policy',
      );
      expect(calls.map(({ path }) => path)).toEqual(['/api/v3/sandboxes']);
    } finally {
      await adapter.close();
    }
    expect(adapter.evidence.cleanupVerified).toBe(true);
  },
);

test('installed SDK retry after a lost create response cannot dispatch a second creation', async () => {
  mode = 'lost-create';
  const adapter = new VercelAdapter(config());
  await expect(adapter.execute(input())).rejects.toThrow('already dispatched');
  expect(
    calls.filter((call) => call.path === '/api/v3/sandboxes'),
  ).toHaveLength(1);
  await adapter.close();
  expect(adapter.evidence).toMatchObject({
    createDispatches: 1,
    creationStatus: 'RECONCILED',
    cleanupVerified: true,
  });
});

test('installed SDK cannot automatically resume, fork or snapshot through the adapter transport', async () => {
  const adapter = new VercelAdapter(config());
  await adapter.execute(input());
  mode = 'stopped';
  await expect(adapter.sandbox.runCommand('true')).rejects.toThrow('forbidden');
  expect(calls.some((call) => call.resume === 'true')).toBe(false);
  await expect(
    Sandbox.fork({
      ...config(),
      sourceSandbox: metadata.name,
      fetch: adapter.budgetedFetch,
    }),
  ).rejects.toThrow('forbidden');
  await expect(adapter.sandbox.snapshot()).rejects.toThrow('forbidden');
  expect(calls.some((call) => /\/(fork|snapshot)$/.test(call.path))).toBe(
    false,
  );
  await adapter.close();
  expect(adapter.evidence.cleanupVerified).toBe(true);
}, 15000);

test('expired cleanup budget cannot dispatch a provider request or extend the total deadline', async () => {
  const settings = config();
  settings.cleanupDeadlineMs = Date.now() + 40;
  const adapter = new VercelAdapter(settings);
  await adapter.execute(input());
  await new Promise((resolve) => setTimeout(resolve, 50));
  const count = calls.length;
  await expect(adapter.close()).rejects.toThrow();
  expect(calls).toHaveLength(count);
  expect(adapter.evidence.cleanupVerified).toBe(false);
});

test('trusted lost-response acceptance discards one real SDK create response and then reconciles', async () => {
  const adapter = new VercelAdapter({
    ...config(),
    acceptance: { discardCreateResponse: true },
  });
  await expect(adapter.execute(input())).rejects.toThrow('already dispatched');
  await adapter.close();
  expect(adapter.evidence).toMatchObject({
    acceptanceFault: 'CREATE_RESPONSE_DISCARDED',
    createDispatches: 1,
    creationStatus: 'RECONCILED',
    cleanupVerified: true,
  });
  expect(
    calls.filter((call) => call.path === '/api/v3/sandboxes'),
  ).toHaveLength(1);
  expect(driverCalls).toHaveLength(0);
});

test('trusted cancellation hook runs only after the actual capsule command transport accepts dispatch', async () => {
  const dispatched = jest.fn(() => {
    expect(calls.at(-1).path).toMatch(/\/cmd$/);
    expect(driverCalls.at(-1)[1]).toBe('execute');
  });
  const adapter = new VercelAdapter({
    ...config(),
    acceptance: { onCapsuleDispatched: dispatched },
  });
  await adapter.execute(input());
  expect(dispatched).toHaveBeenCalledTimes(1);
  await adapter.close();
});
