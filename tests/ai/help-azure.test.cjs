const {
  AzureHelpAdapter,
  azureGenerationConfigurationFromEnv,
  buildHelpInput,
} = require('../../packages/ai/dist');
const config = {
  baseURL: 'https://fixture.openai.azure.com/openai/v1/',
  generationDeployment: 'generation-deployment',
  generationModel: 'gpt-4.1-mini-2025-04-14',
  verificationDeployment: 'generation-deployment',
  verificationModel: 'gpt-4.1-mini-2025-04-14',
  configurationId: 'help-fixture',
  tokenizer: 'o200k_base',
  authMode: 'api-key',
  apiKey: 'fictitious-key',
};
let prepared, candidate;
beforeAll(async () => {
  const fixture = await import('../../fixtures/ai/help-corpus.mjs');
  prepared = buildHelpInput(
    {
      context: fixture.helpContext,
      chunks: [fixture.helpChunk],
      kind: 'FEEDBACK',
      hintLevel: null,
    },
    config.tokenizer,
  );
  candidate = fixture.helpCandidates.FEEDBACK;
});
function response(content, changes = {}) {
  return new Response(
    JSON.stringify({
      id: 'fixture-chat',
      object: 'chat.completion',
      model: config.generationModel,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: JSON.stringify(content) },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      ...changes,
    }),
    {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'fixture-request',
      },
    },
  );
}
const signal = () => AbortSignal.timeout(5000);
describe('Azure help generation and independent review over controlled HTTP', () => {
  test('generation configuration is separate from embeddings and defaults review to same deployment', () => {
    expect(
      azureGenerationConfigurationFromEnv({
        AI_AZURE_BASE_URL: config.baseURL,
        AI_GENERATION_DEPLOYMENT: config.generationDeployment,
        AI_GENERATION_MODEL: config.generationModel,
        AI_GENERATION_CONFIGURATION_ID: config.configurationId,
        AI_GENERATION_TOKENIZER: config.tokenizer,
        AI_AUTH_MODE: 'api-key',
        AI_AZURE_API_KEY: config.apiKey,
        AI_CONFIGURATION_ID: 'a-different-embedding-id',
      }),
    ).toEqual(config);
  });
  test.each([
    { ...config, configurationId: '' },
    { ...config, tokenizer: 'unknown' },
    { ...config, tokenizer: 'cl100k_base' },
    { ...config, verificationModel: 'gpt-4' },
    { ...config, generationModel: 'unknown-model' },
    { ...config, authMode: 'azure-cli' },
    { ...config, baseURL: 'https://attacker.invalid/openai/v1/' },
    { ...config, baseURL: 'http://fixture.openai.azure.com/openai/v1/' },
  ])('rejects invalid explicit configuration before transport', (value) => {
    expect(() => new AzureHelpAdapter(value)).toThrow('INVALID_CONFIGURATION');
  });
  test('calls generation and verification with distinct schemas, original context, no tools, limits and exact citations', async () => {
    const review = {
      verdict: 'ACCEPT',
      reason: 'SUPPORTED',
      source_refs: candidate.source_refs,
    };
    const transport = jest
      .fn()
      .mockImplementationOnce(async () => response(candidate))
      .mockImplementationOnce(async () => response(review));
    const adapter = new AzureHelpAdapter(config, transport);
    expect(await adapter.generate(prepared, signal())).toEqual({
      candidate,
      usage: {
        model: config.generationModel,
        inputTokens: 100,
        outputTokens: 50,
        requestId: 'fixture-request',
      },
    });
    expect(await adapter.verify(prepared, candidate, signal())).toEqual({
      verification: review,
      usage: {
        model: config.generationModel,
        inputTokens: 100,
        outputTokens: 50,
        requestId: 'fixture-request',
      },
    });
    expect(transport).toHaveBeenCalledTimes(2);
    const requests = transport.mock.calls.map(([url, options]) => {
      expect(String(url)).toBe(`${config.baseURL}chat/completions`);
      return JSON.parse(options.body);
    });
    expect(requests.map((request) => request.max_completion_tokens)).toEqual([
      2048, 512,
    ]);
    expect(
      requests.map((request) => request.response_format.json_schema.name),
    ).toEqual(['alunza_help', 'alunza_help_review']);
    for (const request of requests) {
      expect(request.model).toBe(config.generationDeployment);
      expect(request.tools).toBeUndefined();
      expect(request.response_format.json_schema.strict).toBe(true);
      expect(request.messages[0].role).toBe('system');
      expect(request.messages[1].content).not.toContain('fictitious-key');
    }
    expect(JSON.parse(requests[0].messages[1].content)).toEqual(prepared);
    expect(JSON.parse(requests[1].messages[1].content)).toEqual({
      context: prepared,
      candidate,
    });
    expect(requests[1].messages[0].content).toContain('help-review-es-1');
    expect(adapter.usage).toBeUndefined();
    expect(adapter.lastUsage).toBeUndefined();
  });
  test.each([
    {},
    { usage: null },
    { usage: {} },
    { usage: { prompt_tokens: -1, completion_tokens: 0.5 } },
    { usage: { prompt_tokens: '12' } },
  ])('missing or malformed usage stays unknown %p', async (metadata) => {
    const transport = jest.fn(async () =>
      response(candidate, { usage: undefined, ...metadata }),
    );
    expect(
      (
        await new AzureHelpAdapter(config, transport).generate(
          prepared,
          signal(),
        )
      ).usage,
    ).toBeUndefined();
  });
  test('explicit zero usage remains zero and valid partial usage remains partial', async () => {
    const adapter = new AzureHelpAdapter(
      config,
      jest.fn(async () => response(candidate, { usage: { prompt_tokens: 0 } })),
    );
    expect((await adapter.generate(prepared, signal())).usage).toEqual({
      model: config.generationModel,
      inputTokens: 0,
      requestId: 'fixture-request',
    });
  });
  test.each([429, 500, 503])(
    'HTTP %i performs zero retries and sanitizes provider errors',
    async (status) => {
      const transport = jest.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: { message: 'SECRET_RESPONSE', code: 'fixture' },
            }),
            {
              status,
              headers: {
                'content-type': 'application/json',
                'retry-after': '0',
              },
            },
          ),
      );
      await expect(
        new AzureHelpAdapter(config, transport).generate(prepared, signal()),
      ).rejects.toMatchObject({
        message: 'PROVIDER_UNAVAILABLE',
        code: 'PROVIDER_UNAVAILABLE',
      });
      expect(transport).toHaveBeenCalledTimes(1);
    },
  );
  test('cancellation before dispatch does not call provider', async () => {
    const transport = jest.fn();
    const abort = new AbortController();
    abort.abort();
    await expect(
      new AzureHelpAdapter(config, transport).generate(prepared, abort.signal),
    ).rejects.toThrow('CANCELLED');
    expect(transport).not.toHaveBeenCalled();
  });
  test('propagates cancellation during transport without retry', async () => {
    const abort = new AbortController();
    const transport = jest.fn(async () => {
      abort.abort();
      throw new Error('private details');
    });
    await expect(
      new AzureHelpAdapter(config, transport).generate(prepared, abort.signal),
    ).rejects.toThrow('CANCELLED');
    expect(transport).toHaveBeenCalledTimes(1);
  });
  test('deadline cancellation does not wait for a transport that ignores abort', async () => {
    let release;
    const transport = jest.fn(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const abort = new AbortController();
    const pending = new AzureHelpAdapter(config, transport).generate(
      prepared,
      abort.signal,
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    abort.abort();
    await expect(pending).rejects.toThrow('CANCELLED');
    release(response(candidate));
    expect(transport).toHaveBeenCalledTimes(1);
  });
  test.each([
    { model: 'unexpected-model' },
    { choices: [] },
    { choices: [{ message: { content: '{}' }, finish_reason: 'length' }] },
    {
      choices: [
        {
          message: { content: '{}', refusal: 'refused' },
          finish_reason: 'stop',
        },
      ],
    },
    { choices: [{ message: { content: 'not json' }, finish_reason: 'stop' }] },
    {
      choices: [
        { message: { content: '{}', tool_calls: [{}] }, finish_reason: 'stop' },
      ],
    },
  ])('rejects invalid provider result %p', async (changes) => {
    const transport = jest.fn(async () => response(candidate, changes));
    await expect(
      new AzureHelpAdapter(config, transport).generate(prepared, signal()),
    ).rejects.toMatchObject({
      code: 'INVALID_OUTPUT',
      usage: {
        model: changes.model ?? config.generationModel,
        inputTokens: 100,
        outputTokens: 50,
        requestId: 'fixture-request',
      },
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  test.each(['malformed-json', 'schema', 'diagnosis', 'reference', 'review'])(
    'retains observed usage on rejected %s without retaining raw content',
    async (kind) => {
      let value = { ...candidate, explanation: 'PRIVATE_CANDIDATE_CONTENT' };
      const changes = {};
      if (kind === 'malformed-json')
        changes.choices = [
          {
            message: { content: 'PRIVATE_INVALID_JSON' },
            finish_reason: 'stop',
          },
        ];
      if (kind === 'schema') value.score = 10;
      if (kind === 'diagnosis') value.diagnosis_code = 'SUCCESS';
      if (kind === 'reference')
        value.source_refs = [
          { ...candidate.source_refs[0], locator: 'PRIVATE_BAD_LOCATOR' },
        ];
      if (kind === 'review')
        value = {
          verdict: 'ACCEPT',
          reason: 'DIAGNOSIS_CONTRADICTION',
          source_refs: [],
          private: 'PRIVATE_REVIEW',
        };
      const transport = jest.fn(async () => response(value, changes));
      const adapter = new AzureHelpAdapter(config, transport);
      const result = await (
        kind === 'review'
          ? adapter.verify(prepared, candidate, signal())
          : adapter.generate(prepared, signal())
      ).catch((error) => error);
      expect(result).toMatchObject({
        code: 'INVALID_OUTPUT',
        usage: {
          model: config.generationModel,
          inputTokens: 100,
          outputTokens: 50,
          requestId: 'fixture-request',
        },
      });
      expect(JSON.stringify(result)).not.toContain('PRIVATE');
      expect(result.cause).toBeUndefined();
      expect(transport).toHaveBeenCalledTimes(1);
    },
  );
  test.each([
    undefined,
    null,
    {},
    { prompt_tokens: -1, completion_tokens: '3' },
  ])(
    'rejected response with unobserved metrics %p retains unknown usage',
    async (usage) => {
      const adapter = new AzureHelpAdapter(
        config,
        jest.fn(async () => response({ ...candidate, score: 10 }, { usage })),
      );
      const error = await adapter
        .generate(prepared, signal())
        .catch((error) => error);
      expect(error.code).toBe('INVALID_OUTPUT');
      expect(error.usage).toBeUndefined();
    },
  );
  test('unsafe observed model/request ID are omitted without dropping valid zero/partial metrics', async () => {
    const transport = jest.fn(async () => {
      const result = response(
        { ...candidate, score: 10 },
        {
          model: 'PRIVATE/model',
          usage: { prompt_tokens: 0, completion_tokens: null },
        },
      );
      result.headers.set('x-request-id', 'PRIVATE/request');
      return result;
    });
    const error = await new AzureHelpAdapter(config, transport)
      .generate(prepared, signal())
      .catch((error) => error);
    expect(error.code).toBe('INVALID_OUTPUT');
    expect(error.usage).toEqual({ inputTokens: 0 });
    expect(JSON.stringify(error)).not.toContain('PRIVATE');
  });
  test('rejects an invalid prepared checkpoint and candidate before external dispatch', async () => {
    const transport = jest.fn();
    const adapter = new AzureHelpAdapter(config, transport);
    await expect(
      adapter.generate({ ...prepared, hiddenTests: ['private'] }, signal()),
    ).rejects.toThrow('INVALID_CONTEXT');
    await expect(
      adapter.verify(
        prepared,
        { ...candidate, diagnosis_code: 'SUCCESS' },
        signal(),
      ),
    ).rejects.toThrow('INVALID_OUTPUT');
    expect(transport).not.toHaveBeenCalled();
  });
});
