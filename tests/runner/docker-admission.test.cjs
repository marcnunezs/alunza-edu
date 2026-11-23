const { randomUUID } = require('node:crypto');
const imageIdentity = jest.fn();
const runCapsule = jest.fn();
let DockerAdapter;
beforeAll(async () => {
  jest.unstable_mockModule('../../infra/runner/capsule.mjs', () => ({
    imageIdentity,
    runCapsule,
    getDockerAvailability: jest.fn(),
    inspectConfiguredDocker: jest.fn(),
    getDockerEngineId: jest.fn(),
    command: jest.fn(),
    RUNNER_PREFIX: 'alunza-laboratorio-runner-',
    cleanupDockerExecution: jest.fn(),
    sweepExpiredDockerExecutions: jest.fn(),
  }));
  ({ DockerAdapter } = await import('../../packages/runner/dist/index.js'));
});
beforeEach(() => {
  jest.resetAllMocks();
  runCapsule.mockResolvedValue({
    packet: null,
    programWallMs: 1,
    containerWallMs: 1,
    cleanupVerified: true,
  });
});
const firstImage = 'sha256:' + 'a'.repeat(64);
const nextImage = 'sha256:' + 'b'.repeat(64);
const input = () => ({
  executionId: randomUUID(),
  code: 'module.exports.solve=()=>true',
  args: [],
  budgetMs: 3000,
  outputRemaining: 65536,
});

test('an admission pins only its adapter, skips the duplicate lookup and retains fresh capsules and timings', async () => {
  const observeTiming = jest.fn();
  const options = { image: firstImage, observeTiming };
  const adapter = new DockerAdapter(options);
  options.image = nextImage;
  const request = input();
  const signal = new AbortController().signal;
  await adapter.execute(request, signal);
  await adapter.execute({ ...request, args: [1], budgetMs: 2900 }, signal);
  await new DockerAdapter({ image: nextImage }).execute(input());
  expect(imageIdentity).not.toHaveBeenCalled();
  expect(runCapsule).toHaveBeenCalledTimes(3);
  expect(runCapsule.mock.calls.map((call) => call[1].image)).toEqual([
    firstImage,
    firstImage,
    nextImage,
  ]);
  expect(runCapsule.mock.calls[0]).toEqual([
    request,
    { image: firstImage, signal, observeTiming },
  ]);
  expect(runCapsule.mock.calls[1][0].budgetMs).toBe(2900);
  expect(
    observeTiming.mock.calls.filter(
      ([event]) => event.phase === 'imageResolve',
    ),
  ).toEqual([
    [
      {
        phase: 'imageResolve',
        durationMs: expect.any(Number),
        completed: true,
      },
    ],
  ]);
});

test('direct callers still resolve once per execution and recheck for the next adapter', async () => {
  imageIdentity
    .mockResolvedValueOnce(firstImage)
    .mockResolvedValueOnce(nextImage);
  const adapter = new DockerAdapter();
  await adapter.execute(input());
  await adapter.execute(input());
  await new DockerAdapter().execute(input());
  expect(imageIdentity).toHaveBeenCalledTimes(2);
  expect(runCapsule.mock.calls.map((call) => call[1].image)).toEqual([
    firstImage,
    firstImage,
    nextImage,
  ]);
});

test.each([
  'latest',
  'alunza:tag',
  'sha256:' + 'a'.repeat(63),
  'sha256:' + 'A'.repeat(64),
  '',
])('rejects a mutable or invalid admitted image: %s', (image) => {
  expect(() => new DockerAdapter({ image })).toThrow('immutable local image');
  expect(runCapsule).not.toHaveBeenCalled();
});

test('a removed admitted image fails without switching to a different tag or retrying the capsule', async () => {
  runCapsule.mockRejectedValue(new Error('Runner container creation failed'));
  imageIdentity.mockResolvedValue(nextImage);
  await expect(
    new DockerAdapter({ image: firstImage }).execute(input()),
  ).rejects.toThrow('creation failed');
  expect(imageIdentity).not.toHaveBeenCalled();
  expect(runCapsule).toHaveBeenCalledTimes(1);
});
