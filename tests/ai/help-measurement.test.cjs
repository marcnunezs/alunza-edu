const { createHash } = require('node:crypto');
const {
  calibrateHelpEvidenceFromReceipts,
  verifiedHelpCalibrationHash,
  verifiedHelpEvidencePolicyFromArtifact,
  TOKENIZER_VERSION,
} = require('../../packages/ai/dist');
const id = (n) => `e1000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const digest = (text) => createHash('sha256').update(text).digest('hex');
// Synthetic authoritative-record doubles test validation only. No artifact is
// written, attested by a database, installed, or claimed as an Azure measurement.
function fixture(origin = 'AZURE') {
  const runId = id(1);
  const binding = {
    configurationId: 'embedding-verified',
    embeddingModel: 'text-embedding-3-small',
    dimensions: 3,
    tokenizerVersion: TOKENIZER_VERSION,
    queryVersion: 'help-query-1',
    corpusHash: 'a'.repeat(64),
  };
  const corpus = [
    {
      sourceVersionId: id(2),
      chunkId: id(3),
      contentHash: digest('Material ficticio de funciones.'),
    },
    {
      sourceVersionId: id(4),
      chunkId: id(5),
      contentHash: digest('Material ficticio irrelevante.'),
    },
    {
      sourceVersionId: id(6),
      chunkId: id(7),
      contentHash: digest('Documento diferente para validación reservada.'),
    },
  ];
  const cases = [
    ['cal-positive', 'training', 'calibration', 'SUPPORTED', 0.2],
    ['cal-negative', 'training', 'calibration', 'NO_EVIDENCE', 0.6],
    ['val-positive', 'holdout', 'validation', 'SUPPORTED', 0.1],
    ['val-negative', 'holdout', 'validation', 'NO_EVIDENCE', 0.7],
  ].map(([caseId, groupId, split, expected, distance]) => ({
    id: caseId,
    groupId,
    split,
    expected,
    relevantChunkIds:
      expected === 'SUPPORTED' ? [id(split === 'calibration' ? 3 : 7)] : [],
    candidates: [
      {
        chunkId:
          expected === 'SUPPORTED'
            ? id(split === 'calibration' ? 3 : 7)
            : id(5),
        distance,
      },
    ],
  }));
  const queries = cases.map((test) => ({
    caseId: test.id,
    text: `Consulta pública ${test.id}`,
    queryHash: digest(`Consulta pública ${test.id}`),
  }));
  const observations = cases.map((test, index) => ({
    caseId: test.id,
    callId: id(10 + index),
    queryHash: queries[index].queryHash,
    corpusHash: binding.corpusHash,
    candidates: test.candidates,
  }));
  const receipts = observations.map((observation) => ({
    callId: observation.callId,
    runId,
    provider: origin,
    configurationId: binding.configurationId,
    model: binding.embeddingModel,
    dimensions: binding.dimensions,
    inputHash: observation.queryHash,
    state: 'COMPLETED',
    requestId: `observed-${observation.caseId}`,
  }));
  return {
    evidence: {
      version: 'help-measurement-1',
      origin,
      runId,
      binding,
      corpus,
      cases,
      queries,
      observations,
    },
    trusted: globalThis.structuredClone({
      origin,
      runId,
      binding,
      corpus,
      receipts,
      observations,
    }),
  };
}
test('recomputes coverage from independently supplied database observations and receipts', () => {
  const { evidence, trusted } = fixture();
  const artifact = calibrateHelpEvidenceFromReceipts(evidence, trusted);
  expect(artifact).toMatchObject({
    version: 'help-evidence-2',
    origin: 'AZURE',
    runId: evidence.runId,
    receiptCount: 4,
    observationCount: 4,
    measurement: {
      acceptanceThreshold: 0.2,
      falseAcceptances: 0,
      validationAccepted: 1,
    },
  });
  const accepted = verifiedHelpEvidencePolicyFromArtifact(
    artifact,
    evidence.binding,
    verifiedHelpCalibrationHash(artifact),
  );
  expect(accepted.select([{ chunk_id: id(3), distance: 0.1 }]).reason).toBe(
    'SUPPORTED',
  );
  expect(artifact.evidenceHash).not.toBe(verifiedHelpCalibrationHash(artifact));
});
test.each(['threshold', 'origin', 'run', 'corpus'])(
  'independent DB attestation detects changed artifact %s',
  (field) => {
    const { evidence, trusted } = fixture();
    const artifact = calibrateHelpEvidenceFromReceipts(evidence, trusted);
    const expected = verifiedHelpCalibrationHash(artifact),
      changed = globalThis.structuredClone(artifact);
    if (field === 'threshold') changed.measurement.acceptanceThreshold = 0.9;
    if (field === 'origin') changed.origin = 'TEST';
    if (field === 'run') changed.runId = id(99);
    if (field === 'corpus')
      changed.measurement.binding.corpusHash = 'b'.repeat(64);
    expect(() =>
      verifiedHelpEvidencePolicyFromArtifact(
        changed,
        evidence.binding,
        expected,
        { allowTest: true },
      ),
    ).toThrow('CALIBRATION_INVALID');
  },
);
test('TEST observations are valid for explicit tests and never promote to Azure', () => {
  const { evidence, trusted } = fixture('TEST');
  const artifact = calibrateHelpEvidenceFromReceipts(evidence, trusted);
  expect(() =>
    verifiedHelpEvidencePolicyFromArtifact(
      artifact,
      evidence.binding,
      verifiedHelpCalibrationHash(artifact),
    ),
  ).toThrow('CALIBRATION_INVALID');
  expect(
    verifiedHelpEvidencePolicyFromArtifact(
      artifact,
      evidence.binding,
      verifiedHelpCalibrationHash(artifact),
      { allowTest: true },
    ).version,
  ).toContain(':TEST:');
  evidence.origin = 'AZURE';
  expect(() => calibrateHelpEvidenceFromReceipts(evidence, trusted)).toThrow(
    'CALIBRATION_INVALID',
  );
});
test.each([
  'missing-receipt',
  'wrong-model',
  'wrong-config',
  'wrong-dimensions',
  'wrong-query',
  'wrong-corpus',
  'invented-distance',
  'wrong-origin',
  'missing-request-id',
  'shared-call',
  'unknown-chunk',
  'semantic-ambiguity',
])('rejects unauthenticated measurement %s', (change) => {
  const { evidence, trusted } = fixture();
  if (change === 'missing-receipt') trusted.receipts.pop();
  if (change === 'wrong-model') trusted.receipts[0].model = 'other-model';
  if (change === 'wrong-config')
    trusted.receipts[0].configurationId = 'other-config';
  if (change === 'wrong-dimensions') trusted.receipts[0].dimensions = 4;
  if (change === 'wrong-query') evidence.queries[0].text = 'Changed';
  if (change === 'wrong-corpus')
    evidence.corpus[0].contentHash = 'b'.repeat(64);
  if (change === 'invented-distance')
    evidence.observations[0].candidates[0].distance = 0.001;
  if (change === 'wrong-origin') trusted.receipts[0].provider = 'TEST';
  if (change === 'missing-request-id') delete trusted.receipts[0].requestId;
  if (change === 'shared-call')
    evidence.observations[1].callId = evidence.observations[0].callId;
  if (change === 'unknown-chunk') evidence.cases[0].relevantChunkIds = [id(99)];
  if (change === 'semantic-ambiguity') evidence.cases[1].expected = 'AMBIGUOUS';
  expect(() => calibrateHelpEvidenceFromReceipts(evidence, trusted)).toThrow(
    'CALIBRATION_INVALID',
  );
});
test('legacy Azure label, self-supplied evidence digest and missing attestation cannot enable product policy', () => {
  const { evidence, trusted } = fixture();
  const artifact = calibrateHelpEvidenceFromReceipts(evidence, trusted);
  for (const value of [
    artifact.measurement,
    { ...artifact, evidenceHash: 'a'.repeat(64) },
  ])
    expect(() =>
      verifiedHelpEvidencePolicyFromArtifact(
        value,
        evidence.binding,
        verifiedHelpCalibrationHash(artifact),
      ),
    ).toThrow('CALIBRATION_INVALID');
  expect(() =>
    verifiedHelpEvidencePolicyFromArtifact(
      artifact,
      evidence.binding,
      undefined,
    ),
  ).toThrow('CALIBRATION_INVALID');
});
test.each(['version', 'content', 'query'])(
  'holdout cannot reuse training %s even under a new group label',
  (field) => {
    const { evidence, trusted } = fixture();
    if (field === 'version')
      evidence.corpus[2].sourceVersionId = trusted.corpus[2].sourceVersionId =
        evidence.corpus[0].sourceVersionId;
    if (field === 'content')
      evidence.corpus[2].contentHash = trusted.corpus[2].contentHash =
        evidence.corpus[0].contentHash;
    if (field === 'query') {
      evidence.queries[2].text = evidence.queries[0].text;
      evidence.queries[2].queryHash = evidence.queries[0].queryHash;
      evidence.observations[2].queryHash = trusted.observations[2].queryHash =
        evidence.queries[0].queryHash;
      trusted.receipts[2].inputHash = evidence.queries[0].queryHash;
    }
    expect(() => calibrateHelpEvidenceFromReceipts(evidence, trusted)).toThrow(
      'CALIBRATION_INVALID',
    );
  },
);
