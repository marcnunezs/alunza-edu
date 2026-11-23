import { Inject, Injectable } from '@nestjs/common';
import { evaluationObservationSchema } from '@alunza/contracts';
import type { EvaluationObservation } from '@alunza/contracts';
import { EvaluationRepository } from './evaluation.repository';
import { EVALUATION_CONFIG, EvaluationCallError } from './evaluation.types';
import type {
  EvaluationCallSpec,
  EvaluationConfig,
  EvaluationInvoke,
} from './evaluation.types';

/** A provider is never called unless its durable dispatch has committed. */
@Injectable()
export class EvaluationGateway {
  constructor(
    private readonly repository: EvaluationRepository,
    @Inject(EVALUATION_CONFIG) private readonly config: EvaluationConfig,
  ) {}
  canContinue(owner: EvaluationCallSpec['owner']) {
    return this.repository.canContinue(owner);
  }
  async execute<T>(
    spec: EvaluationCallSpec,
    invoke: EvaluationInvoke<T>,
  ): Promise<T> {
    const reservation = await this.repository.reserve(
      spec,
      this.config.enabled,
    );
    if (reservation.state === 'STOP')
      throw new EvaluationCallError('CALL_UNCERTAIN');
    if (reservation.state === 'ERROR')
      throw new EvaluationCallError(
        reservation.failure.code,
        reservation.failure.retryable,
        reservation.failure.retryAfterMs,
      );
    if (reservation.state === 'COMPLETED') {
      if (!(await this.repository.canContinue(spec.owner)))
        throw new EvaluationCallError('CANCELLED');
      return reservation.result as T;
    }
    let observed: EvaluationObservation | undefined;
    let pending = Promise.resolve();
    const observer: Parameters<EvaluationInvoke<T>>[0] = (event) => {
      const parsed = evaluationObservationSchema.safeParse(event);
      if (!parsed.success || parsed.data.phase !== spec.phase) return;
      observed = parsed.data;
      pending = pending
        .then(async () => {
          await this.repository.observe(
            reservation.callId,
            reservation.dispatchToken,
            parsed.data,
          );
        })
        .catch(() => undefined);
      return pending;
    };
    let result: T;
    try {
      result = await invoke(observer);
    } catch (error) {
      await pending;
      const value =
        error && typeof error === 'object'
          ? (error as {
              code?: unknown;
              retryable?: unknown;
              retryAfterMs?: unknown;
            })
          : {};
      const code =
        typeof value.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(value.code)
          ? value.code
          : 'PROVIDER_UNAVAILABLE';
      const failure =
        observed &&
        (observed.outcome === 'RESPONSE' ||
          observed.httpStatus ||
          observed.requestId)
          ? {
              code,
              retryable:
                (value.retryable === true || observed.retryable === true) &&
                observed.outcome === 'ERROR',
              ...(typeof value.retryAfterMs === 'number'
                ? {
                    retryAfterMs: Math.max(
                      0,
                      Math.min(300_000, value.retryAfterMs),
                    ),
                  }
                : {}),
            }
          : undefined;
      // A lost checkpoint never grants permission to issue the same call again.
      try {
        await this.repository.complete(
          reservation.callId,
          reservation.dispatchToken,
          undefined,
          failure,
        );
      } catch {
        /* Remains DISPATCHED and therefore fenced. */
      }
      throw error;
    }
    await pending;
    if (
      !(await this.repository.complete(
        reservation.callId,
        reservation.dispatchToken,
        result,
      ))
    )
      throw new EvaluationCallError('CALL_UNCERTAIN');
    if (!(await this.repository.canContinue(spec.owner)))
      throw new EvaluationCallError('CANCELLED');
    return result;
  }
}
