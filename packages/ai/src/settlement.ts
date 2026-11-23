export interface AiRateLimit {
  limit?: number;
  remaining?: number;
  resetMs?: number;
}
export interface AiRateLimits {
  tokens?: AiRateLimit;
  requests?: AiRateLimit;
}
/** Accounting evidence only. Never contains prompts, vectors, candidates or errors. */
export interface AiSettlement {
  phase: 'EMBEDDING' | 'GENERATION' | 'REVIEW';
  outcome: 'RESPONSE' | 'ERROR';
  settledAt: string;
  aborted: boolean;
  model?: string;
  requestId?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cachedInputTokens?: number;
  };
  httpStatus?: number;
  retryable?: boolean;
  retryAfterMs?: number;
  rateLimits?: AiRateLimits;
}
export type AiSettlementObserver = (
  event: AiSettlement,
) => void | Promise<void>;

const safeLabel = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,128}$/u.test(value);
const counter = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

function headerNumber(value: string | null): number | undefined {
  if (value === null || value.length > 128) return undefined;
  const text = value.trim();
  if (!/^\d+(?:\.\d+)?$/u.test(text)) return undefined;
  const number = Number(text);
  return Number.isFinite(number) ? number : undefined;
}

/** Read only the documented wait headers; never retain arbitrary header values. */
export function readRetryAfterMs(
  headers: Pick<Headers, 'get'> | null | undefined,
  nowMs = Date.now(),
): number | undefined {
  if (!headers) return undefined;
  const milliseconds = headerNumber(headers.get('retry-after-ms'));
  if (milliseconds !== undefined)
    return Math.min(300_000, Math.ceil(milliseconds));
  const value = headers.get('retry-after');
  const seconds = headerNumber(value);
  if (seconds !== undefined)
    return Math.min(300_000, Math.ceil(seconds * 1000));
  if (value === null || value.length > 128 || !Number.isFinite(nowMs))
    return undefined;
  const text = value.trim();
  // HTTP dates include the preferred IMF-fixdate and its two legacy forms.
  if (
    !/^(?:[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT|[A-Z][a-z]+, \d{2}-[A-Z][a-z]{2}-\d{2} \d{2}:\d{2}:\d{2} GMT|[A-Z][a-z]{2} [A-Z][a-z]{2} {1,2}\d{1,2} \d{2}:\d{2}:\d{2} \d{4})$/u.test(
      text,
    )
  )
    return undefined;
  const deadline = Date.parse(text.endsWith(' GMT') ? text : `${text} GMT`);
  return Number.isFinite(deadline)
    ? Math.min(300_000, Math.max(0, Math.ceil(deadline - nowMs)))
    : undefined;
}

function resetMilliseconds(value: string | null): number | undefined {
  const seconds = headerNumber(value);
  if (seconds !== undefined) {
    const milliseconds = Math.ceil(seconds * 1000);
    return counter(milliseconds) ? milliseconds : undefined;
  }
  if (value === null || value.length > 128) return undefined;
  const parts =
    /^(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?(?:(\d+(?:\.\d+)?)ms)?$/u.exec(
      value.trim(),
    );
  if (!parts || !parts.slice(1).some((part) => part !== undefined))
    return undefined;
  const multipliers = [3_600_000, 60_000, 1000, 1];
  let total = 0;
  for (const [index, multiplier] of multipliers.entries()) {
    const part = parts[index + 1];
    if (part !== undefined) total += Number(part) * multiplier;
  }
  const milliseconds = Math.ceil(total);
  return counter(milliseconds) ? milliseconds : undefined;
}

function rateLimits(headers: Headers): AiRateLimits | undefined {
  const limits: AiRateLimits = {};
  for (const kind of ['tokens', 'requests'] as const) {
    const observed: AiRateLimit = {};
    for (const field of ['limit', 'remaining'] as const) {
      const value = headers.get(`x-ratelimit-${field}-${kind}`);
      if (value === null || value.length > 128 || !/^\d+$/u.test(value.trim()))
        continue;
      const number = headerNumber(value);
      if (counter(number)) observed[field] = number;
    }
    if (
      observed.limit !== undefined &&
      observed.remaining !== undefined &&
      observed.remaining > observed.limit
    )
      delete observed.remaining;
    const resetMs = resetMilliseconds(headers.get(`x-ratelimit-reset-${kind}`));
    if (resetMs !== undefined) observed.resetMs = resetMs;
    if (Object.keys(observed).length) limits[kind] = observed;
  }
  return Object.keys(limits).length ? limits : undefined;
}

async function notify(
  observer: AiSettlementObserver,
  event: AiSettlement,
): Promise<void> {
  // Accounting persistence has its own durable retry/reconciliation policy. A
  // failed observer must not repeat a paid request or publish a late candidate.
  try {
    await observer(event);
  } catch {
    // Never log an observer error: it may contain database or request details.
  }
}

async function responseMetadata(
  response: Response,
): Promise<Partial<AiSettlement>> {
  const requestId =
    response.headers.get('x-request-id') ??
    response.headers.get('apim-request-id');
  const metadata: Partial<AiSettlement> = {
    ...(safeLabel(requestId) ? { requestId } : {}),
  };
  // Embedding batches can exceed a chat response's limit. Bound this independent
  // accounting reader as well; oversized or malformed usage remains unknown.
  const maximum = 8 * 1024 * 1024;
  const reader = response.body?.getReader();
  if (!reader) return metadata;
  const parts: Uint8Array[] = [];
  let size = 0;
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error('Accounting read expired')),
      30_000,
    );
    timer.unref();
  });
  try {
    while (true) {
      const next = await Promise.race([reader.read(), expired]);
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maximum) {
        void reader.cancel().catch(() => undefined);
        return metadata;
      }
      parts.push(next.value);
    }
    const raw: unknown = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts)),
    );
    if (!raw || typeof raw !== 'object') return metadata;
    const value = raw as {
      model?: unknown;
      usage?: {
        prompt_tokens?: unknown;
        completion_tokens?: unknown;
        prompt_tokens_details?: { cached_tokens?: unknown };
      };
    };
    if (safeLabel(value.model)) metadata.model = value.model;
    const input = value.usage?.prompt_tokens;
    const output = value.usage?.completion_tokens;
    const cached = value.usage?.prompt_tokens_details?.cached_tokens;
    if (counter(input) || counter(output))
      metadata.usage = {
        ...(counter(input) ? { inputTokens: input } : {}),
        ...(counter(output) ? { outputTokens: output } : {}),
        ...(counter(input) && counter(cached) && cached <= input
          ? { cachedInputTokens: cached }
          : {}),
      };
  } catch {
    // A response without readable metrics does not establish zero consumption.
    void reader.cancel().catch(() => undefined);
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
  return metadata;
}

