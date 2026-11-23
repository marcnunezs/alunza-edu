// Additive TEST-only fixtures. No mutation occurs when importing this module.
import { createHash, randomUUID } from 'node:crypto';
import testState from '../laboratory-test-state.cjs';
import { classes, concepts } from '../../fixtures/demo/academic.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const hash = (s) => createHash('sha256').update(s).digest('hex');
const successCode = 'module.exports.solve=(a,b)=>a+b;';
const incorrectCode = 'module.exports.solve=(a,b)=>a-b;';

export function planLinuxVmFixture(campaignId) {
  if (!UUID.test(campaignId))
    throw new Error('A fixture campaign UUID is required.');
  return classes.flatMap((classroom) =>
    ['RUN', 'SUBMIT'].map((mode) => {
      const marker = `ALUNZA_PRIVATE_${campaignId.replaceAll('-', '')}`;
      const tests = Array.from({ length: 8 }, (_, index) => {
        const hidden = mode === 'SUBMIT' && index >= 2;
        const args = [hidden ? -(index + 2) : index + 2, index + 5];
        return {
          id: `${hidden ? 'private' : 'visible'}-${campaignId}-${index + 1}`,
          visibility: hidden ? 'hidden' : 'visible',
          args,
          expected: args[0] + args[1],
        };
      });
      return {
        mode,
        classroom,
        tests,
        marker,
        successCode,
        incorrectCode,
        hiddenProbeCode: `module.exports.solve=(a,b)=>{if(a<0)console.log("${marker}");return a+b;};`,
      };
    }),
  );
}

