const { mkdtemp, readFile, readdir, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { basename, dirname, join, resolve } = require('node:path');

let journal;
let directory;
beforeAll(async () => {
  journal = await import('./sandbox-correlation.mjs');
});
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'alunza-sandbox-correlation-'));
});
afterEach(async () => {
  if (
    dirname(directory) !== resolve(tmpdir()) ||
    !basename(directory).startsWith('alunza-sandbox-correlation-')
  )
    throw new Error('Unexpected temporary journal directory');
  await rm(directory, { recursive: true, force: true });
});

function reservation(overrides = {}) {
  return {
    directory,
    approvalRef: 'PO-IMP05-smoke-01',
    operation: 'probe:sandbox',
    approved: true,
    releaseSha: 'a'.repeat(40),
    correlation: {
      schemaVersion: 1,
      sandboxName: 'alunza-runner-11111111-1111-4111-8111-111111111111',
      recordedAt: '2026-10-04T13:00:00.000Z',
      teamId: 'team_fixture',
      projectId: 'prj_fixture',
      image: `vcr.vercel.com/alunza/runner@sha256:${'b'.repeat(64)}`,
      region: 'iad1',
      requestedVmTimeoutMs: 60000,
      maxCreateDispatches: 1,
    },
    ...overrides,
  };
}

test('A reused approval rejects before dispatch despite a new UUID, time, target or release', async () => {
  const first = reservation();
  const path = await journal.reserveSandboxCorrelation(first);
  const original = await readFile(path, 'utf8');
  const second = reservation({
    releaseSha: 'c'.repeat(40),
    correlation: {
      ...first.correlation,
      sandboxName: 'alunza-runner-22222222-2222-4222-8222-222222222222',
      recordedAt: '2026-10-04T14:00:00.000Z',
      teamId: 'team_other',
      projectId: 'prj_other',
      region: 'sfo1',
      image: `vcr.vercel.com/other/runner@sha256:${'d'.repeat(64)}`,
    },
  });
  const create = jest.fn();
  await expect(
    journal.reserveSandboxCorrelation(second).then(create),
  ).rejects.toMatchObject({
    code: 'SANDBOX_APPROVAL_ALREADY_RESERVED',
    correlationPath: path,
  });
  expect(create).not.toHaveBeenCalled();
  expect(await readFile(path, 'utf8')).toBe(original);
  expect(await readdir(directory)).toEqual([basename(path)]);
});

test('An independent approval creates a separate exclusive journal', async () => {
  const firstPath = await journal.reserveSandboxCorrelation(reservation());
  const secondPath = await journal.reserveSandboxCorrelation(
    reservation({ approvalRef: 'PO-IMP05-smoke-02' }),
  );
  expect(secondPath).not.toBe(firstPath);
  expect(await readdir(directory)).toHaveLength(2);
  expect(JSON.parse(await readFile(secondPath, 'utf8')).approvalRef).toBe(
    'PO-IMP05-smoke-02',
  );
});

test('Two concurrent invocations of one approval allow exactly one reservation', async () => {
  const results = await Promise.allSettled([
    journal.reserveSandboxCorrelation(reservation()),
    journal.reserveSandboxCorrelation(reservation()),
  ]);
  expect(
    results.filter((result) => result.status === 'fulfilled'),
  ).toHaveLength(1);
  const rejection = results.find((result) => result.status === 'rejected');
  expect(rejection.reason.code).toBe('SANDBOX_APPROVAL_ALREADY_RESERVED');
  expect(await readdir(directory)).toHaveLength(1);
});

test('A failure after reservation retains the lock until manual reconciliation and a new approval', async () => {
  const path = await journal.reserveSandboxCorrelation(reservation());
  // No provider dispatch occurred: a local abort still consumes this reservation.
  const original = await readFile(path, 'utf8');
  await expect(
    journal.reserveSandboxCorrelation(reservation()),
  ).rejects.toMatchObject({
    code: 'SANDBOX_APPROVAL_ALREADY_RESERVED',
    correlationPath: path,
  });
  expect(await readFile(path, 'utf8')).toBe(original);
});

test('The journal contains only approved reconciliation metadata, without credentials or fixture contents', async () => {
  const options = reservation();
  const secret = 'fixture-secret-must-not-be-journaled';
  const path = await journal.reserveSandboxCorrelation({
    ...options,
    token: secret,
    correlation: {
      ...options.correlation,
      token: secret,
      env: { VERCEL_TOKEN: secret },
      code: secret,
      hiddenTests: secret,
      approvalRef: secret,
      approved: false,
      releaseSha: secret,
    },
  });
  const text = await readFile(path, 'utf8');
  expect(text).not.toContain(secret);
  expect(JSON.parse(text)).toEqual({
    ...options.correlation,
    approved: true,
    releaseSha: options.releaseSha,
    approvalRef: options.approvalRef,
    operation: options.operation,
  });
  expect(basename(path)).toMatch(/^sandbox-correlation-[a-f0-9]{64}\.json$/);
  expect(path).not.toContain(options.approvalRef);
  expect(path).not.toContain(options.correlation.sandboxName);
});

test.each([
  ['missing approval', { approvalRef: null }],
  ['empty approval', { approvalRef: '' }],
  ['whitespace approval', { approvalRef: '   ' }],
  ['noncanonical approval', { approvalRef: ' PO-01' }],
  ['control characters', { approvalRef: 'PO-01\n' }],
  ['oversized approval', { approvalRef: 'x'.repeat(161) }],
  ['other operation', { operation: 'probe:ai' }],
  ['unapproved', { approved: false }],
  ['missing release', { releaseSha: null }],
  ['invalid release', { releaseSha: 'HEAD' }],
])('Invalid %s fails before journaling', async (_description, overrides) => {
  await expect(
    journal.reserveSandboxCorrelation(reservation(overrides)),
  ).rejects.toThrow('INVALID_SANDBOX_CORRELATION');
  expect(await readdir(directory)).toEqual([]);
});

test.each([
  ['schema', { schemaVersion: 2 }],
  ['name traversal', { sandboxName: '../another-file' }],
  ['timestamp', { recordedAt: '2026-02-30T13:00:00.000Z' }],
  ['team', { teamId: 'token with spaces' }],
  ['project', { projectId: 'https://example.test' }],
  ['image', { image: 'vcr.vercel.com/alunza/runner:latest' }],
  ['region', { region: '../iad1' }],
  ['unbounded timeout', { requestedVmTimeoutMs: 60001 }],
  ['empty timeout', { requestedVmTimeoutMs: 0 }],
  ['fractional timeout', { requestedVmTimeoutMs: 1.5 }],
  ['extra creations', { maxCreateDispatches: 2 }],
])(
  'Invalid correlation %s fails before journaling',
  async (_description, overrides) => {
    const options = reservation();
    await expect(
      journal.reserveSandboxCorrelation({
        ...options,
        correlation: { ...options.correlation, ...overrides },
      }),
    ).rejects.toThrow('INVALID_SANDBOX_CORRELATION');
    expect(await readdir(directory)).toEqual([]);
  },
);
