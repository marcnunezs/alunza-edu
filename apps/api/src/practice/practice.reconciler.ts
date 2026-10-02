import { Inject, Injectable } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { APP_CONFIG } from '../config';
import type { AppConfig } from '../config';
import { ExecutionPort, failedRun } from './execution.port';
import { PracticeRepository } from './practice.repository';

@Injectable()
export class PracticeReconciler implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | undefined;
  private stopped = false;
  constructor(
    private readonly repository: PracticeRepository,
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
    // A create response can be lost before Docker exposes the new container.
    // Sweep owned expired capsules even if its reservation already completed,
    // admissions are disabled, or database retention is temporarily unavailable.
    const sweep = local ? await this.execution.sweepExpired() : undefined;
    await this.repository.purgeExpired();
    // Disabling new admissions must not strand existing local Docker leases.
    if (!local || !sweep?.cleanupVerified) return;
    // Bounded batch. SKIP LOCKED + rotated tokens fences every replica.
    for (let index = 0; index < 4; index++) {
      const reservation = await this.repository.claimExpired();
      if (!reservation) return;
      const cleaned = await this.execution.cleanup(reservation.executionId);
      await this.repository.finish(
        reservation,
        failedRun(reservation.runnerVersion, reservation.visibleTotal),
        cleaned,
      );
    }
  }
  async onModuleDestroy() {
    this.stopped = true;
    clearInterval(this.timer);
    await this.running;
  }
}
