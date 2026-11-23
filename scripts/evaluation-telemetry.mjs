// Header observations describe one response, not assigned deployment capacity.
// Cache evidence explains usage; it never changes the authorized price model.
export function summarizeEvaluationTelemetry(receipts) {
  const eligible = receipts.filter((receipt) =>
    ['GENERATION', 'REVIEW'].includes(receipt.phase),
  );
  const observed = eligible.filter(
    (receipt) =>
      Number.isSafeInteger(receipt.cachedInputTokens) &&
      receipt.cachedInputTokens >= 0 &&
      Number.isSafeInteger(receipt.inputTokens) &&
      receipt.cachedInputTokens <= receipt.inputTokens,
  );
  return {
    cache: {
      eligibleCalls: eligible.length,
      observedCalls: observed.length,
      missingCalls: eligible.length - observed.length,
      observedCachedInputTokens:
        eligible.length && observed.length === eligible.length
          ? observed.reduce(
              (total, receipt) => total + receipt.cachedInputTokens,
              0,
            )
          : null,
    },
    rateLimitObservedCalls: receipts.filter(
      (receipt) =>
        receipt.rateLimits &&
        ['tokens', 'requests'].some((kind) =>
          ['limit', 'remaining', 'resetMs'].some((field) =>
            Number.isSafeInteger(receipt.rateLimits[kind]?.[field]),
          ),
        ),
    ).length,
    retryAfterObservedCalls: receipts.filter(
      (receipt) =>
        Number.isSafeInteger(receipt.retryAfterMs) && receipt.retryAfterMs >= 0,
    ).length,
    costBasis: 'UNDISCOUNTED_TOKEN_ESTIMATE',
  };
}
