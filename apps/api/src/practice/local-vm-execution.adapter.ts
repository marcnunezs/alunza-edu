import { Injectable } from '@nestjs/common';
import { ExecutionPort } from './execution.port';
import type {
  ExecutionAuthority,
  ExecutionContext,
  PracticeExecutionInput,
} from './execution.port';
import { SubmissionExecutionPort } from './submission-execution.port';
import type { SubmissionExecutionInput } from './submission-execution.port';
import { LocalVmRunnerService } from './local-vm-runner.service';
import { projectRun } from './docker-execution.adapter';
import { projectSubmission } from './docker-submission.adapter';

@Injectable()
export class LocalVmExecutionAdapter extends ExecutionPort {
  constructor(private readonly runner: LocalVmRunnerService) {
    super();
  }
  inspect() {
    return this.runner.inspect();
  }
  async execute(
    input: PracticeExecutionInput,
    context?: ExecutionContext,
    authority?: ExecutionAuthority,
  ) {
    const { result, cleanupVerified } = await this.runner.execute(
      input,
      context,
      authority,
    );
    return {
      technicalResult: projectRun(input, result, context!.runnerVersion),
      cleanupVerified,
    };
  }
  cleanup(executionId: string, timeoutMs?: number, context?: ExecutionContext) {
    return this.runner.cleanup(executionId, context, timeoutMs);
  }
  async sweepExpired() {
    // Every dispatch has a durable reservation. Reconciliation claims and
    // retires each independently; there is no global Docker sweep here.
    return { cleanupVerified: true, removed: 0 };
  }
}

@Injectable()
export class LocalVmSubmissionAdapter extends SubmissionExecutionPort {
  constructor(private readonly runner: LocalVmRunnerService) {
    super();
  }
  async execute(
    input: SubmissionExecutionInput,
    context?: ExecutionContext,
    authority?: ExecutionAuthority,
  ) {
    const { result, cleanupVerified } = await this.runner.execute(
      input,
      context,
      authority,
    );
    return {
      ...projectSubmission(input, result, context!.runnerVersion),
      cleanupVerified,
    };
  }
}
