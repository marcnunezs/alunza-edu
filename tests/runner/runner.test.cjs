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
        JSON.stringify({ kind: 'value', value }),
      ).toString('base64'),
      outputTruncated: false,
      exitCode: 0,
      signal: null,
      cgroup: {},
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
test('cumulative external elapsed time reduces the next case budget', async () => {
  const source = input();
  source.tests.push({ ...source.tests[0], id: 'second' });
  const backend = adapter([
    capsule(true, { programWallMs: 2000 }),
    capsule(true, { timedOut: true }),
  ]);
  const result = await runner.execute(source, backend);
  expect(backend.execute.mock.calls[1][0].budgetMs).toBe(1000);
  expect(result.diagnosisCode).toBe('TIMEOUT');
  expect(result.allRequiredPassed).toBe(false);
});
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
