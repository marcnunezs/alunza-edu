const {
  AzureHelpAdapter,
  AzureEmbeddingsAdapter,
  buildHelpInput,
  observeAiTransport,
  readRetryAfterMs,
} = require('../../packages/ai/dist');
const generation = {
  baseURL: 'https://fixture.openai.azure.com/openai/v1/',
  generationDeployment: 'generation',
  generationModel: 'gpt-4.1-mini-2025-04-14',
  verificationDeployment: 'generation',
  verificationModel: 'gpt-4.1-mini-2025-04-14',
  configurationId: 'settlement-test',
  tokenizer: 'o200k_base',
  authMode: 'api-key',
  apiKey: 'fictitious-key',
};
const embedding = {
  baseURL: generation.baseURL,
  embeddingDeployment: 'embedding',
  embeddingModel: 'text-embedding-3-small',
  configurationId: 'embed-test',
  dimensions: 3,
  authMode: 'api-key',
  apiKey: 'fictitious-key',
};
let input, candidate;
beforeAll(async () => {
  const fixture = await import('../../fixtures/ai/help-corpus.mjs');
  input = buildHelpInput(
    {
      context: fixture.helpContext,
      chunks: [fixture.helpChunk],
      kind: 'FEEDBACK',
      hintLevel: null,
    },
    generation.tokenizer,
  );
  candidate = fixture.helpCandidates.FEEDBACK;
});
test('settlement sanitizes observed metadata and preserves explicit zero without inventing missing counters', async () => {
  const events = [];
  const wrapped = observeAiTransport(
    async () =>
      new Response(
        JSON.stringify({
          model: 'PRIVATE/model',
          usage: { prompt_tokens: 0, completion_tokens: -1 },
          candidate: 'PRIVATE_CONTENT',
        }),
        { headers: { 'x-request-id': 'PRIVATE/request' } },
      ),
    (value) => {
      events.push(value);
    },
    'GENERATION',
  );
  await wrapped('https://fixture.openai.azure.com/openai/v1/chat/completions');
  expect(events).toHaveLength(1);
  expect(events[0].usage).toEqual({ inputTokens: 0 });
  expect(events[0].model).toBeUndefined();
  expect(events[0].requestId).toBeUndefined();
  expect(JSON.stringify(events)).not.toContain('PRIVATE');
});
test('malformed response body still records a confirmed response with unknown usage', async () => {
  const events = [];
  const wrapped = observeAiTransport(
    async () =>
      new Response('PRIVATE_INVALID_JSON', {
        headers: { 'x-request-id': 'safe-id' },
      }),
    (value) => {
      events.push(value);
    },
    'REVIEW',
  );
  await wrapped('https://fixture.openai.azure.com/openai/v1/chat/completions');
  expect(events[0]).toMatchObject({
    phase: 'REVIEW',
    outcome: 'RESPONSE',
    requestId: 'safe-id',
  });
  expect(events[0].usage).toBeUndefined();
  expect(JSON.stringify(events)).not.toContain('PRIVATE');
});
test('HTTP failure waits for accounting acknowledgement before SDK receives the response', async () => {
  let acknowledge, observed;
  const reached = new Promise((resolve) => {
    observed = resolve;
  });
  const accounting = new Promise((resolve) => {
    acknowledge = resolve;
  });
  const transport = observeAiTransport(
    async () => new Response('{}', { status: 429 }),
    async () => {
      observed();
      await accounting;
    },
    'EMBEDDING',
  );
  let delivered = false;
  const pending = transport(
    'https://fixture.openai.azure.com/openai/v1/embeddings',
  ).then(() => {
    delivered = true;
  });
  await reached;
  expect(delivered).toBe(false);
  acknowledge();
  await pending;
  expect(delivered).toBe(true);
});
function response(phase, changes = {}, status = 200) {
  const content =
    phase === 'REVIEW'
      ? {
          verdict: 'ACCEPT',
          reason: 'SUPPORTED',
          source_refs: candidate.source_refs,
        }
      : candidate;
  return new Response(
    JSON.stringify({
      model:
        phase === 'EMBEDDING'
          ? embedding.embeddingModel
          : generation.generationModel,
      ...(phase === 'EMBEDDING'
        ? { data: [{ index: 0, embedding: [1, 0, 0] }] }
        : {
            choices: [
              {
                message: { content: JSON.stringify(content) },
                finish_reason: 'stop',
              },
            ],
          }),
      usage: {
        prompt_tokens: 15,
        ...(phase === 'EMBEDDING' ? {} : { completion_tokens: 7 }),
      },
      ...changes,
    }),
    {
      status,
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'safe-request',
        'retry-after': '2',
      },
    },
  );
}
function invoke(phase, transport, signal, observe) {
  if (phase === 'EMBEDDING')
    return new AzureEmbeddingsAdapter(embedding, transport).embed(
      ['retorno'],
      signal,
      observe,
    );
  const adapter = new AzureHelpAdapter(generation, transport);
  return phase === 'GENERATION'
    ? adapter.generate(input, signal, observe)
    : adapter.verify(input, candidate, signal, observe);
}
async function event(events) {
  for (let index = 0; index < 100 && !events.length; index++)
    await new Promise((resolve) => setTimeout(resolve, 5));
  expect(events).toHaveLength(1);
  return events[0];
}
describe.each(['EMBEDDING', 'GENERATION', 'REVIEW'])(
  '%s transport settlements',
  (phase) => {
    test('records a late paid response after abort without publishing its payload', async () => {
      let release, reached;
      const reachedFetch = new Promise((resolve) => {
        reached = resolve;
      });
      const transport = jest.fn(() => {
        reached();
        return new Promise((resolve) => {
          release = resolve;
        });
      });
      const controller = new AbortController(),
        events = [];
      const pending = invoke(phase, transport, controller.signal, (value) =>
        events.push(value),
      ).catch((error) => error);
      await reachedFetch;
      controller.abort();
      release(response(phase));
      const result = await pending;
      expect(result).toBeInstanceOf(Error);
      expect(await event(events)).toMatchObject({
        phase,
        outcome: 'RESPONSE',
        aborted: true,
        httpStatus: 200,
        requestId: 'safe-request',
        usage: { inputTokens: 15 },
      });
      expect(JSON.stringify(events)).not.toMatch(
        /fictitious-key|explanation|source_refs|"embedding"|choices/,
      );
      expect(transport).toHaveBeenCalledTimes(1);
    });
    test.each([429, 500, 503])(
      'records confirmed HTTP %i without SDK retries or error-body leakage',
      async (status) => {
        const events = [],
          transport = jest.fn(async () =>
            response(
              phase,
              {
                error: { message: 'PRIVATE_ERROR' },
                model: undefined,
                usage: undefined,
              },
              status,
            ),
          );
        await expect(
          invoke(phase, transport, new AbortController().signal, (value) =>
            events.push(value),
          ),
        ).rejects.toBeInstanceOf(Error);
        expect(await event(events)).toMatchObject({
          phase,
          outcome: 'ERROR',
          httpStatus: status,
          retryable: true,
          retryAfterMs: 2000,
        });
        expect(events[0].usage).toBeUndefined();
        expect(JSON.stringify(events)).not.toContain('PRIVATE');
        expect(transport).toHaveBeenCalledTimes(1);
      },
    );
    test('network uncertainty has no fabricated HTTP status or zero metrics', async () => {
      const events = [];
      await expect(
        invoke(
          phase,
          jest.fn(async () => {
            throw new Error('PRIVATE_NETWORK');
          }),
          new AbortController().signal,
          (value) => events.push(value),
        ),
      ).rejects.toBeInstanceOf(Error);
      expect(await event(events)).toMatchObject({ phase, outcome: 'ERROR' });
      expect(events[0].httpStatus).toBeUndefined();
      expect(events[0].usage).toBeUndefined();
      expect(JSON.stringify(events)).not.toContain('PRIVATE');
    });
    test('observer failures do not change the pedagogical result or repeat transport', async () => {
      const transport = jest.fn(async () => response(phase));
      const observer = jest.fn(async () => {
        throw new Error('PRIVATE_LEDGER');
      });
      await invoke(phase, transport, new AbortController().signal, observer);
      for (let index = 0; index < 100 && !observer.mock.calls.length; index++)
        await new Promise((resolve) => setTimeout(resolve, 5));
      expect(observer).toHaveBeenCalledTimes(1);
      expect(transport).toHaveBeenCalledTimes(1);
    });
    test('abort before dispatch creates no settlement or request', async () => {
      const controller = new AbortController();
      controller.abort();
      const transport = jest.fn(),
        observer = jest.fn();
      await expect(
        invoke(phase, transport, controller.signal, observer),
      ).rejects.toBeInstanceOf(Error);
      expect(transport).not.toHaveBeenCalled();
      expect(observer).not.toHaveBeenCalled();
    });
  },
);