/** Observe fetch itself: an SDK may reject after abort despite a later response.
 * Reading a clone keeps that later usage available without restoring pedagogy. */
export function observeAiTransport(
  transport: typeof fetch,
  observer: AiSettlementObserver | undefined,
  phase:
    AiSettlement['phase'] | ((init?: RequestInit) => AiSettlement['phase']),
): typeof fetch {
  if (!observer) return transport;
  return async (input, init) => {
    const callPhase = typeof phase === 'function' ? phase(init) : phase;
    try {
      const response = await transport(input, init);
      const observedLimits = rateLimits(response.headers);
      const status: Partial<AiSettlement> = {
        ...(response.status >= 100 && response.status <= 599
          ? { httpStatus: response.status }
          : {}),
        ...(observedLimits ? { rateLimits: observedLimits } : {}),
      };
      if (!response.ok) {
        status.retryable =
          response.status === 408 ||
          response.status === 429 ||
          response.status >= 500;
        const retryAfterMs = readRetryAfterMs(response.headers);
        if (status.retryable && retryAfterMs !== undefined)
          status.retryAfterMs = retryAfterMs;
      }
      let copy: Response;
      try {
        copy = response.clone();
      } catch {
        await notify(observer, {
          phase: callPhase,
          outcome: response.ok ? 'RESPONSE' : 'ERROR',
          settledAt: new Date().toISOString(),
          aborted: init?.signal?.aborted ?? false,
          ...status,
        });
        return response;
      }
      const metadata = await responseMetadata(copy);
      await notify(observer, {
        phase: callPhase,
        outcome: response.ok ? 'RESPONSE' : 'ERROR',
        settledAt: new Date().toISOString(),
        aborted: init?.signal?.aborted ?? false,
        ...metadata,
        ...status,
      });
      return response;
    } catch (error) {
      await notify(observer, {
        phase: callPhase,
        outcome: 'ERROR',
        settledAt: new Date().toISOString(),
        aborted: init?.signal?.aborted ?? false,
      });
      throw error;
    }
  };
}
