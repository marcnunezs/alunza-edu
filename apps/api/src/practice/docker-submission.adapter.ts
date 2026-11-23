import { Inject, Injectable, Optional } from '@nestjs/common';
import { submitTechnicalResultSchema } from '@alunza/contracts';
import type { ExecutionResult } from '@alunza/runner';
import { APP_CONFIG } from '../config';
import type { AppConfig } from '../config';
import type { ExecutionContext, ExecutionAuthority } from './execution.port';
import { executionContextSchema } from './execution.port';
import { DockerRunnerService } from './docker-runner.service';
import { createSubmitTimingObserver } from './submit-observability';
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
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Optional() private readonly configuredRunner?: DockerRunnerService,
  ) {
    super();
  }
  async execute(
    input: SubmissionExecutionInput,
    context?: ExecutionContext,
    authority?: ExecutionAuthority,
  ) {
    if (context && !executionContextSchema.safeParse(context).success)
      throw new Error('Runner inspection context invalid');
    if (
      this.config.dockerConfiguration ||
      (context?.provider === 'docker' && context.engineId)
    ) {
      if (!this.configuredRunner)
        throw new Error('Docker candidate unavailable');
      const { result, cleanupVerified } = await this.configuredRunner.execute(
        input,
        context,
        authority,
      );
      return {
        ...projectSubmission(input, result, context!.runnerVersion),
        cleanupVerified,
      };
    }
    const runner = await import('@alunza/runner');
    if (
      context &&
      (context.provider !== 'docker' ||
        context.runnerVersion !== runner.RUNNER_VERSION ||
        !/^sha256:[a-f0-9]{64}$/.test(context.image))
    )
      throw new Error('Runner inspection context invalid');
    const observer = createSubmitTimingObserver(this.config.environment, {
      requestId: input.requestId,
      executionId: input.executionId,
    });
    const result = await runner.execute(
      input,
      new runner.DockerAdapter({
        ...(context ? { image: context.image } : {}),
        observeTiming: observer
          ? ({ phase, durationMs, completed }) =>
              observer({ source: 'docker', phase, durationMs, completed })
          : undefined,
      }),
      AbortSignal.timeout(30_000),
    );
    return {
      ...projectSubmission(input, result, runner.RUNNER_VERSION),
      cleanupVerified: result.evidence.cleanupVerified,
    };
  }
}