describe('safe Azure response metadata', () => {
  const now = Date.parse('Sun, 04 Oct 2026 12:00:00 GMT');
  test.each([
    [{ 'retry-after-ms': '1250', 'retry-after': '9' }, 1250],
    [{ 'retry-after-ms': '0', 'retry-after': '9' }, 0],
    [{ 'retry-after-ms': '1.1' }, 2],
    [{ 'retry-after-ms': '999999' }, 300000],
    [{ 'retry-after-ms': '-1', 'retry-after': '2.5' }, 2500],
    [{ 'retry-after-ms': 'invalid', 'retry-after': '2' }, 2000],
    [{ 'retry-after': '0' }, 0],
    [{ 'retry-after': '999' }, 300000],
    [{ 'retry-after': 'Sun, 04 Oct 2026 12:00:02 GMT' }, 2000],
    [{ 'retry-after': 'Sunday, 04-Oct-26 12:00:02 GMT' }, 2000],
    [{ 'retry-after': 'Sun Oct  4 12:00:02 2026' }, 2000],
    [{ 'retry-after': 'Sun, 04 Oct 2026 11:59:59 GMT' }, 0],
    [{ 'retry-after': 'Sun, 04 Oct 2026 13:00:00 GMT' }, 300000],
    [{ 'retry-after-ms': '1e3', 'retry-after': 'invalid' }, undefined],
    [{ 'retry-after-ms': 'Infinity' }, undefined],
    [{ 'retry-after': '-2' }, undefined],
    [{ 'retry-after': '2026-10-04' }, undefined],
    [{}, undefined],
  ])('validates retry headers %j without hidden waits', (headers, expected) => {
    expect(readRetryAfterMs(new Headers(headers), now)).toBe(expected);
  });
  test('missing headers preserve unknown retry timing', () => {
    expect(readRetryAfterMs(undefined, now)).toBeUndefined();
  });
  async function settlement(headers, usage) {
    const events = [];
    await observeAiTransport(
      async () => new Response(JSON.stringify({ usage }), { headers }),
      (value) => events.push(value),
      'GENERATION',
    )('https://fixture.openai.azure.com/openai/v1/chat/completions');
    expect(events).toHaveLength(1);
    return events[0];
  }
  test('records only allowlisted numeric quota headers in milliseconds', async () => {
    const observed = await settlement({
      'x-ratelimit-limit-tokens': '201000',
      'x-ratelimit-remaining-tokens': '0',
      'x-ratelimit-reset-tokens': '2.5',
      'x-ratelimit-limit-requests': '201',
      'x-ratelimit-remaining-requests': '200',
      'x-ratelimit-reset-requests': '1m2s3ms',
      authorization: 'PRIVATE_AUTHORIZATION',
      'set-cookie': 'PRIVATE_COOKIE',
      'x-ratelimit-private': 'PRIVATE_QUOTA',
    });
    expect(observed.rateLimits).toEqual({
      tokens: { limit: 201000, remaining: 0, resetMs: 2500 },
      requests: { limit: 201, remaining: 200, resetMs: 62003 },
    });
    expect(JSON.stringify(observed)).not.toContain('PRIVATE');
  });
  test('omits malformed and inconsistent quota fields without inventing counters', async () => {
    const observed = await settlement({
      'x-ratelimit-limit-tokens': '1e3',
      'x-ratelimit-remaining-tokens': '5',
      'x-ratelimit-reset-tokens': '-1',
      'x-ratelimit-limit-requests': '0',
      'x-ratelimit-remaining-requests': '1',
      'x-ratelimit-reset-requests': 'PRIVATE_RESET',
    });
    expect(observed.rateLimits).toEqual({
      tokens: { remaining: 5 },
      requests: { limit: 0 },
    });
    expect(JSON.stringify(observed)).not.toContain('PRIVATE');
    const invalid = await settlement({
      'x-ratelimit-limit-tokens': '9007199254740992',
      'x-ratelimit-remaining-tokens': '0.5',
      'x-ratelimit-reset-tokens': '9007199254740992s',
    });
    expect(invalid.rateLimits).toBeUndefined();
    expect((await settlement({})).rateLimits).toBeUndefined();
  });
  test('retains quota headers when the response body cannot be cloned', async () => {
    const events = [];
    await observeAiTransport(
      async () => {
        const result = new Response('PRIVATE_CONTENT', {
          status: 429,
          headers: {
            'retry-after-ms': '1500',
            'retry-after': '2',
            'x-ratelimit-remaining-tokens': '0',
          },
        });
        await result.text();
        return result;
      },
      (value) => events.push(value),
      'EMBEDDING',
    )('https://fixture.openai.azure.com/openai/v1/embeddings');
    expect(events[0]).toMatchObject({
      httpStatus: 429,
      retryAfterMs: 1500,
      rateLimits: { tokens: { remaining: 0 } },
    });
    expect(events[0].usage).toBeUndefined();
    expect(JSON.stringify(events)).not.toContain('PRIVATE');
  });
  test.each([0, 12, 15])(
    'keeps explicit bounded cached tokens %i',
    async (cached) => {
      const observed = await settlement(
        {},
        {
          prompt_tokens: 15,
          completion_tokens: 7,
          prompt_tokens_details: { cached_tokens: cached, private: 'PRIVATE' },
        },
      );
      expect(observed.usage).toEqual({
        inputTokens: 15,
        outputTokens: 7,
        cachedInputTokens: cached,
      });
      expect(JSON.stringify(observed)).not.toContain('PRIVATE');
    },
  );
  test.each([null, -1, 0.5, '12', 16, 9007199254740992])(
    'omits invalid cached usage %j without altering total consumption',
    async (cached) => {
      const observed = await settlement(
        {},
        {
          prompt_tokens: 15,
          completion_tokens: 7,
          prompt_tokens_details: { cached_tokens: cached },
        },
      );
      expect(observed.usage).toEqual({ inputTokens: 15, outputTokens: 7 });
    },
  );
  test('cached tokens without valid input consumption remain unknown', async () => {
    const observed = await settlement(
      {},
      {
        completion_tokens: 7,
        prompt_tokens_details: { cached_tokens: 0 },
      },
    );
    expect(observed.usage).toEqual({ outputTokens: 7 });
  });
});
