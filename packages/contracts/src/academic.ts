import { z } from 'zod';

// PostgreSQL UTF-8 text and JSON equality cannot represent NUL or lone UTF-16
// surrogates. Reject them at the field boundary instead of failing persistence.
function persistableText(value: string): boolean {
  for (const character of value) {
    const point = character.codePointAt(0)!;
    if (point === 0 || (point >= 0xd800 && point <= 0xdfff)) return false;
  }
  return true;
}
const text = z
  .string()
  .refine(
    persistableText,
    'El texto contiene caracteres Unicode no admitidos.',
  );
function persistableJson(value: z.infer<ReturnType<typeof z.json>>): boolean {
  if (typeof value === 'string') return persistableText(value);
  if (Array.isArray(value)) return value.every(persistableJson);
  if (value !== null && typeof value === 'object')
    return Object.entries(value).every(
      ([key, item]) => persistableText(key) && persistableJson(item),
    );
  return true;
}

const id = z.uuid();
const timestamp = z.iso.datetime({ offset: true });
const date = z.iso.date();
const name = text.trim().min(1).max(160);
const description = text.trim().max(4000);
const code = text.trim().toUpperCase().min(1).max(40);
const revision = z.number().int().positive();
const state = z.enum(['ACTIVE', 'ARCHIVED']);
const page = z.strictObject({
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});
const envelope = <T extends z.ZodType>(schema: T) =>
  z.strictObject({ data: schema, requestId: id });
const list = <T extends z.ZodType>(schema: T) =>
  z.strictObject({ data: z.array(schema), page, requestId: id });
const dates = { startDate: date.nullable(), endDate: date.nullable() };
const dateOrder = (value: {
  startDate?: string | null;
  endDate?: string | null;
}) => !value.startDate || !value.endDate || value.startDate <= value.endDate;
const nonempty = (value: object) => Object.keys(value).length > 0;

export const courseSchema = z.strictObject({
  id,
  organizationId: id,
  code,
  name,
  description,
  academicPeriod: text.min(1).max(80),
  ...dates,
  revision,
  state,
});
const courseFields = {
  code,
  name,
  description: description.default(''),
  academicPeriod: text.trim().min(1).max(80),
  startDate: date.nullable().default(null),
  endDate: date.nullable().default(null),
};
export const courseCreateSchema = z
  .strictObject(courseFields)
  .refine(dateOrder, {
    message: 'La fecha final no puede preceder al inicio.',
    path: ['endDate'],
  });
export const courseUpdateSchema = z
  .strictObject(courseFields)
  .partial()
  .refine(nonempty, 'Indica al menos un cambio.')
  .refine(dateOrder, { message: 'Fechas incoherentes.', path: ['endDate'] });
export const courseTeacherGrantSchema = z.strictObject({
  enabled: z.boolean(),
});
export const courseTeacherSchema = z.strictObject({
  courseId: id,
  teacherId: id,
  teacherName: name,
  enabled: z.boolean(),
});
export const teacherAssignmentSchema = z.strictObject({ teacherId: id });
export const courseResponseSchema = envelope(courseSchema);
export const courseListResponseSchema = list(courseSchema);
export const courseTeacherListResponseSchema = list(courseTeacherSchema);

export const classSchema = z.strictObject({
  id,
  organizationId: id,
  courseId: id,
  code,
  name,
  description,
  ...dates,
  teacherId: id,
  teacherName: name,
  revision,
  state,
});
const classFields = {
  code,
  name,
  description: description.default(''),
  startDate: date.nullable().default(null),
  endDate: date.nullable().default(null),
};
export const classCreateSchema = z
  .strictObject({ ...classFields, courseId: id, teacherId: id.optional() })
  .refine(dateOrder, { message: 'Fechas incoherentes.', path: ['endDate'] });
export const classUpdateSchema = z
  .strictObject(classFields)
  .partial()
  .refine(nonempty, 'Indica al menos un cambio.')
  .refine(dateOrder, { message: 'Fechas incoherentes.', path: ['endDate'] });
