import { createHash } from 'node:crypto';
import { EvaluationCalibrationWorker } from './evaluation-calibration.worker';
import type { EvaluationCalibrationProviders } from './evaluation-calibration.worker';
import type { EvaluationRepository } from '../evaluation/evaluation.repository';
import type { EvaluationGateway } from '../evaluation/evaluation.gateway';
import type {
  EvaluationCalibrationJob,
  EvaluationCallSpec,
  EvaluationCalibrationEvidence,
} from '../evaluation/evaluation.types';
import type { AiSettlementObserver } from '@alunza/ai';

const id = (n: number) =>
  `e2000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
function fixture(kind: EvaluationCalibrationJob['kind'] = 'CALIBRATION') {
  const profile = {
    id: 'test-embedding',
    model: 'test-fixture-only',
    dimensions: 3,
    fingerprint: 'a'.repeat(64),
    inputMicroUsdPerMillion: '0',
    outputMicroUsdPerMillion: '0',
  };
  const job: EvaluationCalibrationJob = {
    kind,
    id: id(1),
    token: id(2),
    runId: id(3),
    caseId: 'case-a',
    corpusHash: 'b'.repeat(64),
    profile,
    calibration: {
      caseId: 'case-a',
      groupId: 'exercise-a',
      split: 'calibration',
      expected: 'SUPPORTED',
      relevantBindingIds: [id(8)],
    },
  };
  const context = {
    attemptId: id(4),
    exerciseVersionId: id(5),
    statement: 'Devuelve el doble.',
    concepts: ['retorno'],
    code: 'function doble(n) { n * 2; }',
    diagnosisCode: 'FAILED_TEST' as const,
    infrastructureStatus: 'OK' as const,
    visibleTests: [{ id: 'visible-1', passed: false }],
  };
  const chunk = {
    source_id: id(6),
    source_version_id: id(7),
    chunk_id: id(9),
    locator: 'Líneas 1–1',
    text: 'Return devuelve el valor al llamador.',
    distance: 0.1,
  };
  const { text: _text, distance: _distance, ...ref } = chunk;
  const candidate = {
    diagnosis_code: 'FAILED_TEST',
    explanation: 'El intento superó todas las pruebas.',
    hint: '',
    source_refs: [ref],
    status: 'SUPPORTED',
  };
  if (kind === 'REVIEW')
    job.reviewCase = {
      caseId: 'review-a',
      candidate,
      expected: 'REJECT',
      boundaryExpected: false,
      refsMapping: [
        {
          source_id: ref.source_id,
          source_version_id: ref.source_version_id,
          chunk_id: ref.chunk_id,
          locator: ref.locator,
          materialBindingId: id(8),
        },
      ],
    };
  let queryHash = '';
  const repository = {
    claimCalibration: jest.fn(
      async () => job as EvaluationCalibrationJob | null,
    ),
    pendingCalibrationRun: jest.fn(async () => null as string | null),
    renewCalibration: jest.fn(async () => true),
    calibrationContext: jest.fn(async () => ({
      scope: {
        organizationId: id(20),
        classId: id(21),
        activityId: id(22),
        studentId: id(23),
      },
      context,
    })),
    prepareCalibrationQuery: jest.fn(
      async (_job: EvaluationCalibrationJob, query: string) => {
        queryHash = hash(query);
        return queryHash;
      },
    ),
    findReceipt: jest.fn(async () => ({
      callId: id(10),
      state: 'COMPLETED',
      inputHash: queryHash,
    })),
    calibrationRetrieve: jest.fn(async () => [chunk]),
    calibrationEvidence: jest.fn(
      async (): Promise<EvaluationCalibrationEvidence | null> => null,
    ),
    finishCalibration: jest.fn(async () => true),
    failCalibration: jest.fn(async () => true),
    failCalibrationRun: jest.fn(async () => true),
    reviewReferences: jest.fn(async () => [
      { materialBindingId: id(8), ...ref },
    ]),
    completeReviewCase: jest.fn(async () => true),
  };
  const gateway = {
    execute: jest.fn(
      async (
        _spec: EvaluationCallSpec,
        invoke: (observer: AiSettlementObserver) => Promise<unknown>,
      ) => invoke(() => undefined),
    ),
  };
  const embeds = jest.fn(async () => [[1, 0, 0]]);
  const verify = jest.fn(async () => ({
    verification: {
      verdict: 'REJECT' as const,
      reason: 'DIAGNOSIS_CONTRADICTION' as const,
      source_refs: [],
    },
  }));
  const providers: EvaluationCalibrationProviders = {
    embeddings: {
      configuration: {
        id: profile.id,
        model: profile.model,
        dimensions: profile.dimensions,
      },
      embed: embeds,
    },
    embeddingFingerprint: profile.fingerprint,
    verification: { verify },
    verificationProfile: {
      id: 'test-review',
      model: 'test-fixture-only',
      fingerprint: 'c'.repeat(64),
    },
    tokenizer: 'cl100k_base',
  };
  const factory = jest.fn(
    () => providers as EvaluationCalibrationProviders | null,
  );
  const worker = new EvaluationCalibrationWorker(
    repository as unknown as EvaluationRepository,
    gateway as unknown as EvaluationGateway,
    factory,
    { enabled: true, operationsPort: 4401 },
  );
  return {
    worker,
    repository,
    gateway,
    factory,
    providers,
    embeds,
    verify,
    job,
    context,
    chunk,
  };
}
test('persists exact query before budgeted dispatch and retrieves only from its completed receipt', async () => {
  const test = fixture();
  await test.worker.tick();
  expect(
    test.repository.prepareCalibrationQuery.mock.invocationCallOrder[0],
  ).toBeLessThan(test.gateway.execute.mock.invocationCallOrder[0]!);
  expect(test.gateway.execute).toHaveBeenCalledWith(
    expect.objectContaining({
      phase: 'EMBEDDING',
      logicalKey: 'help-query-1',
      reservedInputTokens: 500,
      maxOutputTokens: 0,
      configuration: expect.objectContaining({ fingerprint: 'a'.repeat(64) }),
    }),
    expect.any(Function),
  );
  expect(test.repository.calibrationRetrieve).toHaveBeenCalledWith(
    test.job,
    [1, 0, 0],
    expect.stringMatching(/^[a-f0-9]{64}$/),
    id(10),
    test.providers.embeddings.configuration,
  );
  expect(test.repository.failCalibration).not.toHaveBeenCalled();
});
test('a saved query with different hash never dispatches', async () => {
  const test = fixture();
  test.repository.prepareCalibrationQuery.mockResolvedValue('wrong');
  await test.worker.tick();
  expect(test.gateway.execute).not.toHaveBeenCalled();
  expect(test.repository.failCalibration).toHaveBeenCalledWith(test.job);
});
test('provider configuration is checked against the approved fingerprint', async () => {
  const test = fixture();
  test.providers.embeddingFingerprint = 'd'.repeat(64);
  await test.worker.tick();
  expect(test.embeds).not.toHaveBeenCalled();
  expect(test.repository.failCalibration).toHaveBeenCalledWith(test.job);
});
test('database response loss before dispatch leaves reclaimable work without terminal failure', async () => {
  const test = fixture();
  test.repository.prepareCalibrationQuery.mockRejectedValue(
    new Error('DB response lost'),
  );
  await test.worker.tick();
  expect(test.embeds).not.toHaveBeenCalled();
  expect(test.repository.failCalibration).not.toHaveBeenCalled();
});
test('database response loss after retrieval does not overwrite the durable checkpoint', async () => {
  const test = fixture();
  test.repository.calibrationRetrieve.mockRejectedValue(
    new Error('Commit uncertain'),
  );
  await test.worker.tick();
  expect(test.embeds).toHaveBeenCalledTimes(1);
  expect(test.repository.failCalibration).not.toHaveBeenCalled();
});
test('idle worker discovers finalization left behind by a process restart', async () => {
  const test = fixture();
  test.repository.claimCalibration.mockResolvedValue(null);
  test.repository.pendingCalibrationRun.mockResolvedValue(id(3));
  await test.worker.tick();
  expect(test.repository.calibrationEvidence).toHaveBeenCalledWith(id(3));
  expect(test.embeds).not.toHaveBeenCalled();
});
test('review fixtures call only the verifier after authorized retrieval and never publish student help', async () => {
  const test = fixture('REVIEW');
  await test.worker.tick();
  expect(test.gateway.execute.mock.calls.map(([spec]) => spec.phase)).toEqual([
    'EMBEDDING',
    'REVIEW',
  ]);
  expect(test.verify).toHaveBeenCalledTimes(1);
  expect(test.repository.completeReviewCase).toHaveBeenCalledWith(
    test.job,
    id(10),
  );
  expect(test.repository.finishCalibration).not.toHaveBeenCalled();
});
test('structurally invalid candidate is recorded as a boundary result without paid calls', async () => {
  const test = fixture('REVIEW');
  test.job.reviewCase!.candidate.score = 10;
  test.job.reviewCase!.boundaryExpected = true;
  await test.worker.tick();
  expect(test.gateway.execute).not.toHaveBeenCalled();
  expect(test.repository.completeReviewCase).toHaveBeenCalledWith(
    test.job,
    null,
    true,
  );
});
test('false candidate locator is preserved and rejected, never repaired during remapping', async () => {
  const test = fixture('REVIEW');
  (
    test.job.reviewCase!.candidate.source_refs as { locator: string }[]
  )[0]!.locator = 'Página falsa';
  await test.worker.tick();
  expect(test.verify).not.toHaveBeenCalled();
  expect(test.repository.completeReviewCase).toHaveBeenCalledWith(
    test.job,
    null,
    true,
  );
});
test.each([false, 'error'])(
  'lease %p aborts an outstanding call without failing durable work',
  async (outcome) => {
    jest.useFakeTimers();
    try {
      const test = fixture();
      test.embeds.mockImplementation(() => new Promise(() => undefined));
      if (outcome === false)
        test.repository.renewCalibration.mockResolvedValue(false);
      else
        test.repository.renewCalibration.mockRejectedValue(
          new Error('DB unavailable'),
        );
      const pending = test.worker.tick();
      await jest.advanceTimersByTimeAsync(10_001);
      await pending;
      expect(test.repository.failCalibration).not.toHaveBeenCalled();
      expect(test.repository.calibrationRetrieve).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  },
);
test('absolute case deadline stops even a provider that ignores cancellation', async () => {
  jest.useFakeTimers();
  try {
    const test = fixture();
    test.embeds.mockImplementation(() => new Promise(() => undefined));
    const pending = test.worker.tick();
    await jest.advanceTimersByTimeAsync(15_001);
    await pending;
    expect(test.repository.failCalibration).toHaveBeenCalledWith(test.job);
    expect(test.repository.calibrationRetrieve).not.toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});

function storedEvidence(): EvaluationCalibrationEvidence {
  const source = fixture();
  const labels = [
    {
      id: 'a',
      groupId: 'training',
      split: 'calibration',
      expected: 'SUPPORTED',
      distance: 0.2,
      chunkId: id(61),
    },
    {
      id: 'b',
      groupId: 'training',
      split: 'calibration',
      expected: 'NO_EVIDENCE',
      distance: 0.7,
      chunkId: id(63),
    },
    {
      id: 'c',
      groupId: 'holdout',
      split: 'validation',
      expected: 'SUPPORTED',
      distance: 0.1,
      chunkId: id(62),
    },
    {
      id: 'd',
      groupId: 'holdout',
      split: 'validation',
      expected: 'NO_EVIDENCE',
      distance: 0.8,
      chunkId: id(63),
    },
  ] as const;
  const queries = labels.map((item) => ({
    caseId: item.id,
    text: `Consulta ${item.id}`,
    queryHash: hash(`Consulta ${item.id}`),
  }));
  const observations = labels.map((item, index) => ({
    caseId: item.id,
    callId: id(index + 80),
    queryHash: queries[index]!.queryHash,
    corpusHash: source.job.corpusHash,
    candidates: [{ chunkId: item.chunkId, distance: item.distance }],
  }));
  return {
    manifest: {
      provider: 'TEST',
      corpusHash: source.job.corpusHash,
      profiles: { EMBEDDING: source.job.profile },
    } as EvaluationCalibrationEvidence['manifest'],
    corpus: [61, 62, 63].map((index) => ({
      sourceVersionId: id(index + 10),
      chunkId: id(index),
      contentHash: hash(`Different source ${index}`),
    })),
    queries,
    observations,
    cases: labels.map((item, index) => ({
      id: id(index + 90),
      metadata: {
        caseId: item.id,
        groupId: item.groupId,
        split: item.split,
        expected: item.expected,
        relevantBindingIds: [],
      },
      queryHash: queries[index]!.queryHash,
      candidates: observations[index]!.candidates,
      relevantChunkIds: item.expected === 'SUPPORTED' ? [item.chunkId] : [],
      callId: observations[index]!.callId,
    })),
    receipts: observations.map((item) => ({
      callId: item.callId,
      runId: source.job.runId,
      provider: 'TEST',
      configurationId: source.job.profile.id,
      model: source.job.profile.model,
      dimensions: 3,
      inputHash: item.queryHash,
      state: 'COMPLETED',
    })),
  };
}
test('finalization after restart recomputes a nonpromotable TEST artifact from persisted receipts', async () => {
  const test = fixture();
  test.repository.calibrationEvidence.mockResolvedValue(storedEvidence());
  await test.worker.finalize(test.job.runId);
  expect(test.repository.finishCalibration).toHaveBeenCalledWith(
    test.job.runId,
    expect.objectContaining({
      version: 'help-evidence-2',
      origin: 'TEST',
      receiptCount: 4,
      measurement: expect.objectContaining({
        acceptanceThreshold: 0.2,
        falseAcceptances: 0,
      }),
    }),
  );
  expect(test.repository.failCalibrationRun).not.toHaveBeenCalled();
});
test('an invalid completed sample fails explicitly instead of publishing or looping forever', async () => {
  const test = fixture(),
    evidence = storedEvidence();
  evidence.corpus[1]!.contentHash = evidence.corpus[0]!.contentHash;
  test.repository.calibrationEvidence.mockResolvedValue(evidence);
  await test.worker.finalize(test.job.runId);
  expect(test.repository.finishCalibration).not.toHaveBeenCalled();
  expect(test.repository.failCalibrationRun).toHaveBeenCalledWith(
    test.job.runId,
    'CALIBRATION_INVALID',
  );
});
