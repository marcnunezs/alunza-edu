import { Inject, Injectable } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { APP_CONFIG } from '../config';
import type { AppConfig } from '../config';
import { ExecutionPort } from './execution.port';
import { failedSubmission } from './submission-execution.port';
import { SubmissionRepository } from './submission.repository';

@Injectable()
export class SubmissionReconciler implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | undefined;
  private stopped = false;
  constructor(
    private readonly repository: SubmissionRepository,
    private readonly execution: ExecutionPort,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}
  onModuleInit() {
    this.startTick();
    this.timer = setInterval(() => this.startTick(), 15_000);
    this.timer.unref();
  }
  private startTick() {
    if (this.stopped || this.running) return;
    this.running = this.tick()
      .catch(() => undefined)
      .finally(() => {
        this.running = undefined;
      });
  }
  async tick() {
    const local =
      this.config.environment !== 'production' &&
      this.config.environment !== 'preproduction';
    const sweep = local ? await this.execution.sweepExpired() : undefined;
    await this.repository.purgeExpired();
    if (!local || !sweep?.cleanupVerified) return;
    for (let index = 0; index < 4; index++) {
      const reservation = await this.repository.claimExpired();
      if (!reservation) return;
      const cleaned = await this.execution.cleanup(reservation.executionId);
      // Prefer already durable evidence. Never rerun an uncertain execution and
      // never replace its valid staged result with a later operational failure.
      if (!reservation.stagedResult) {
        const stored = await this.repository.stage(
          reservation,
          failedSubmission(reservation.runnerVersion, reservation.visibleTotal),
        );
        if (!stored) continue;
      }
      await this.repository.finish(reservation, cleaned);
    }
  }
  async onModuleDestroy() {
    this.stopped = true;
    clearInterval(this.timer);
    await this.running;
  }
}