export const classResponseSchema = envelope(classSchema);
export const classListResponseSchema = list(classSchema);
export const classStudentSchema = z.strictObject({
  userId: id,
  displayName: name,
  enrolledAt: timestamp,
});
export const classStudentListResponseSchema = list(classStudentSchema);
export const academicArchiveSchema = z.strictObject({
  reason: text.trim().min(1).max(500),
});
export const joinCodeCreateSchema = z.strictObject({
  expiresAt: timestamp.optional(),
});
export const joinCodeSchema = z.strictObject({
  id,
  classId: id,
  expiresAt: timestamp,
  revokedAt: timestamp.nullable(),
  revision,
  code: z.string().min(16).max(128).optional(),
});
export const joinCodeResponseSchema = envelope(joinCodeSchema);
export const joinCodeListResponseSchema = list(
  joinCodeSchema.omit({ code: true }),
);
export const enrollmentInputSchema = z.strictObject({
  code: z.string().trim().min(1).max(128),
});
export const enrollmentSchema = z.strictObject({
  organizationId: id,
  classId: id,
  className: name,
  alreadyEnrolled: z.boolean(),
});
export const enrollmentResponseSchema = envelope(enrollmentSchema);

export const conceptSchema = z.strictObject({
  id,
  organizationId: id,
  currentVersionId: id,
  name,
  description,
  parentId: id.nullable(),
  revision,
  state,
  references: z.number().int().nonnegative(),
});
export const conceptCreateSchema = z.strictObject({
  name,
  description: description.default(''),
  parentId: id.nullable().default(null),
});
export const conceptUpdateSchema = conceptCreateSchema
  .partial()
  .refine(nonempty, 'Indica al menos un cambio.');
export const conceptResponseSchema = envelope(conceptSchema);
export const conceptListResponseSchema = list(conceptSchema);
export function normalizeConceptName(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLocaleLowerCase('es');
}

export const academicExecutionLimits = Object.freeze({
  memoryBytes: 134217728,
  runtimeMs: 3000,
  outputBytes: 65536,
});
export const executionLimitsSchema = z.strictObject({
  memoryBytes: z.literal(134217728),
  runtimeMs: z.literal(3000),
  outputBytes: z.literal(65536),
});
export const difficultySchema = z.enum([
  'BEGINNER',
  'INTERMEDIATE',
  'ADVANCED',
]);
export const byteLength = (value: string) =>
  new TextEncoder().encode(value).byteLength;
const sourceCode = text
  .max(65536)
  .refine((value) => byteLength(value) <= 65536, 'El código supera 64 KiB.');
const jsonValue = z
  .json()
  .refine(persistableJson, 'El JSON contiene caracteres Unicode no admitidos.')
  .refine(
    (value) => byteLength(JSON.stringify(value)) <= 65536,
    'El valor JSON supera 64 KiB.',
  );
export const exerciseTestSchema = z.strictObject({
  id: text.trim().min(1).max(100),
  visibility: z.enum(['visible', 'hidden']),
  args: z
    .array(z.json())
    .refine(
      persistableJson,
      'Los argumentos contienen caracteres Unicode no admitidos.',
    )
    .refine(
      (value) => byteLength(JSON.stringify(value)) <= 65536,
      'Los argumentos superan 64 KiB.',
    ),
  expected: jsonValue,
});
function canonicalJson(value: z.infer<ReturnType<typeof z.json>>): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key]!)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
const exerciseFields = {
  title: name,
  statement: text.trim().min(1).max(16000),
  starterCode: sourceCode,
  language: z.literal('javascript'),
  entrypoint: z.literal('solve'),
  difficulty: difficultySchema,
  conceptVersionIds: z.array(id).min(1).max(30),
  tests: z.array(exerciseTestSchema).min(1).max(8),
  executionLimits: executionLimitsSchema,
};
export const exerciseVersionInputSchema = z
  .strictObject(exerciseFields)
  .superRefine((value, ctx) => {
    if (
      new Set(value.conceptVersionIds).size !== value.conceptVersionIds.length
    )
      ctx.addIssue({
        code: 'custom',
        path: ['conceptVersionIds'],
        message: 'No repitas conceptos.',
      });
    if (!value.tests.some((test) => test.visibility === 'visible'))
      ctx.addIssue({
        code: 'custom',
        path: ['tests'],
        message: 'Incluye al menos una prueba visible.',
      });
    const ids = new Set<string>();
    const expectations = new Map<string, string>();
    value.tests.forEach((test, index) => {
      if (ids.has(test.id))
        ctx.addIssue({
          code: 'custom',
          path: ['tests', index, 'id'],
          message: 'Identificador de prueba duplicado.',
        });
      ids.add(test.id);
      const key = canonicalJson(test.args),
        expected = canonicalJson(test.expected);
      if (expectations.has(key) && expectations.get(key) !== expected)
        ctx.addIssue({
          code: 'custom',
          path: ['tests', index],
          message: 'Las mismas entradas tienen resultados contradictorios.',
        });
      expectations.set(key, expected);
    });
  });
