const { describeHelpSyntax } = require('../../packages/ai/dist/help-syntax');
const {
  buildHelpQuery,
  buildHelpInput,
  helpTokenCount,
} = require('../../packages/ai/dist');
let context, chunk;
beforeAll(async () => {
  ({ helpContext: context, helpChunk: chunk } =
    await import('../../fixtures/ai/help-corpus.mjs'));
});
const unavailable = ['Estructura sintáctica no disponible.'];

test('comments, strings and property names do not become return instructions', () => {
  const facts = describeHelpSyntax(
    'function solve(n) { /* return n; */ const text = "return n"; const x = {return: n}; x.return; }',
  );
  expect(facts).toHaveLength(1);
  expect(facts[0]).toContain('sin instrucciones return propias');
  expect(facts[0]).toContain('declaraciones de variables');
});

test('a nested function return is not assigned to its enclosing function', () => {
  const facts = describeHelpSyntax(
    'function solve(n) { function helper(x) { return x * 2; } helper(n) + 1; }',
  );
  expect(facts).toHaveLength(2);
  expect(facts[0]).toContain(
    'Función 1: cuerpo de bloque sin instrucciones return propias',
  );
  expect(facts[0]).toContain('llamadas dentro de esas expresiones');
  expect(facts[1]).toContain(
    'Función 2: cuerpo de bloque; 1 instrucciones return propias (1 con expresión)',
  );
});

test('distinguishes an arrow expression from a block without claiming an error', () => {
  expect(describeHelpSyntax('const solve = n => n * 2;')).toEqual([
    'Función 1: flecha con cuerpo de expresión (retorno implícito), sin bloque de instrucciones.',
  ]);
  expect(describeHelpSyntax('const solve = n => { n * 2; };')[0]).toContain(
    'flecha con cuerpo de bloque sin instrucciones return propias',
  );
});

test('counts syntax inside an if without inferring which paths execute', () => {
  const facts = describeHelpSyntax(
    'function solve(n) { if (n === 0) return; if (n > 0) return n; }',
  );
  expect(facts[0]).toContain(
    '2 instrucciones return propias (1 con expresión)',
  );
  expect(facts[0]).toContain('return dentro de if');
  expect(facts[0]).not.toMatch(
    /garantiza|siempre|undefined|incorrect|debe|error/,
  );
  const nested = describeHelpSyntax(
    'function solve(n) { if (n) { const nested = () => { return n; }; } }',
  );
  expect(nested[0]).not.toContain('return dentro de if');
  expect(nested[1]).not.toContain('return dentro de if');
});

test('assignment and console calls are syntax facts, not execution or a solution', () => {
  const facts = describeHelpSyntax(
    'globalThis.HELP_SYNTAX_EXECUTION_CANARY = true; function solve(n) { let x; if(n) { x = n; } else { x = 0; } console.log(x); }',
  );
  expect(globalThis.HELP_SYNTAX_EXECUTION_CANARY).toBeUndefined();
  expect(facts[0]).toContain('asignaciones');
  expect(facts[0]).toContain('llamadas dentro de esas expresiones');
  expect(facts[0]).toContain('sin instrucciones return propias');
});

test('regex literals are rejected before Acorn can validate or construct them', () => {
  const constructor = jest.spyOn(globalThis, 'RegExp');
  expect(
    describeHelpSyntax(
      'function solve(n) { const pattern = /STUDENT_UNCOMPILED_PATTERN/u; return n; }',
    ),
  ).toEqual(unavailable);
  expect(
    constructor.mock.calls.some(
      ([pattern]) => pattern === 'STUDENT_UNCOMPILED_PATTERN',
    ),
  ).toBe(false);
  constructor.mockRestore();
  expect(
    describeHelpSyntax('function solve(n) { return n / 2; }')[0],
  ).toContain('1 instrucciones return propias');
});

test.each([
  'function solve( {',
  'using resource = acquire(); function solve(n) { return n; }',
  'const x = 1;',
  `function solve(n) { return ${'('.repeat(40)}n${')'.repeat(40)}; }`,
  'function solve(n) {' + 'n;'.repeat(260) + '}',
  'function solve(n) {' + 'x'.repeat(2050) + '}',
  'function solve(n) { return ' + 'n+'.repeat(80) + '1; }',
])('an unsupported or bounded-out analysis is neutral: %p', (code) => {
  const before = Date.now();
  expect(describeHelpSyntax(code)).toEqual(unavailable);
  expect(Date.now() - before).toBeLessThan(1000);
});

test('the optional analysis ceiling neither rejects 64KiB student code nor shortens generation context', () => {
  const code =
    'function solve(n) {\n' +
    '// datos públicos\n'.repeat(150) +
    'return n;\n}';
  expect(Buffer.byteLength(code)).toBeGreaterThan(2048);
  expect(describeHelpSyntax(code)).toEqual(unavailable);
  const query = buildHelpQuery({ ...context, code });
  expect(query).toContain(unavailable[0]);
  expect(query).toContain(`Diagnóstico persistido: ${context.diagnosisCode}`);
  expect(helpTokenCount(query)).toBeLessThanOrEqual(500);
  const prepared = buildHelpInput({
    context: { ...context, code },
    chunks: [chunk],
    kind: 'FEEDBACK',
    hintLevel: null,
  });
  expect(prepared.context.code).toBe(code);
  expect(prepared.truncation.code).toBe(false);
  expect(() =>
    buildHelpQuery({ ...context, code: 'x'.repeat(65536) }),
  ).not.toThrow();
});

test('facts keep complete function lines while narrative and result metadata stay outside syntax retrieval', () => {
  const code = Array.from(
    { length: 10 },
    (_, i) =>
      `function f${i}(n) { let x; if(n) { x=n; } else { x=0; } helper(x); }`,
  ).join('\n');
  const query = buildHelpQuery({
    ...context,
    code,
    statement: 'Enunciado público. '.repeat(2000),
    concepts: Array.from({ length: 100 }, () =>
      'Concepto público. '.repeat(10),
    ),
  });
  expect(query).toContain(
    'Función 1: cuerpo de bloque sin instrucciones return propias',
  );
  expect(query).toContain('[hechos restantes omitidos]');
  expect(query.match(/\[fragmento inicial\]/g)).toHaveLength(2);
  expect(query).toContain('Código JavaScript (datos):');
  expect(query).not.toMatch(
    /Enunciado|Diagnóstico|Infraestructura|Pruebas visibles/,
  );
  const codeFragment = query
    .split('Código JavaScript (datos): ')[1]
    .split('\n[fragmento inicial]')[0];
  expect(code.startsWith(codeFragment)).toBe(true);
  expect(helpTokenCount(codeFragment)).toBeLessThanOrEqual(32);
  expect(helpTokenCount(query)).toBeLessThanOrEqual(500);
});
