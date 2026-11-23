// Fictitious, deterministic academic data. No passwords or reusable join secrets.
export const organizationA = '10000000-0000-4000-8000-000000000001';
export const organizationB = '10000000-0000-4000-8000-000000000002';
export const teacherA = '20000000-0000-4000-8000-000000000002';
export const teacherB = '20000000-0000-4000-8000-000000000005';
const uuid = (group, n) =>
  `${group}0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const additionalStudents = Array.from({ length: 6 }, (_, index) => {
  const institution = index < 3 ? 'a' : 'b';
  const position = (index % 3) + 2;
  return {
    id: uuid('2', index + 7),
    email: `student.${institution}${position}@alunza.test`,
    displayName: `Estudiante ${institution.toUpperCase()}${position}`,
    accountState: 'ACTIVE',
    organizationId: institution === 'a' ? organizationA : organizationB,
    role: 'STUDENT',
    membershipState: 'ACTIVE',
  };
});
export const courses = [organizationA, organizationB].map(
  (organizationId, index) => ({
    id: uuid('3', index + 1),
    organizationId,
    code: 'PROG1',
    name: 'Programación I',
    description: 'Introducción formativa a JavaScript',
    academicPeriod: '2026-2',
    startDate: '2026-07-01',
    endDate: '2026-12-31',
    teacherId: index ? teacherB : teacherA,
  }),
);
export const classes = [
  {
    id: uuid('4', 1),
    organizationId: organizationA,
    courseId: courses[0].id,
    teacherId: teacherA,
    code: 'PROG1-A1',
    name: 'Programación I · A1',
    studentIds: [
      '20000000-0000-4000-8000-000000000003',
      additionalStudents[0].id,
    ],
  },
  {
    id: uuid('4', 2),
    organizationId: organizationA,
    courseId: courses[0].id,
    teacherId: teacherA,
    code: 'PROG1-A2',
    name: 'Programación I · A2',
    studentIds: additionalStudents.slice(1, 3).map((u) => u.id),
  },
  {
    id: uuid('4', 3),
    organizationId: organizationB,
    courseId: courses[1].id,
    teacherId: teacherB,
    code: 'PROG1-B1',
    name: 'Programación I · B1',
    studentIds: [
      '20000000-0000-4000-8000-000000000006',
      ...additionalStudents.slice(3).map((u) => u.id),
    ],
  },
];
export const concepts = [organizationA, organizationB].flatMap(
  (organizationId, index) => [
    {
      id: uuid('5', index * 2 + 1),
      versionId: uuid('6', index * 2 + 1),
      organizationId,
      name: 'Funciones',
      description: 'Entradas, cálculo y retorno de funciones JavaScript.',
      parentId: null,
    },
    {
      id: uuid('5', index * 2 + 2),
      versionId: uuid('6', index * 2 + 2),
      organizationId,
      name: 'Condicionales',
      description: 'Selección de resultados con condiciones.',
      parentId: uuid('5', index * 2 + 1),
    },
  ],
);
const definitions = [
  {
    title: 'Sumar dos números',
    statement: 'Implementa solve(a, b) para retornar la suma de ambos números.',
    args: [2, 3],
    expected: 5,
    hiddenArgs: [-2, 4],
    hiddenExpected: 2,
    reference: 'function solve(a,b){ return a+b; }',
  },
  {
    title: 'Duplicar un número',
    statement: 'Implementa solve(n) para retornar el doble de n.',
    args: [3],
    expected: 6,
    hiddenArgs: [-4],
    hiddenExpected: -8,
    reference: 'function solve(n){ return n*2; }',
  },
  {
    title: 'Identificar un número par',
    statement:
      'Implementa solve(n) para retornar true si n es par; de lo contrario, false.',
    args: [4],
    expected: true,
    hiddenArgs: [3],
    hiddenExpected: false,
    reference: 'function solve(n){ return n%2===0; }',
  },
  {
    title: 'Elegir el mayor',
    statement:
      'Implementa solve(a, b) para retornar el mayor de los dos números.',
    args: [2, 5],
    expected: 5,
    hiddenArgs: [-2, -5],
    hiddenExpected: -2,
    reference: 'function solve(a,b){ return a>b?a:b; }',
  },
  {
    title: 'Contar elementos',
    statement:
      'Implementa solve(items) para retornar la cantidad de elementos del arreglo.',
    args: [[1, 2]],
    expected: 2,
    hiddenArgs: [[]],
    hiddenExpected: 0,
    reference: 'function solve(items){ return items.length; }',
  },
];
export const exercises = [organizationA, organizationB].flatMap(
  (organizationId, index) =>
    definitions.map((definition, position) => {
      const n = index * 5 + position + 1;
      return {
        id: uuid('7', n),
        versionId: uuid('8', n),
        organizationId,
        ownerId: index ? teacherB : teacherA,
        title: definition.title,
        statement: definition.statement,
        starterCode:
          'module.exports.solve = function solve(...args) {\n  // Escribe tu solución aquí.\n};\n',
        language: 'javascript',
        entrypoint: 'solve',
        difficulty: 'BEGINNER',
        conceptVersionIds: [
          concepts[index * 2 + (position === 2 || position === 3 ? 1 : 0)]
            .versionId,
        ],
        tests: [
          {
            id: 'visible-1',
            visibility: 'visible',
            args: definition.args,
            expected: definition.expected,
          },
          {
            id: 'hidden-1',
            visibility: 'hidden',
            args: definition.hiddenArgs,
            expected: definition.hiddenExpected,
          },
        ],
        executionLimits: {
          memoryBytes: 134217728,
          runtimeMs: 3000,
          outputBytes: 65536,
        },
        referenceSolution: `${definition.reference}\nmodule.exports.solve = solve;`,
        incorrectSolution:
          'module.exports.solve = function solve(){ return null; };',
      };
    }),
);
export const activities = classes.flatMap((classroom, index) => {
  const bank = exercises.filter(
    (exercise) => exercise.organizationId === classroom.organizationId,
  );
  return ['PUBLISHED', 'DRAFT', 'CLOSED'].map((state, position) => ({
    id: uuid('9', index * 3 + position + 1),
    organizationId: classroom.organizationId,
    classId: classroom.id,
    title: ['Primeros pasos', 'Próxima práctica', 'Práctica de consulta'][
      position
    ],
    state,
    type: 'FORMATIVE',
    instructions:
      'Lee cada enunciado y prepara tu solución. El código se conserva en este navegador.',
    exercises: bank.slice(0, 2).map((exercise, ordinal) => ({
      id: `a0000000-0000-4000-8000-${String((index * 3 + position) * 2 + ordinal + 1).padStart(12, '0')}`,
      exerciseId: exercise.id,
      exerciseVersionId: exercise.versionId,
      position: ordinal,
      required: true,
    })),
  }));
});
