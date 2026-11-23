const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { resolve } = require('node:path');
let runner;
beforeAll(async () => {
  runner = await import('../../packages/runner/dist/index.js');
});
const input = () => ({
  executionId: randomUUID(),
  requestId: 'unit',
  exerciseVersionId: 'fixture',
  testsVersion: 'v1',
  mode: 'SUBMIT',
  entrypoint: 'solve',
  code: 'module.exports.solve=()=>true',
  tests: [{ id: 'visible', visibility: 'visible', args: [], expected: true }],
});
function capsule(value = true, overrides = {}) {
  return {
    packet: {
      status: 'exited',
      runtimeMs: 100,
      outputBytes: 0,
      stdout: '',
      stderr: '',
      returnData: Buffer.from(
        JSON.stringify({
          kind: 'value',
          value,
          invocation: 'QUICKJS_SYNC_CALL',
        }),
      ).toString('base64'),
      outputTruncated: false,
      exitCode: 0,
      signal: null,
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
    programWallMs: 100,
    lifecycleMs: 200,
    image: 'sha256:' + 'a'.repeat(64),
    ...overrides,
  };
}
function adapter(responses) {
  return {
    provider: 'docker',
    execute: jest.fn(async () => responses.shift()),
    close: jest.fn(async () => {}),
  };
}
test('limits and client-supplied grants cannot be overridden', () => {
  expect(runner.LIMITS).toMatchObject({
    memoryBytes: 134217728,
    runtimeMs: 3000,
    outputBytes: 65536,
  });
  expect(() =>
    runner.executionSchema.parse({ ...input(), limits: { runtimeMs: 99999 } }),
  ).toThrow();
  expect(() =>
    runner.executionSchema.parse({
      ...input(),
      entrypoint: 'x;process.exit()',
    }),
  ).toThrow();
});
test('all required comparisons are outside the untrusted response', async () => {
  const result = await runner.execute(input(), adapter([capsule(false)]));
  expect(result.diagnosisCode).toBe('FAILED_TEST');
  expect(result.allRequiredPassed).toBe(false);
});
test('a legacy value packet without invocation provenance cannot grant success', async () => {
  const response = capsule();
  response.packet.returnData = Buffer.from(
    '{"kind":"value","value":true}',
  ).toString('base64');
  const result = await runner.execute(input(), adapter([response]));
  expect(result.diagnosisCode).toBe('UNKNOWN');
  expect(result.terminationReason).toBe('PROTOCOL_INVALID');
  expect(result.allRequiredPassed).toBe(false);
});
test('execution correlation is propagated to every capsule', async () => {
  const source = input();
  const backend = adapter([capsule()]);
  await runner.execute(source, backend);
  expect(backend.execute.mock.calls[0][0].executionId).toBe(source.executionId);
});
test('cleanup rejects arbitrary Docker selectors before external effects', async () => {
  await expect(runner.cleanupDockerExecution('--all')).rejects.toThrow(
    'Execution UUID required',
  );
});
test('console remains available on exception and partial UTF8 is not expanded', async () => {
  const response = capsule();
  const bytes = Buffer.concat([Buffer.alloc(65535, 120), Buffer.from([0xc3])]);
  response.packet.stdout = bytes.toString('base64');
  response.packet.outputBytes = bytes.length;
  response.packet.exitCode = 70;
  response.packet.returnData = Buffer.from('{"kind":"exception"}').toString(
    'base64',
  );
  const result = await runner.execute(input(), adapter([response]));
  expect(result.diagnosisCode).toBe('RUNTIME_ERROR');
  expect(result.visibleTestResults[0].passed).toBe(false);
  expect(Buffer.byteLength(result.visibleTestResults[0].stdout)).toBe(65535);
  expect(result.visibleTestResults[0].stdout).not.toContain('\ufffd');
});
test('packet byte accounting must match the bounded console payload', async () => {
  const response = capsule();
  response.packet.stdout = Buffer.from('undeclared bytes').toString('base64');
  const result = await runner.execute(input(), adapter([response]));
  expect(result.terminationReason).toBe('PROTOCOL_INVALID');
});
test('a trusted parser failure is syntax while an exception remains runtime', async () => {
  const response = capsule();
  response.packet.exitCode = 70;
  response.packet.returnData =
    Buffer.from('{"kind":"syntax"}').toString('base64');
  expect(
    (await runner.execute(input(), adapter([response]))).diagnosisCode,
  ).toBe('SYNTAX_ERROR');
});
test('public projection contains no hidden identifiers, output or expected inputs', async () => {
  const secret = 'PRIVATE_SENTINEL';
  const source = input();
  source.tests = [
    { id: secret, visibility: 'hidden', args: [secret], expected: secret },
  ];
  const response = capsule(secret);
  response.packet.stdout = Buffer.from(secret).toString('base64');
  response.packet.outputBytes = Buffer.byteLength(secret);
  const result = await runner.execute(source, adapter([response]));
  expect(JSON.stringify(runner.publicResult(result))).not.toContain(secret);
  expect(runner.publicResult(result).hiddenChecksPassed).toBe(true);
});
test('RUN omits hidden tests', async () => {
  const source = input();
  source.mode = 'RUN';
  source.tests.push({
    id: 'hidden',
    visibility: 'hidden',
    args: [],
    expected: false,
  });
  const backend = adapter([capsule(true)]);
  expect((await runner.execute(source, backend)).diagnosisCode).toBe('SUCCESS');
  expect(backend.execute).toHaveBeenCalledTimes(1);
});
test('a hidden case completed before another timed out is not a complete hidden success', async () => {
  const source = input();
  source.tests = [
    { id: 'hidden-1', visibility: 'hidden', args: [], expected: true },
    { id: 'hidden-2', visibility: 'hidden', args: [], expected: true },
  ];
  const result = await runner.execute(
    source,
    adapter([capsule(), capsule(true, { timedOut: true })]),
  );
  expect(runner.publicResult(result).hiddenChecksPassed).toBe(false);
  expect(result.allRequiredPassed).toBe(false);
});
test('adapter failure does not claim observed cleanup', async () => {
  const backend = adapter([]);
  backend.execute.mockRejectedValue(new Error('offline'));
  const result = await runner.execute(input(), backend);
  expect(result.evidence.cleanupVerified).toBe(false);
});
test('cumulative trusted supervisor time reduces the next case budget', async () => {
  const source = input();
  source.tests.push({ ...source.tests[0], id: 'second' });
  const first = capsule(true, { programWallMs: 4000 });
  first.packet.runtimeMs = 2000;
  const backend = adapter([first, capsule(true, { timedOut: true })]);
  const result = await runner.execute(source, backend);
  expect(backend.execute.mock.calls[1][0].budgetMs).toBe(1000);
  expect(result.diagnosisCode).toBe('TIMEOUT');
  expect(result.allRequiredPassed).toBe(false);
});

test('Docker startup latency is operational time and cannot forge a student timeout', async () => {
  const backend = adapter([capsule(true, { programWallMs: 5000 })]);
  const result = await runner.execute(input(), backend);
  expect(result.diagnosisCode).toBe('SUCCESS');
  expect(result.runtimeMs).toBe(100);
  expect(result.evidence.hostProgramWallMs).toBe(5000);
});

test.each([2999, 3000, 3001])(
  'eight cases share one time budget at %i ms total',
  async (total) => {
    const source = input();
    source.tests = Array.from({ length: 8 }, (_, index) => ({
      ...source.tests[0],
      id: `case-${index + 1}`,
    }));
    const responses = source.tests.map((_, index) => {
      const response = capsule();
      response.packet.runtimeMs = index === 7 ? total - 2800 : 400;
      return response;
    });
    const backend = adapter(responses);
    const result = await runner.execute(source, backend);
    expect(backend.execute.mock.calls.map(([sent]) => sent.budgetMs)).toEqual([
      3000, 2600, 2200, 1800, 1400, 1000, 600, 200,
    ]);
    expect(result.diagnosisCode).toBe(total < 3000 ? 'SUCCESS' : 'TIMEOUT');
    expect(result.allRequiredPassed).toBe(total < 3000);
    expect(result.runtimeMs).toBe(total);
  },
);

test.each([65535, 65536, 65537])(
  'eight cases share combined stdout/stderr at %i generated bytes',
  async (total) => {
    const source = input();
    source.tests = Array.from({ length: 8 }, (_, index) => ({
      ...source.tests[0],
      id: `case-${index + 1}`,
    }));
    const responses = source.tests.map((_, index) => {
      const response = capsule();
      const bytes = index === 7 ? Math.min(total, 65536) - 57344 : 8192;
      response.packet.stdout = Buffer.alloc(
        Math.floor(bytes / 2),
        'x',
      ).toString('base64');
      response.packet.stderr = Buffer.alloc(
        bytes - Math.floor(bytes / 2),
        'y',
      ).toString('base64');
      response.packet.outputBytes = bytes;
      if (index === 7 && total > 65536) {
        response.packet.status = 'output';
        response.packet.outputTruncated = true;
      }
      return response;
    });
    const backend = adapter(responses);
    const result = await runner.execute(source, backend);
    expect(
      backend.execute.mock.calls.map(([sent]) => sent.outputRemaining),
    ).toEqual([65536, 57344, 49152, 40960, 32768, 24576, 16384, 8192]);
    expect(result.outputBytes).toBe(Math.min(total, 65536));
    expect(result.terminationReason).toBe(
      total > 65536 ? 'OUTPUT_LIMIT' : 'COMPLETED',
    );
    expect(result.allRequiredPassed).toBe(total <= 65536);
  },
);

test('missing effective cgroups cannot grant success even with a valid invocation', async () => {
  const response = capsule();
  response.packet.cgroup = {};
  const result = await runner.execute(input(), adapter([response]));
  expect(result.diagnosisCode).toBe('UNKNOWN');
  expect(result.terminationReason).toBe('CAPABILITY_GAP');
  expect(result.allRequiredPassed).toBe(false);
});
test.each([
  { kills: 0, expected: 'SUCCESS', reason: 'COMPLETED' },
  { kills: 1, expected: 'UNKNOWN', reason: 'MEMORY_LIMIT' },
])(
  'a normal return respects the fresh capsule OOM counter ($kills)',
  async ({ kills, expected, reason }) => {
    const response = capsule();
    response.packet.cgroup['memory.events'] =
      `max 8\noom ${kills}\noom_kill ${kills}\n`;
    const result = await runner.execute(input(), adapter([response]));
    expect(result).toMatchObject({
      diagnosisCode: expected,
      terminationReason: reason,
      allRequiredPassed: kills === 0,
      evidence: { oomObserved: kills > 0 },
    });
    expect(result.runtimeMs).toBe(response.packet.runtimeMs);
    expect(result.evidence.cgroups).toEqual([response.packet.cgroup]);
  },
);
test.each([{ oomKilled: true }, { packet: null }, { exitCode: 137 }])(
  'incomplete evidence never grants success: %o',
  async (override) => {
    const result = await runner.execute(
      input(),
      adapter([capsule(true, override)]),
    );
    expect(result.diagnosisCode).toBe('UNKNOWN');
    expect(result.allRequiredPassed).toBe(false);
  },
);

test.each([false, true])(
  'OOM packet evidence is accounted once before stopping, including concurrent host timeout %s',
  async (timedOut) => {
    const response = capsule(true, { oomKilled: true, timedOut });
    response.packet.runtimeMs = 482.80039800000003;
    response.packet.stdout = Buffer.from('before oom\n').toString('base64');
    response.packet.stderr = Buffer.from('bounded stderr\n').toString('base64');
    response.packet.outputBytes = Buffer.byteLength(
      'before oom\nbounded stderr\n',
    );
    response.packet.exitCode = null;
    response.packet.signal = 'SIGKILL';
    response.packet.cgroup['memory.events'] = 'oom 1\noom_kill 1\n';
    const backend = adapter([response, capsule()]);
    const source = input();
    source.tests.push({
      id: 'never',
      visibility: 'visible',
      args: [],
      expected: true,
    });
    const result = await runner.execute(source, backend);
    expect(result).toMatchObject({
      diagnosisCode: 'UNKNOWN',
      terminationReason: 'MEMORY_LIMIT',
      runtimeMs: response.packet.runtimeMs,
      outputBytes: response.packet.outputBytes,
      allRequiredPassed: false,
      evidence: { oomObserved: true, cleanupVerified: true },
    });
    expect(result.evidence.cgroups).toEqual([response.packet.cgroup]);
    expect(
      result.evidence.timings.map((row) => row.supervisorProcessMs),
    ).toEqual([response.packet.runtimeMs]);
    expect(result.visibleTestResults).toEqual([
      {
        id: 'visible',
        passed: false,
        stdout: 'before oom\n',
        stderr: 'bounded stderr\n',
      },
    ]);
    expect(backend.execute).toHaveBeenCalledTimes(1);
    expect(backend.close).toHaveBeenCalledTimes(1);
  },
);

test('OOM in a hidden second case preserves cumulative accounting and private output', async () => {
  const first = capsule();
  first.packet.runtimeMs = 200;
  first.packet.stdout = Buffer.from('ok').toString('base64');
  first.packet.outputBytes = 2;
  const oom = capsule(true, { oomKilled: true });
  const secret = 'PRIVATE_OOM_CASE_OUTPUT';
  oom.packet.runtimeMs = 248.24951000000001;
  oom.packet.stdout = Buffer.from(secret).toString('base64');
  oom.packet.outputBytes = Buffer.byteLength(secret);
  const backend = adapter([first, oom, capsule()]);
  const source = input();
  source.tests.push(
    { id: secret, visibility: 'hidden', args: [], expected: true },
    { id: 'never', visibility: 'visible', args: [], expected: true },
  );
  const result = await runner.execute(source, backend);
  expect(result.terminationReason).toBe('MEMORY_LIMIT');
  expect(result.runtimeMs).toBe(first.packet.runtimeMs + oom.packet.runtimeMs);
  expect(result.outputBytes).toBe(2 + Buffer.byteLength(secret));
  expect(result.evidence.cgroups).toEqual([
    first.packet.cgroup,
    oom.packet.cgroup,
  ]);
  expect(result.evidence.timings.map((row) => row.budgetMs)).toEqual([
    3000, 2800,
  ]);
  expect(
    backend.execute.mock.calls.map(([sent]) => sent.outputRemaining),
  ).toEqual([65536, 65534]);
  expect(backend.execute).toHaveBeenCalledTimes(2);
  expect(result.privateTestResults).toEqual([
    { id: secret, passed: false, stdout: secret, stderr: '' },
  ]);
  const publicView = runner.publicResult(result);
  expect(publicView.runtimeMs).toBe(result.runtimeMs);
  expect(publicView.hiddenChecksPassed).toBe(false);
  expect(JSON.stringify(publicView)).not.toContain(secret);
  expect(backend.close).toHaveBeenCalledTimes(1);
});

test.each([
  [
    'absent packet',
    (response) => {
      response.packet = null;
    },
  ],
  [
    'invalid schema',
    (response) => {
      response.packet.runtimeMs = 'untrusted';
    },
  ],
  [
    'invalid base64',
    (response) => {
      response.packet.stdout = '!!!!';
    },
  ],
  [
    'noncanonical base64',
    (response) => {
      response.packet.stdout = 'eB==';
      response.packet.outputBytes = 1;
    },
  ],
  [
    'invalid stderr base64',
    (response) => {
      response.packet.stderr = '!!!!';
    },
  ],
  [
    'missing cgroups',
    (response) => {
      response.packet.cgroup = {};
    },
  ],
  [
    'weaker memory control',
    (response) => {
      response.packet.cgroup['memory.max'] = '268435456';
    },
  ],
  [
    'undeclared output',
    (response) => {
      response.packet.stdout = Buffer.from('not counted').toString('base64');
    },
  ],
  [
    'unconfirmed exit',
    (response) => {
      response.exitCode = 137;
    },
  ],
  [
    'unconfirmed cleanup',
    (response) => {
      response.cleanupVerified = false;
    },
  ],
])(
  'OOM with %s does not account unverified evidence or continue',
  async (_label, mutate) => {
    const first = capsule();
    const oom = capsule(true, { oomKilled: true });
    mutate(oom);
    const backend = adapter([first, oom, capsule()]);
    const source = input();
    source.tests.push(
      { id: 'oom', visibility: 'visible', args: [], expected: true },
      { id: 'never', visibility: 'visible', args: [], expected: true },
    );
    const result = await runner.execute(source, backend);
    expect(result).toMatchObject({
      diagnosisCode: 'UNKNOWN',
      terminationReason: 'MEMORY_LIMIT',
      runtimeMs: first.packet.runtimeMs,
      outputBytes: 0,
      allRequiredPassed: false,
      evidence: { oomObserved: true, cleanupVerified: oom.cleanupVerified },
    });
    expect(result.evidence.cgroups).toEqual([first.packet.cgroup]);
    expect(result.visibleTestResults).toHaveLength(1);
    if (!oom.packet || typeof oom.packet.runtimeMs !== 'number') {
      expect(result.evidence.timings[1].supervisorProcessMs).toBeNull();
    }
    expect(backend.execute).toHaveBeenCalledTimes(2);
    expect(backend.close).toHaveBeenCalledTimes(1);
  },
);

test('OOM packet exceeding the remaining combined output budget is not partly counted', async () => {
  const first = capsule();
  first.packet.stdout = Buffer.from('x').toString('base64');
  first.packet.outputBytes = 1;
  const oom = capsule(true, { oomKilled: true });
  oom.packet.stdout = Buffer.alloc(65536, 120).toString('base64');
  oom.packet.outputBytes = 65536;
  const source = input();
  source.tests.push({
    id: 'oom',
    visibility: 'visible',
    args: [],
    expected: true,
  });
  const backend = adapter([first, oom]);
  const result = await runner.execute(source, backend);
  expect(result.terminationReason).toBe('MEMORY_LIMIT');
  expect(result.runtimeMs).toBe(first.packet.runtimeMs);
  expect(result.outputBytes).toBe(1);
  expect(result.evidence.cgroups).toEqual([first.packet.cgroup]);
  expect(backend.execute.mock.calls[1][0].outputRemaining).toBe(65535);
});

test.each([3000, 3004.7])(
  'OOM preserves measured %s ms without clipping an overrun or becoming TIMEOUT',
  async (runtimeMs) => {
    const response = capsule(true, { oomKilled: true, timedOut: true });
    response.packet.runtimeMs = runtimeMs;
    response.packet.status = 'timeout';
    const result = await runner.execute(input(), adapter([response]));
    expect(result.terminationReason).toBe('MEMORY_LIMIT');
    expect(result.runtimeMs).toBe(runtimeMs);
    expect(result.evidence.timings[0].supervisorProcessMs).toBe(runtimeMs);
    expect(result.allRequiredPassed).toBe(false);
  },
);

test('cancellation still precedes OOM and close failure still invalidates its cleanup', async () => {
  const cancelled = await runner.execute(
    input(),
    adapter([capsule(true, { oomKilled: true, cancelled: true })]),
  );
  expect(cancelled.terminationReason).toBe('CANCELLED');
  expect(cancelled.runtimeMs).toBe(0);
  const backend = adapter([capsule(true, { oomKilled: true })]);
  backend.close.mockRejectedValue(new Error('private provider detail'));
  const failedCleanup = await runner.execute(input(), backend);
  expect(failedCleanup).toMatchObject({
    terminationReason: 'PROVIDER_FAILURE',
    infrastructureStatus: 'FAILED',
    allRequiredPassed: false,
    runtimeMs: 100,
    evidence: { cleanupVerified: false, oomObserved: true },
  });
  expect(JSON.stringify(failedCleanup)).not.toContain(
    'private provider detail',
  );
});
test('student fake verdict is rejected by the return data schema', async () => {
  const response = capsule();
  response.packet.returnData = Buffer.from(
    '{"passed":true,"diagnosis":"SUCCESS"}',
  ).toString('base64');
  expect(
    (await runner.execute(input(), adapter([response]))).terminationReason,
  ).toBe('PROTOCOL_INVALID');
});
test('provider cleanup failure invalidates a previously complete result', async () => {
  const backend = adapter([capsule()]);
  backend.close.mockRejectedValue(new Error('private provider detail'));
  const result = await runner.execute(input(), backend);
  expect(result.allRequiredPassed).toBe(false);
  expect(result.diagnosisCode).toBe('UNKNOWN');
  expect(JSON.stringify(result)).not.toContain('private provider detail');
});
test('remote is denied before SDK side effects without explicit authorization', () => {
  expect(() => new runner.VercelAdapter({ authorized: false })).toThrow();
});
test('remote CLI without manifest reports pending exit2, no request and no secret', () => {
  const secret = 'PRIVATE_TEST_TOKEN_NEVER_PRINT';
  const child = spawnSync(
    process.execPath,
    ['scripts/runner-probe.mjs', '--adapter', 'vercel'],
    {
      cwd: resolve(__dirname, '../..'),
      env: { ...process.env, VERCEL_TOKEN: secret },
      encoding: 'utf8',
      timeout: 10000,
    },
  );
  expect(child.status).toBe(2);
  expect(child.stderr).toBe('');
  expect(child.stdout).not.toContain(secret);
  expect(JSON.parse(child.stdout)).toMatchObject({
    status: 'PENDING',
    remoteCalls: 0,
  });
});
test('doctor without Docker reports pending exit2 without stack', () => {
  const child = spawnSync(process.execPath, ['scripts/runner-doctor.mjs'], {
    cwd: resolve(__dirname, '../..'),
    env: { SystemRoot: process.env.SystemRoot ?? '', PATH: '' },
    encoding: 'utf8',
    timeout: 10000,
  });
  expect(child.status).toBe(2);
  expect(child.stderr).toBe('');
  expect(JSON.parse(child.stdout)).toMatchObject({
    status: 'PENDING',
    remoteCalls: 0,
  });
});
test('Sandbox reserves cleanup requests after normal quota and authorization time exhaust', () => {
  let now = 0;
  const budget = new runner.SandboxRequestBudget(10, 1000, () => now);
  budget.consume(false);
  budget.consume(false);
  expect(() => budget.consume(false)).toThrow();
  now = 2000;
  budget.consume(true);
  budget.consume(true);
  expect(budget.requests).toBe(4);
  for (let i = 0; i < 6; i++) budget.consume(true);
  expect(budget.requests).toBe(10);
  expect(() => budget.consume(true)).toThrow();
});
test('Sandbox rejects a budget too small to reserve cleanup', () => {
  expect(
    () => new runner.SandboxRequestBudget(9, Date.now() + 10000),
  ).toThrow();
});
test('a completed cleanup window never permits creation of a second Sandbox', () => {
  let now = 0;
  const budget = new runner.SandboxRequestBudget(60, 120000, () => now);
  budget.consume(false);
  budget.consume(true);
  now = 31000;
  expect(() => budget.consume(false)).toThrow();
  expect(budget.requests).toBe(2);
});
