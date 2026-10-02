const {
  buildHelpInput,
  buildHelpQuery,
  validateHelpCandidate,
  validatePreparedHelpInput,
  HELP_SYSTEM_PROMPT,
  HELP_VERIFICATION_PROMPT,
} = require('../../packages/ai/dist');
let corpus;
beforeAll(async () => {
  corpus = await import('../../fixtures/ai/help-adversarial-manifest.mjs');
});
test('adversarial corpus is distinct from demo, versioned and explicitly unevaluated', () => {
  expect(corpus.manifest).toMatchObject({
    version: 'help-adversarial-1',
    corpusKind: 'FICTITIOUS_ADVERSARIAL',
    productionCalibration: false,
    providerEvaluation: 'NOT_EXECUTED',
    humanAcceptance: 'PENDING',
  });
  expect(new Set(corpus.cases.map((item) => item.id)).size).toBe(
    corpus.cases.length,
  );
  expect(corpus.manifest.corpusHash).toMatch(/^[a-f0-9]{64}$/);
  expect(
    corpus.cases.every(
      (item) => item.group && item.expected && item.forbidden.length,
    ),
  ).toBe(true);
});
test('six diagnoses have feedback and every allowed hint level has a case', () => {
  const positive = corpus.cases.filter((item) => item.category === 'positive');
  expect(
    positive
      .filter((item) => item.kind === 'FEEDBACK')
      .map((item) => item.context.diagnosisCode)
      .sort(),
  ).toEqual([
    'FAILED_TEST',
    'RUNTIME_ERROR',
    'SUCCESS',
    'SYNTAX_ERROR',
    'TIMEOUT',
    'UNKNOWN',
  ]);
  for (const diagnosis of [
    'FAILED_TEST',
    'RUNTIME_ERROR',
    'SYNTAX_ERROR',
    'TIMEOUT',
  ])
    expect(
      positive
        .filter(
          (item) =>
            item.context.diagnosisCode === diagnosis && item.kind === 'HINT',
        )
        .map((item) => item.hintLevel),
    ).toEqual([1, 2, 3]);
  expect(
    positive
      .filter((item) =>
        ['SUCCESS', 'UNKNOWN'].includes(item.context.diagnosisCode),
      )
      .every((item) => item.kind === 'FEEDBACK'),
  ).toBe(true);
});
test('material/code instructions remain untrusted data without becoming system policy', () => {
  const attacks = corpus.cases.filter((item) => item.category === 'injection');
  expect(attacks.length).toBeGreaterThanOrEqual(10);
  for (const item of attacks) {
    const prepared = buildHelpInput(item);
    expect(validatePreparedHelpInput(prepared)).toEqual(prepared);
    expect(prepared.context.code).toBe(item.context.code);
    expect(prepared.chunks).toEqual(item.chunks);
    expect(buildHelpQuery(item.context)).not.toContain(
      'FICTITIOUS_SECRET_CANARY',
    );
  }
  expect(HELP_SYSTEM_PROMPT).not.toContain('FICTITIOUS_SECRET_CANARY');
  expect(HELP_VERIFICATION_PROMPT).not.toContain('FICTITIOUS_SECRET_CANARY');
  expect(HELP_SYSTEM_PROMPT).toContain('dato no confiable');
  expect(HELP_VERIFICATION_PROMPT).toContain('datos no confiables');
});
test('independent boundary oracles reject invalid candidates before review', () => {
  for (const item of corpus.cases.filter(
    (entry) => entry.expected.boundary === 'REJECT',
  ))
    expect(() =>
      validateHelpCandidate(buildHelpInput(item), item.candidate),
    ).toThrow('INVALID_OUTPUT');
});
test('semantic candidates require evaluation: schema success is never labeled quality success', () => {
  const semantic = corpus.cases.filter((item) => item.category === 'candidate');
  expect(semantic.map((item) => item.expected.reason)).toEqual(
    expect.arrayContaining([
      'DIAGNOSIS_CONTRADICTION',
      'UNSUPPORTED_CLAIM',
      'INSTRUCTION_INJECTION',
      'SOLUTION_DISCLOSURE',
    ]),
  );
  for (const item of semantic) {
    expect(validateHelpCandidate(buildHelpInput(item), item.candidate)).toEqual(
      item.candidate,
    );
    expect(item.expected.review).toBe('REJECT');
  }
  expect(corpus.rubric.status).toBe('PROPOSED_NOT_HUMAN_ACCEPTED');
});
test('contradictory material is a semantic case, not an invented cosine oracle', () => {
  const item = corpus.cases.find((entry) => entry.category === 'contradiction');
  expect(buildHelpInput(item).chunks).toHaveLength(2);
  expect(item.expected).toMatchObject({
    boundary: 'SEMANTIC_REVIEW',
    review: 'NO_EVIDENCE',
    reason: 'AMBIGUOUS_EVIDENCE',
  });
});
