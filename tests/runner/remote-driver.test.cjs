const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { SourceTextModule, SyntheticModule, createContext } = require('node:vm');
const source = readFileSync(
  resolve(__dirname, '../../infra/runner/remote-driver.mjs'),
  'utf8',
);
const id = 'f3c322b7-82ee-41d1-8bf6-d9a29bdcd6eb';
const input = `/vercel/sandbox/alunza-input-${id}.json`;
const output = `/vercel/sandbox/alunza-result-${id}.json`;
async function run({
  operation = 'execute',
  path = input,
  probe,
  extraArgs = [],
  body = { code: 'student', args: ['PRIVATE_SENTINEL'] },
  result = { packet: { stdout: 'PRIVATE_SENTINEL' } },
  failure,
  failedPhases = [],
  startFailure,
  failFiles = [],
  rawInput,
  files = new Map(),
} = {}) {
  let stdout = '',
    stderr = '';
  const process = {
    argv: [
      'node',
      'remote-driver.mjs',
      operation,
      path,
      output,
      ...(probe ? [probe] : []),
      ...extraArgs,
    ],
    stdout: {
      write: (value) => {
        stdout += value;
      },
    },
    stderr: {
      write: (value) => {
        stderr += value;
      },
    },
  };
  if (!files.has(input))
    files.set(input, Buffer.from(rawInput ?? JSON.stringify(body)));
  const fs = {
    readFile: jest.fn(async (file) => files.get(file)),
    stat: jest.fn(async () => ({ uid: 1000, gid: 1000 })),
    writeFile: jest.fn(async (file, value) => {
      files.set(file, value);
    }),
    chown: jest.fn(async () => {}),
    unlink: jest.fn(async (file) => {
      files.delete(file);
    }),
  };
  for (const operation of failFiles) {
    fs[operation].mockRejectedValueOnce(new Error('PRIVATE_SENTINEL'));
  }
  const runCapsule = jest.fn(async (_input, options) => {
    for (const phase of failedPhases) options.observeFailure(phase);
    if (startFailure) options.observeStartFailure(startFailure);
    if (failure) throw new Error(failure);
    return result;
  });
  const context = createContext({ process, Buffer });
  const module = new SourceTextModule(source, { context });
  await module.link(async (name) => {
    const values =
      name === 'node:fs/promises'
        ? fs
        : name === './timing.mjs'
          ? await import('../../infra/runner/timing.mjs')
          : { runCapsule };
    return new SyntheticModule(
      Object.keys(values),
      function () {
        for (const [key, value] of Object.entries(values))
          this.setExport(key, value);
      },
      { context },
    );
  });
  await module.evaluate();
  return { files, fs, runCapsule, stdout, stderr, exitCode: process.exitCode };
}

test('private result is written mode0600 for the uploader and never sent to command logs', async () => {
  const execution = await run();
  expect(execution.stdout + execution.stderr).toBe('');
  expect(execution.files.has(input)).toBe(false);
  expect(execution.files.get(output).toString()).toContain('PRIVATE_SENTINEL');
  expect(execution.fs.writeFile).toHaveBeenCalledWith(
    output,
    expect.any(Buffer),
    { mode: 0o600, flag: 'wx' },
  );
  expect(execution.fs.chown).toHaveBeenCalledWith(output, 1000, 1000);
  const cleanup = await run({ operation: 'cleanup', files: execution.files });
  expect(cleanup.files.has(input)).toBe(false);
  expect(cleanup.files.has(output)).toBe(false);
  expect(cleanup.runCapsule).not.toHaveBeenCalled();
});

test('execution failures are sanitized and still unlink private input', async () => {
  const execution = await run({ failure: 'PRIVATE_SENTINEL secret stack' });
  expect(execution.exitCode).toBe(68);
  expect(execution.stdout).toBe('');
  expect(execution.stderr).toBe('REMOTE_CAPSULE_FAILED\n');
  expect(execution.files.has(input)).toBe(false);
});

test('oversized result is rejected before a private result file is written', async () => {
  const execution = await run({ result: { data: 'x'.repeat(524288) } });
  expect(execution.exitCode).toBe(81);
  expect(execution.fs.writeFile).not.toHaveBeenCalled();
  expect(execution.files.has(input)).toBe(false);
});

test('arbitrary file selectors cannot be read or removed', async () => {
  const execution = await run({ path: '/etc/passwd', operation: 'cleanup' });
  expect(execution.exitCode).toBe(64);
  expect(execution.fs.readFile).not.toHaveBeenCalled();
  expect(execution.fs.unlink).not.toHaveBeenCalled();
});

test('only the trusted command argument chooses the fixed OS probe', async () => {
  const fromInput = await run({ body: { code: '', probe: 'network' } });
  expect(fromInput.runCapsule.mock.calls[0][1]).toEqual({
    probe: undefined,
    deadlineMs: undefined,
    observeFailure: expect.any(Function),
    observeStartFailure: expect.any(Function),
  });
  const trusted = await run({ probe: 'network' });
  expect(trusted.runCapsule.mock.calls[0][1]).toEqual({
    probe: 'network',
    deadlineMs: undefined,
    observeFailure: expect.any(Function),
    observeStartFailure: expect.any(Function),
  });
  const invalid = await run({ probe: 'arbitrary' });
  expect(invalid.runCapsule).not.toHaveBeenCalled();
  expect(invalid.exitCode).toBe(64);
});

