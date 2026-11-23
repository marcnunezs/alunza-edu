// Additive, explicitly selected physical TEST fixtures. Imports perform no I/O.
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import testState from '../laboratory-test-state.cjs';
import { concepts } from '../../fixtures/demo/academic.mjs';

const check = (value, code) => {
  if (!value) throw new Error(code);
};
const sha = (value) => createHash('sha256').update(value).digest('hex');
export const HELP_MATERIAL =
  'Una función recibe argumentos y retorna un resultado. Para sumar dos números, combina ambos argumentos. Una condición permite distinguir casos. Revisa la entrada, el cálculo y el retorno.';

export function helpExercisePlan(campaignId, scope) {
  check(
    /^[a-f0-9-]{36}$/i.test(campaignId) &&
      ['H01', 'H02', 'H03'].includes(scope),
    'HELP_FIXTURE_SCOPE',
  );
  return {
    successCode: 'module.exports.solve=(a,b)=>a+b;',
    incorrectCode: 'module.exports.solve=(a,b)=>a-b;',
    tests: Array.from({ length: 8 }, (_, index) => {
      const hidden = index >= 2,
        args = [hidden ? -(index + 2) : index + 2, index + 5];
      return {
        id: `${hidden ? 'private' : 'visible'}-${campaignId}-${index + 1}`,
        visibility: hidden ? 'hidden' : 'visible',
        args,
        expected: args[0] + args[1],
      };
    }),
  };
}

// api is an authenticated, fixed-origin requester supplied by the private
// controller. SQL creates only the owned eight-case exercise, never an attempt.
export async function setupHelpScope({
  state,
  adminPool,
  campaignId,
  scope,
  student,
  teacher,
  api,
  retain,
}) {
  testState.assertLaboratoryTestState(state);
  const plan = helpExercisePlan(campaignId, scope);
  const organizationId = teacher.organizationId;
  const result = {
    scope,
    actorId: student.id,
    teacherId: teacher.id,
    organizationId,
    attemptIds: [],
    closed: false,
    source: null,
  };
  const suffix = `${scope}-${campaignId.slice(0, 8)}`;
  const classroom = (
    await api('teacher', 'POST', `/organizations/${organizationId}/classes`, {
      courseId: '30000000-0000-4000-8000-000000000001',
      code: `HELP-${suffix}`,
      name: `Ayuda física ${suffix}`,
      description: 'Validación local aislada del flujo de ayuda',
      startDate: null,
      endDate: null,
    })
  ).data;
  result.classId = classroom.id;
  // Retain ownership immediately so partial preparation can still be retired.
  await retain(result);
  const join = (
    await api(
      'teacher',
      'POST',
      `/classes/${classroom.id}/join-codes`,
      {},
      classroom.revision,
    )
  ).data;
  await api('student', 'POST', '/class-enrollments', { code: join.code });
  const exerciseId = randomUUID(),
    versionId = randomUUID(),
    client = await adminPool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO app.exercises(id,organization_id,owner_id) VALUES($1,$2,$3)',
      [exerciseId, organizationId, teacher.id],
    );
    await client.query(
      `INSERT INTO app.exercise_versions(id,organization_id,exercise_id,version,title,statement,starter_code,difficulty,created_by)
      VALUES($1,$2,$3,1,$4,'Sumar dos números con ocho comprobaciones',$5,'BEGINNER',$6)`,
      [
        versionId,
        organizationId,
        exerciseId,
        `Ayuda física ${suffix}`,
        plan.incorrectCode,
        teacher.id,
      ],
    );
    await client.query(
      'INSERT INTO app.exercise_version_concepts(organization_id,exercise_version_id,concept_version_id) VALUES($1,$2,$3)',
      [
        organizationId,
        versionId,
        concepts.find((c) => c.organizationId === organizationId).versionId,
      ],
    );
    for (const [position, test] of plan.tests.entries())
      await client.query(
        `INSERT INTO app_private.exercise_tests(organization_id,exercise_version_id,test_id,position,visibility,args,expected)
      VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)`,
        [
          organizationId,
          versionId,
          test.id,
          position,
          test.visibility,
          JSON.stringify(test.args),
          JSON.stringify(test.expected),
        ],
      );
    await client.query(
      'UPDATE app.exercises SET current_version_id=$2 WHERE id=$1',
      [exerciseId, versionId],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  result.exerciseVersionId = versionId;
  const activity = (
    await api('teacher', 'POST', `/classes/${classroom.id}/activities`, {
      title: `Ayuda y reintento ${suffix}`,
      instructions:
        'Comprende el resultado, consulta la ayuda y vuelve a entregar.',
      type: 'FORMATIVE',
      opensAt: null,
      closesAt: null,
      exercises: [
        { exerciseVersionId: versionId, position: 0, required: true },
      ],
    })
  ).data;
  result.activityId = activity.id;
  result.assignmentId = activity.exercises[0].id;
  await retain(result);
  await api(
    'teacher',
    'POST',
    `/activities/${activity.id}/publish`,
    {},
    activity.revision,
  );
  const testsVersion = (
    await adminPool.query(
      `SELECT encode(sha256(convert_to(jsonb_agg(jsonb_build_object('id',test_id,'visibility',visibility,'args',args,'expected',expected) ORDER BY position)::text,'UTF8')),'hex') AS hash
    FROM app_private.exercise_tests WHERE organization_id=$1 AND exercise_version_id=$2`,
      [organizationId, versionId],
    )
  ).rows[0].hash;
  result.fixture = {
    activityId: result.activityId,
    assignmentId: result.assignmentId,
    exerciseVersionId: versionId,
    testsVersion,
    visibleTestIds: plan.tests
      .filter((t) => t.visibility === 'visible')
      .map((t) => t.id),
    hiddenTestIds: plan.tests
      .filter((t) => t.visibility === 'hidden')
      .map((t) => t.id),
    hiddenMarkers: [],
    successCode: plan.successCode,
    incorrectCode: plan.incorrectCode,
  };
  if (scope !== 'H02') {
    const title = `Material de ayuda ${suffix}`,
      form = new globalThis.FormData();
    form.set('title', title);
    form.set(
      'file',
      new globalThis.Blob([HELP_MATERIAL], { type: 'text/plain' }),
      'ayuda.txt',
    );
    const accepted = (
      await api('teacher', 'POST', `/classes/${classroom.id}/sources`, form)
    ).data;
    result.source = {
      id: accepted.source.id,
      title,
      text: HELP_MATERIAL,
      versionId: accepted.version.id,
      sha256: sha(HELP_MATERIAL),
    };
    await retain(result);
    const deadline = Date.now() + 40000;
    let ready = false;
    while (Date.now() < deadline) {
      const source = (
        await api('teacher', 'GET', `/sources/${result.source.id}`)
      ).data;
      check(source.latestJob?.state !== 'FAILED', 'MATERIAL_INGESTION_FAILED');
      if (source.latestJob?.state === 'SUCCEEDED') {
        check(
          source.availability === 'READY' &&
            source.activeVersion?.id === result.source.versionId &&
            source.activeVersion.sha256 === result.source.sha256 &&
            source.chunkCount > 0,
          'MATERIAL_NOT_READY',
        );
        ready = true;
        break;
      }
      await sleep(100);
    }
    check(ready, 'MATERIAL_INGESTION_DEADLINE');
  }
  result.prepared = true;
  await retain(result);
  return result;
}