export async function setupLinuxVmFixture({
  state,
  adminPool,
  campaignId = randomUUID(),
  publish = true,
}) {
  testState.assertLaboratoryTestState(state);
  if (typeof publish !== 'boolean')
    throw new Error('Explicit publication required.');
  const plan = planLinuxVmFixture(campaignId),
    client = await adminPool.connect();
  const fixturesByActor = {},
    activities = [];
  try {
    await client.query('BEGIN');
    for (const item of plan) {
      const c = item.classroom;
      const present = await client.query(
        `SELECT c.id FROM app.classes c
        JOIN app.organization_memberships m ON m.organization_id=c.organization_id AND m.user_id=c.teacher_id
        WHERE c.id=$1 AND c.organization_id=$2 AND c.teacher_id=$3 AND m.state='ACTIVE'`,
        [c.id, c.organizationId, c.teacherId],
      );
      if (present.rowCount !== 1)
        throw new Error('Canonical class or active teacher missing.');
      const memberships = await client.query(
        `SELECT cm.user_id FROM app.class_memberships cm
        JOIN app.organization_memberships m USING(organization_id,user_id)
        JOIN app.profiles p ON p.id=cm.user_id
        WHERE cm.class_id=$1 AND cm.ended_at IS NULL AND m.state='ACTIVE' AND p.account_state='ACTIVE' AND m.role='STUDENT'`,
        [c.id],
      );
      if (
        !c.studentIds.every((id) =>
          memberships.rows.some((row) => row.user_id === id),
        )
      )
        throw new Error('Canonical active students missing.');
      const ids = {
        exercise: randomUUID(),
        version: randomUUID(),
        activity: randomUUID(),
        assignment: randomUUID(),
      };
      const concept = concepts.find(
        (value) => value.organizationId === c.organizationId,
      );
      await client.query(
        'INSERT INTO app.exercises(id,organization_id,owner_id) VALUES($1,$2,$3)',
        [ids.exercise, c.organizationId, c.teacherId],
      );
      await client.query(
        `INSERT INTO app.exercise_versions(id,organization_id,exercise_id,version,title,statement,starter_code,difficulty,created_by)
        VALUES($1,$2,$3,1,$4,'Sumar dos números con ocho comprobaciones',$5,'BEGINNER',$6)`,
        [
          ids.version,
          c.organizationId,
          ids.exercise,
          `VM .13 ${item.mode} ${campaignId}`,
          successCode,
          c.teacherId,
        ],
      );
      await client.query(
        'INSERT INTO app.exercise_version_concepts(organization_id,exercise_version_id,concept_version_id) VALUES($1,$2,$3)',
        [c.organizationId, ids.version, concept.versionId],
      );
      for (const [position, test] of item.tests.entries())
        await client.query(
          `INSERT INTO app_private.exercise_tests(organization_id,exercise_version_id,test_id,position,visibility,args,expected)
          VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)`,
          [
            c.organizationId,
            ids.version,
            test.id,
            position,
            test.visibility,
            JSON.stringify(test.args),
            JSON.stringify(test.expected),
          ],
        );
      await client.query(
        'UPDATE app.exercises SET current_version_id=$2 WHERE id=$1',
        [ids.exercise, ids.version],
      );
      await client.query(
        `INSERT INTO app.activities(id,organization_id,class_id,created_by,title,type,state)
        VALUES($1,$2,$3,$4,$5,'FORMATIVE','DRAFT')`,
        [
          ids.activity,
          c.organizationId,
          c.id,
          c.teacherId,
          `VM .13 ${item.mode} ${campaignId}`,
        ],
      );
      await client.query(
        `INSERT INTO app.activity_exercises(id,organization_id,activity_id,exercise_version_id,position,required)
        VALUES($1,$2,$3,$4,0,true)`,
        [ids.assignment, c.organizationId, ids.activity, ids.version],
      );
      if (publish)
        await client.query(
          "UPDATE app.activities SET state='PUBLISHED',published_at=now(),revision=revision+1 WHERE id=$1",
          [ids.activity],
        );
      const testsVersion =
        item.mode === 'RUN'
          ? hash(JSON.stringify(item.tests))
          : (
              await client.query(
                `SELECT
        encode(sha256(convert_to(jsonb_agg(jsonb_build_object('id',test_id,'visibility',visibility,'args',args,'expected',expected) ORDER BY position)::text,'UTF8')),'hex') AS hash
        FROM app_private.exercise_tests WHERE organization_id=$1 AND exercise_version_id=$2`,
                [c.organizationId, ids.version],
              )
            ).rows[0].hash;
      const fixture = {
        activityId: ids.activity,
        assignmentId: ids.assignment,
        exerciseVersionId: ids.version,
        testsVersion,
        runTestsVersion: hash(
          JSON.stringify(item.tests.filter((t) => t.visibility === 'visible')),
        ),
        visibleTestIds: item.tests
          .filter((t) => t.visibility === 'visible')
          .map((t) => t.id),
        hiddenTestIds: item.tests
          .filter((t) => t.visibility === 'hidden')
          .map((t) => t.id),
        successCode,
        incorrectCode,
        hiddenProbeCode: item.hiddenProbeCode,
        hiddenMarkers: item.mode === 'SUBMIT' ? [item.marker] : [],
      };
      for (const id of c.studentIds) {
        fixturesByActor[id] ??= {};
        fixturesByActor[id][item.mode] = fixture;
      }
      activities.push({
        id: ids.activity,
        organizationId: c.organizationId,
        classId: c.id,
        mode: item.mode,
      });
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return {
    campaignId,
    fixturesByActor,
    activities,
    async close() {
      // Close only these six activities. Attempts, executions and audit history survive.
      const owned = await adminPool.connect();
      try {
        await owned.query('BEGIN');
        for (const activity of activities)
          await owned.query(
            "UPDATE app.activities SET state='CLOSED',closed_at=now(),revision=revision+1 WHERE id=$1 AND organization_id=$2 AND state='PUBLISHED'",
            [activity.id, activity.organizationId],
          );
        await owned.query('COMMIT');
      } catch (error) {
        await owned.query('ROLLBACK');
        throw error;
      } finally {
        owned.release();
      }
    },
  };
}
