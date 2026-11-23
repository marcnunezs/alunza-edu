import { Inject, Injectable } from '@nestjs/common';
import type { RunExecutionInput, RunTechnicalResult } from '@alunza/contracts';
import { APP_CONFIG } from '../config';
import type { AppConfig } from '../config';
import { ApiError } from '../http/errors';
import type { Actor } from '../governance/governance.shared';
import { ExecutionPort, failedRun } from './execution.port';
import { PracticeRepository } from './practice.repository';
import { createRunTimingObserver, measureRunPhase } from './run-observability';
import type { SubmitTimingContext } from './submit-observability';

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
    responseClosed?: Promise<boolean>,
  ) {
    const timingContext: SubmitTimingContext = { requestId: who.requestId };
    const observer = createRunTimingObserver(
      this.config.environment,
      timingContext,
    );
    const measure = <T>(phase: string, operation: () => Promise<T>) =>
      measureRunPhase(observer, phase, operation);
    return measure('total', async () => {
      // Authorization precedes all interaction with the provider, even availability.
      await measure('authorizeInitial', () =>
        this.repository.authorize(
          who,
          activityId,
          assignmentId,
          input.exerciseVersionId,
        ),
      );
      const runner = this.config.practiceRunnerEnabled
        ? await measure('inspect', () => this.execution.inspect())
        : { available: false, runnerVersion: 'disabled' };
      const { admission, context } = await measure('admit', () =>
        this.repository.admit(
          who,
          activityId,
          assignmentId,
          input,
          key,
          runner,
          this.config.practiceQuotas,
        ),
      );
      timingContext.executionId =
        admission.kind === 'replay'
          ? admission.response.executionId
          : admission.executionId;
      if (admission.kind === 'replay') {
        await measure('authorizeFinal', () =>
          this.repository.authorize(
            who,
            activityId,
            assignmentId,
            input.exerciseVersionId,
          ),
        );
        return admission.response;
      }
      const started = performance.now();
      const startedAt = Date.now();
      const executionContext = admission.executionContext ?? runner.context;
      let committed = false;
      let result: RunTechnicalResult;
      let cleaned = false;
      try {
        try {
          const executionInput = {
            executionId: admission.executionId,
            exerciseVersionId: input.exerciseVersionId,
            requestId: who.requestId,
            testsVersion: context.suiteHash,
            mode: 'RUN' as const,
            entrypoint: 'solve' as const,
            code: input.code,
            tests: context.tests,
          };
          if (
            executionContext &&
            (executionContext.runnerVersion !== admission.runnerVersion ||
              executionContext.runnerVersion !== runner.runnerVersion)
          )
            throw new Error('Runner inspection version mismatch');
          const output = await measure('execute', async () =>
            executionContext &&
            (executionContext.provider === 'vercel' ||
              executionContext.provider === 'local-vm' ||
              executionContext.engineId)
              ? await this.execution.execute(executionInput, executionContext, {
                  leaseToken: admission.leaseToken,
                  normalDeadlineMs: startedAt + 30_000,
                  cleanupDeadlineMs: startedAt + 40_000,
                })
              : executionContext
                ? await this.execution.execute(executionInput, executionContext)
                : await this.execution.execute(executionInput),
          );
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
              cleaned = await measure('cleanupFallback', () =>
                this.execution.cleanup(
                  admission.executionId,
                  Math.min(10_000, remaining),
                  ...(executionContext ? [executionContext] : []),
                ),
              );
          }
        }
        // Unverified cleanup retains the occupied slot for durable recovery.
        const response = await measure('finish', () =>
          this.repository.finish(admission, result, cleaned),
        );
        if (!response)
          throw new ApiError(
            'DEPENDENCY_UNAVAILABLE',
            'No se pudo cerrar la ejecución. Conserva tu código y reintenta con la misma solicitud.',
            503,
            true,
          );
        await measure('authorizeFinal', () =>
          this.repository.authorize(
            who,
            activityId,
            assignmentId,
            input.exerciseVersionId,
          ),
        );
        committed = true;
        return response;
      } finally {
        if (
          executionContext?.provider === 'docker' &&
          executionContext.engineId
        )
          this.execution.requestClosed(
            admission.executionId,
            executionContext,
            {
              committed,
              cleanupVerified: cleaned,
              responseClosed,
            },
          );
      }
    });
  }
}
