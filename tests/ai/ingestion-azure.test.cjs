const {
  AzureEmbeddingsAdapter,
  azureEmbeddingConfigurationFromEnv,
} = require('../../packages/ai/dist');
const config = {
  baseURL: 'https://fixture.openai.azure.com/openai/v1/',
  embeddingDeployment: 'embedding-deployment',
  embeddingModel: 'text-embedding-3-small',
  configurationId: 'ingestion-test',
  dimensions: 3,
  authMode: 'api-key',
  apiKey: 'fictitious-key',
};
function response(
  data,
  model = config.embeddingModel,
  metadata = { usage: { prompt_tokens: 7, total_tokens: 7 } },
) {
  return new Response(
    JSON.stringify({
      object: 'list',
      model,
      data,
      ...metadata,
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
describe('RF-006 Azure ingestion SDK with simulated HTTP and zero remote calls', () => {
  test('embedding configuration does not require a generation deployment', () => {
    expect(
      azureEmbeddingConfigurationFromEnv({
        AI_AZURE_BASE_URL: config.baseURL,
        AI_EMBEDDING_DEPLOYMENT: config.embeddingDeployment,
        AI_EMBEDDING_MODEL: config.embeddingModel,
        AI_CONFIGURATION_ID: config.configurationId,
        AI_EMBEDDING_DIMENSIONS: '3',
        AI_AUTH_MODE: 'api-key',
        AI_AZURE_API_KEY: 'fictitious-key',
      }),
    ).toEqual(config);
  });
  test.each([
    { ...config, embeddingModel: 'unknown-model' },
    { ...config, embeddingModel: 'text-embedding-ada-002', dimensions: 3 },
    { ...config, dimensions: 1537 },
    { ...config, baseURL: 'http://fixture.openai.azure.com/openai/v1/' },
    { ...config, authMode: 'azure-cli' },
  ])(
    'rejects incompatible configuration without leaking credentials',
    (settings) => {
      expect(() => new AzureEmbeddingsAdapter(settings)).toThrow(
        'INVALID_CONFIGURATION',
      );
    },
  );
  test('requests configured dimensions and reorders indexed responses', async () => {
    const transport = jest.fn(async () =>
      response([
        { index: 1, embedding: [0, 1, 0] },
        { index: 0, embedding: [1, 0, 0] },
      ]),
    );
    const adapter = new AzureEmbeddingsAdapter(config, transport);
    expect(
      await adapter.embed(['hello', 'world'], AbortSignal.timeout(2000)),
    ).toEqual([
      [1, 0, 0],
      [0, 1, 0],
    ]);
    const [url, options] = transport.mock.calls[0];
    expect(String(url)).toBe(`${config.baseURL}embeddings`);
    expect(JSON.parse(options.body)).toEqual({
      model: config.embeddingDeployment,
      input: ['hello', 'world'],
      encoding_format: 'float',
      dimensions: 3,
    });
    expect(adapter.lastUsage).toEqual({
      inputTokens: 7,
      model: config.embeddingModel,
      requestId: 'fixture-request',
    });
    expect(adapter.usage).toBeUndefined();
  });
  test.each([
    {},
    { usage: null },
    { usage: {} },
    { usage: { prompt_tokens: null } },
    { usage: { prompt_tokens: '7' } },
    { usage: { prompt_tokens: -1 } },
    { usage: { prompt_tokens: 0.5 } },
    { usage: { prompt_tokens: Number.MAX_SAFE_INTEGER + 1 } },
  ])('keeps missing or invalid usage unknown: %j', async (metadata) => {
    const data = [{ index: 0, embedding: [1, 0, 0] }];
    const transport = jest
      .fn()
      .mockImplementationOnce(async () => response(data))
      .mockImplementationOnce(async () =>
        response(data, config.embeddingModel, metadata),
      );
    const adapter = new AzureEmbeddingsAdapter(config, transport);
    await adapter.embed(['hello'], AbortSignal.timeout(2000));
    expect(adapter.lastUsage?.inputTokens).toBe(7);
    await expect(
      adapter.embed(['hello'], AbortSignal.timeout(2000)),
    ).resolves.toEqual([[1, 0, 0]]);
    expect(adapter.lastUsage).toBeUndefined();
  });
  test('preserves zero tokens only when explicitly reported', async () => {
    const adapter = new AzureEmbeddingsAdapter(config, async () =>
      response([{ index: 0, embedding: [1, 0, 0] }], config.embeddingModel, {
        usage: { prompt_tokens: 0, total_tokens: 0 },
      }),
    );
    await adapter.embed(['hello'], AbortSignal.timeout(2000));
    expect(adapter.lastUsage).toEqual({
      inputTokens: 0,
      model: config.embeddingModel,
      requestId: 'fixture-request',
    });
  });
  test('accepts actual 500-token text exceeding old assay 2000-byte bound', async () => {
    const text = ' variable'.repeat(500);
    const transport = jest.fn(async () =>
      response([{ index: 0, embedding: [1, 0, 0] }]),
    );
    await expect(
      new AzureEmbeddingsAdapter(config, transport).embed(
        [text],
        AbortSignal.timeout(2000),
      ),
    ).resolves.toEqual([[1, 0, 0]]);
    expect(Buffer.byteLength(text)).toBeGreaterThan(2000);
  });
  test.each(
    [[], Array(33).fill('hello'), [' variable'.repeat(501)], ['   ']].map(
      (texts) => [texts],
    ),
  )('rejects invalid batch before transport', async (texts) => {
    const transport = jest.fn();
    await expect(
      new AzureEmbeddingsAdapter(config, transport).embed(
        texts,
        AbortSignal.timeout(2000),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_EMBEDDING', retryable: false });
    expect(transport).not.toHaveBeenCalled();
  });
  test.each([
    [{ index: 0, embedding: [1, 0] }],
    [{ index: 0, embedding: [0, 0, 0] }],
    [{ index: 0, embedding: [1, null, 0] }],
    [{ index: 2, embedding: [1, 0, 0] }],
    [
      { index: 0, embedding: [1, 0, 0] },
      { index: 0, embedding: [1, 0, 0] },
    ],
    [null],
  ])('rejects malformed vectors permanently', async (...entries) => {
    const transport = jest.fn(async () => response(entries));
    await expect(
      new AzureEmbeddingsAdapter(config, transport).embed(
        ['hello'],
        AbortSignal.timeout(2000),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_EMBEDDING', retryable: false });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  test('rejects same-dimension model mismatch before recording usage', async () => {
    const adapter = new AzureEmbeddingsAdapter(config, async () =>
      response([{ index: 0, embedding: [1, 0, 0] }], 'text-embedding-3-large'),
    );
    await expect(
      adapter.embed(['hello'], AbortSignal.timeout(2000)),
    ).rejects.toMatchObject({ code: 'INVALID_EMBEDDING' });
    expect(adapter.lastUsage).toBeUndefined();
  });
  test.each([
    [429, true],
    [500, true],
    [503, true],
    [408, true],
    [401, false],
    [403, false],
    [400, false],
  ])('classifies HTTP %s without SDK retry', async (status, retryable) => {
    const transport = jest.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: { message: 'PRIVATE-PROVIDER-PAYLOAD', type: 'error' },
          }),
          {
            status,
            headers: {
              'content-type': 'application/json',
              'retry-after': '999',
            },
          },
        ),
    );
    let caught;
    try {
      await new AzureEmbeddingsAdapter(config, transport).embed(
        ['hello'],
        AbortSignal.timeout(2000),
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      code: retryable ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_REJECTED',
      retryable,
    });
    expect(caught.retryAfterMs).toBe(retryable ? 300_000 : undefined);
    expect(caught.message).not.toContain('PRIVATE');
    expect(transport).toHaveBeenCalledTimes(1);
  });
  test('pre-aborted job never contacts provider', async () => {
    const controller = new AbortController();
    controller.abort();
    const transport = jest.fn();
    await expect(
      new AzureEmbeddingsAdapter(config, transport).embed(
        ['hello'],
        controller.signal,
      ),
    ).rejects.toMatchObject({ code: 'CANCELLED', retryable: false });
    expect(transport).not.toHaveBeenCalled();
  });
  test('network failure is transient and has no hidden retries', async () => {
    const transport = jest.fn(async () => {
      throw new Error('PRIVATE-NETWORK-DETAIL');
    });
    await expect(
      new AzureEmbeddingsAdapter(config, transport).embed(
        ['hello'],
        AbortSignal.timeout(2000),
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE', retryable: true });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  test('ada fixed dimensions are validated but not sent as a v3 option', async () => {
    const settings = {
      ...config,
      embeddingModel: 'text-embedding-ada-002',
      dimensions: 1536,
    };
    const vector = Array(1536).fill(0);
    vector[0] = 1;
    const transport = jest.fn(async () =>
      response([{ index: 0, embedding: vector }], settings.embeddingModel),
    );
    await expect(
      new AzureEmbeddingsAdapter(settings, transport).embed(
        ['hello'],
        AbortSignal.timeout(2000),
      ),
    ).resolves.toEqual([vector]);
    expect(
      JSON.parse(transport.mock.calls[0][1].body).dimensions,
    ).toBeUndefined();
  });
});
