import { test, expect } from '@jest/globals';
import { summarizeEvaluationTelemetry } from '../../scripts/evaluation-telemetry.mjs';

test('missing or partial cache evidence stays unknown, including legacy receipts', () => {
  expect(
    summarizeEvaluationTelemetry([]).cache.observedCachedInputTokens,
  ).toBeNull();
  const result = summarizeEvaluationTelemetry([
    { phase: 'EMBEDDING', inputTokens: 12 },
    { phase: 'GENERATION', inputTokens: 2000, cachedInputTokens: 1024 },
    { phase: 'REVIEW', inputTokens: 1500 },
  ]);
  expect(result.cache).toEqual({
    eligibleCalls: 2,
    observedCalls: 1,
    missingCalls: 1,
    observedCachedInputTokens: null,
  });
});

test('explicit zero and cache hits are counted without discounting the estimate', () => {
  const result = summarizeEvaluationTelemetry([
    {
      phase: 'GENERATION',
      inputTokens: 2000,
      cachedInputTokens: 1024,
      rateLimits: { tokens: { remaining: 0, resetMs: 1200 } },
      retryAfterMs: 0,
    },
    { phase: 'REVIEW', inputTokens: 1500, cachedInputTokens: 0 },
  ]);
  expect(result.cache).toEqual({
    eligibleCalls: 2,
    observedCalls: 2,
    missingCalls: 0,
    observedCachedInputTokens: 1024,
  });
  expect(result.rateLimitObservedCalls).toBe(1);
  expect(result.retryAfterObservedCalls).toBe(1);
  expect(result.costBasis).toBe('UNDISCOUNTED_TOKEN_ESTIMATE');
});

test.each([-1, 10.5, 101, undefined, null])(
  'invalid cached subset %s does not fabricate consumption',
  (cachedInputTokens) => {
    expect(
      summarizeEvaluationTelemetry([
        { phase: 'GENERATION', inputTokens: 100, cachedInputTokens },
      ]).cache,
    ).toMatchObject({
      observedCalls: 0,
      missingCalls: 1,
      observedCachedInputTokens: null,
    });
  },
);
