const {
  AzureHelpAdapter,
  AzureEmbeddingsAdapter,
  buildHelpInput,
  observeAiTransport,
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
