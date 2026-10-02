const { readFile } = require('node:fs/promises');
let probe, example;
beforeAll(async () => {
  probe = await import('../../scripts/help-probe.mjs');
  example = JSON.parse(
    await readFile('infra/preproduction/help-manifest.example.json', 'utf8'),
  );
});
describe('help product remote probe preparation is offline and separately bounded', () => {
  function completeManifest() {
    const value = JSON.parse(JSON.stringify(example));
    value.remote = {
      enabled: true,
      approvedBy: 'Fixture reviewer',
      approvalRef: 'controlled-unit-test',
      approvedAt: '2026-09-27T00:00:00Z',
      expiresAt: '2026-09-28T00:00:00Z',
    };
    value.releaseSha = 'a'.repeat(40);
    const id = 'b0000000-0000-4000-8000-000000000001';
    value.targets = {
      apiOrigin: 'https://api.example.invalid',
      azureBaseURL: 'https://fixture.openai.azure.com/openai/v1/',
      organizationId: id,
      classId: id,
      activityId: id,
      attemptId: id,
      sourceVersionIds: [id],
      embedding: {
        configurationId: 'fixture-embedding',
        model: 'text-embedding-3-small',
        dimensions: 1536,
        deployment: 'fixture-embedding',
      },
      generation: {
        configurationId: 'fixture-generation',
        model: 'gpt-4.1-mini-2025-04-14',
        deployment: 'fixture-generation',
        verificationModel: 'gpt-4.1-mini-2025-04-14',
        verificationDeployment: 'fixture-generation',
        tokenizer: 'o200k_base',
      },
    };
    value.corpus.expectedHash = 'c'.repeat(64);
    // Deliberately synthetic schema example; never emitted as remote evidence.
    value.corpus.calibrationArtifact = {
      version: 'help-evidence-1',
      measurementProvider: 'azure',
      binding: {
        configurationId: 'fixture-embedding',
        embeddingModel: 'text-embedding-3-small',
        dimensions: 1536,
        tokenizerVersion: require('@alunza/ai').TOKENIZER_VERSION,
        queryVersion: 'help-query-1',
        corpusHash: value.corpus.expectedHash,
      },
      acceptanceThreshold: 0.1,
      calibrationCases: 4,
      validationCases: 2,
      validationSupported: 1,
      validationAccepted: 1,
      falseAcceptances: 0,
      casesHash: 'd'.repeat(64),
    };
    value.budget.maxCost = 1;
    value.budget.pricePerMillionTokens = {
      embeddingInput: 1,
      generationInput: 1,
      generationOutput: 1,
      verificationInput: 1,
      verificationOutput: 1,
    };
    return value;
  }
  test('complete authorization is validated without claiming remote execution', () => {
    const now = Date.parse('2026-09-27T12:00:00Z');
    const result = probe.planHelpProbe(completeManifest(), now);
    expect(result.authorization).toBe('manifest-valid');
    expect(result.maximumCost).toBeCloseTo(0.07624, 6);
    expect(result.executionImplemented).toBe(false);
  });
  test.each([
    'expired',
    'future',
    'corpus',
    'configuration',
    'budget',
    'approval',
    'incomplete',
  ])('rejects %s before remote work', (condition) => {
    const value = completeManifest();
    if (condition === 'expired')
      value.remote.expiresAt = '2026-09-27T11:00:00Z';
    if (condition === 'future')
      value.remote.approvedAt = '2026-09-27T13:00:00Z';
    if (condition === 'corpus') value.corpus.expectedHash = 'e'.repeat(64);
    if (condition === 'configuration')
      value.targets.embedding.configurationId = 'another-config';
    if (condition === 'budget') value.budget.maxCost = 0.001;
    if (condition === 'approval') value.remote.enabled = false;
    if (condition === 'incomplete') value.targets.attemptId = null;
    expect(() =>
      probe.assertHelpProbeAuthorization(
        value,
        Date.parse('2026-09-27T12:00:00Z'),
      ),
    ).toThrow('HELP_REMOTE_NOT_AUTHORIZED');
  });
  test('example is valid but denies remote authorization', () => {
    expect(probe.validateHelpProbeManifest(example)).toEqual(example);
    expect(() => probe.assertHelpProbeAuthorization(example)).toThrow(
      'HELP_REMOTE_NOT_AUTHORIZED',
    );
  });
  test('planning needs no provider credentials, never fetches and reports unknown observed consumption', async () => {
    const fetch = jest.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('Unexpected network');
    });
    try {
      const plan = await probe.helpProbeMain([]);
      expect(plan.status).toBe('prepared-remote-not-executed');
      expect(plan.authorization).toBe('pending');
      expect(plan.executionImplemented).toBe(false);
      expect(plan.remoteCalls).toBe(0);
      expect(plan.observedTokens).toBeNull();
      expect(plan.observedCost).toBeNull();
      expect(plan.plannedCalls).toEqual({
        embedding: 4,
        generation: 4,
        verification: 4,
        total: 12,
      });
      expect(plan.maximumTokens).toEqual({
        embeddingInput: 2000,
        generationInput: 32000,
        generationOutput: 8192,
        verificationInput: 32000,
        verificationOutput: 2048,
      });
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
    }
  });
  test('rejects secrets, unknown fields, insecure destinations and unbudgeted extra calls', () => {
    for (const value of [
      { ...example, apiKey: 'SECRET' },
      {
        ...example,
        targets: { ...example.targets, apiOrigin: 'http://localhost:3001' },
      },
      {
        ...example,
        targets: {
          ...example.targets,
          apiOrigin: 'https://user:SECRET@example.com',
        },
      },
      {
        ...example,
        targets: {
          ...example.targets,
          azureBaseURL: 'https://evil.invalid/openai/v1/',
        },
      },
      { ...example, budget: { ...example.budget, maxAiRequests: 13 } },
    ])
      expect(() => probe.validateHelpProbeManifest(value)).toThrow(
        'INVALID_HELP_MANIFEST',
      );
  });
  test('explicit execute cannot dispatch a partially implemented probe', async () => {
    await expect(probe.helpProbeMain(['--mode', 'execute'])).rejects.toThrow(
      'REMOTE_EXECUTION_NOT_IMPLEMENTED',
    );
    await expect(probe.helpProbeMain(['--execute'])).rejects.toThrow(
      'INVALID_ARGUMENTS',
    );
    await expect(probe.helpProbeMain(['--mode', 'check'])).rejects.toThrow(
      'HELP_REMOTE_NOT_AUTHORIZED',
    );
  });
});
