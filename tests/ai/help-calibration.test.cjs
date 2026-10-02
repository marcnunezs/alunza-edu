const {
  calibrateHelpEvidence,
  parseHelpCalibrationArtifact,
  helpEvidencePolicyFromArtifact,
} = require('../../packages/ai/dist');
// Synthetic observations exercise only the pure algorithm. No Azure artifact
// is emitted, installed, or claimed to have been measured by these unit tests.
const relevant = 'c0000000-0000-4000-8000-000000000001';
const irrelevant = 'c0000000-0000-4000-8000-000000000002';
const binding = {
  configurationId: 'embeddings-example',
  embeddingModel: 'text-embedding-3-small',
  dimensions: 1536,
  tokenizerVersion: 'cl100k_base',
  queryVersion: 'help-query-1',
  corpusHash: 'a'.repeat(64),
};
const observation = (id, groupId, split, expected, distance) => ({
  id,
  groupId,
  split,
  expected,
  relevantChunkIds: expected === 'SUPPORTED' ? [relevant] : [],
  candidates: [
    { chunkId: expected === 'SUPPORTED' ? relevant : irrelevant, distance },
  ],
});
const cases = [
  observation('a1', 'exercise-a', 'calibration', 'SUPPORTED', 0.1),
  observation('a2', 'exercise-a', 'calibration', 'NO_EVIDENCE', 0.7),
  observation('b1', 'exercise-b', 'calibration', 'SUPPORTED', 0.15),
  observation('b2', 'exercise-b', 'calibration', 'AMBIGUOUS', 0.8),
  observation('v1', 'holdout-exercise', 'validation', 'SUPPORTED', 0.09),
  observation('v2', 'holdout-exercise', 'validation', 'NO_EVIDENCE', 0.9),
];
const calibrate = (changes = {}) =>
  calibrateHelpEvidence({
    measurementProvider: 'azure',
    binding,
    cases,
    ...changes,
  });
describe('reproducible measured calibration without a default threshold', () => {
  test('maximizes positive calibration coverage without false acceptance and validates held-out exercises', () => {
    const artifact = calibrate();
    expect(artifact.acceptanceThreshold).toBe(0.15);
    expect(artifact.ambiguityThreshold).toBeUndefined();
    expect(artifact.falseAcceptances).toBe(0);
    expect(artifact.validationAccepted).toBe(1);
    expect(calibrate({ cases: [...cases].reverse() })).toEqual(artifact);
    expect(parseHelpCalibrationArtifact(JSON.stringify(artifact))).toEqual(
      artifact,
    );
  });
  test('policy filters evidence and does not infer semantic ambiguity from distance', () => {
    const policy = helpEvidencePolicyFromArtifact(calibrate(), binding);
    const close = { chunk_id: relevant, distance: 0.1 };
    expect(policy.select([close])).toEqual({
      chunks: [close],
      reason: 'SUPPORTED',
    });
    expect(policy.select([{ chunk_id: relevant, distance: 0.16 }])).toEqual({
      chunks: [],
      reason: 'NO_EVIDENCE',
    });
    expect(policy.select([{ chunk_id: relevant, distance: 0.5 }])).toEqual({
      chunks: [],
      reason: 'NO_EVIDENCE',
    });
    expect(policy.select([])).toEqual({ chunks: [], reason: 'NO_EVIDENCE' });
    expect(() => policy.select([{ distance: NaN }])).toThrow('INVALID_CONTEXT');
  });
  test('policy identity includes the entire validated artifact, not just the observations', () => {
    const artifact = calibrate();
    const original = helpEvidencePolicyFromArtifact(artifact, binding);
    const changedThreshold = helpEvidencePolicyFromArtifact(
      { ...artifact, acceptanceThreshold: 0.14 },
      binding,
    );
    const changedBinding = { ...binding, corpusHash: 'b'.repeat(64) };
    const changedCorpus = helpEvidencePolicyFromArtifact(
      { ...artifact, binding: changedBinding },
      changedBinding,
    );
    expect(changedThreshold.version).not.toBe(original.version);
    expect(changedCorpus.version).not.toBe(original.version);
    expect(
      helpEvidencePolicyFromArtifact(JSON.stringify(artifact), binding).version,
    ).toBe(original.version);
  });
  test.each([
    'configurationId',
    'embeddingModel',
    'dimensions',
    'tokenizerVersion',
    'queryVersion',
    'corpusHash',
  ])('rejects changed binding %s', (key) => {
    const changed = {
      ...binding,
      [key]:
        key === 'dimensions'
          ? 3
          : key === 'corpusHash'
            ? 'b'.repeat(64)
            : 'changed',
    };
    expect(() => helpEvidencePolicyFromArtifact(calibrate(), changed)).toThrow(
      'CALIBRATION_INVALID',
    );
  });
  test.each([undefined, {}, '{invalid', '{}'])(
    'missing/invalid artifact %p never enables a numeric fallback',
    (artifact) => {
      expect(() => helpEvidencePolicyFromArtifact(artifact, binding)).toThrow(
        'CALIBRATION_INVALID',
      );
    },
  );
  test('rejects validation leakage across exercise groups', () => {
    expect(() =>
      calibrate({
        cases: cases.map((test) =>
          test.split === 'validation'
            ? { ...test, groupId: 'exercise-a' }
            : test,
        ),
      }),
    ).toThrow('CALIBRATION_INVALID');
  });
  test('rejects false acceptance on holdout, including ambiguity', () => {
    for (const expected of ['NO_EVIDENCE', 'AMBIGUOUS'])
      expect(() =>
        calibrate({
          cases: cases.map((test) =>
            test.id === 'v2'
              ? {
                  ...test,
                  expected,
                  candidates: [{ chunkId: irrelevant, distance: 0.02 }],
                }
              : test,
          ),
        }),
      ).toThrow('CALIBRATION_INVALID');
  });
  test('rejects no holdout coverage instead of certifying an always-empty policy', () => {
    expect(() =>
      calibrate({
        cases: cases.map((test) =>
          test.id === 'v1'
            ? { ...test, candidates: [{ chunkId: relevant, distance: 0.9 }] }
            : test,
        ),
      }),
    ).toThrow('CALIBRATION_INVALID');
  });
  test('rejects impossible calibration, duplicate IDs, missing negatives and false acceptance', () => {
    expect(() =>
      calibrate({
        cases: cases.map((test) =>
          test.expected === 'SUPPORTED'
            ? test
            : {
                ...test,
                candidates: [{ chunkId: irrelevant, distance: 0.01 }],
              },
        ),
      }),
    ).toThrow('CALIBRATION_INVALID');
    expect(() => calibrate({ cases: [...cases, cases[0]] })).toThrow(
      'CALIBRATION_INVALID',
    );
    expect(() =>
      calibrate({
        cases: cases.filter((test) => test.expected === 'SUPPORTED'),
      }),
    ).toThrow('CALIBRATION_INVALID');
    expect(() =>
      parseHelpCalibrationArtifact({
        ...calibrate(),
        falseAcceptances: 1,
      }),
    ).toThrow('CALIBRATION_INVALID');
    expect(() => calibrate({ measurementProvider: 'test' })).toThrow(
      'CALIBRATION_INVALID',
    );
  });
});
