/* eslint @typescript-eslint/no-require-imports: "off" */
const { randomUUID } = require('node:crypto');
const c = require('@alunza/contracts');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

test('OpenAPI publica archivo de ejercicios y todas sus referencias JSON resuelven', () => {
  const document = JSON.parse(
    readFileSync(join(__dirname, '../packages/contracts/openapi.json'), 'utf8'),
  );
  expect(document.paths['/api/v1/exercises/{id}/archive'].post).toBeDefined();
  const inspect = (value) => {
    if (!value || typeof value !== 'object') return;
    if (typeof value.$ref === 'string' && value.$ref.startsWith('#/')) {
      const target = value.$ref
        .slice(2)
        .split('/')
        .reduce(
          (node, part) =>
            node?.[part.replaceAll('~1', '/').replaceAll('~0', '~')],
          document,
        );
      expect({ reference: value.$ref, resolved: target !== undefined }).toEqual(
        { reference: value.$ref, resolved: true },
      );
    }
    Object.values(value).forEach(inspect);
  };
  inspect(document);
});
const definition = () => ({
  title: 'Sumar',
  statement: 'Retorna a+b.',
  starterCode: 'function solve(a,b){}',
  language: 'javascript',
  entrypoint: 'solve',
  difficulty: 'BEGINNER',
  conceptVersionIds: [randomUUID()],
  tests: [{ id: 'v1', visibility: 'visible', args: [1, 2], expected: 3 }],
  executionLimits: {
    memoryBytes: 134217728,
    runtimeMs: 3000,
    outputBytes: 65536,
  },
});
test('RF004 rechaza contradicción entre visible y oculta con objetos JSON equivalentes', () => {
  const value = definition();
  value.tests = [
    { id: 'v', visibility: 'visible', args: [{ a: 1, b: 2 }], expected: 3 },
    { id: 'h', visibility: 'hidden', args: [{ b: 2, a: 1 }], expected: 4 },
  ];
  expect(c.exerciseVersionInputSchema.safeParse(value).success).toBe(false);
  value.tests[1].expected = 3;
  expect(c.exerciseVersionInputSchema.safeParse(value).success).toBe(true);
});
test.each(['secret', 'ownerId', 'organizationId'])(
  'autoría no admite campo privilegiado %s',
  (field) => {
    expect(
      c.exerciseVersionInputSchema.safeParse({
        ...definition(),
        [field]: randomUUID(),
      }).success,
    ).toBe(false);
  },
);
test('RF004 no admite solo ocultas, duplicados, límites ampliados ni valores no JSON', () => {
  const value = definition();
  expect(c.exerciseVersionInputSchema.safeParse(value).success).toBe(true);
  for (const tests of [
    [],
    [{ ...value.tests[0], visibility: 'hidden' }],
    [value.tests[0], value.tests[0]],
    [{ ...value.tests[0], expected: Infinity }],
  ])
    expect(
      c.exerciseVersionInputSchema.safeParse({ ...value, tests }).success,
    ).toBe(false);
  expect(
    c.exerciseVersionInputSchema.safeParse({
      ...value,
      executionLimits: { ...value.executionLimits, runtimeMs: 3001 },
    }).success,
  ).toBe(false);
});
test('RF004 limita bytes UTF-8 de código y argumentos, no solo caracteres', () => {
  const value = definition();
  expect(
    c.exerciseVersionInputSchema.safeParse({
      ...value,
      starterCode: 'a'.repeat(65536),
    }).success,
  ).toBe(true);
  expect(
    c.exerciseVersionInputSchema.safeParse({
      ...value,
      starterCode: 'á'.repeat(32769),
    }).success,
  ).toBe(false);
  expect(
    c.exerciseVersionInputSchema.safeParse({
      ...value,
      tests: [{ ...value.tests[0], args: ['x'.repeat(65536)] }],
    }).success,
  ).toBe(false);
});
test('RF004 rechaza Unicode no persistible y admite pares válidos y JSON compacto en la frontera', () => {
  const value = definition();
  for (const invalid of [String.fromCharCode(0), String.fromCharCode(0xd800)]) {
    expect(
      c.exerciseVersionInputSchema.safeParse({ ...value, title: invalid })
        .success,
    ).toBe(false);
    expect(
      c.exerciseVersionInputSchema.safeParse({
        ...value,
        tests: [{ ...value.tests[0], args: [{ [invalid]: 'valor' }] }],
      }).success,
    ).toBe(false);
    expect(
      c.exerciseVersionInputSchema.safeParse({
        ...value,
        tests: [{ ...value.tests[0], expected: invalid }],
      }).success,
    ).toBe(false);
  }
  expect(
    c.exerciseVersionInputSchema.safeParse({
      ...value,
      title: 'Funciones 😀',
      tests: [
        { ...value.tests[0], args: Array(32767).fill(0), expected: 1e30 },
      ],
    }).success,
  ).toBe(true);
});

test('fechas académicas conservan fecha civil y rechazan fin anterior', () => {
  const course = {
    code: ' pr1 ',
    name: 'Programación',
    academicPeriod: '2026-2',
    startDate: '2026-08-01',
    endDate: '2026-12-01',
  };
  expect(c.courseCreateSchema.parse(course).startDate).toBe('2026-08-01');
  expect(
    c.courseCreateSchema.safeParse({ ...course, endDate: '2026-07-01' })
      .success,
  ).toBe(false);
  expect(
    c.courseCreateSchema.safeParse({
      ...course,
      startDate: '2026-08-01T00:00:00Z',
    }).success,
  ).toBe(false);
});
test('actividad rechaza ventanas vacías y referencias repetidas', () => {
  const activity = {
    title: 'Actividad',
    instructions: 'Lee',
    type: 'FORMATIVE',
    opensAt: '2026-09-20T00:00:00Z',
    closesAt: '2026-09-20T00:00:00Z',
    exercises: [],
  };
  expect(c.activityInputSchema.safeParse(activity).success).toBe(false);
  const item = { exerciseVersionId: randomUUID(), position: 0, required: true };
  expect(
    c.activityInputSchema.safeParse({
      ...activity,
      closesAt: null,
      exercises: [item, item],
    }).success,
  ).toBe(false);
});
test('proyección de pruebas del estudiante no acepta ocultas', () => {
  const value = definition();
  const projection = {
    organizationId: randomUUID(),
    classId: randomUUID(),
    activityId: randomUUID(),
    activityExerciseId: randomUUID(),
    exerciseVersionId: randomUUID(),
    activityState: 'PUBLISHED',
    canEdit: true,
    opensAt: null,
    closesAt: null,
    serverNow: new Date().toISOString(),
    title: value.title,
    statement: value.statement,
    starterCode: value.starterCode,
    difficulty: value.difficulty,
    concepts: [],
    tests: value.tests,
    executionLimits: value.executionLimits,
  };
  expect(c.studentExerciseSchema.safeParse(projection).success).toBe(true);
  expect(
    c.studentExerciseSchema.safeParse({
      ...projection,
      tests: [{ ...value.tests[0], visibility: 'hidden' }],
    }).success,
  ).toBe(false);
  expect(
    c.studentExerciseSchema.safeParse({
      ...projection,
      referenceSolution: 'secret',
    }).success,
  ).toBe(false);
});
test('normalización taxonómica preserva equivalencia Unicode y espacios', () => {
  expect(c.normalizeConceptName('  FUNCIONES\u00a0  JavaScript ')).toBe(
    'funciones javascript',
  );
});
