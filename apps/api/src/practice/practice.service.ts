import { Inject, Injectable } from '@nestjs/common';
import type { RunExecutionInput, RunTechnicalResult } from '@alunza/contracts';
import { APP_CONFIG } from '../config';
import type { AppConfig } from '../config';
import { ApiError } from '../http/errors';
import type { Actor } from '../governance/governance.shared';
import { ExecutionPort, failedRun } from './execution.port';
import { PracticeRepository } from './practice.repository';

@Injectable()
export class PracticeService {
  constructor(
    private readonly repository: PracticeRepository,
    private readonly execution: ExecutionPort,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async run(
    who: Actor,
    activityId: string,
    assignmentId: string,
    input: RunExecutionInput,
    key: string,
  ) {
    // Authorization precedes all interaction with Docker, even availability.
    await this.repository.authorize(
      who,
      activityId,
      assignmentId,
      input.exerciseVersionId,
    );
    const runner = this.config.practiceRunnerEnabled
      ? await this.execution.inspect()
      : { available: false, runnerVersion: 'disabled' };
    const { admission, context } = await this.repository.admit(
      who,
      activityId,
      assignmentId,
      input,
      key,
      runner,
      this.config.practiceQuotas,
    );
    if (admission.kind === 'replay') return admission.response;
    const started = performance.now();
    let result: RunTechnicalResult;
    let cleaned = false;
    try {
      const output = await this.execution.execute({
        executionId: admission.executionId,
        exerciseVersionId: input.exerciseVersionId,
        requestId: who.requestId,
        testsVersion: context.suiteHash,
        mode: 'RUN',
        entrypoint: 'solve',
        code: input.code,
        tests: context.tests,
      });
      result = output.technicalResult;
      cleaned = output.cleanupVerified;
    } catch {
      result = failedRun(
        admission.runnerVersion,
        admission.visibleTotal,
        performance.now() - started,
      );
    } finally {
      // Runner cleanup already shares a 30s operation + 10s cleanup envelope.
      // Only retry unverified cleanup within that same remaining envelope.
      if (!cleaned) {
        result = failedRun(
          admission.runnerVersion,
          admission.visibleTotal,
          performance.now() - started,
        );
        const remaining = 40_000 - (performance.now() - started);
        if (remaining > 0)
          cleaned = await this.execution.cleanup(
            admission.executionId,
            Math.min(10_000, remaining),
          );
      }
    }
    // Unverified cleanup retains the occupied slot for durable recovery.
    const response = await this.repository.finish(admission, result, cleaned);
    if (!response)
      throw new ApiError(
        'DEPENDENCY_UNAVAILABLE',
        'No se pudo cerrar la ejecución. Conserva tu código y reintenta con la misma solicitud.',
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
}
