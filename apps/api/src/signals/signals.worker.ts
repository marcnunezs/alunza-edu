import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { performance } from 'node:perf_hooks';
import { APP_CONFIG } from '../config';
import type { AppConfig } from '../config';
import { SignalsRepository } from './signals.repository';
import { processSignalSnapshot } from './signal-processing';

@Injectable()
export class SignalsWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SignalsWorker.name);
  private stopped = false;
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;
  private counters = {
    cycles: 0,
    committed: 0,
    replay: 0,
    stale: 0,
    leaseLost: 0,
    failed: 0,
    evaluations: 0,
    signals: 0,
    notVerifiable: 0,
    durationMs: 0,
  };

  constructor(
    private readonly repository: SignalsRepository,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit() {
    if (this.config.signalsWorkerEnabled) this.schedule();
  }
  private schedule() {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.running = this.tick()
        .catch(() => {
          this.counters.failed++;
          this.logger.warn({ event: 'SIGNALS_CLAIM_UNAVAILABLE' });
        })
        .finally(() => {
          this.running = undefined;
          this.schedule();
        });
    }, 1000);
    this.timer.unref();
  }
  async onModuleDestroy() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.running;
  }
  metrics() {
    return { ...this.counters };
  }

  async tick(laneId?: string): Promise<void> {
    const job = await this.repository.claim(laneId);
    if (!job) return;
    this.counters.cycles++;
    const started = performance.now();
    let lost = false;
    let renewal: Promise<void> | undefined;
    const heartbeat = setInterval(() => {
      if (renewal || lost) return;
      renewal = this.repository
        .renew(job)
        .then((valid) => {
          if (!valid) lost = true;
        })
        .catch(() => {
          lost = true;
        })
        .finally(() => {
          renewal = undefined;
        });
    }, 10_000);
    heartbeat.unref();
    try {
      const snapshot = await this.repository.capture(job);
      if (!snapshot || lost) {
        this.counters.leaseLost++;
        return;
      }
      const batch = processSignalSnapshot(snapshot, 100);
      if (lost || !(await this.repository.renew(job))) {
        this.counters.leaseLost++;
        return;
      }
      // An uncertain commit is reconciled by durable identity, never by a new key.
      const finalization = await this.repository.finalize(
        job,
        snapshot.snapshot.id,
        batch,
      );
      if (finalization.status === 'COMMITTED') this.counters.committed++;
      if (finalization.status === 'REPLAY') this.counters.replay++;
      if (finalization.status === 'STALE') this.counters.stale++;
      if (finalization.status === 'LEASE_LOST') this.counters.leaseLost++;
      this.counters.evaluations += finalization.evaluations;
      this.counters.signals += finalization.signals;
      if (finalization.status === 'COMMITTED')
        this.counters.notVerifiable += batch.evaluations.filter(
          (evaluation) => evaluation.result.outcome === 'NOT_VERIFIABLE',
        ).length;
      this.logger.debug({
        event: 'SIGNALS_BATCH',
        status: finalization.status,
        evaluations: finalization.evaluations,
        signals: finalization.signals,
      });
    } catch (error) {
      this.counters.failed++;
      const code =
        error instanceof Error &&
        ['SIGNAL_CLOCK_REGRESSION', 'CLOCK_REGRESSION'].includes(error.message)
          ? 'CLOCK_REGRESSION'
          : 'PROCESSING_FAILED';
      if (!lost) await this.repository.fail(job, code).catch(() => undefined);
      this.logger.warn({ event: 'SIGNALS_PROCESSING_FAILED', code });
    } finally {
      clearInterval(heartbeat);
      await renewal;
      this.counters.durationMs += performance.now() - started;
    }
  }
}