export const exerciseSchema = z.strictObject({
  id,
  organizationId: id,
  ownerId: id,
  visibility: z.enum(['PRIVATE', 'ORGANIZATION']),
  state,
  revision,
  currentVersionId: id,
  title: name,
  difficulty: difficultySchema,
});
export const exerciseVersionSchema = z.strictObject({
  ...exerciseFields,
  id,
  exerciseId: id,
  version: revision,
  createdAt: timestamp,
});
export const exerciseResponseSchema = envelope(exerciseSchema);
export const exerciseListResponseSchema = list(exerciseSchema);
export const exerciseVersionResponseSchema = envelope(exerciseVersionSchema);
export const exerciseVersionListResponseSchema = list(exerciseVersionSchema);

export const activityStateSchema = z.enum(['DRAFT', 'PUBLISHED', 'CLOSED']);
const activityExerciseInputSchema = z.strictObject({
  exerciseVersionId: id,
  position: z.number().int().nonnegative().max(99),
  required: z.boolean(),
});
const activityFields = {
  title: name,
  instructions: description,
  type: z.enum(['DIAGNOSTIC', 'FORMATIVE']),
  opensAt: timestamp.nullable(),
  closesAt: timestamp.nullable(),
  exercises: z.array(activityExerciseInputSchema).max(100),
};
function activityRules(
  value: {
    opensAt?: string | null;
    closesAt?: string | null;
    exercises?: z.infer<typeof activityExerciseInputSchema>[];
  },
  ctx: z.RefinementCtx,
) {
  if (
    value.opensAt &&
    value.closesAt &&
    Date.parse(value.opensAt) >= Date.parse(value.closesAt)
  )
    ctx.addIssue({
      code: 'custom',
      path: ['closesAt'],
      message: 'El término debe ser posterior a la apertura.',
    });
  if (value.exercises) {
    if (
      new Set(value.exercises.map((item) => item.position)).size !==
      value.exercises.length
    )
      ctx.addIssue({
        code: 'custom',
        path: ['exercises'],
        message: 'Hay posiciones repetidas.',
      });
    if (
      new Set(value.exercises.map((item) => item.exerciseVersionId)).size !==
      value.exercises.length
    )
      ctx.addIssue({
        code: 'custom',
        path: ['exercises'],
        message: 'Hay versiones repetidas.',
      });
  }
}
export const activityInputSchema = z
  .strictObject(activityFields)
  .superRefine(activityRules);
export const activityUpdateSchema = z
  .strictObject(activityFields)
  .partial()
  .refine(nonempty, 'Indica al menos un cambio.')
  .superRefine(activityRules);
export const activitySchema = z.strictObject({
  id,
  organizationId: id,
  classId: id,
  ...activityFields,
  state: activityStateSchema,
  revision,
  publishedAt: timestamp.nullable(),
  closedAt: timestamp.nullable(),
  exercises: z.array(
    activityExerciseInputSchema.extend({ id, exerciseId: id, title: name }),
  ),
});
export const activityResponseSchema = envelope(activitySchema);
export const activityListResponseSchema = list(activitySchema);
export const studentExerciseSchema = z.strictObject({
  organizationId: id,
  classId: id,
  activityId: id,
  activityExerciseId: id,
  exerciseVersionId: id,
  activityState: activityStateSchema,
  canEdit: z.boolean(),
  opensAt: timestamp.nullable(),
  closesAt: timestamp.nullable(),
  serverNow: timestamp,
  title: name,
  statement: exerciseFields.statement,
  starterCode: sourceCode,
  difficulty: difficultySchema,
  concepts: z.array(z.strictObject({ id, versionId: id, name, description })),
  tests: z.array(
    exerciseTestSchema.extend({ visibility: z.literal('visible') }),
  ),
  executionLimits: executionLimitsSchema,
});
export const studentExerciseResponseSchema = envelope(studentExerciseSchema);

export type Course = z.infer<typeof courseSchema>;
export type CourseTeacher = z.infer<typeof courseTeacherSchema>;
export type AcademicClass = z.infer<typeof classSchema>;
export type JoinCode = z.infer<typeof joinCodeSchema>;
export type Enrollment = z.infer<typeof enrollmentSchema>;
export type Concept = z.infer<typeof conceptSchema>;
export type Exercise = z.infer<typeof exerciseSchema>;
export type ExerciseVersion = z.infer<typeof exerciseVersionSchema>;
export type ExerciseVersionInput = z.infer<typeof exerciseVersionInputSchema>;
export type Activity = z.infer<typeof activitySchema>;
export type ActivityInput = z.infer<typeof activityInputSchema>;
export type StudentExercise = z.infer<typeof studentExerciseSchema>;
