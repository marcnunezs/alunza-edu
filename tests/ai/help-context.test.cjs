const {
  buildHelpQuery,
  buildHelpInput,
  helpTokenCount,
  validatePreparedHelpInput,
  validateHelpCandidate,
  validateHelpVerification,
  HELP_QUERY_VERSION,
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
  test('query v4 retains short code as data while excluding private and result metadata', () => {
    const code = 'function solve(n) { n * 2; return n; }';
    const query = buildHelpQuery({
      ...context,
      statement: 'Funciones y retorno 🧑‍💻. '.repeat(100),
      code,
      stdout: 'PRIVATE_OUTPUT',
      hiddenTests: ['PRIVATE_TEST'],
      visibleTests: [
        {
          id: 'PRIVATE_TEST_ID',
          passed: false,
          expected: 'PRIVATE_EXPECTED',
          stdout: 'PRIVATE_VISIBLE_OUTPUT',
        },
      ],
    });
    expect(HELP_QUERY_VERSION).toBe('help-query-4');
    expect(query).toContain(code);
    expect(query).not.toMatch(
      /Pruebas visibles|Diagnóstico persistido|Infraestructura|Enunciado/,
    );
    expect(query).not.toContain(context.attemptId);
    expect(query).not.toContain(context.exerciseVersionId);
    expect(helpTokenCount(query)).toBeLessThanOrEqual(500);
    expect(query).not.toMatch(/PRIVATE|\uFFFD/);
    expect(buildHelpQuery(context)).toBe(buildHelpQuery(context));
    expect(buildHelpQuery(context)).not.toContain('FAILED_TEST');
    expect(input().context.diagnosisCode).toBe(context.diagnosisCode);
  });
  test('different persisted code changes retrieval without reclassifying the result', () => {
    const first = buildHelpQuery({
      ...context,
      code: 'const solve = n => { n * 2; };',
    });
    const second = buildHelpQuery({
      ...context,
      code: 'const solve = n => n * 2;',
    });
    expect(first).not.toBe(second);
    for (const query of [first, second])
      expect(query).not.toContain('Diagnóstico persistido:');
    expect(input().context.diagnosisCode).toBe(context.diagnosisCode);
    expect(buildHelpQuery({ ...context, code: 'const x = 1;' })).not.toMatch(
      /falta return|debe devolver|incorrecto/,
    );
  });
  test('syntax retrieval ignores visible IDs and counts while generation preserves public results', () => {
    const original = {
      ...context,
      visibleTests: [{ id: 'first-id', passed: false }],
    };
    expect(buildHelpQuery(original)).toBe(
      buildHelpQuery({
        ...original,
        visibleTests: [{ id: 'different-id', passed: false }],
      }),
    );
    expect(buildHelpQuery(original)).toBe(
      buildHelpQuery({
        ...original,
        visibleTests: [{ id: 'first-id', passed: true }],
      }),
    );
    expect(input({ context: original }).context.visibleTests).toEqual(
      original.visibleTests,
    );
  });
  test.each(['Una explicación pública. 🧑‍💻 '.repeat(1800), 'a'.repeat(65536)])(
    'a long statement cannot displace the complete short code or concepts',
    (statement) => {
      const code = 'function solve(n) { return n; }';
      const query = buildHelpQuery({
        ...context,
        statement,
        code,
        concepts: ['Variables', 'Condiciones'],
      });
      expect(query).toContain(`Código JavaScript (datos): ${code}`);
      expect(query).toContain('Conceptos: Variables; Condiciones');
      expect(query).not.toContain('Enunciado');
      expect(query).toBe(
        buildHelpQuery({
          ...context,
          statement: 'Una narrativa diferente.',
          code,
          concepts: ['Variables', 'Condiciones'],
        }),
      );
      expect(helpTokenCount(query)).toBeLessThanOrEqual(500);
      expect(query).not.toContain('\uFFFD');
    },
  );
  test.each(['// 🧑‍💻 cafe\u0301\n', '"\\\t\n', 'const siguiente = 1;\n', 'a'])(
    'bounds all independent sections and marks incomplete code for %p',
    (piece) => {
      const code = piece.repeat(Math.floor(65536 / piece.length));
      const statement = 'Enunciado público. '.repeat(2000);
      const query = buildHelpQuery({
        ...context,
        code,
        statement,
        concepts: Array.from({ length: 100 }, () =>
          'Concepto público. '.repeat(10),
        ),
        visibleTests: Array.from({ length: 8 }, (_, i) => ({
          id: `test-${i}`,
          passed: i % 2 === 0,
        })),
      });
      expect(query).toContain('Código JavaScript (datos): ');
      expect(query).toContain('Enunciado (datos): ');
      expect(query.match(/\[fragmento inicial\]/g)).toHaveLength(3);
      expect(query).toContain('Pruebas visibles: 4 de 8 aprobadas.');
      expect(query).toContain(
        `Diagnóstico persistido: ${context.diagnosisCode}`,
      );
      expect(query).not.toContain('\uFFFD');
      expect(helpTokenCount(query)).toBeLessThanOrEqual(500);
    },
  );
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
