const {
  buildHelpQuery,
  buildHelpInput,
  helpTokenCount,
  validatePreparedHelpInput,
  validateHelpCandidate,
  validateHelpVerification,
} = require('../../packages/ai/dist');
let context, chunk, candidates;
beforeAll(async () => {
  ({
    helpContext: context,
    helpChunk: chunk,
    helpCandidates: candidates,
  } = await import('../../fixtures/ai/help-corpus.mjs'));
});
const input = (changes = {}, tokenizer) =>
  buildHelpInput(
    {
      context,
      chunks: [chunk],
      kind: 'FEEDBACK',
      hintLevel: null,
      ...changes,
    },
    tokenizer,
  );
function reordered(value) {
  if (Array.isArray(value)) return value.map(reordered);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, item]) => [key, reordered(item)]),
    );
  return value;
}
describe('persisted help context and public result boundary', () => {
  test('allows only persisted public fields and retains the complete code', () => {
    const code =
      'function doble(n) {\n' +
      '  // contexto público\n'.repeat(80) +
      'return n * 2;\n}';
    const safe = input({
      context: {
        ...context,
        code,
        hiddenTests: ['secret'],
        stdout: 'private',
        visibleTests: [
          {
            id: 'visible-1',
            passed: false,
            expected: 'hidden',
            stdout: 'private',
          },
        ],
      },
    });
    expect(safe.context.code).toBe(code);
    expect(safe.truncation).toEqual({
      statement: false,
      code: false,
      concepts: false,
      visibleTests: false,
    });
    expect(JSON.stringify(safe)).not.toMatch(
      /secret|private|hiddenTests|expected|stdout/,
    );
    expect(helpTokenCount(JSON.stringify(safe))).toBeLessThanOrEqual(5000);
  });
  test('rejects too much complete context instead of shortening code or statement', () => {
    expect(() =>
      input({
        context: { ...context, code: 'const siguiente = 1;\n'.repeat(1600) },
      }),
    ).toThrow('CONTEXT_TOO_LARGE');
    expect(() =>
      input({
        context: {
          ...context,
          statement: 'Una explicación pública.\n'.repeat(1300),
        },
      }),
    ).toThrow('CONTEXT_TOO_LARGE');
  });
  test.each(['cl100k_base', 'o200k_base'])(
    'bounds tokenizer work without changing text or counts for %s',
    (tokenizer) => {
      const before = Date.now();
      expect(() => helpTokenCount('a'.repeat(65536), tokenizer)).toThrow(
        'CONTEXT_TOO_LARGE',
      );
      expect(Date.now() - before).toBeLessThan(1000);
      expect(helpTokenCount('a'.repeat(2048), tokenizer)).toBeGreaterThan(0);
      expect(() => helpTokenCount('a'.repeat(2049), tokenizer)).toThrow(
        'CONTEXT_TOO_LARGE',
      );
      expect(
        input({ context: { ...context, code: 'a'.repeat(2048) } }, tokenizer)
          .context.code,
      ).toBe('a'.repeat(2048));
      expect(() =>
        input({ context: { ...context, code: 'a'.repeat(65536) } }, tokenizer),
      ).toThrow('CONTEXT_TOO_LARGE');
      expect(
        helpTokenCount(
          buildHelpQuery({ ...context, statement: 'a'.repeat(65536) }),
        ),
      ).toBeLessThanOrEqual(500);
    },
  );
  test('query is deterministic, at most 500 cl100k tokens and excludes submitted code/output', () => {
    const query = buildHelpQuery({
      ...context,
      statement: 'Funciones y retorno 🧑‍💻. '.repeat(100),
      code: 'PRIVATE_CODE',
      stdout: 'PRIVATE_OUTPUT',
    });
    expect(helpTokenCount(query)).toBeLessThanOrEqual(500);
    expect(query).not.toMatch(/PRIVATE|\uFFFD/);
    expect(buildHelpQuery(context)).toBe(buildHelpQuery(context));
    expect(buildHelpQuery(context)).toContain('FAILED_TEST');
  });
  test.each(['cl100k_base', 'o200k_base'])(
    'supports explicitly configured tokenizer %s',
    (tokenizer) => {
      const prepared = input({}, tokenizer);
      expect(prepared.tokenizer).toBe(tokenizer);
      expect(validatePreparedHelpInput(prepared)).toEqual(prepared);
      expect(helpTokenCount('<|endoftext|>', tokenizer)).toBeGreaterThan(0);
    },
  );
  test('checkpoint digest survives JSONB key ordering and rejects changed data or extra keys', () => {
    const original = input();
    expect(validatePreparedHelpInput(reordered(original))).toEqual(original);
    expect(() =>
      validatePreparedHelpInput({
        ...original,
        context: { ...original.context, code: 'changed' },
      }),
    ).toThrow('INVALID_CONTEXT');
    expect(() =>
      validatePreparedHelpInput({ ...original, secret: 'unexpected' }),
    ).toThrow('INVALID_CONTEXT');
    expect(() =>
      validatePreparedHelpInput({
        ...original,
        context: { ...original.context, stdout: 'unexpected' },
      }),
    ).toThrow('INVALID_CONTEXT');
    expect(() =>
      validatePreparedHelpInput({
        ...original,
        truncation: { ...original.truncation, code: true },
      }),
    ).toThrow('INVALID_CONTEXT');
  });
  test.each(['\u0000', '\uD800', '\uDC00'])(
    'rejects malformed Unicode %p',
    (code) => {
      expect(() => input({ context: { ...context, code } })).toThrow(
        'INVALID_CONTEXT',
      );
    },
  );
  test('preserves valid emoji and combining accents', () => {
    expect(
      input({ context: { ...context, code: '// 🧑‍💻 cafe\u0301' } }).context.code,
    ).toBe('// 🧑‍💻 cafe\u0301');
  });
  test.each([
    { kind: 'FEEDBACK', hintLevel: 1 },
    { kind: 'HINT', hintLevel: null },
    { kind: 'HINT', hintLevel: 4 },
    { kind: 'HINT', hintLevel: 1, diagnosisCode: 'SUCCESS' },
    {
      kind: 'HINT',
      hintLevel: 1,
      diagnosisCode: 'UNKNOWN',
      infrastructureStatus: 'FAILED',
    },
  ])(
    'rejects invalid help kind/level combination %p',
    ({ diagnosisCode, infrastructureStatus, ...settings }) => {
      expect(() =>
        input({
          ...settings,
          context: {
            ...context,
            ...(diagnosisCode ? { diagnosisCode } : {}),
            ...(infrastructureStatus ? { infrastructureStatus } : {}),
          },
        }),
      ).toThrow('INVALID_HINT_LEVEL');
    },
  );
  test.each([1, 2, 3])(
    'accepts level %i independently of feedback',
    (hintLevel) => {
      const prepared = input({ kind: 'HINT', hintLevel });
      expect(validateHelpCandidate(prepared, candidates[hintLevel])).toEqual(
        candidates[hintLevel],
      );
    },
  );
  test('operational UNKNOWN requires canonical UNKNOWN; success feedback remains available', () => {
    expect(() =>
      input({ context: { ...context, infrastructureStatus: 'FAILED' } }),
    ).toThrow('INVALID_CONTEXT');
    expect(
      input({ context: { ...context, diagnosisCode: 'SUCCESS' } }).kind,
    ).toBe('FEEDBACK');
    expect(
      input({
        context: {
          ...context,
          diagnosisCode: 'UNKNOWN',
          infrastructureStatus: 'FAILED',
        },
      }).kind,
    ).toBe('FEEDBACK');
  });
  test.each([[], [null], Array(6).fill({})].map((chunks) => ({ chunks })))(
    'rejects invalid corpus %p',
    ({ chunks }) => expect(() => input({ chunks })).toThrow('INVALID_CONTEXT'),
  );
  test('requires genuine bounded source references, distinct chunks and valid distances', () => {
    for (const chunks of [
      [chunk, chunk],
      [{ ...chunk, distance: NaN }],
      [{ ...chunk, distance: -1 }],
      [{ ...chunk, locator: '' }],
      [{ ...chunk, text: 'palabra '.repeat(600) }],
    ])
      expect(() => input({ chunks })).toThrow('INVALID_CONTEXT');
  });
  test('preserves exactly the five public fields', () => {
    expect(
      Object.keys(validateHelpCandidate(input(), candidates.FEEDBACK)).sort(),
    ).toEqual([
      'diagnosis_code',
      'explanation',
      'hint',
      'source_refs',
      'status',
    ]);
  });
  test.each([
    { score: 10 },
    { diagnosis_code: 'SUCCESS' },
    { hint: 'Una pista no solicitada' },
    { explanation: '<script>alert(1)</script>' },
    { explanation: 'Consulta https://example.invalid' },
    { source_refs: [] },
  ])('rejects invalid candidate %p', (changes) => {
    expect(() =>
      validateHelpCandidate(input(), { ...candidates.FEEDBACK, ...changes }),
    ).toThrow('INVALID_OUTPUT');
  });
  test('validates exact reference locator and rejects duplicate citation', () => {
    const ref = candidates.FEEDBACK.source_refs[0];
    for (const refs of [[{ ...ref, locator: 'otra página' }], [ref, ref]])
      expect(() =>
        validateHelpCandidate(input(), {
          ...candidates.FEEDBACK,
          source_refs: refs,
        }),
      ).toThrow('INVALID_OUTPUT');
  });
  test('review ACCEPT requires exact candidate refs and valid verdict/reason semantics', () => {
    const accepted = {
      verdict: 'ACCEPT',
      reason: 'SUPPORTED',
      source_refs: candidates.FEEDBACK.source_refs,
    };
    expect(
      validateHelpVerification(input(), candidates.FEEDBACK, accepted),
    ).toEqual(accepted);
    for (const bad of [
      { ...accepted, source_refs: [] },
      { ...accepted, reason: 'DIAGNOSIS_CONTRADICTION' },
      { ...accepted, verdict: 'NO_EVIDENCE' },
      { ...accepted, reason: 'SUPPORTED', verdict: 'REJECT' },
      { ...accepted, score: 1 },
    ])
      expect(() =>
        validateHelpVerification(input(), candidates.FEEDBACK, bad),
      ).toThrow('INVALID_OUTPUT');
    expect(
      validateHelpVerification(input(), candidates.FEEDBACK, {
        verdict: 'REJECT',
        reason: 'UNSUPPORTED_CLAIM',
        source_refs: [],
      }),
    ).toEqual({
      verdict: 'REJECT',
      reason: 'UNSUPPORTED_CLAIM',
      source_refs: [],
    });
  });
});
