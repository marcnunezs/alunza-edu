import { randomUUID, createHash } from 'node:crypto';
import { execute, DockerAdapter } from '@alunza/runner';
import { exerciseVersionInputSchema } from '@alunza/contracts';
import { exercises } from '../fixtures/demo/academic.mjs';
import { report } from './test-environment.mjs';

const evidence = [];
try {
  for (const exercise of exercises) {
    exerciseVersionInputSchema.parse({
      title: exercise.title,
      statement: exercise.statement,
      starterCode: exercise.starterCode,
      language: exercise.language,
      entrypoint: exercise.entrypoint,
      difficulty: exercise.difficulty,
      conceptVersionIds: exercise.conceptVersionIds,
      tests: exercise.tests,
      executionLimits: exercise.executionLimits,
    });
    for (const kind of ['referenceSolution', 'incorrectSolution']) {
      const result = await execute(
        {
          executionId: randomUUID(),
          requestId: randomUUID(),
          exerciseVersionId: exercise.versionId,
          testsVersion: createHash('sha256')
            .update(JSON.stringify(exercise.tests))
            .digest('hex'),
          mode: 'SUBMIT',
          entrypoint: 'solve',
          code: exercise[kind],
          tests: exercise.tests,
        },
        new DockerAdapter(),
      );
      const expected = kind === 'referenceSolution' ? 'SUCCESS' : 'FAILED_TEST';
      if (result.diagnosisCode !== expected || !result.evidence.cleanupVerified)
        throw new Error(
          `No se verificó ${exercise.versionId} (${kind}): ${result.diagnosisCode}/${result.terminationReason}.`,
        );
      evidence.push({
        exerciseVersionId: exercise.versionId,
        kind,
        diagnosis: result.diagnosisCode,
        cleanup: result.evidence.cleanupVerified,
        provider: 'docker',
      });
    }
  }
  await report(
    'canonical-exercises',
    {
      status: 'passed',
      exercises: exercises.length,
      checks: evidence.length,
      evidence,
      scope:
        'Fixture validation only; no student execution API or universal author validation.',
    },
    'imp-02',
  );
  console.log(
    `Banco canónico: ${exercises.length} ejercicios; ${evidence.length} verificaciones Docker aprobadas.`,
  );
} catch (error) {
  await report(
    'canonical-exercises',
    { status: 'failed', completed: evidence.length, error: error.message },
    'imp-02',
  );
  console.error(error.message);
  process.exitCode = 1;
}
