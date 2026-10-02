import { Inject, Injectable } from '@nestjs/common';
import type { AttemptListQuery, SubmitAttemptInput } from '@alunza/contracts';
import { APP_CONFIG } from '../config';
import type { AppConfig } from '../config';
import type { Actor } from '../governance/governance.shared';
import { ApiError } from '../http/errors';
import { ExecutionPort } from './execution.port';
import {
  SubmissionExecutionPort,
  failedSubmission,
} from './submission-execution.port';
import type { CanonicalSubmissionResult } from './submission-execution.port';
import { SubmissionRepository } from './submission.repository';

@Injectable()
export class SubmissionService {
  constructor(
    private readonly repository: SubmissionRepository,
    private readonly execution: SubmissionExecutionPort,
    private readonly lifecycle: ExecutionPort,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async submit(
    who: Actor,
    activityId: string,
    assignmentId: string,
    input: SubmitAttemptInput,
    key: string,
  ) {
    await this.repository.authorize(
      who,
      activityId,
      assignmentId,
      input.exerciseVersionId,
    );
    const runner = this.config.practiceRunnerEnabled
      ? await this.lifecycle.inspect()
      : { available: false, runnerVersion: 'disabled' };
    const reservation = await this.repository.admit(
      who,
      activityId,
      assignmentId,
      input,
      key,
      runner,
      this.config.practiceQuotas,
    );
    if (reservation.kind === 'replay') {
      await this.repository.authorize(
        who,
        activityId,
        assignmentId,
        input.exerciseVersionId,
      );
      return reservation.response;
    }
    const started = performance.now();
    let result: CanonicalSubmissionResult;
    let cleaned = false;
    try {
      const suite = await this.repository.suite(reservation);
      const output = await this.execution.execute({
        executionId: reservation.executionId,
        requestId: who.requestId,
        exerciseVersionId: input.exerciseVersionId,
        testsVersion: suite.testsVersion,
        mode: 'SUBMIT',
        entrypoint: 'solve',
        code: input.code,
        tests: suite.tests,
      });
      result = {
        technicalResult: output.technicalResult,
        privateTestResults: output.privateTestResults,
      };
      cleaned = output.cleanupVerified;
    } catch {
      result = failedSubmission(
        reservation.runnerVersion,
        reservation.visibleTotal,
        performance.now() - started,
      );
    } finally {
      if (!cleaned) {
        const remaining = 40_000 - (performance.now() - started);
        if (remaining > 0)
          cleaned = await this.lifecycle.cleanup(
            reservation.executionId,
            Math.min(10_000, remaining),
          );
      }
    }
    // Durable normalized evidence survives a failure of the following attempt commit.
    // Recovery consumes this evidence; it never executes student code a second time.
    const staged = await this.repository.stage(reservation, result);
    const response = staged
      ? await this.repository.finish(reservation, cleaned)
      : null;
    if (!response)
      throw new ApiError(
        'DEPENDENCY_UNAVAILABLE',
        'No se pudo confirmar el envío. Conserva tu código y recupera la misma solicitud.',
        503,
        true,
      );
    await this.repository.authorize(
      who,
      activityId,
      assignmentId,
      input.exerciseVersionId,
    );
    return response;
  }

  detail(who: Actor, attemptId: string) {
    return this.repository.detail(who, attemptId);
  }
  list(
    who: Actor,
    activityId: string,
    assignmentId: string,
    query: AttemptListQuery,
  ) {
    return this.repository.list(who, activityId, assignmentId, query);
  }
  progress(who: Actor, activityId: string) {
    return this.repository.progress(who, activityId);
  }
}
