import { z } from 'zod';
import * as c from '@alunza/contracts';

export function addAcademicOpenApi(specification, operation) {
  const schemas = {
    Course: c.courseResponseSchema,
    Courses: c.courseListResponseSchema,
    CourseCreate: c.courseCreateSchema,
    CourseUpdate: c.courseUpdateSchema,
    CourseTeachers: c.courseTeacherListResponseSchema,
    CourseTeacherGrant: c.courseTeacherGrantSchema,
    Class: c.classResponseSchema,
    Classes: c.classListResponseSchema,
    ClassCreate: c.classCreateSchema,
    ClassUpdate: c.classUpdateSchema,
    ClassStudents: c.classStudentListResponseSchema,
    TeacherAssignment: c.teacherAssignmentSchema,
    AcademicArchive: c.academicArchiveSchema,
    JoinCode: c.joinCodeResponseSchema,
    JoinCodes: c.joinCodeListResponseSchema,
    JoinCodeCreate: c.joinCodeCreateSchema,
    Enrollment: c.enrollmentResponseSchema,
    EnrollmentInput: c.enrollmentInputSchema,
    Concept: c.conceptResponseSchema,
    Concepts: c.conceptListResponseSchema,
    ConceptCreate: c.conceptCreateSchema,
    ConceptUpdate: c.conceptUpdateSchema,
    Exercise: c.exerciseResponseSchema,
    Exercises: c.exerciseListResponseSchema,
    ExerciseVersion: c.exerciseVersionResponseSchema,
    ExerciseVersions: c.exerciseVersionListResponseSchema,
    ExerciseVersionInput: c.exerciseVersionInputSchema,
    Activity: c.activityResponseSchema,
    Activities: c.activityListResponseSchema,
    ActivityInput: c.activityInputSchema,
    ActivityUpdate: c.activityUpdateSchema,
    StudentExercise: c.studentExerciseResponseSchema,
  };
  for (const [name, schema] of Object.entries(schemas)) {
    const generated = z.toJSONSchema(schema, {
      target: 'openapi-3.0',
      io: 'input',
    });
    // Recursive JSON definitions are emitted relative to a standalone schema.
    // Hoist them to OpenAPI components and rebase every reference to the document.
    const definitions = generated.definitions ?? {};
    const rebase = (value) => {
      if (Array.isArray(value)) return value.map(rebase);
      if (value && typeof value === 'object')
        return Object.fromEntries(
          Object.entries(value).map(([key, item]) => [
            key,
            key === '$ref' &&
            typeof item === 'string' &&
            item.startsWith('#/definitions/')
              ? `#/components/schemas/${name}_${item.slice('#/definitions/'.length)}`
              : rebase(item),
          ]),
        );
      return value;
    };
    delete generated.definitions;
    specification.components.schemas[name] = rebase(generated);
    for (const [key, definition] of Object.entries(definitions))
      specification.components.schemas[`${name}_${key}`] = rebase(definition);
  }
  const paths = specification.paths;
  const filter = (name, values) => ({
    name,
    in: 'query',
    schema: { type: 'string', enum: values },
  });
  const add = (path, method, name, output, options = {}) => {
    paths[`/api/v1${path}`] ??= {};
    const ids = [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
    paths[`/api/v1${path}`][method] = operation(name, output, {
      ids,
      ...options,
    });
  };
  for (const [plural, singular] of [
    ['courses', 'Course'],
    ['classes', 'Class'],
    ['concepts', 'Concept'],
    ['exercises', 'Exercise'],
  ]) {
    add(
      `/organizations/{orgId}/${plural}`,
      'get',
      `list${plural}`,
      `${plural[0].toUpperCase()}${plural.slice(1)}`,
      {
        list: true,
        filters: [
          filter('state', ['ACTIVE', 'ARCHIVED']),
          ...(plural === 'exercises'
            ? [
                filter('difficulty', ['BEGINNER', 'INTERMEDIATE', 'ADVANCED']),
                {
                  name: 'conceptId',
                  in: 'query',
                  schema: { type: 'string', format: 'uuid' },
                },
              ]
            : []),
        ],
      },
    );
    add(
      `/organizations/{orgId}/${plural}`,
      'post',
      `create${singular}`,
      singular,
      {
        input:
          singular === 'Exercise'
            ? 'ExerciseVersionInput'
            : `${singular}Create`,
        idempotent: true,
        status: 201,
      },
    );
    add(`/${plural}/{id}`, 'get', `get${singular}`, singular);
    if (singular !== 'Exercise') {
      add(`/${plural}/{id}`, 'patch', `update${singular}`, singular, {
        input: `${singular}Update`,
        versioned: true,
      });
    }
    add(`/${plural}/{id}/archive`, 'post', `archive${singular}`, singular, {
      input: 'AcademicArchive',
      idempotent: true,
      versioned: true,
    });
  }
  add('/courses/{id}/teachers', 'get', 'listCourseTeachers', 'CourseTeachers', {
    list: true,
  });
  add(
    '/courses/{id}/teachers/{teacherId}',
    'put',
    'setCourseTeacher',
    'Course',
    { input: 'CourseTeacherGrant', versioned: true },
  );
  add('/classes/{id}/teacher', 'put', 'assignClassTeacher', 'Class', {
    input: 'TeacherAssignment',
    versioned: true,
  });
  add('/classes/{id}/students', 'get', 'listClassStudents', 'ClassStudents', {
    list: true,
  });
  add('/classes/{id}/join-codes', 'get', 'listJoinCodes', 'JoinCodes', {
    list: true,
  });
  add('/classes/{id}/join-codes', 'post', 'createJoinCode', 'JoinCode', {
    input: 'JoinCodeCreate',
    idempotent: true,
    versioned: true,
    status: 201,
  });
  add(
    '/classes/{id}/join-codes/{codeId}/revoke',
    'post',
    'revokeJoinCode',
    'JoinCode',
    { idempotent: true, versioned: true },
  );
  add('/class-enrollments/preview', 'post', 'previewEnrollment', 'Enrollment', {
    input: 'EnrollmentInput',
  });
  add('/class-enrollments', 'post', 'confirmEnrollment', 'Enrollment', {
    input: 'EnrollmentInput',
    idempotent: true,
    status: 200,
  });
  add(
    '/exercises/{id}/versions',
    'get',
    'listExerciseVersions',
    'ExerciseVersions',
    { list: true },
  );
  add(
    '/exercises/{id}/versions',
    'post',
    'createExerciseVersion',
    'ExerciseVersion',
    {
      input: 'ExerciseVersionInput',
      idempotent: true,
      versioned: true,
      status: 201,
    },
  );
  add('/classes/{id}/activities', 'get', 'listActivities', 'Activities', {
    list: true,
    filters: [filter('state', ['DRAFT', 'PUBLISHED', 'CLOSED'])],
  });
  add('/classes/{id}/activities', 'post', 'createActivity', 'Activity', {
    input: 'ActivityInput',
    idempotent: true,
    status: 201,
  });
  add('/activities/{id}', 'get', 'getActivity', 'Activity');
  add('/activities/{id}', 'patch', 'updateActivity', 'Activity', {
    input: 'ActivityUpdate',
    versioned: true,
  });
  for (const transition of ['publish', 'close'])
    add(
      `/activities/{id}/${transition}`,
      'post',
      `${transition}Activity`,
      'Activity',
      { versioned: true, idempotent: true },
    );
  add(
    '/activities/{id}/exercises/{activityExerciseId}',
    'get',
    'getStudentExercise',
    'StudentExercise',
  );
}