const startDetail = {
  httpStatus: 500,
  outcome: 'HTTP_RESPONSE',
  runtimeCause: 'CGROUP',
  containerState: 'created',
  hasStarted: false,
  oomKilled: false,
};
const failedStart = {
  failure: 'PRIVATE_SENTINEL',
  failedPhases: ['START', 'CONTAINER_CLEANUP'],
  startFailure: startDetail,
};

test('START creates a typed private diagnostic and keeps the operation deadline out of the student input', async () => {
  const deadline = Date.now() + 30000;
  const execution = await run({
    ...failedStart,
    extraArgs: [`--deadline-ms=${deadline}`],
  });
  expect(execution.exitCode).toBe(75);
  expect(execution.stdout).toBe('');
  expect(execution.stderr).toBe('REMOTE_CAPSULE_FAILED\n');
  expect(execution.files.has(input)).toBe(false);
  const file = execution.files.get(output);
  expect(file.length).toBeLessThanOrEqual(4096);
  expect(file.toString()).not.toContain('PRIVATE_SENTINEL');
  expect(JSON.parse(file)).toEqual({
    kind: 'START_FAILURE',
    schemaVersion: 1,
    detail: startDetail,
  });
  expect(execution.fs.writeFile).toHaveBeenCalledWith(output, file, {
    mode: 0o600,
    flag: 'wx',
  });
  expect(execution.fs.chown).toHaveBeenCalledWith(output, 1000, 1000);
  expect(execution.runCapsule.mock.calls[0][1].deadlineMs).toBe(deadline);
  expect(execution.runCapsule.mock.calls[0][0]).not.toHaveProperty(
    'deadlineMs',
  );
  const cleanup = await run({ operation: 'cleanup', files: execution.files });
  expect(cleanup.files.size).toBe(0);
});

test.each([
  [
    'a field outside the schema',
    { startFailure: { ...startDetail, message: 'PRIVATE_SENTINEL' } },
  ],
  [
    'a foreign outcome',
    { startFailure: { ...startDetail, outcome: 'PRIVATE_SENTINEL' } },
  ],
  ['expired authority', { extraArgs: ['--deadline-ms=1'] }],
  ['another phase failed first', { failedPhases: ['SEND', 'START'] }],
])('%s cannot publish a START diagnostic', async (_name, override) => {
  const execution = await run({ ...failedStart, ...override });
  expect(execution.files.has(output)).toBe(false);
  expect(execution.files.has(input)).toBe(false);
  expect(execution.stderr).toBe('REMOTE_CAPSULE_FAILED\n');
});

test.each(['writeFile', 'chown', 'unlink'])(
  'START remains first when %s fails',
  async (method) => {
    const execution = await run({ ...failedStart, failFiles: [method] });
    expect(execution.exitCode).toBe(75);
    expect(execution.stdout).toBe('');
    expect(execution.stderr).toBe('REMOTE_CAPSULE_FAILED\n');
  },
);

test.each([
  ['--deadline-ms=1e12'],
  ['--deadline-ms=0'],
  ['identity', 'permissions'],
])(
  'invalid supervisor arguments are rejected before opening files (%s)',
  async (...args) => {
    const execution = await run({ extraArgs: args });
    expect(execution.exitCode).toBe(64);
    expect(execution.fs.stat).not.toHaveBeenCalled();
  },
);

test.each([
  ['stat', 65],
  ['readFile', 66],
  ['writeFile', 82],
  ['chown', 83],
  ['unlink', 84],
])(
  'a failing %s reports its reserved code and never includes file contents',
  async (method, code) => {
    const execution = await run({ failFiles: [method] });
    expect(execution.exitCode).toBe(code);
    expect(execution.stdout).toBe('');
    expect(execution.stderr).toBe('REMOTE_CAPSULE_FAILED\n');
    expect(execution.fs.unlink).toHaveBeenCalledWith(input);
  },
);

test('invalid JSON and oversized input have distinct bounded failures', async () => {
  for (const [rawInput, code] of [
    ['PRIVATE_SENTINEL', 67],
    ['x'.repeat(262145), 66],
  ]) {
    const execution = await run({ rawInput });
    expect(execution.exitCode).toBe(code);
    expect(execution.runCapsule).not.toHaveBeenCalled();
    expect(execution.stdout).toBe('');
    expect(execution.stderr).toBe('REMOTE_CAPSULE_FAILED\n');
  }
});

test('the first trusted capsule phase survives container and file cleanup failures', async () => {
  const execution = await run({
    failedPhases: ['UNKNOWN_FIXTURE_TEXT', 'PRE_INSPECT', 'CONTAINER_CLEANUP'],
    failure: 'PRIVATE_SENTINEL',
    failFiles: ['unlink'],
  });
  expect(execution.exitCode).toBe(72);
  expect(execution.stdout).toBe('');
  expect(execution.stderr).toBe('REMOTE_CAPSULE_FAILED\n');
  expect(execution.fs.unlink).toHaveBeenCalledWith(input);
});

test('a private write failure survives a subsequent unlink failure', async () => {
  const execution = await run({ failFiles: ['writeFile', 'unlink'] });
  expect(execution.exitCode).toBe(82);
  expect(execution.stderr).toBe('REMOTE_CAPSULE_FAILED\n');
});

test('file cleanup attempts the second path even if the first unlink fails', async () => {
  const execution = await run({ operation: 'cleanup', failFiles: ['unlink'] });
  expect(execution.exitCode).toBe(85);
  expect(execution.fs.unlink.mock.calls).toEqual([[input], [output]]);
  expect(execution.stdout).toBe('');
  expect(execution.stderr).toBe('REMOTE_CAPSULE_FAILED\n');
});
