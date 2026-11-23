import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createClient } from '@supabase/supabase-js';
import { academicExecutionLimits } from '@alunza/contracts';
import { root } from './local.mjs';
import {
  classes,
  concepts,
  additionalStudents,
} from '../fixtures/demo/academic.mjs';
import {
  cases as adversarialCases,
  documents,
} from '../fixtures/ai/help-adversarial-manifest.mjs';
import {
  EvaluationClient,
  EvaluationJournal,
  EvaluationSessions,
  EvaluationError,
  privateJson,
  sha256,
} from './evaluation-client.mjs';
import {
  evaluationPlanSchema,
  preparationFingerprint,
} from './evaluation-manifest.mjs';

// Author labels concern whether the authorized document supports this actual
// programming problem. Other JavaScript topics are near negatives; a different
// UUID alone does not make the holdout query independent.
export const evaluationCalibrationCases = [
  {
    split: 'calibration',
    statement:
      'Escribe una función solve que calcule el doble de su argumento y comunique el resultado al llamador. Explica la diferencia entre calcular y devolver un resultado.',
    code: 'module.exports.solve = (n) => { n * 2; };',
    expectedDiagnosis: 'RUNTIME_ERROR',
    expectedResults: [4, 6],
    relevantText: documents[0].text,
    irrelevantText: documents.find((item) => item.id === 'arrays').text,
  },
  {
    split: 'validation',
    statement:
      'Implementa una función solve que incremente en uno el argumento recibido y entregue ese nuevo valor al llamador. Investiga por qué una expresión aislada deja al llamador sin resultado.',
    code: 'module.exports.solve = (n) => { n + 1; };',
    expectedDiagnosis: 'RUNTIME_ERROR',
    expectedResults: [3, 4],
    relevantText:
      'El llamador recibe un valor sólo cuando la función ejecuta return. Una operación aritmética aislada no devuelve su resultado.',
    irrelevantText: documents.find((item) => item.id === 'conditions').text,
  },
];

export function evaluationAdversarialGroups() {
  return adversarialCases
    .filter((item) => item.hintLevel === null)
    .map((fixtureCase) => ({
      fixtureCase,
      requests:
        fixtureCase.category === 'positive'
          ? adversarialCases.filter(
              (item) =>
                item.category === 'positive' &&
                item.context.diagnosisCode ===
                  fixtureCase.context.diagnosisCode,
            )
          : [fixtureCase],
    }));
}

