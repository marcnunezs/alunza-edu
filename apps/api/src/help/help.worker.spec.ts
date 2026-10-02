import { randomUUID } from 'node:crypto';
import { buildHelpInput, HelpBoundaryError } from '@alunza/ai';
import type { HelpContext, RetrievedChunk } from '@alunza/ai';
import type { AppConfig } from '../config';
import { HelpWorker } from './help.worker';
import type { HelpRepository } from './help.repository';
import type { HelpJob, HelpPhase } from './help.types';
function fixture() {
  const job: HelpJob = {
    id: randomUUID(),
    token: randomUUID(),
    attemptId: randomUUID(),
    kind: 'FEEDBACK',
    hintLevel: null,
    deadlineAt: new Date(Date.now() + 15000).toISOString(),
  };
  const context: HelpContext = {
    attemptId: job.attemptId,
    exerciseVersionId: randomUUID(),
    statement: 'Explica las funciones.',
    concepts: ['Funciones'],
    code: 'function solve() { return 0; }',
    diagnosisCode: 'FAILED_TEST',
    infrastructureStatus: 'OK',
    visibleTests: [{ id: 'visible-1', passed: true }],
  };
  const chunks: RetrievedChunk[] = [
    {
      source_id: randomUUID(),
      source_version_id: randomUUID(),
      chunk_id: randomUUID(),
      locator: 'Líneas 1–3',
      text: 'Una función devuelve un valor.',
      distance: 0.1,
    },
  ];
  const source_refs = chunks.map(
    ({ text: _text, distance: _distance, ...ref }) => ref,
  );
  const candidate = {
    diagnosis_code: context.diagnosisCode,
    explanation: 'El resultado proviene de las pruebas guardadas.',
    hint: '',
    source_refs,
    status: 'SUPPORTED' as const,
  };
  const verification = {
    verdict: 'ACCEPT' as const,
    reason: 'SUPPORTED' as const,
    source_refs,
  };
  const repository = {
    claim: jest.fn().mockResolvedValue(job),
    renew: jest.fn().mockResolvedValue(true),
    context: jest.fn().mockResolvedValue({ context }),
    getInput: jest.fn().mockResolvedValue(null),
    configurationMatches: jest.fn().mockResolvedValue(true),
    retrieve: jest.fn().mockResolvedValue(chunks),
    prepareInput: jest.fn().mockImplementation(async (_job, input) => input),
    beginCall: jest.fn().mockResolvedValue({ state: 'DISPATCH' }),
    completeCall: jest.fn().mockResolvedValue(true),
    revalidate: jest.fn().mockResolvedValue(true),
    finish: jest.fn().mockResolvedValue(true),
    fail: jest.fn().mockResolvedValue(true),
  };
  const providers = {
    configurationId: 'test-help-v1',
    configurationFingerprint: 'test-help-profile-v1',
    tokenizer: 'cl100k_base' as const,
    embeddings: {
      configuration: { id: 'test-3d', model: 'test', dimensions: 3 },
      embed: jest.fn().mockResolvedValue([[1, 0, 0]]),
    },
    generation: { generate: jest.fn().mockResolvedValue({ candidate }) },
    verification: { verify: jest.fn().mockResolvedValue({ verification }) },
    evidence: {
      version: 'test-policy-v1',
      select: jest.fn().mockImplementation((value) => ({
        chunks: value,
        reason: 'SUPPORTED' as const,
      })),
    },
  };
  const factory = jest.fn().mockReturnValue(providers);
  const worker = new HelpWorker(
    repository as unknown as HelpRepository,
    factory,
    { helpWorkerEnabled: false } as AppConfig,
  );
  return {
    job,
    context,
    chunks,
    candidate,
    verification,
    repository,
    providers,
    factory,
    worker,
  };
}
test('publishes only after persisted dispatches, receipts, validation and permission check', async () => {
  const f = fixture();
  await f.worker.tick();
  expect(f.repository.beginCall.mock.calls.map((call) => call[1])).toEqual([
    'EMBEDDING',
    'GENERATION',
    'REVIEW',
  ]);
  expect(f.repository.completeCall).toHaveBeenCalledTimes(3);
  expect(f.repository.finish).toHaveBeenCalledWith(
    f.job,
    f.candidate,
    expect.objectContaining({ verification: 'SUPPORTED' }),
  );
  expect(f.repository.revalidate.mock.invocationCallOrder[0]).toBeLessThan(
    f.repository.finish.mock.invocationCallOrder[0]!,
  );
  expect(f.repository.fail).not.toHaveBeenCalled();
});
test('no confirmed context means no provider or result', async () => {
  const f = fixture();
  f.repository.context.mockResolvedValue(null);
  await f.worker.tick();
  expect(f.factory).not.toHaveBeenCalled();
  expect(f.repository.finish).not.toHaveBeenCalled();
});
test('operational UNKNOWN explains deterministically without configuration or providers', async () => {
  const f = fixture();
  f.context.infrastructureStatus = 'FAILED';
  f.context.diagnosisCode = 'UNKNOWN';
  await f.worker.tick();
  expect(f.factory).not.toHaveBeenCalled();
  expect(f.repository.finish).toHaveBeenCalledWith(
    f.job,
    expect.objectContaining({
      status: 'NO_EVIDENCE',
      diagnosis_code: 'UNKNOWN',
      hint: '',
    }),
    expect.anything(),
  );
});
test('missing provider configuration degrades explicitly', async () => {
  const f = fixture();
  f.factory.mockReturnValue(null);
  await f.worker.tick();
  expect(f.repository.fail).toHaveBeenCalledWith(
    f.job,
    'CONFIGURATION_MISSING',
  );
});
test('empty corpus never calls generation or review', async () => {
  const f = fixture();
  f.repository.retrieve.mockResolvedValue([]);
  await f.worker.tick();
  expect(f.providers.generation.generate).not.toHaveBeenCalled();
  expect(f.repository.finish).toHaveBeenCalledWith(
    f.job,
    expect.objectContaining({ status: 'NO_EVIDENCE' }),
    expect.anything(),
  );
});
test('an incompatible persisted embedding profile reports configuration failure rather than missing evidence', async () => {
  const f = fixture();
  f.repository.retrieve.mockRejectedValue(
    new HelpBoundaryError('INVALID_CONFIGURATION'),
  );
  await f.worker.tick();
  expect(f.repository.fail).toHaveBeenCalledWith(
    f.job,
    'INVALID_CONFIGURATION',
  );
  expect(f.repository.finish).not.toHaveBeenCalled();
  expect(f.providers.generation.generate).not.toHaveBeenCalled();
});
test.each(['EMBEDDING', 'GENERATION', 'REVIEW'] as HelpPhase[])(
  'uncertain %s dispatch is not repeated or overwritten',
  async (phase) => {
    const f = fixture();
    f.repository.beginCall.mockImplementation(async (_job, value) => ({
      state: value === phase ? 'STOP' : 'DISPATCH',
    }));
    await f.worker.tick();
    expect(f.repository.finish).not.toHaveBeenCalled();
    expect(f.repository.fail).not.toHaveBeenCalled();
    expect(f.repository.completeCall).toHaveBeenCalledTimes(
      ['EMBEDDING', 'GENERATION', 'REVIEW'].indexOf(phase),
    );
  },
);
test('completed checkpoints and exact prepared context resume without paid calls', async () => {
  const f = fixture();
  const prepared = buildHelpInput({
    context: f.context,
    kind: 'FEEDBACK',
    hintLevel: null,
    chunks: f.chunks,
  });
  f.repository.getInput.mockResolvedValue(JSON.parse(JSON.stringify(prepared)));
  f.repository.beginCall.mockImplementation(async (_job, phase) => ({
    state: 'COMPLETED',
    result:
      phase === 'GENERATION'
        ? { candidate: f.candidate }
        : { verification: f.verification },
  }));
  await f.worker.tick();
  expect(f.providers.embeddings.embed).not.toHaveBeenCalled();
  expect(f.repository.retrieve).not.toHaveBeenCalled();
  expect(f.providers.generation.generate).not.toHaveBeenCalled();
  expect(f.providers.verification.verify).not.toHaveBeenCalled();
  expect(f.repository.finish).toHaveBeenCalledTimes(1);
});
test('configuration changes cannot reuse a prior checkpoint', async () => {
  const f = fixture();
  f.repository.configurationMatches.mockResolvedValue(false);
  await f.worker.tick();
  expect(f.repository.fail).toHaveBeenCalledWith(
    f.job,
    'INVALID_CONFIGURATION',
  );
  expect(f.providers.embeddings.embed).not.toHaveBeenCalled();
});
test('an embedding receipt for a previous query cannot recover with a new query', async () => {
  const f = fixture();
  f.repository.beginCall.mockResolvedValue({
    state: 'COMPLETED',
    result: {
      vectors: [[1, 0, 0]],
      configuration: f.providers.embeddings.configuration,
      queryVersion: 'old-query',
      queryHash: 'a'.repeat(64),
    },
  });
  await f.worker.tick();
  expect(f.repository.fail).toHaveBeenCalledWith(
    f.job,
    'INVALID_CONFIGURATION',
  );
  expect(f.providers.embeddings.embed).not.toHaveBeenCalled();
  expect(f.repository.retrieve).not.toHaveBeenCalled();
  expect(f.providers.generation.generate).not.toHaveBeenCalled();
});
test('commit response loss leaves the durable receipt untouched', async () => {
  const f = fixture();
  f.repository.completeCall.mockRejectedValue(new Error('connection lost'));
  await f.worker.tick();
  expect(f.repository.fail).not.toHaveBeenCalled();
  expect(f.providers.generation.generate).not.toHaveBeenCalled();
});
test('full code that exceeds context fails explicitly instead of silently truncating', async () => {
  const f = fixture();
  f.context.code = 'const x = 1;\n'.repeat(1500);
  await f.worker.tick();
  expect(f.repository.fail).toHaveBeenCalledWith(f.job, 'CONTEXT_TOO_LARGE');
  expect(f.providers.generation.generate).not.toHaveBeenCalled();
});
test('candidate schema violations never reach verification', async () => {
  const f = fixture();
  f.providers.generation.generate.mockResolvedValue({
    candidate: { ...f.candidate, score: 1 },
  });
  await f.worker.tick();
  expect(f.repository.fail).toHaveBeenCalledWith(f.job, 'INVALID_OUTPUT');
  expect(f.providers.verification.verify).not.toHaveBeenCalled();
});
test('observed usage survives an invalid provider answer without storing its content', async () => {
  const f = fixture();
  const usage = { model: 'test-model', inputTokens: 125, outputTokens: 15 };
  f.providers.generation.generate.mockRejectedValue(
    new HelpBoundaryError('INVALID_OUTPUT', usage),
  );
  await f.worker.tick();
  expect(f.repository.completeCall).toHaveBeenCalledWith(
    f.job,
    'GENERATION',
    { failure: 'INVALID_OUTPUT', usage },
    usage,
  );
  expect(f.repository.fail).toHaveBeenCalledWith(f.job, 'INVALID_OUTPUT');
  expect(f.providers.verification.verify).not.toHaveBeenCalled();
});
test('unsupported review cannot publish the generated candidate', async () => {
  const f = fixture();
  f.providers.verification.verify.mockResolvedValue({
    verification: {
      verdict: 'NO_EVIDENCE',
      reason: 'AMBIGUOUS_EVIDENCE',
      source_refs: [],
    },
  });
  await f.worker.tick();
  expect(f.repository.fail).toHaveBeenCalledWith(f.job, 'NO_EVIDENCE');
  expect(f.repository.finish).not.toHaveBeenCalled();
});
test('revalidation includes context references and fences a revoked result', async () => {
  const f = fixture();
  f.repository.revalidate.mockResolvedValue(false);
  await f.worker.tick();
  expect(f.repository.finish).not.toHaveBeenCalled();
});
test.each(['deadline', 'lease', 'database'] as const)(
  '%s expiry aborts providers and prevents publication',
  async (reason) => {
    jest.useFakeTimers();
    try {
      const f = fixture();
      if (reason === 'lease') f.repository.renew.mockResolvedValue(false);
      if (reason === 'database')
        f.repository.renew.mockRejectedValue(new Error('connection lost'));
      f.providers.generation.generate.mockImplementation(
        (_input, signal) =>
          new Promise((_resolve, reject) =>
            signal.addEventListener(
              'abort',
              () => reject(new HelpBoundaryError('CANCELLED')),
              { once: true },
            ),
          ),
      );
      const task = f.worker.tick();
      await jest.advanceTimersByTimeAsync(reason === 'deadline' ? 15001 : 3001);
      await task;
      expect(f.repository.finish).not.toHaveBeenCalled();
      if (reason === 'deadline')
        expect(f.repository.fail).toHaveBeenCalledWith(
          f.job,
          'DEADLINE_EXCEEDED',
        );
      else expect(f.repository.fail).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  },
);
test('deadline releases the worker even when embedding credentials ignore cancellation', async () => {
  jest.useFakeTimers();
  try {
    const f = fixture();
    f.providers.embeddings.embed.mockImplementation(
      () => new Promise(() => undefined),
    );
    const task = f.worker.tick();
    await jest.advanceTimersByTimeAsync(15001);
    await task;
    expect(f.repository.fail).toHaveBeenCalledWith(f.job, 'DEADLINE_EXCEEDED');
    expect(f.repository.completeCall).not.toHaveBeenCalled();
    expect(f.providers.generation.generate).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    jest.useRealTimers();
  }
});
