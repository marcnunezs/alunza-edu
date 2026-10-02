/** Accounting evidence only. Never contains prompts, vectors, candidates or errors. */
export interface AiSettlement {
  phase: 'EMBEDDING' | 'GENERATION' | 'REVIEW';
  outcome: 'RESPONSE' | 'ERROR';
  settledAt: string;
  aborted: boolean;
  model?: string;
  requestId?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
  httpStatus?: number;
  retryable?: boolean;
  retryAfterMs?: number;
}
export type AiSettlementObserver = (
  event: AiSettlement,
) => void | Promise<void>;

const safeLabel = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,128}$/u.test(value);
const counter = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

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
      usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
    };
    if (safeLabel(value.model)) metadata.model = value.model;
    const input = value.usage?.prompt_tokens;
    const output = value.usage?.completion_tokens;
    if (counter(input) || counter(output))
      metadata.usage = {
        ...(counter(input) ? { inputTokens: input } : {}),
        ...(counter(output) ? { outputTokens: output } : {}),
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
      const status: Partial<AiSettlement> = {
        ...(response.status >= 100 && response.status <= 599
          ? { httpStatus: response.status }
          : {}),
      };
      if (!response.ok) {
        status.retryable =
          response.status === 408 ||
          response.status === 429 ||
          response.status >= 500;
        const seconds = Number(response.headers.get('retry-after'));
        if (status.retryable && Number.isFinite(seconds) && seconds > 0)
          status.retryAfterMs = Math.min(300_000, Math.ceil(seconds * 1000));
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
