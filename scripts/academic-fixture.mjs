import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import {
  developmentTarget,
  testTarget,
  assertRuntimeTarget,
} from './local-target.mjs';
import {
  additionalStudents,
  courses,
  classes,
  concepts,
  exercises,
  activities,
} from '../fixtures/demo/academic.mjs';

export async function seedAcademic(state) {
  const expected = [developmentTarget, testTarget].find(
    (target) => target.projectId === state.projectId,
  );
  assertRuntimeTarget(state, expected);
  const database = new pg.Client({ connectionString: state.migrationUrl });
  await database.connect();
  try {
    if (
      !(await database.query("SELECT to_regclass('app.courses') present"))
        .rows[0].present
    )
      return false;
    const auth = createClient(state.authUrl, state.authAdminKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    for (const student of additionalStudents) {
      const found = await auth.auth.admin.getUserById(student.id);
      if (found.data?.user) {
        if (found.data.user.email !== student.email)
          throw new Error('Identidad de fixture académico incompatible.');
        const updated = await auth.auth.admin.updateUserById(student.id, {
          password: state.fixturePassword,
          email_confirm: true,
        });
        if (updated.error)
          throw new Error('No se pudo sincronizar identidad académica local.');
      } else {
        if (
          found.error &&
          found.error.status !== 404 &&
          found.error.code !== 'user_not_found'
        )
          throw new Error('No se pudo consultar identidad académica local.');
        const created = await auth.auth.admin.createUser({
          id: student.id,
          email: student.email,
          password: state.fixturePassword,
          email_confirm: true,
        });
        if (created.error || created.data.user?.id !== student.id)
          throw new Error('No se pudo preparar identidad académica local.');
      }
    }
    await database.query('BEGIN');
    for (const student of additionalStudents) {
      await database.query(
        "INSERT INTO app.profiles(id,display_name,email_normalized,account_state) VALUES($1,$2,$3,'ACTIVE') ON CONFLICT(id) DO NOTHING",
        [student.id, student.displayName, student.email],
      );
      await database.query(
        "INSERT INTO app.organization_memberships(organization_id,user_id,role,state,joined_at) VALUES($1,$2,'STUDENT','ACTIVE','2026-09-10T12:00:00Z') ON CONFLICT(organization_id,user_id) DO NOTHING",
        [student.organizationId, student.id],
      );
    }
    for (const course of courses) {
      await database.query(
        'INSERT INTO app.courses(id,organization_id,code,name,description,academic_period,start_date,end_date) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO NOTHING',
        [
          course.id,
          course.organizationId,
          course.code,
          course.name,
          course.description,
          course.academicPeriod,
          course.startDate,
          course.endDate,
        ],
      );
      const adminId = course.organizationId.endsWith('1')
        ? '20000000-0000-4000-8000-000000000001'
        : '20000000-0000-4000-8000-000000000004';
      await database.query(
        'INSERT INTO app.course_teacher_grants(organization_id,course_id,teacher_id,granted_by) VALUES($1,$2,$3,$4) ON CONFLICT(organization_id,course_id,teacher_id) DO NOTHING',
        [course.organizationId, course.id, course.teacherId, adminId],
      );
    }
    for (const classroom of classes) {
      await database.query(
        "INSERT INTO app.classes(id,organization_id,course_id,teacher_id,code,name,description,start_date,end_date) VALUES($1,$2,$3,$4,$5,$6,'Clase ficticia de demostración','2026-07-01','2026-12-31') ON CONFLICT(id) DO NOTHING",
        [
          classroom.id,
          classroom.organizationId,
          classroom.courseId,
          classroom.teacherId,
          classroom.code,
          classroom.name,
        ],
      );
      for (const studentId of classroom.studentIds)
        await database.query(
          "INSERT INTO app.class_memberships(organization_id,class_id,user_id,enrolled_at) VALUES($1,$2,$3,'2026-09-10T12:00:00Z') ON CONFLICT(organization_id,class_id,user_id) DO NOTHING",
          [classroom.organizationId, classroom.id, studentId],
        );
    }
    for (const concept of concepts) {
      const adminId = concept.organizationId.endsWith('1')
        ? '20000000-0000-4000-8000-000000000001'
        : '20000000-0000-4000-8000-000000000004';
      await database.query(
        'INSERT INTO app.concept_tags(id,organization_id,normalized_name) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING',
        [
          concept.id,
          concept.organizationId,
          concept.name.normalize('NFKC').toLocaleLowerCase('es'),
        ],
      );
      await database.query(
        'INSERT INTO app.concept_versions(id,organization_id,concept_id,version,name,description,parent_concept_id,created_by) VALUES($1,$2,$3,1,$4,$5,$6,$7) ON CONFLICT(id) DO NOTHING',
        [
          concept.versionId,
          concept.organizationId,
          concept.id,
          concept.name,
          concept.description,
          concept.parentId,
          adminId,
        ],
      );
      await database.query(
        'UPDATE app.concept_tags SET current_version_id=$1 WHERE id=$2 AND current_version_id IS NULL',
        [concept.versionId, concept.id],
      );
    }
    for (const exercise of exercises) {
      await database.query(
        'INSERT INTO app.exercises(id,organization_id,owner_id) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING',
        [exercise.id, exercise.organizationId, exercise.ownerId],
      );
      const existed =
        (
          await database.query(
            'SELECT id FROM app.exercise_versions WHERE id=$1',
            [exercise.versionId],
          )
        ).rowCount > 0;
      if (!existed) {
        await database.query(
          'INSERT INTO app.exercise_versions(id,organization_id,exercise_id,version,title,statement,starter_code,language,entrypoint,difficulty,execution_limits,created_by) VALUES($1,$2,$3,1,$4,$5,$6,$7,$8,$9,$10,$11)',
          [
            exercise.versionId,
            exercise.organizationId,
            exercise.id,
            exercise.title,
            exercise.statement,
            exercise.starterCode,
            exercise.language,
            exercise.entrypoint,
            exercise.difficulty,
            JSON.stringify(exercise.executionLimits),
            exercise.ownerId,
          ],
        );
        for (const conceptId of exercise.conceptVersionIds)
          await database.query(
            'INSERT INTO app.exercise_version_concepts(organization_id,exercise_version_id,concept_version_id) VALUES($1,$2,$3)',
            [exercise.organizationId, exercise.versionId, conceptId],
          );
        for (const [position, test] of exercise.tests.entries())
          await database.query(
            'INSERT INTO app_private.exercise_tests(organization_id,exercise_version_id,test_id,position,visibility,args,expected) VALUES($1,$2,$3,$4,$5,$6,$7)',
            [
              exercise.organizationId,
              exercise.versionId,
              test.id,
              position,
              test.visibility,
              JSON.stringify(test.args),
              JSON.stringify(test.expected),
            ],
          );
      }
      await database.query(
        'UPDATE app.exercises SET current_version_id=$1 WHERE id=$2 AND current_version_id IS NULL',
        [exercise.versionId, exercise.id],
      );
    }
    for (const activity of activities) {
      const exists =
        (
          await database.query('SELECT id FROM app.activities WHERE id=$1', [
            activity.id,
          ])
        ).rowCount > 0;
      if (exists) continue;
      const teacherId = classes.find(
        (item) => item.id === activity.classId,
      ).teacherId;
      await database.query(
        "INSERT INTO app.activities(id,organization_id,class_id,created_by,title,type,instructions,state) VALUES($1,$2,$3,$4,$5,$6,$7,'DRAFT')",
        [
          activity.id,
          activity.organizationId,
          activity.classId,
          teacherId,
          activity.title,
          activity.type,
          activity.instructions,
        ],
      );
      for (const item of activity.exercises)
        await database.query(
          'INSERT INTO app.activity_exercises(id,organization_id,activity_id,exercise_version_id,position,required) VALUES($1,$2,$3,$4,$5,$6)',
          [
            item.id,
            activity.organizationId,
            activity.id,
            item.exerciseVersionId,
            item.position,
            item.required,
          ],
        );
      if (activity.state !== 'DRAFT')
        await database.query(
          "UPDATE app.activities SET state='PUBLISHED',published_at=now(),revision=revision+1 WHERE id=$1",
          [activity.id],
        );
      if (activity.state === 'CLOSED')
        await database.query(
          "UPDATE app.activities SET state='CLOSED',closed_at=now(),revision=revision+1 WHERE id=$1",
          [activity.id],
        );
    }
    await database.query('COMMIT');
    console.log(
      'Demo académica preparada: 2 organizaciones, 2 administradores, 2 profesores, 8 estudiantes, 3 clases y 10 ejercicios.',
    );
    return true;
  } catch (error) {
    await database.query('ROLLBACK');
    throw error;
  } finally {
    await database.end();
  }
}
