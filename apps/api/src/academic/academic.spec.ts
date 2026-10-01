import { describe, expect, it } from '@jest/globals';
import {
  activityInputSchema,
  classCreateSchema,
  courseCreateSchema,
  exerciseVersionInputSchema,
  studentExerciseSchema,
  academicArchiveSchema,
  courseUpdateSchema,
  classUpdateSchema,
  conceptUpdateSchema,
  activityUpdateSchema,
} from '@alunza/contracts';
import { activityAvailability, validateActivity } from './activities.service';
import { validateExercise } from './content.service';
import { normalizeConcept, validateDates } from './academic.shared';

const uuid = '00000000-0000-4000-8000-000000000001';
const versionInput = () =>
  exerciseVersionInputSchema.parse({
    title: 'Sumar',
    statement: 'Devuelve la suma.',
    starterCode: 'function solve(a, b) { return a + b; }',
    difficulty: 'BASIC',
    conceptVersionIds: [uuid],
    tests: [
      { visibility: 'VISIBLE', args: [2, 3], expected: 5 },
      { visibility: 'HIDDEN', args: [7, 8], expected: 15 },
    ],
  });

describe('academic input boundaries', () => {
  it('keeps PATCH fields absent instead of applying creation defaults', () => {
    for (const schema of [
      courseUpdateSchema,
      classUpdateSchema,
      conceptUpdateSchema,
    ]) {
      expect(schema.parse({ name: 'Nuevo' })).toEqual({ name: 'Nuevo' });
      expect(schema.safeParse({}).success).toBe(false);
    }
    expect(activityUpdateSchema.parse({ title: 'Nueva' })).toEqual({
      title: 'Nueva',
    });
    expect(activityUpdateSchema.safeParse({}).success).toBe(false);
  });
  it('rejects forged organization, state and publication fields', () => {
    const course = {
      code: 'PRG1',
      name: 'Programación',
      academicPeriod: '2026-2',
    };
    expect(
      courseCreateSchema.safeParse({ ...course, organizationId: uuid }).success,
    ).toBe(false);
    expect(
      classCreateSchema.safeParse({
        code: 'A',
        name: 'Clase',
        courseId: uuid,
        state: 'ACTIVE',
      }).success,
    ).toBe(false);
    expect(
      activityInputSchema.safeParse({
        title: 'Actividad',
        type: 'FORMATIVE',
        publishedAt: new Date().toISOString(),
      }).success,
    ).toBe(false);
    expect(academicArchiveSchema.safeParse({ ownerId: uuid }).success).toBe(
      false,
    );
  });
  it('normalizes human catalog codes and validates calendar dates', () => {
    expect(
      courseCreateSchema.parse({
        code: ' prg-1 ',
        name: 'Programación',
        academicPeriod: '2026-2',
      }).code,
    ).toBe('PRG-1');
    expect(
      courseCreateSchema.safeParse({
        code: 'A',
        name: 'B',
        academicPeriod: '2026-2',
        startDate: '2026-02-30',
      }).success,
    ).toBe(false);
    expect(() => validateDates('2026-09-20', '2026-09-19')).toThrow();
    expect(() =>
      validateDates('2026-08-01', '2026-12-01', {
        start: '2026-09-01',
        end: '2026-12-31',
      }),
    ).toThrow();
    expect(() => validateDates(null, null)).not.toThrow();
  });
  it('normalizes compatibility characters and repeated spaces without removing accents', () => {
    expect(normalizeConcept('  Ｆunciones   Puras  ')).toBe('funciones puras');
    expect(normalizeConcept('  Iteración  ')).toBe('iteración');
  });
});

