/* eslint @typescript-eslint/no-require-imports: "off" */
const { randomUUID } = require('node:crypto');
const { testHelpFactory } = require('./help-providers.cjs');
const { observedCall } = require('./help-fault-observer.cjs');
const { HelpBoundaryError } = require('@alunza/ai');
const {
  setMaterialFault,
  clearMaterialFault,
  materialFaultForTexts,
} = require('./help-fault-materials.cjs');
const attemptId = randomUUID();
const input = {
  context: {
    attemptId,
    diagnosisCode: 'FAILED_TEST',
    code: 'HELP_PROVIDER_UNAVAILABLE HELP_NO_EVIDENCE HELP_INVALID_OUTPUT HELP_FAKE_REFERENCE',
  },
  kind: 'HINT',
  hintLevel: 1,
  chunks: [
    {
      source_id: randomUUID(),
      source_version_id: randomUUID(),
      chunk_id: randomUUID(),
      locator: 'Líneas 1–2',
      text: 'HELP_NO_EVIDENCE <script>untrusted()</script>',
    },
  ],
};
const embeddings = {
  configuration: { id: 'fixture', model: 'test-fixture-only', dimensions: 3 },
  embed: jest.fn(async () => [[1, 0, 0]]),
};
const signal = () => new AbortController().signal;
test('material faults bind externally to the real extracted file/chunk hashes, not magic words', async () => {
  const text = 'Una función devuelve un valor. Documento ficticio acotado.';
  try {
    await setMaterialFault({ text, scenario: 'permanent' });
    const matched = materialFaultForTexts([text]);
    expect(matched.scenario).toBe('permanent');
    expect(matched.fileHash).toMatch(/^[a-f0-9]{64}$/);
    expect(matched.chunkHashes).toHaveLength(1);
    expect(
      materialFaultForTexts(['IMP04_PERMANENT IMP04_TRANSIENT IMP04_SLOW']),
    ).toBeNull();
    expect(JSON.stringify(matched)).not.toContain(text);
  } finally {
    clearMaterialFault();
  }
});
test('student markers and hostile document strings never select TEST provider behavior', async () => {
  const provider = testHelpFactory(embeddings, () => null)();
  const generated = await provider.generation.generate(input, signal());
  expect(provider.evidence.select(input.chunks).chunks).toEqual(input.chunks);
  expect(generated.candidate.status).toBe('SUPPORTED');
  expect(generated.candidate.diagnosis_code).toBe('FAILED_TEST');
  expect(generated.candidate).not.toHaveProperty('score');
  expect(generated.candidate.source_refs[0].chunk_id).toBe(
    input.chunks[0].chunk_id,
  );
  expect(
    (await provider.verification.verify(input, generated.candidate, signal()))
      .verification.verdict,
  ).toBe('ACCEPT');
});
test('a fault controls only the bound attempt; a different attempt keeps its supported response', async () => {
  const control = jest.fn((id) =>
    id === attemptId ? { scenario: 'generation-unavailable' } : null,
  );
  const provider = testHelpFactory(embeddings, control)();
  await expect(
    provider.generation.generate(input, signal()),
  ).rejects.toBeInstanceOf(HelpBoundaryError);
  await expect(
    provider.generation.generate(
      { ...input, context: { ...input.context, attemptId: randomUUID() } },
      signal(),
    ),
  ).resolves.toMatchObject({ candidate: { status: 'SUPPORTED' } });
  expect(control).toHaveBeenCalledWith(attemptId);
});
test.each([
  ['reject-injection', 'INSTRUCTION_INJECTION'],
  ['reject-solution', 'SOLUTION_DISCLOSURE'],
])(
  'external reviewer scenario %s has an explicit rejection receipt',
  async (scenario, reason) => {
    const provider = testHelpFactory(embeddings, () => ({ scenario }))();
    const generated = await provider.generation.generate(input, signal());
    const events = [];
    const result = await provider.verification.verify(
      input,
      generated.candidate,
      signal(),
      (event) => events.push(event),
    );
    expect(result.verification).toEqual({
      verdict: 'REJECT',
      reason,
      source_refs: [],
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      phase: 'REVIEW',
      outcome: 'RESPONSE',
      aborted: false,
      model: 'test-fixture-only',
      httpStatus: 200,
      usage: { inputTokens: 130, outputTokens: 20 },
    });
  },
);
test('a cancelled provider records ERROR and never returns the candidate after the absolute cancellation', async () => {
  const controller = new AbortController();
  const events = [];
  const provider = testHelpFactory(embeddings, () => ({
    scenario: 'deadline',
  }))();
  const pending = provider.generation.generate(
    input,
    controller.signal,
    (event) => events.push(event),
  );
  controller.abort(new Error('controlled cancellation'));
  await expect(pending).rejects.toThrow('controlled cancellation');
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    phase: 'GENERATION',
    outcome: 'ERROR',
    aborted: true,
  });
  expect(events[0]).not.toHaveProperty('usage');
});
test('observer rejection neither repeats nor replaces successful provider output; receipts contain no candidate or student content', async () => {
  const operation = jest.fn(async () => ({
    candidate: { private: input.context.code },
    usage: { inputTokens: 4, outputTokens: 2 },
  }));
  const events = [];
  const value = await observedCall(
    'GENERATION',
    signal(),
    async (event) => {
      events.push(event);
      throw new Error('private observer failure');
    },
    operation,
  );
  expect(operation).toHaveBeenCalledTimes(1);
  expect(value.candidate.private).toBe(input.context.code);
  expect(JSON.stringify(events)).not.toContain(input.context.code);
  expect(JSON.stringify(events)).not.toContain('candidate');
  expect(events[0].settledAt).toEqual(expect.any(String));
});
test.each([
  [429, true, 20],
  [400, false, undefined],
])(
  'known %s transport failure retains status/retry evidence with unknown usage',
  async (httpStatus, retryable, retryAfterMs) => {
    const events = [];
    const error = Object.assign(new Error('private message'), {
      httpStatus,
      retryable,
      retryAfterMs,
    });
    await expect(
      observedCall(
        'EMBEDDING',
        signal(),
        (event) => events.push(event),
        async () => {
          throw error;
        },
      ),
    ).rejects.toBe(error);
    expect(events[0]).toMatchObject({
      phase: 'EMBEDDING',
      outcome: 'ERROR',
      httpStatus,
      retryable,
    });
    expect(events[0]).not.toHaveProperty('usage');
    expect(JSON.stringify(events)).not.toContain('private message');
  },
);
