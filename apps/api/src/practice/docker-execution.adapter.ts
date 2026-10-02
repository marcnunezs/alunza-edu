import { Injectable } from '@nestjs/common';
import { runTechnicalResultSchema } from '@alunza/contracts';
import { ExecutionPort, failedRun } from './execution.port';
import type { PracticeExecutionInput } from './execution.port';

@Injectable()
export class DockerExecutionAdapter extends ExecutionPort {
  private inspection:
    Promise<{ available: boolean; runnerVersion: string }> | undefined;
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

  protected async inspectDocker() {
    try {
      const runner = await import('@alunza/runner');
      const { available } = await runner.getDockerAvailability();
      return { available, runnerVersion: runner.RUNNER_VERSION };
    } catch {
      return { available: false, runnerVersion: 'unavailable' };
    }
  }

  async execute(input: PracticeExecutionInput) {
    const runner = await import('@alunza/runner');
    const result = await runner.execute(
      input,
      new runner.DockerAdapter(),
      AbortSignal.timeout(30_000),
    );
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
      result.runnerVersion === runner.RUNNER_VERSION &&
      result.privateTestResults.length === 0 &&
      result.hiddenRequiredCount === 0 &&
      tests.every((test) => knownIds.has(test.id)) &&
      (result.diagnosisCode !== 'SUCCESS' || result.allRequiredPassed);
    return {
      technicalResult:
        coherent && projected.success
          ? projected.data
          : failedRun(runner.RUNNER_VERSION, input.tests.length),
      cleanupVerified: result.evidence.cleanupVerified,
    };
  }

  async cleanup(executionId: string, timeoutMs = 10_000): Promise<boolean> {
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
    // RUN and SUBMIT reconcilers share this adapter and can sweep together.
    // Share only that in-flight sweep, including its existing 10s deadline.
    // No result is cached: success or failure releases the next fresh sweep.
    return (this.sweeping ??= this.sweepDocker().finally(() => {
      this.sweeping = undefined;
    }));
  }

  protected async sweepDocker() {
    try {
      const runner = await import('@alunza/runner');
      return await runner.sweepExpiredDockerExecutions(
        AbortSignal.timeout(10_000),
      );
    } catch {
      return { cleanupVerified: false, removed: 0 };
    }
  }
}
