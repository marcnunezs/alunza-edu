const imageIdentity = jest.fn();
const runCapsule = jest.fn();
jest.unstable_mockModule('../../infra/runner/capsule.mjs', () => ({
  imageIdentity,
  runCapsule,
  getDockerAvailability: jest.fn(),
  cleanupDockerExecution: jest.fn(),
  sweepExpiredDockerExecutions: jest.fn(),
}));
let DockerAdapter;
beforeAll(async () => {
  ({ DockerAdapter } = await import('../../packages/runner/dist/index.js'));
});
beforeEach(() => {
  imageIdentity.mockReset();
  runCapsule.mockReset();
  runCapsule.mockResolvedValue({ cleanupVerified: true });
});
const first = 'sha256:' + 'a'.repeat(64);
const second = 'sha256:' + 'b'.repeat(64);
const input = {
  executionId: '10000000-0000-4000-8000-000000000001',
  code: 'function solve() { return 1; }',
  args: [],
  budgetMs: 3000,
  outputRemaining: 65536,
  memoryBytes: 134217728,
};

test('A prepared image remains pinned across cases even when the tag resolves elsewhere', async () => {
  imageIdentity.mockResolvedValue(second);
  const adapter = new DockerAdapter({ image: first });
  const signal = new AbortController().signal;
  await adapter.execute(input, signal);
  await adapter.execute({ ...input, args: [2] }, signal);
  expect(imageIdentity).not.toHaveBeenCalled();
  expect(runCapsule).toHaveBeenCalledTimes(2);
  expect(runCapsule).toHaveBeenNthCalledWith(1, input, {
    image: first,
    signal,
    observeTiming: undefined,
  });
  expect(runCapsule).toHaveBeenNthCalledWith(
    2,
    { ...input, args: [2] },
    {
      image: first,
      signal,
      observeTiming: undefined,
    },
  );
});

test("Separate prepared operations never replace one another's image", async () => {
  const a = new DockerAdapter({ image: first });
  const b = new DockerAdapter({ image: second });
  await Promise.all([a.execute(input), b.execute(input)]);
  expect(imageIdentity).not.toHaveBeenCalled();
  expect(runCapsule.mock.calls.map(([, options]) => options.image)).toEqual([
    first,
    second,
  ]);
});

test('An unprepared adapter resolves once for its cases and a new adapter resolves afresh', async () => {
  imageIdentity.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
  const adapter = new DockerAdapter();
  await adapter.execute(input);
  await adapter.execute(input);
  await new DockerAdapter().execute(input);
  expect(imageIdentity).toHaveBeenCalledTimes(2);
  expect(runCapsule.mock.calls.map(([, options]) => options.image)).toEqual([
    first,
    first,
    second,
  ]);
});

test.each([
  null,
  '',
  'runner:latest',
  'sha256:a',
  'sha256:' + 'A'.repeat(64),
  first + '\n',
  1,
  {},
])(
  'Rejects a supplied invalid digest %p before any provider access',
  (image) => {
    expect(() => new DockerAdapter({ image })).toThrow(
      'Runner requires immutable local image ID',
    );
    expect(imageIdentity).not.toHaveBeenCalled();
    expect(runCapsule).not.toHaveBeenCalled();
  },
);

test('A missing pinned image fails without resolving the tag or retrying a capsule', async () => {
  const failure = new Error('Runner container creation failed');
  runCapsule.mockRejectedValueOnce(failure);
  imageIdentity.mockResolvedValue(second);
  await expect(new DockerAdapter({ image: first }).execute(input)).rejects.toBe(
    failure,
  );
  expect(imageIdentity).not.toHaveBeenCalled();
  expect(runCapsule).toHaveBeenCalledTimes(1);
  expect(runCapsule.mock.calls[0][1].image).toBe(first);
});
