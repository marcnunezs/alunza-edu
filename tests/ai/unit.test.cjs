const { ragHelpSchema, diagnosisCodeSchema } = require('@alunza/contracts');
const {
  runRagAssay,
  fallback,
  validateVectors,
  AzureAiAdapter,
  azureConfigurationFromEnv,
  azureWireSchema,
  AiBoundaryError,
  PgvectorAssayRepository,
  runProviderProbe,
} = require('@alunza/ai');
let fixture;
beforeAll(async () => {
  fixture = await import('../../fixtures/ai/corpus.mjs');
});
function setup() {
  const source = fixture.sources[0],
    chunk = source.chunks[0];
  const retrieved = {
    source_id: source.id,
    source_version_id: source.sourceVersionId,
    chunk_id: chunk.id,
    locator: chunk.locator,
    text: chunk.text,
    distance: 0.01,
  };
  return {
    diagnosis: 'FAILED_TEST',
    query: fixture.query,
    scope: fixture.scope,
    embeddings: fixture.embeddingDouble,
    generation: fixture.generationDouble,
    evidence: fixture.fixturePolicy,
    retrieval: {
      authorize: jest.fn(async () => {}),
      retrieve: jest.fn(async () => [retrieved]),
      revalidate: jest.fn(async () => true),
    },
  };
}
const settings = {
  baseURL: 'https://fixture.openai.azure.com/openai/v1/',
  embeddingDeployment: 'embedding-deployment',
  generationDeployment: 'generation-deployment',
  embeddingModel: 'fixture-embedding-model-v1',
  generationModel: 'fixture-generation-model-v1',
  configurationId: 'azure-fixture-1',
  dimensions: 3,
  authMode: 'api-key',
  apiKey: 'test-only-not-a-real-key',
};
describe('strict RAG contract and standalone orchestration', () => {
  it.each(diagnosisCodeSchema.options)(
    'preserves %s in both deterministic fallbacks',
    (diagnosis) => {
      for (const status of ['NO_EVIDENCE', 'PROVIDER_UNAVAILABLE'])
        expect(ragHelpSchema.parse(fallback(diagnosis, status))).toMatchObject({
          diagnosis_code: diagnosis,
          status,
          source_refs: [],
          hint: '',
        });
    },
  );
  it('accepts supported fixture evidence without changing the input', async () => {
    const input = setup();
    const result = await runRagAssay(input);
    expect(result.help.status).toBe('SUPPORTED');
    expect(input.diagnosis).toBe('FAILED_TEST');
    expect(result.semanticPolicy).toContain('not-general');
  });
  it.each([
    'missing',
    'extra',
    'score',
    'nested',
    'enum',
    'diagnosis',
    'reference',
    'locator',
    'too-long',
    'empty',
    'no-ref',
    'irrelevant',
    'contradiction',
  ])('rejects %s output', async (kind) => {
    const input = setup();
    const valid = await input.generation.generate(
      {
        canonicalDiagnosis: input.diagnosis,
        authorizedChunks: await input.retrieval.retrieve(),
      },
      AbortSignal.timeout(1000),
    );
    const candidate = JSON.parse(JSON.stringify(valid));
    if (kind === 'missing') delete candidate.hint;
    if (kind === 'extra') candidate.reasoning = 'hidden';
    if (kind === 'score') candidate.score = 1;
    if (kind === 'nested')
      candidate.source_refs[0].url = 'https://untrusted.invalid';
    if (kind === 'enum') candidate.status = 'RUNNING';
    if (kind === 'diagnosis') candidate.diagnosis_code = 'SUCCESS';
    if (kind === 'reference')
      candidate.source_refs[0].chunk_id = fixture.sources[4].chunks[0].id;
    if (kind === 'locator')
      candidate.source_refs[0].locator = 'Página inventada';
    if (kind === 'too-long') candidate.explanation = 'x'.repeat(2001);
    if (kind === 'empty') candidate.explanation = '   ';
    if (kind === 'no-ref') candidate.source_refs = [];
    if (kind === 'irrelevant') candidate.hint = 'Otro tema sin respaldo';
    if (kind === 'contradiction')
      candidate.explanation = 'Todas las pruebas pasaron.';
    input.generation = { generate: async () => candidate };
    expect((await runRagAssay(input)).help).toEqual(
      fallback('FAILED_TEST', 'PROVIDER_UNAVAILABLE'),
    );
  });
  it('does not call embeddings or generation for a denied actor', async () => {
    const input = setup();
    input.retrieval.authorize = async () => {
      throw new AiBoundaryError('ACCESS_DENIED');
    };
    input.embeddings = { ...input.embeddings, embed: jest.fn() };
    input.generation = { generate: jest.fn() };
    await expect(runRagAssay(input)).rejects.toMatchObject({
      reason: 'ACCESS_DENIED',
    });
    expect(input.embeddings.embed).not.toHaveBeenCalled();
    expect(input.generation.generate).not.toHaveBeenCalled();
  });
  it.each(['empty', 'irrelevant', 'ambiguous'])(
    'avoids generation for %s evidence',
    async (kind) => {
      const input = setup();
      input.generation = { generate: jest.fn() };
      if (kind === 'empty') input.retrieval.retrieve = async () => [];
      else input.evidence = { ...input.evidence, relevant: () => [] };
      expect((await runRagAssay(input)).help.status).toBe('NO_EVIDENCE');
      expect(input.generation.generate).not.toHaveBeenCalled();
    },
  );
  it('returns NO_EVIDENCE after revocation', async () => {
    const input = setup();
    input.retrieval.revalidate = async () => false;
    expect((await runRagAssay(input)).help.status).toBe('NO_EVIDENCE');
  });
  it('distinguishes dependency failure from empty corpus', async () => {
    const input = setup();
    input.retrieval.retrieve = async () => {
      throw new AiBoundaryError('DATABASE_UNAVAILABLE');
    };
    const result = await runRagAssay(input);
    expect(result.help.status).toBe('PROVIDER_UNAVAILABLE');
    expect(result.reason).toBe('DATABASE_UNAVAILABLE');
  });
  it('bounds even a non-cooperative provider and aborts its signal', async () => {
    const input = setup();
    let received;
    input.generation = {
      generate: async (_, signal) => {
        received = signal;
        return new Promise(() => {});
      },
    };
    input.timeoutMs = 20;
    expect((await runRagAssay(input)).help.status).toBe('PROVIDER_UNAVAILABLE');
    expect(received.aborted).toBe(true);
  });
  it.each(
    [
      [],
      [[1, 2]],
      [
        [1, 2, 3],
        [1, 2, 3],
      ],
      [[NaN, 1, 2]],
      [[Infinity, 1, 2]],
      [[0, 0, 0]],
    ].map((vectors) => [vectors]),
  )('rejects invalid vectors %j', (vectors) => {
    expect(() => validateVectors(vectors, 1, 3)).toThrow('INVALID_VECTOR');
  });
  it.each([15422, 16422, 17422])(
    'refuses original or development database destination %s',
    (port) => {
      expect(
        () =>
          new PgvectorAssayRepository(
            `postgresql://alunza_app:fixture@127.0.0.1:${port}/postgres`,
          ),
      ).toThrow('INVALID_CONFIGURATION');
    },
  );
  it('accepts LAB TEST configuration without opening a database connection', async () => {
    const repository = new PgvectorAssayRepository(
      'postgresql://alunza_app:fixture@127.0.0.1:18422/postgres',
    );
    await repository.close();
  });
  it.each(['?host=remote&port=5432', '#unexpected', '?sslmode=disable'])(
    'refuses connection option override %s',
    (suffix) => {
      expect(
        () =>
          new PgvectorAssayRepository(
            `postgresql://alunza_app:fixture@127.0.0.1:18422/postgres${suffix}`,
          ),
      ).toThrow('INVALID_CONFIGURATION');
    },
  );
});
describe('real SDK with explicitly simulated HTTP transport; zero remote calls', () => {
  it.each(['refusal', 'truncated', 'malformed-json', 'tool-call'])(
    'rejects provider %s',
    async (kind) => {
      const message = { role: 'assistant', content: '{}', refusal: null };
      if (kind === 'refusal') message.refusal = 'No';
      if (kind === 'malformed-json') message.content = '{invalid';
      if (kind === 'tool-call')
        message.tool_calls = [
          {
            id: 'fake',
            type: 'function',
            function: { name: 'sql', arguments: '{}' },
          },
        ];
      const transport = async () =>
        new Response(
          JSON.stringify({
            id: 'fixture',
            object: 'chat.completion',
            created: 0,
            model: settings.generationModel,
            choices: [
              {
                index: 0,
                finish_reason: kind === 'truncated' ? 'length' : 'stop',
                message,
              },
            ],
          }),
          { headers: { 'content-type': 'application/json' } },
        );
      await expect(
        new AzureAiAdapter(settings, transport).generate(
          {
            canonicalDiagnosis: 'FAILED_TEST',
            authorizedChunks: [],
            promptVersion: 'fixture',
          },
          AbortSignal.timeout(1000),
        ),
      ).rejects.toBeInstanceOf(AiBoundaryError);
    },
  );
  it('keeps document instructions in untrusted data with no tools', async () => {
    let sent;
    const transport = async (_, options) => {
      sent = JSON.parse(options.body);
      return new Response(
        JSON.stringify({
          id: 'fixture',
          object: 'chat.completion',
          created: 0,
          model: settings.generationModel,
          choices: [
            {
              index: 0,
              finish_reason: 'stop',
              message: { role: 'assistant', content: '{}', refusal: null },
            },
          ],
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    };
    const chunks = await setup().retrieval.retrieve();
    chunks[0].text = fixture.adversarialTexts.join('\n');
    await new AzureAiAdapter(settings, transport).generate(
      {
        canonicalDiagnosis: 'FAILED_TEST',
        authorizedChunks: chunks,
        promptVersion: 'fixture',
      },
      AbortSignal.timeout(1000),
    );
    expect(sent.messages[0].role).toBe('system');
    expect(sent.messages[0].content).not.toContain(fixture.adversarialTexts[0]);
    expect(sent.messages[1].role).toBe('user');
    expect(sent.messages[1].content).toContain(fixture.adversarialTexts[0]);
    expect(sent.tools).toBeUndefined();
  });
  it('rejects missing configuration without echoing values', () => {
    expect(() =>
      azureConfigurationFromEnv({ AI_AZURE_API_KEY: 'secret-marker' }),
    ).toThrow('INVALID_CONFIGURATION');
  });
  it('rejects malformed and non-Azure URLs safely', () => {
    for (const baseURL of [
      'bad',
      'https://api.openai.com/v1/',
      'http://fixture.openai.azure.com/openai/v1/',
    ])
      expect(() => new AzureAiAdapter({ ...settings, baseURL })).toThrow(
        'INVALID_CONFIGURATION',
      );
  });
  it('uses Azure v1 deployment, strict schema, no tools and bounded output', async () => {
    let sent, url;
    const input = setup();
    const valid = await input.generation.generate(
      {
        canonicalDiagnosis: 'FAILED_TEST',
        authorizedChunks: await input.retrieval.retrieve(),
      },
      AbortSignal.timeout(1000),
    );
    const transport = jest.fn(async (target, options) => {
      url = String(target);
      sent = JSON.parse(options.body);
      return new Response(
        JSON.stringify({
          id: 'fixture-request',
          object: 'chat.completion',
          created: 0,
          model: settings.generationModel,
          choices: [
            {
              index: 0,
              finish_reason: 'stop',
              message: {
                role: 'assistant',
                content: JSON.stringify(valid),
                refusal: null,
              },
            },
          ],
          usage: { prompt_tokens: 12, completion_tokens: 10, total_tokens: 22 },
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    });
    const adapter = new AzureAiAdapter(settings, transport, 256);
    const result = await adapter.generate(
      {
        canonicalDiagnosis: 'FAILED_TEST',
        authorizedChunks: await input.retrieval.retrieve(),
        promptVersion: 'fixture',
      },
      AbortSignal.timeout(1000),
    );
    expect(result).toEqual(valid);
    expect(url).toBe(
      'https://fixture.openai.azure.com/openai/v1/chat/completions',
    );
    expect(sent.model).toBe(settings.generationDeployment);
    expect(sent.max_completion_tokens).toBe(256);
    expect(sent.tools).toBeUndefined();
    expect(sent.response_format.json_schema.strict).toBe(true);
    expect(JSON.stringify(azureWireSchema)).not.toMatch(
      /maxLength|format|minItems|maxItems/,
    );
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('validates real SDK embedding parsing and restores response order', async () => {
    const transport = async () =>
      new Response(
        JSON.stringify({
          object: 'list',
          model: settings.embeddingModel,
          data: [
            { object: 'embedding', index: 1, embedding: [0, 1, 0] },
            { object: 'embedding', index: 0, embedding: [1, 0, 0] },
          ],
          usage: { prompt_tokens: 2, total_tokens: 2 },
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    expect(
      await new AzureAiAdapter(settings, transport).embed(
        ['a', 'b'],
        AbortSignal.timeout(1000),
      ),
    ).toEqual([
      [1, 0, 0],
      [0, 1, 0],
    ]);
  });
  it('rejects malformed embedding dimension from provider', async () => {
    const transport = async () =>
      new Response(
        JSON.stringify({
          object: 'list',
          model: settings.embeddingModel,
          data: [{ object: 'embedding', index: 0, embedding: [1, 0] }],
          usage: { prompt_tokens: 1, total_tokens: 1 },
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    await expect(
      new AzureAiAdapter(settings, transport).embed(
        ['a'],
        AbortSignal.timeout(1000),
      ),
    ).rejects.toMatchObject({ reason: 'INVALID_VECTOR' });
  });
  it.each([429, 500])(
    'does not retry HTTP %i or expose provider body',
    async (status) => {
      const transport = jest.fn(
        async () =>
          new Response(
            JSON.stringify({ error: { message: 'provider-secret-marker' } }),
            { status, headers: { 'content-type': 'application/json' } },
          ),
      );
      await expect(
        new AzureAiAdapter(settings, transport).embed(
          ['a'],
          AbortSignal.timeout(1000),
        ),
      ).rejects.toThrow('PROVIDER_FAILURE');
      expect(transport).toHaveBeenCalledTimes(1);
    },
  );
});

describe('separate probe flows with named transport/repository doubles', () => {
  it('rejects a same-dimension model mismatch before publishing vectors or recording usage', async () => {
    const transport = async (_, options) => {
      const body = JSON.parse(options.body);
      return new Response(
        JSON.stringify({
          object: 'list',
          model: 'unexpected-other-model',
          data: body.input.map((_, index) => ({
            object: 'embedding',
            index,
            embedding: [1, 0, 0],
          })),
          usage: { prompt_tokens: 2, total_tokens: 2 },
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    };
    const adapter = new AzureAiAdapter(settings, transport);
    const input = probeInput('rag-local');
    input.embeddings = adapter;
    input.generation = adapter;
    await expect(runProviderProbe(input)).rejects.toThrow('INVALID_OUTPUT');
    expect(input.local.publish).not.toHaveBeenCalled();
    expect(input.local.repository.retrieve).not.toHaveBeenCalled();
    expect(adapter.usage).toEqual([]);
  });
  it('rejects a generation model mismatch before recording provider metadata', async () => {
    const transport = async () =>
      new Response(
        JSON.stringify({
          id: 'fixture',
          object: 'chat.completion',
          created: 0,
          model: 'unexpected-other-model',
          choices: [
            {
              index: 0,
              finish_reason: 'stop',
              message: { role: 'assistant', content: '{}' },
            },
          ],
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    const adapter = new AzureAiAdapter(settings, transport);
    await expect(
      adapter.generate(
        {
          canonicalDiagnosis: 'FAILED_TEST',
          authorizedChunks: [],
          promptVersion: 'fixture',
        },
        AbortSignal.timeout(1000),
      ),
    ).rejects.toThrow('INVALID_OUTPUT');
    expect(adapter.usage).toEqual([]);
  });
  function probeInput(mode) {
    const chunks = fixture.sources.flatMap((source) =>
      source.chunks.map((chunk) => ({
        source_id: source.id,
        source_version_id: source.sourceVersionId,
        chunk_id: chunk.id,
        locator: chunk.locator,
        text: chunk.text,
      })),
    );
    const embeddings = {
      configuration: {
        id: 'provider-transport-double-4d',
        model: 'explicit-double',
        dimensions: 4,
      },
      embed: jest.fn(async (texts) => texts.map(() => [1, 0, 0, 0])),
    };
    const generation = { generate: jest.fn(fixture.generationDouble.generate) };
    const repository = {
      authorize: jest.fn(async () => {}),
      retrieve: jest.fn(async () => [{ ...chunks[0], distance: 0.01 }]),
      revalidate: jest.fn(async () => true),
    };
    return {
      mode,
      embeddings,
      generation,
      chunks,
      query: fixture.query,
      signal: AbortSignal.timeout(1000),
      local: {
        scope: fixture.scope,
        repository,
        maxCosineDistance: 0.2,
        publish: jest.fn(async () => {}),
      },
    };
  }
  it('connectivity uses one document/query batch and no database', async () => {
    const input = probeInput('connectivity');
    const result = await runProviderProbe(input);
    expect(input.embeddings.embed.mock.calls[0][0]).toHaveLength(2);
    expect(input.generation.generate).toHaveBeenCalledTimes(1);
    expect(input.local.publish).not.toHaveBeenCalled();
    expect(input.local.repository.retrieve).not.toHaveBeenCalled();
    expect(result.dimension).toBe(4);
  });
  it('rag-local publishes a separate real-provider-shaped generation and uses the query vector', async () => {
    const input = probeInput('rag-local');
    const result = await runProviderProbe(input);
    expect(input.embeddings.embed.mock.calls[0][0]).toHaveLength(12);
    expect(input.local.publish.mock.calls[0][0]).toHaveLength(11);
    expect(input.local.repository.retrieve).toHaveBeenCalledWith(
      fixture.scope,
      [1, 0, 0, 0],
      input.embeddings.configuration,
    );
    expect(input.generation.generate).toHaveBeenCalledTimes(1);
    expect(input.local.repository.revalidate).toHaveBeenCalled();
    expect(result.help.status).toBe('SUPPORTED');
  });
  it('rag-local refuses absent threshold or the synthetic generation before provider calls', async () => {
    for (const kind of ['threshold', 'generation']) {
      const input = probeInput('rag-local');
      if (kind === 'threshold') input.local.maxCosineDistance = undefined;
      else input.embeddings.configuration.id = 'synthetic-3d-v1';
      await expect(runProviderProbe(input)).rejects.toThrow(
        'INVALID_CONFIGURATION',
      );
      expect(input.embeddings.embed).not.toHaveBeenCalled();
    }
  });
  it('does not generate when the provisional relevance filter removes all chunks', async () => {
    const input = probeInput('rag-local');
    input.local.maxCosineDistance = 0;
    expect((await runProviderProbe(input)).help.status).toBe('NO_EVIDENCE');
    expect(input.generation.generate).not.toHaveBeenCalled();
  });
  it('revalidates revocation after generation', async () => {
    const input = probeInput('rag-local');
    input.local.repository.revalidate = async () => false;
    expect((await runProviderProbe(input)).help.status).toBe('NO_EVIDENCE');
  });
  it('rejects a provider reference outside retrieved scope', async () => {
    const input = probeInput('rag-local');
    input.generation.generate = async () => ({
      diagnosis_code: 'FAILED_TEST',
      explanation: fixture.explanation,
      hint: fixture.hint,
      status: 'SUPPORTED',
      source_refs: [
        {
          source_id: fixture.sources[4].id,
          source_version_id: fixture.sources[4].sourceVersionId,
          chunk_id: fixture.sources[4].chunks[0].id,
          locator: fixture.sources[4].chunks[0].locator,
        },
      ],
    });
    await expect(runProviderProbe(input)).rejects.toThrow('INVALID_OUTPUT');
  });
});
