/* eslint @typescript-eslint/no-require-imports: "off" */
const { randomUUID } = require('node:crypto');
// Same accounting boundary as production transports: observer failure cannot
// replace the provider result, repeat a request, or publish a late candidate.
function notify(observer, event) {
  if (!observer) return;
  try {
    void Promise.resolve(observer(event)).catch(() => undefined);
  } catch {
    /* isolated observer */
  }
}
async function observedCall(phase, signal, observer, operation) {
  const base = {
    phase,
    model: 'test-fixture-only',
    requestId: `fixture-${randomUUID()}`,
  };
  try {
    const result = await operation();
    notify(observer, {
      ...base,
      outcome: 'RESPONSE',
      settledAt: new Date().toISOString(),
      aborted: signal.aborted,
      httpStatus: 200,
      ...(result?.usage
        ? {
            usage: {
              inputTokens: result.usage.inputTokens,
              outputTokens: result.usage.outputTokens,
            },
          }
        : {}),
    });
    return result;
  } catch (error) {
    notify(observer, {
      ...base,
      outcome: 'ERROR',
      settledAt: new Date().toISOString(),
      aborted: signal.aborted,
      ...(!signal.aborted
        ? {
            httpStatus: error.httpStatus ?? (error.retryable ? 429 : 503),
            retryable: error.retryable ?? true,
            ...(error.retryAfterMs === undefined
              ? {}
              : { retryAfterMs: error.retryAfterMs }),
          }
        : {}),
    });
    throw error;
  }
}
module.exports = { observedCall };
