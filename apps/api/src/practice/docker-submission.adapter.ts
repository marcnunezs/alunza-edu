import { Injectable } from '@nestjs/common';
import { submitTechnicalResultSchema } from '@alunza/contracts';
import type { ExecutionResult } from '@alunza/runner';
import {
  failedSubmission,
  SubmissionExecutionPort,
} from './submission-execution.port';
import type {
  CanonicalSubmissionResult,
  SubmissionExecutionInput,
} from './submission-execution.port';

/** Only this projection may cross from the private SUBMIT runner into storage. */
export function projectSubmission(
  input: SubmissionExecutionInput,
  result: ExecutionResult,
  runnerVersion: string,
): CanonicalSubmissionResult {
  const failed = () =>
    failedSubmission(
      runnerVersion,
      input.tests.filter((test) => test.visibility === 'visible').length,
    );
  const visible = input.tests.filter((test) => test.visibility === 'visible');
  const hidden = input.tests.filter((test) => test.visibility === 'hidden');
  const cases = [...result.visibleTestResults, ...result.privateTestResults];
  const complete = ['SUCCESS', 'FAILED_TEST'].includes(result.diagnosisCode);
  const belongsTo = (
    values: Array<{ id: string; passed: boolean }>,
    expected: Array<{ id: string }>,
  ) =>
    values.length <= expected.length &&
    values.every(
      (value) =>
        typeof value.passed === 'boolean' &&
        expected.some((test) => test.id === value.id),
    );
  if (
    result.executionId !== input.executionId ||
    result.runnerVersion !== runnerVersion ||
    result.hiddenRequiredCount !== hidden.length ||
    new Set(cases.map((test) => test.id)).size !== cases.length ||
    !belongsTo(result.visibleTestResults, visible) ||
    !belongsTo(result.privateTestResults, hidden) ||
    (complete && cases.length !== input.tests.length) ||
    (result.diagnosisCode === 'FAILED_TEST' &&
      (result.terminationReason !== 'ASSERTION_FAILED' ||
        result.infrastructureStatus !== 'OK' ||
        result.outputTruncated)) ||
    result.allRequiredPassed !==
      (complete &&
        cases.length === input.tests.length &&
        cases.every((test) => test.passed)) ||
    (result.diagnosisCode === 'SUCCESS') !== result.allRequiredPassed
  )
    return failed();

  const publicCases = result.visibleTestResults.map((test) => ({
    id: test.id,
    passed: test.passed,
    stdout: test.stdout.replaceAll('\0', '?'),
    stderr: test.stderr.replaceAll('\0', '?'),
  }));
  const projected = submitTechnicalResultSchema.safeParse({
    runnerVersion: result.runnerVersion,
    diagnosisCode: result.diagnosisCode,
    terminationReason: result.terminationReason,
    infrastructureStatus: result.infrastructureStatus,
    visibleTestResults: publicCases,
    visiblePassed: publicCases.filter((test) => test.passed).length,
    visibleTotal: visible.length,
    // Hidden output is neither copied nor counted in the public console budget.
    outputBytes: publicCases.reduce(
      (sum, test) =>
        sum + Buffer.byteLength(test.stdout) + Buffer.byteLength(test.stderr),
      0,
    ),
    outputTruncated: result.outputTruncated,
    runtimeMs: result.runtimeMs,
    lifecycleMs: result.lifecycleMs,
    hiddenChecksPassed:
      complete && hidden.length > 0
        ? result.privateTestResults.every((test) => test.passed)
        : null,
    allRequiredPassed: result.allRequiredPassed,
  });
  if (!projected.success) return failed();
  return {
    technicalResult: projected.data,
    privateTestResults: result.privateTestResults.map((test) => ({
      id: test.id,
      passed: test.passed,
    })),
  };
}

@Injectable()
export class DockerSubmissionAdapter extends SubmissionExecutionPort {
  async execute(input: SubmissionExecutionInput) {
    const runner = await import('@alunza/runner');
    const result = await runner.execute(
      input,
      new runner.DockerAdapter(),
      AbortSignal.timeout(30_000),
    );
    return {
      ...projectSubmission(input, result, runner.RUNNER_VERSION),
      cleanupVerified: result.evidence.cleanupVerified,
    };
  }
}
