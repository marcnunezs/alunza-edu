import { z } from 'zod';

const name = z.string().trim().min(1).max(160);
const description = z.string().trim().max(10000);
const code = z
  .string()
  .trim()
  .toUpperCase()
  .min(1)
  .max(40)
  .regex(/^[A-Z0-9_-]+$/);
const date = z.iso.date().nullable();
const instant = z.iso.datetime({ offset: true });
const revision = z.number().int().positive();
const page = z.strictObject({
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});
export const academicPageQuerySchema = z.strictObject({
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(160).optional(),
  state: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
});
export const academicArchiveSchema = z.strictObject({});
const academicFields = {
  code,
  name,
  description: description.default(''),
  startDate: date.default(null),
  endDate: date.default(null),
};
export const courseCreateSchema = z.strictObject({
  ...academicFields,
  academicPeriod: z.string().trim().min(1).max(80),
});
const academicUpdateFields = {
  code: code.optional(),
  name: name.optional(),
  description: description.optional(),
  startDate: date.optional(),
  endDate: date.optional(),
};
export const courseUpdateSchema = z
  .strictObject({
    ...academicUpdateFields,
    academicPeriod: z.string().trim().min(1).max(80).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Indica al menos un cambio.');
export const classCreateSchema = z.strictObject({
  ...academicFields,
  courseId: z.uuid(),
  teacherId: z.uuid().optional(),
});
export const classUpdateSchema = z
  .strictObject(academicUpdateFields)
  .refine((v) => Object.keys(v).length > 0, 'Indica al menos un cambio.');
export const classTeacherSchema = z.strictObject({ teacherId: z.uuid() });
const entityFields = {
  id: z.uuid(),
  organizationId: z.uuid(),
  revision,
  state: z.enum(['ACTIVE', 'ARCHIVED']),
  archivedAt: instant.nullable(),
};
export const courseSchema = z.strictObject({
  ...entityFields,
  ...academicFields,
  academicPeriod: z.string(),
});
export const academicClassSchema = z.strictObject({
  ...entityFields,
  ...academicFields,
  courseId: z.uuid(),
  teacherId: z.uuid(),
});
export const joinCodeCreateSchema = z.strictObject({
  expiresAt: instant.optional(),
});
export const joinCodeSchema = z.strictObject({
  id: z.uuid(),
  classId: z.uuid(),
  expiresAt: instant,
  revokedAt: instant.nullable(),
  usesCount: z.number().int().nonnegative(),
  revision,
});
export const issuedJoinCodeSchema = joinCodeSchema.extend({ code: z.string() });
export const classEnrollmentInputSchema = z.strictObject({
  organizationId: z.uuid(),
  code: z.string().trim().toUpperCase().min(8).max(80),
});
export const classJoinPreviewSchema = z.strictObject({
  classId: z.uuid(),
  className: z.string(),
  courseName: z.string(),
  expiresAt: instant,
  alreadyEnrolled: z.boolean(),
});
export const classEnrollmentSchema = z.strictObject({
  id: z.uuid(),
  organizationId: z.uuid(),
  classId: z.uuid(),
  userId: z.uuid(),
  joinedAt: instant,
  alreadyEnrolled: z.boolean(),
});

export const conceptInputSchema = z.strictObject({
  name,
  description: description.default(''),
  parentId: z.uuid().nullable().default(null),
});
export const conceptUpdateSchema = z
  .strictObject({
    name: name.optional(),
    description: description.optional(),
    parentId: z.uuid().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Indica al menos un cambio.');
export const conceptVersionSchema = z.strictObject({
  id: z.uuid(),
  conceptId: z.uuid(),
  version: z.number().int().positive(),
  name: z.string(),
  description: z.string(),
  parentId: z.uuid().nullable(),
  createdAt: instant,
});
export const conceptSchema = z.strictObject({
  ...entityFields,
  currentVersionId: z.uuid(),
  name: z.string(),
  description: z.string(),
  parentId: z.uuid().nullable(),
  version: z.number().int().positive(),
  usesCount: z.number().int().nonnegative(),
});
export const exerciseDifficultySchema = z.enum([
  'BASIC',
  'INTERMEDIATE',
  'ADVANCED',
]);
export const exerciseTestInputSchema = z.strictObject({
  visibility: z.enum(['VISIBLE', 'HIDDEN']),
  args: z.array(z.json()).max(20),
  expected: z.json(),
  comparator: z.literal('EXACT_DEEP').default('EXACT_DEEP'),
});
export const exerciseTestSchema = exerciseTestInputSchema.extend({
  id: z.uuid(),
});
export const executionLimitsSchema = z.strictObject({
  memoryBytes: z.number().int().min(1).max(134217728).default(134217728),
  timeoutMs: z.number().int().min(1).max(3000).default(3000),
  outputBytes: z.number().int().min(1).max(65536).default(65536),
});
export const exerciseVersionInputSchema = z.strictObject({
  title: name,
  statement: z.string().trim().min(1).max(10000),
  starterCode: z
    .string()
    .max(65536)
    .refine(
      (value) => new TextEncoder().encode(value).byteLength <= 65536,
      'La plantilla supera 64 KiB UTF-8.',
    ),
  language: z.literal('javascript').default('javascript'),
  difficulty: exerciseDifficultySchema,
  entrypoint: z.literal('solve').default('solve'),
  conceptVersionIds: z
    .array(z.uuid())
    .min(1)
    .max(30)
    .refine((v) => new Set(v).size === v.length, 'No repitas conceptos.'),
  tests: z
    .array(exerciseTestInputSchema)
    .min(1)
    .max(8)
    .refine(
      (v) => v.some((t) => t.visibility === 'VISIBLE'),
      'Incluye al menos una prueba visible.',
    )
    .refine(
      (value) =>
        new TextEncoder().encode(JSON.stringify(value)).byteLength <= 65536,
      'Las pruebas superan 64 KiB UTF-8.',
    ),
  executionLimits: executionLimitsSchema.default({
    memoryBytes: 134217728,
    timeoutMs: 3000,
    outputBytes: 65536,
  }),
});
export const exerciseCreateSchema = exerciseVersionInputSchema.extend({
  visibility: z.enum(['PRIVATE', 'ORGANIZATION']).default('PRIVATE'),
});
export const exerciseSummarySchema = z.strictObject({
  ...entityFields,
  ownerId: z.uuid(),
  visibility: z.enum(['PRIVATE', 'ORGANIZATION']),
  currentVersionId: z.uuid(),
  title: z.string(),
  difficulty: exerciseDifficultySchema,
  version: z.number().int().positive(),
});
export const exerciseVersionSchema = z.strictObject({
  id: z.uuid(),
  exerciseId: z.uuid(),
  version: z.number().int().positive(),
  title: z.string(),
  statement: z.string(),
  starterCode: z.string(),
  language: z.literal('javascript'),
  difficulty: exerciseDifficultySchema,
  entrypoint: z.literal('solve'),
  conceptVersionIds: z.array(z.uuid()),
  concepts: z.array(
    z.strictObject({
      id: z.uuid(),
      versionId: z.uuid(),
      name: z.string(),
      version: z.number().int().positive(),
    }),
  ),
  tests: z.array(exerciseTestSchema),
  executionLimits: executionLimitsSchema,
  createdAt: instant,
});
export const exerciseDetailSchema = exerciseSummarySchema.extend({
  currentVersion: exerciseVersionSchema,
});

export const activityExerciseInputSchema = z.strictObject({
  exerciseVersionId: z.uuid(),
  position: z.number().int().min(0).max(99),
  required: z.boolean().default(true),
});
export const activityInputSchema = z.strictObject({
  title: name,
  type: z.enum(['DIAGNOSTIC', 'FORMATIVE']),
  instructions: description.default(''),
  opensAt: instant.nullable().default(null),
  closesAt: instant.nullable().default(null),
  exercises: z.array(activityExerciseInputSchema).max(100).default([]),
});
export const activityUpdateSchema = z
  .strictObject({
    title: name.optional(),
    type: z.enum(['DIAGNOSTIC', 'FORMATIVE']).optional(),
    instructions: description.optional(),
    opensAt: instant.nullable().optional(),
    closesAt: instant.nullable().optional(),
    exercises: z.array(activityExerciseInputSchema).max(100).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Indica al menos un cambio.');
export const activityExerciseSchema = activityExerciseInputSchema.extend({
  id: z.uuid(),
  title: z.string(),
  difficulty: exerciseDifficultySchema,
});
export const activitySchema = z.strictObject({
  id: z.uuid(),
  organizationId: z.uuid(),
  classId: z.uuid(),
  revision,
  title: z.string(),
  type: z.enum(['DIAGNOSTIC', 'FORMATIVE']),
  instructions: z.string(),
  state: z.enum(['DRAFT', 'PUBLISHED', 'CLOSED']),
  opensAt: instant.nullable(),
  closesAt: instant.nullable(),
  publishedAt: instant.nullable(),
  closedAt: instant.nullable(),
  availability: z.enum([
    'DRAFT',
    'AVAILABLE',
    'NOT_OPEN',
    'EXPIRED',
    'CLOSED',
    'CLASS_ARCHIVED',
  ]),
  exercises: z.array(activityExerciseSchema),
});
export const studentExerciseSchema = z.strictObject({
  activityId: z.uuid(),
  activityExerciseId: z.uuid(),
  organizationId: z.uuid(),
  classId: z.uuid(),
  exerciseVersionId: z.uuid(),
  title: z.string(),
  statement: z.string(),
  starterCode: z.string(),
  language: z.literal('javascript'),
  difficulty: exerciseDifficultySchema,
  entrypoint: z.literal('solve'),
  concepts: z.array(
    z.strictObject({ id: z.uuid(), versionId: z.uuid(), name: z.string() }),
  ),
  tests: z.array(
    exerciseTestSchema.extend({ visibility: z.literal('VISIBLE') }),
  ),
  executionLimits: executionLimitsSchema,
});

const response = <T extends z.ZodType>(schema: T) =>
  z.strictObject({ data: schema, requestId: z.uuid() });
const listResponse = <T extends z.ZodType>(schema: T) =>
  z.strictObject({ data: z.array(schema), page, requestId: z.uuid() });
export const courseResponseSchema = response(courseSchema);
export const courseListResponseSchema = listResponse(courseSchema);
export const academicClassResponseSchema = response(academicClassSchema);
export const academicClassListResponseSchema =
  listResponse(academicClassSchema);
export const joinCodeResponseSchema = response(joinCodeSchema);
export const issuedJoinCodeResponseSchema = response(issuedJoinCodeSchema);
export const joinCodeListResponseSchema = listResponse(joinCodeSchema);
export const classJoinPreviewResponseSchema = response(classJoinPreviewSchema);
export const classEnrollmentResponseSchema = response(classEnrollmentSchema);
export const conceptResponseSchema = response(conceptSchema);
export const conceptListResponseSchema = listResponse(conceptSchema);
export const conceptVersionListResponseSchema =
  listResponse(conceptVersionSchema);
export const exerciseResponseSchema = response(exerciseDetailSchema);
export const exerciseListResponseSchema = listResponse(exerciseSummarySchema);
export const exerciseVersionListResponseSchema = listResponse(
  exerciseVersionSchema,
);
export const exerciseArchiveResponseSchema = response(exerciseSummarySchema);
export const activityResponseSchema = response(activitySchema);
export const activityListResponseSchema = listResponse(activitySchema);
export const studentExerciseResponseSchema = response(studentExerciseSchema);
export type Course = z.infer<typeof courseSchema>;
export type AcademicClass = z.infer<typeof academicClassSchema>;
export type JoinCode = z.infer<typeof joinCodeSchema>;
export type Concept = z.infer<typeof conceptSchema>;
export type Exercise = z.infer<typeof exerciseDetailSchema>;
export type ExerciseSummary = z.infer<typeof exerciseSummarySchema>;
export type ExerciseVersion = z.infer<typeof exerciseVersionSchema>;
export type Activity = z.infer<typeof activitySchema>;
export type StudentExercise = z.infer<typeof studentExerciseSchema>;