describe('immutable activity preparation and availability', () => {
  const published = {
    state: 'PUBLISHED',
    opens_at: '2026-09-28T10:00:00Z',
    closes_at: '2026-09-28T11:00:00Z',
  };
  it('accepts drafts with no exercises but blocks publishing an empty or optional-only activity', () => {
    const input = activityInputSchema.parse({
      title: 'Diagnóstico',
      type: 'DIAGNOSTIC',
    });
    expect(() => validateActivity(input)).not.toThrow();
    expect(() => validateActivity(input, true)).toThrow();
    expect(() =>
      validateActivity(
        {
          ...input,
          exercises: [
            { exerciseVersionId: uuid, position: 0, required: false },
          ],
        },
        true,
      ),
    ).toThrow();
  });
  it('rejects repeated versions, positions and inverted or empty time windows', () => {
    const input = activityInputSchema.parse({
      title: 'Diagnóstico',
      type: 'DIAGNOSTIC',
      exercises: [{ exerciseVersionId: uuid, position: 0 }],
    });
    expect(() =>
      validateActivity({
        ...input,
        exercises: [...input.exercises, ...input.exercises],
      }),
    ).toThrow();
    expect(() =>
      validateActivity({
        ...input,
        opensAt: '2026-09-28T11:00:00Z',
        closesAt: '2026-09-28T11:00:00Z',
      }),
    ).toThrow();
  });
  it('uses an inclusive opening and exclusive closing boundary', () => {
    expect(
      activityAvailability(published, Date.parse('2026-09-28T09:59:59.999Z')),
    ).toBe('NOT_OPEN');
    expect(
      activityAvailability(published, Date.parse('2026-09-28T10:00:00Z')),
    ).toBe('AVAILABLE');
    expect(
      activityAvailability(published, Date.parse('2026-09-28T10:59:59.999Z')),
    ).toBe('AVAILABLE');
    expect(
      activityAvailability(published, Date.parse('2026-09-28T11:00:00Z')),
    ).toBe('EXPIRED');
  });
  it('denies drafts, closed activities and archived classes regardless of dates', () => {
    expect(activityAvailability({ state: 'DRAFT' })).toBe('DRAFT');
    expect(activityAvailability({ state: 'CLOSED' })).toBe('CLOSED');
    expect(
      activityAvailability({
        state: 'PUBLISHED',
        class_archived_at: new Date(),
      }),
    ).toBe('CLASS_ARCHIVED');
    expect(activityAvailability({ state: 'PUBLISHED' })).toBe('AVAILABLE');
  });
});

describe('exercise contracts protect deterministic execution and private tests', () => {
  it('rejects a ninth test and limits greater than the runner ceilings', () => {
    const input = versionInput();
    expect(
      exerciseVersionInputSchema.safeParse({
        ...input,
        tests: Array(9).fill(input.tests[0]),
      }).success,
    ).toBe(false);
    expect(
      exerciseVersionInputSchema.safeParse({
        ...input,
        executionLimits: { ...input.executionLimits, timeoutMs: 3001 },
      }).success,
    ).toBe(false);
    expect(
      exerciseVersionInputSchema.safeParse({
        ...input,
        executionLimits: { ...input.executionLimits, memoryBytes: 134217729 },
      }).success,
    ).toBe(false);
    expect(
      exerciseVersionInputSchema.safeParse({
        ...input,
        executionLimits: { ...input.executionLimits, outputBytes: 65537 },
      }).success,
    ).toBe(false);
  });
  it('requires visible evidence and rejects unsupported comparators', () => {
    const input = versionInput();
    expect(
      exerciseVersionInputSchema.safeParse({
        ...input,
        tests: [input.tests[1]],
      }).success,
    ).toBe(false);
    expect(
      exerciseVersionInputSchema.safeParse({
        ...input,
        tests: [{ ...input.tests[0], comparator: 'EVAL' }],
      }).success,
    ).toBe(false);
  });
  it('rejects contradictory deep JSON expectations without executing template code', () => {
    const input = versionInput();
    input.tests = [
      {
        visibility: 'VISIBLE',
        args: [{ a: 1, b: 2 }],
        expected: 3,
        comparator: 'EXACT_DEEP',
      },
      {
        visibility: 'HIDDEN',
        args: [{ b: 2, a: 1 }],
        expected: 4,
        comparator: 'EXACT_DEEP',
      },
    ];
    expect(() => validateExercise(input)).toThrow('Las mismas entradas');
    input.tests[1]!.expected = 3;
    expect(() => validateExercise(input)).not.toThrow();
  });
  it('enforces UTF-8 bytes rather than character counts for source and test data', () => {
    const input = versionInput();
    expect(() =>
      validateExercise({ ...input, starterCode: 'ñ'.repeat(32768) }),
    ).not.toThrow();
    expect(() =>
      validateExercise({ ...input, starterCode: 'ñ'.repeat(32769) }),
    ).toThrow();
    expect(() =>
      validateExercise({
        ...input,
        tests: [{ ...input.tests[0]!, expected: 'ñ'.repeat(32768) }],
      }),
    ).toThrow();
  });
  it('student projection rejects hidden tests and internal fields', () => {
    const input = versionInput();
    const output = {
      activityId: uuid,
      activityExerciseId: uuid,
      organizationId: uuid,
      classId: uuid,
      exerciseVersionId: uuid,
      title: input.title,
      statement: input.statement,
      starterCode: input.starterCode,
      language: input.language,
      difficulty: input.difficulty,
      entrypoint: input.entrypoint,
      executionLimits: input.executionLimits,
      concepts: [],
      tests: [{ id: uuid, ...input.tests[0] }],
    };
    expect(studentExerciseSchema.safeParse(output).success).toBe(true);
    expect(
      studentExerciseSchema.safeParse({
        ...output,
        tests: [{ id: uuid, ...input.tests[1] }],
      }).success,
    ).toBe(false);
    expect(
      studentExerciseSchema.safeParse({ ...output, hiddenTests: input.tests })
        .success,
    ).toBe(false);
  });
});
