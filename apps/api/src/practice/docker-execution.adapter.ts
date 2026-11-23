import { Injectable, Optional } from '@nestjs/common';
import { runTechnicalResultSchema } from '@alunza/contracts';
import type { ExecutionResult } from '@alunza/runner';
import {
  ExecutionPort,
  executionContextSchema,
  failedRun,
} from './execution.port';
import type {
  PracticeExecutionInput,
  RunnerInspection,
  ExecutionContext,
  ExecutionAuthority,
  ExecutionRequestClosure,
} from './execution.port';
import { DockerRunnerService } from './docker-runner.service';

@Injectable()
export class DockerExecutionAdapter extends ExecutionPort {
  constructor(
    @Optional() private readonly configuredRunner?: DockerRunnerService,
  ) {
    super();
  }
  private inspection: Promise<RunnerInspection> | undefined;
  private sweeping:
    Promise<{ cleanupVerified: boolean; removed: number }> | undefined;

  inspect() {
    // Concurrent admissions share only the in-flight machine capability probe.
    // There is no TTL/cache: the next call after settlement probes Docker again,
    // while every execution still verifies its own capsule and pinned image.
    return (this.inspection ??= this.inspectDocker().finally(() => {
      this.inspection = undefined;
    }));
  }

  protected async inspectDocker(): Promise<RunnerInspection> {
    try {
      if (this.configuredRunner?.configured)
        return await this.configuredRunner.inspect();
      const runner = await import('@alunza/runner');
      const { available, image } = await runner.getDockerAvailability();
      return available && image
        ? {
            available: true,
            runnerVersion: runner.RUNNER_VERSION,
            context: Object.freeze({
              provider: 'docker' as const,
              image,
              runnerVersion: runner.RUNNER_VERSION,
            }),
          }
        : { available: false, runnerVersion: runner.RUNNER_VERSION };
    } catch {
      return { available: false, runnerVersion: 'unavailable' };
    }
  }

  async execute(
    input: PracticeExecutionInput,
    context?: ExecutionContext,
    authority?: ExecutionAuthority,
  ) {
    if (context && !executionContextSchema.safeParse(context).success)
      throw new Error('Runner inspection context invalid');
    if (
      this.configuredRunner?.configured ||
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
        technicalResult: projectRun(input, result, context!.runnerVersion),
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
    const result = await runner.execute(
      input,
      new runner.DockerAdapter(context ? { image: context.image } : {}),
      AbortSignal.timeout(30_000),
    );
    return {
      technicalResult: projectRun(input, result, runner.RUNNER_VERSION),
      cleanupVerified: result.evidence.cleanupVerified,
    };
  }

  async cleanup(
    executionId: string,
    timeoutMs = 10_000,
    context?: ExecutionContext,
  ): Promise<boolean> {
    if (
      context &&
      (context.provider !== 'docker' ||
        !executionContextSchema.safeParse(context).success)
    )
      return false;
    if (context?.provider === 'docker' && context.engineId)
      return (
        this.configuredRunner?.cleanup(executionId, context, timeoutMs) ?? false
      );
    try {
      const runner = await import('@alunza/runner');
      return (
        await runner.cleanupDockerExecution(
          executionId,
          AbortSignal.timeout(Math.max(1, Math.floor(timeoutMs))),
        )
      ).cleanupVerified;
    } catch {
      return false;
    }
  }

  sweepExpired() {
    return (this.sweeping ??= this.sweepDocker().finally(() => {
      this.sweeping = undefined;
    }));
  }

  protected async sweepDocker() {
    try {
      const runner = await import('@alunza/runner');
      const legacy = await runner.sweepExpiredDockerExecutions(
        AbortSignal.timeout(10_000),
      );
      if (!this.configuredRunner) return legacy;
      const prepared = await this.configuredRunner.sweepExpired();
      return {
        cleanupVerified: legacy.cleanupVerified && prepared.cleanupVerified,
        removed: legacy.removed + prepared.removed,
      };
    } catch {
      return { cleanupVerified: false, removed: 0 };
    }
  }
  override requestClosed(
    executionId: string,
    context: ExecutionContext,
    closure: ExecutionRequestClosure,
  ) {
    this.configuredRunner?.requestClosed(executionId, context, closure);
  }
}

/** Explicit public projection shared by both providers. */
export function projectRun(
  input: PracticeExecutionInput,
  result: ExecutionResult,
  runnerVersion: string,
) {
  const tests = result.visibleTestResults;
  const knownIds = new Set(input.tests.map((test) => test.id));
  // Explicit projection: no object spread from a private runner response.
  const projected = runTechnicalResultSchema.safeParse({
    runnerVersion: result.runnerVersion,
    diagnosisCode: result.diagnosisCode,
    terminationReason: result.terminationReason,
    infrastructureStatus: result.infrastructureStatus,
    visibleTestResults: tests.map((test) => ({
      id: test.id,
      passed: test.passed,
      // JSONB cannot store U+0000. ASCII replacement preserves byte budget.
      stdout: test.stdout.replaceAll('\0', '?'),
      stderr: test.stderr.replaceAll('\0', '?'),
    })),
    visiblePassed: tests.filter((test) => test.passed).length,
    visibleTotal: input.tests.length,
    outputTruncated: result.outputTruncated,
    outputBytes: result.outputBytes,
    runtimeMs: result.runtimeMs,
    lifecycleMs: result.lifecycleMs,
  });
  const coherent =
    result.executionId === input.executionId &&
    result.runnerVersion === runnerVersion &&
    result.privateTestResults.length === 0 &&
    result.hiddenRequiredCount === 0 &&
    tests.every((test) => knownIds.has(test.id)) &&
    (result.diagnosisCode !== 'SUCCESS' || result.allRequiredPassed);
  return coherent && projected.success
    ? projected.data
    : failedRun(runnerVersion, input.tests.length);
}