export async function prepareEvaluation({
  plan: raw,
  state,
  directory,
  runId = randomUUID(),
}) {
  const plan = evaluationPlanSchema.parse(raw);
  if (
    state.projectId !== plan.destination.projectId ||
    state.authUrl !== plan.destination.authOrigin
  )
    throw new EvaluationError('PREPARE_DESTINATION_MISMATCH');
  const fixture = JSON.parse(
    await readFile(join(root, 'fixtures/foundation/identity.json'), 'utf8'),
  );
  const actors = [...fixture.users, ...additionalStudents].filter(
    (user) => user.accountState === 'ACTIVE',
  );
  const vaultPath = join(directory, 'sessions.json');
  const vault = {
    authUrl: state.authUrl,
    publishableKey: state.publishableKey,
    actors: {},
  };
  for (const actor of actors) {
    const auth = createClient(state.authUrl, state.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const result = await auth.auth.signInWithPassword({
      email: actor.email,
      password: state.fixturePassword,
    });
    if (result.error || result.data.session?.user.id !== actor.id)
      throw new EvaluationError('PREPARE_SESSION_FAILED');
    const { access_token, refresh_token, expires_at } = result.data.session;
    vault.actors[actor.id] = { access_token, refresh_token, expires_at };
  }
  await privateJson(vaultPath, vault);
  const journal = await EvaluationJournal.load(
    join(directory, 'prepare-journal.json'),
    runId,
  );
  await journal.lock();
  const client = new EvaluationClient({
    ...plan.destination,
    sessions: await EvaluationSessions.load(vaultPath),
    journal,
  });
  const students = actors.filter((actor) => actor.role === 'STUDENT');
  const teacherFor = (classroom) => classroom.teacherId;
  const prepared = journal.value.prepared ?? {
    runId,
    planHash: preparationFingerprint(plan),
    materials: [],
    cases: [],
    omittedRemoteOracles: [],
    outsiderId: fixture.users[5].id,
    createdAt: new Date().toISOString(),
  };
  if (prepared.planHash !== preparationFingerprint(plan))
    throw new EvaluationError('PREPARE_PLAN_CHANGED');
  journal.value.prepared = prepared;
  async function create(name, actor, path, body, revision) {
    const intent = await journal.intent(name, { actor, path, body, revision });
    if (intent.result) return intent.result;
    for (;;) {
      try {
        const result = await client.product(actor, path, {
          method: 'POST',
          body,
          revision,
          key: intent.key,
          expected: [200, 201],
        });
        intent.result = result;
        intent.state = 'DONE';
        await journal.save();
        return result;
      } catch (error) {
        if (error.status !== 429) throw error;
        await delay(1000);
      }
    }
  }
  async function activity(
    name,
    classroom,
    statement = 'Escribe una función solve que devuelva el doble de su argumento.',
    expectedResults = [4, 6],
  ) {
    const concept = concepts.find(
      (item) => item.organizationId === classroom.organizationId,
    );
    const teacher = teacherFor(classroom);
    const exercise = await create(
      `exercise:${name}`,
      teacher,
      `/organizations/${classroom.organizationId}/exercises`,
      {
        title: `Evaluación ${name}`,
        statement,
        starterCode: 'module.exports.solve = (n) => n;',
        language: 'javascript',
        entrypoint: 'solve',
        difficulty: 'BEGINNER',
        conceptVersionIds: [concept.versionId],
        tests: [
          {
            id: 'visible-double',
            visibility: 'visible',
            args: [2],
            expected: expectedResults[0],
          },
          {
            id: 'EVAL_HIDDEN_CANARY',
            visibility: 'hidden',
            args: [3],
            expected: expectedResults[1],
          },
        ],
        executionLimits: academicExecutionLimits,
      },
    );
    const draft = await create(
      `activity:${name}`,
      teacher,
      `/classes/${classroom.id}/activities`,
      {
        title: `Evaluación ${name}`,
        instructions: 'Material y práctica ficticios de laboratorio.',
        type: 'FORMATIVE',
        opensAt: null,
        closesAt: null,
        exercises: [
          {
            exerciseVersionId: exercise.currentVersionId,
            position: 0,
            required: true,
          },
        ],
      },
    );
    return create(
      `publish:${name}`,
      teacher,
      `/activities/${draft.id}/publish`,
      {},
      draft.revision,
    );
  }
  function material(name, classroom, scope, text) {
    const existing = prepared.materials.find((entry) => entry.name === name);
    if (existing) return existing.binding;
    const binding = {
      id: randomUUID(),
      actorId: teacherFor(classroom),
      organizationId: classroom.organizationId,
      classId: classroom.id,
      activityId: scope.id,
      sha256: sha256(text),
      format: 'TXT',
      operation: 'UPLOAD',
      maxOperations: 1,
    };
    prepared.materials.push({ name, binding, fileName: `${name}.txt`, text });
    return binding;
  }
  async function attempt(
    name,
    student,
    classroom,
    scope,
    {
      code = 'module.exports.solve = (n) => n;',
      stage,
      profile,
      helps = 4,
      calibration,
      reviewCase,
      expectedDiagnosis = 'FAILED_TEST',
      oracle,
      helpRequests,
    } = {},
  ) {
    if (prepared.cases.some((entry) => entry.name === name)) return;
    const assignment = scope.exercises[0];
    const body = { code, exerciseVersionId: assignment.exerciseVersionId };
    const saved = await create(
      `attempt:${name}`,
      student.id,
      `/activities/${scope.id}/exercises/${assignment.id}/attempts`,
      body,
    );
    if (saved.technicalResult.diagnosisCode !== expectedDiagnosis)
      throw new EvaluationError(`PREPARED_DIAGNOSIS_${name}`);
    const binding = {
      id: randomUUID(),
      actorId: student.id,
      organizationId: classroom.organizationId,
      classId: classroom.id,
      activityId: scope.id,
      attemptId: saved.attemptId,
      codeHash: sha256(code),
      stage,
      maxOperations: helps,
      ...(calibration ? { calibration } : {}),
      ...(reviewCase ? { reviewCase } : {}),
    };
    prepared.cases.push({
      name,
      binding,
      profile,
      expectedDiagnosis,
      ...(oracle ? { oracle } : {}),
      ...(helpRequests ? { helpRequests } : {}),
    });
    await journal.save();
  }
  try {
    const scopes = [];
    for (let i = 0; i < classes.length; i++) {
      const classroom = classes[i];
      const scope = await activity(
        `latency-${i}-${runId.slice(0, 8)}`,
        classroom,
      );
      scopes.push(scope);
      material(`latency-${i}-return`, classroom, scope, documents[0].text);
      material(`latency-${i}-syntax`, classroom, scope, documents[1].text);
    }
    const owner = students.find((student) =>
      classes[0].studentIds.includes(student.id),
    );
    await attempt('functional', owner, classes[0], scopes[0], {
      stage: 'FUNCTIONAL',
      profile: 'functional',
    });
    for (const profile of ['serial', 'concurrent'])
      for (let index = 0; index < 25; index++) {
        const student = students[index % students.length];
        const classIndex = classes.findIndex((item) =>
          item.studentIds.includes(student.id),
        );
        await attempt(
          `${profile}-${index}`,
          student,
          classes[classIndex],
          scopes[classIndex],
          { stage: 'EVALUATION', profile },
        );
      }
    for (const [index, scenario] of evaluationCalibrationCases.entries()) {
      const { split } = scenario;
      const classroom = classes[index];
      const student = students.find((item) =>
        classroom.studentIds.includes(item.id),
      );
      for (const relevant of [true, false]) {
        const name = `${split}-${relevant ? 'positive' : 'near-negative'}`;
        const scope = await activity(
          name,
          classroom,
          scenario.statement,
          scenario.expectedResults,
        );
        const doc = material(
          `calibration-${name}`,
          classroom,
          scope,
          relevant ? scenario.relevantText : scenario.irrelevantText,
        );
        await attempt(name, student, classroom, scope, {
          stage: 'CALIBRATION',
          code: scenario.code,
          expectedDiagnosis: scenario.expectedDiagnosis,
          profile: split,
          helps: 1,
          calibration: {
            caseId: name,
            groupId: `${split}-exercise-${relevant ? 'positive' : 'negative'}`,
            split,
            expected: relevant ? 'SUPPORTED' : 'NO_EVIDENCE',
            relevantBindingIds: relevant ? [doc.id] : [],
          },
        });
      }
    }
    // Each positive diagnosis shares one persisted attempt across explanation
    // and the three allowed hints. Candidate mutations have a separate review
    // job; an infrastructure failure is not fabricated into a student attempt.
    for (const { fixtureCase, requests } of evaluationAdversarialGroups()) {
      if (fixtureCase.context.infrastructureStatus !== 'OK') {
        if (
          !prepared.omittedRemoteOracles.some(
            (entry) => entry.id === fixtureCase.id,
          )
        )
          prepared.omittedRemoteOracles.push({
            id: fixtureCase.id,
            execution: 'deterministic-local-tests',
            reason: 'infrastructure-failure-does-not-authorize-ai',
          });
        continue;
      }
      const name = `adversarial-${fixtureCase.id}`;
      const classroom = classes[0];
      const scope = await activity(
        name,
        classroom,
        fixtureCase.context.statement.replace('función doble', 'función solve'),
      );
      const mappings = fixtureCase.chunks.map((chunk, index) => {
        const binding = material(
          `${name}-${index}`,
          classroom,
          scope,
          chunk.text,
        );
        return {
          source_id: chunk.source_id,
          source_version_id: chunk.source_version_id,
          chunk_id: chunk.chunk_id,
          locator: chunk.locator,
          materialBindingId: binding.id,
        };
      });
      const code = `${fixtureCase.context.code}\nmodule.exports.solve = doble;`;
      await attempt(name, owner, classroom, scope, {
        code,
        stage: 'EVALUATION',
        profile: fixtureCase.candidate ? 'candidate' : 'adversarial',
        helps: fixtureCase.candidate ? 1 : requests.length,
        expectedDiagnosis: fixtureCase.context.diagnosisCode,
        ...(fixtureCase.candidate
          ? {
              reviewCase: {
                caseId: fixtureCase.id,
                candidate: fixtureCase.candidate,
                expected: fixtureCase.expected.review ?? 'REJECT',
                boundaryExpected: fixtureCase.expected.boundary === 'REJECT',
                refsMapping: mappings,
              },
            }
          : {}),
        oracle: {
          caseId: fixtureCase.id,
          expected: fixtureCase.expected,
          forbidden: fixtureCase.forbidden,
        },
        ...(!fixtureCase.candidate
          ? {
              helpRequests: requests.map((request) => ({
                kind: request.kind,
                hintLevel: request.hintLevel,
                oracle: {
                  caseId: request.id,
                  expected: request.expected,
                  forbidden: request.forbidden,
                },
              })),
            }
          : {}),
      });
    }
    prepared.corpusHash = sha256(
      JSON.stringify(
        prepared.materials
          .map(({ binding }) => ({
            bindingId: binding.id,
            sha256: binding.sha256,
          }))
          .sort((a, b) => a.bindingId.localeCompare(b.bindingId)),
      ),
    );
    await journal.save();
    await privateJson(join(directory, 'prepared.json'), prepared);
    return prepared;
  } finally {
    await journal.close();
  }
}