export function publicHelpScope(s) {
  check(s.prepared && !s.closed, 'HELP_SCOPE_NOT_PREPARED');
  return {
    scope: s.scope,
    actorId: s.actorId,
    teacherId: s.teacherId,
    organizationId: s.organizationId,
    classId: s.classId,
    activityId: s.activityId,
    assignmentId: s.assignmentId,
    exerciseVersionId: s.exerciseVersionId,
    route: `/actividades/${s.activityId}/ejercicios/${s.assignmentId}`,
    wrongCode: s.fixture.incorrectCode,
    correctCode: s.fixture.successCode,
    source: s.source,
  };
}

export async function closeHelpScope(s, api) {
  if (s.closed) return;
  if (s.source) {
    const source = (await api('admin', 'GET', `/sources/${s.source.id}`)).data;
    if (source.state !== 'ARCHIVED')
      await api(
        'admin',
        'POST',
        `/sources/${source.id}/archive`,
        { reason: 'Validación física local finalizada' },
        source.revision,
      );
  }
  if (s.activityId) {
    const activity = (
      await api('teacher', 'GET', `/activities/${s.activityId}`)
    ).data;
    if (activity.state === 'PUBLISHED')
      await api(
        'teacher',
        'POST',
        `/activities/${activity.id}/close`,
        {},
        activity.revision,
      );
  }
  if (s.classId) {
    const classroom = (await api('admin', 'GET', `/classes/${s.classId}`)).data;
    if (classroom.state !== 'ARCHIVED')
      await api(
        'admin',
        'POST',
        `/classes/${classroom.id}/archive`,
        { reason: 'Validación física local finalizada' },
        classroom.revision,
      );
  }
  s.closed = true;
}
