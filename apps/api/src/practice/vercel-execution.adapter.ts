import { Injectable } from '@nestjs/common';
import { ExecutionPort } from './execution.port';
import type {
  ExecutionAuthority,
  ExecutionContext,
  PracticeExecutionInput,
} from './execution.port';
import { SubmissionExecutionPort } from './submission-execution.port';
import type { SubmissionExecutionInput } from './submission-execution.port';
import { projectRun } from './docker-execution.adapter';
import { projectSubmission } from './docker-submission.adapter';
import { VercelRunnerService } from './vercel-runner.service';

@Injectable()
export class VercelExecutionAdapter extends ExecutionPort {
  constructor(private readonly runner: VercelRunnerService) {
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
  cleanup(executionId: string, timeoutMs?: number) {
    return this.runner.cleanup(executionId, timeoutMs);
  }
  async sweepExpired() {
    // Every remote creation belongs to a durable reservation. Claim/cleanup below
    // processes each independently; a single unresolved resource cannot block others.
    return { cleanupVerified: true, removed: 0 };
  }
}

@Injectable()
export class VercelSubmissionAdapter extends SubmissionExecutionPort {
  constructor(private readonly runner: VercelRunnerService) {
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
