const {
  evaluationObservationSchema,
  evaluationReceiptSchema,
  evaluationCostMicroUsd,
} = require('../../packages/contracts/dist');

const observation = {
  phase: 'GENERATION',
  outcome: 'RESPONSE',
  settledAt: '2026-10-04T20:00:00Z',
  aborted: false,
  usage: { inputTokens: 2000, outputTokens: 7, cachedInputTokens: 1024 },
  rateLimits: {
    tokens: { limit: 200000, remaining: 0, resetMs: 1000 },
    requests: { limit: 200, remaining: 198, resetMs: 10000 },
  },
  retryAfterMs: 1500,
};
const receipt = {
  callId: '12345678-1234-4234-8234-123456789abc',
  runId: null,
  stage: null,
  phase: 'GENERATION',
  state: 'COMPLETED',
  provider: 'AZURE',
  configurationId: 'unit-only',
  model: 'gpt-4.1-mini-2025-04-14',
  observedModel: 'gpt-4.1-mini-2025-04-14',
  dimensions: null,
  inputHash: 'a'.repeat(64),
  dispatchedAt: observation.settledAt,
  settledAt: observation.settledAt,
  outcome: 'RESPONSE',
  inputTokens: 2000,
  outputTokens: 7,
  requestId: 'unit-request',
  httpStatus: 200,
  retryable: null,
  aborted: false,
  reservedInputTokens: 8000,
  maxOutputTokens: 2048,
  reservedCostMicroUsd: '6477',
  observedCostMicroUsd: '812',
};

test('the operational contract retains safe quota, backoff and cached subset evidence', () => {
  expect(evaluationObservationSchema.parse(observation)).toEqual(observation);
  const extended = {
    ...receipt,
    cachedInputTokens: 1024,
    rateLimits: observation.rateLimits,
    retryAfterMs: 1500,
  };
  expect(evaluationReceiptSchema.parse(extended)).toEqual(extended);
  // Cache is evidence only: accounting still uses the approved uncached input rate.
  expect(
    evaluationCostMicroUsd(
      receipt.inputTokens,
      receipt.outputTokens,
      '400000',
      '1600000',
    ),
  ).toBe(receipt.observedCostMicroUsd);
});

test('legacy receipts remain valid and missing cache is not converted to zero', () => {
  expect(
    evaluationReceiptSchema.parse(receipt).cachedInputTokens,
  ).toBeUndefined();
  expect(
    evaluationReceiptSchema.parse({
      ...receipt,
      cachedInputTokens: null,
      rateLimits: null,
      retryAfterMs: null,
    }).cachedInputTokens,
  ).toBeNull();
});

test.each([
  { inputTokens: 10, cachedInputTokens: 11 },
  { inputTokens: 10, cachedInputTokens: -1 },
  { inputTokens: 10, cachedInputTokens: 0.5 },
  { cachedInputTokens: 0 },
])(
  'invalid cache usage is rejected by the durable observation boundary',
  (usage) => {
    expect(
      evaluationObservationSchema.safeParse({ ...observation, usage }).success,
    ).toBe(false);
  },
);

test('arbitrary headers and body content cannot enter the metadata contract', () => {
  expect(
    evaluationObservationSchema.safeParse({
      ...observation,
      rateLimits: { authorization: 'fictitious-private-value' },
    }).success,
  ).toBe(false);
  expect(
    evaluationObservationSchema.safeParse({
      ...observation,
      usage: { inputTokens: 1, prompt: 'fictitious-private-value' },
    }).success,
  ).toBe(false);
});

test.each([-1, 300001, 1.5])(
  'invalid retry delay %s is rejected',
  (retryAfterMs) => {
    expect(
      evaluationObservationSchema.safeParse({ ...observation, retryAfterMs })
        .success,
    ).toBe(false);
  },
);
