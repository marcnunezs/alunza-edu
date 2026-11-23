import { Injectable } from '@nestjs/common';
import type { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { AuditExportRepository } from './audit-export.repository';

@Injectable()
export class AuditExportMaintenance implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<unknown> | undefined;
  private stopped = false;
  constructor(private readonly repository: AuditExportRepository) {}
  onModuleInit() {
    this.tick();
    this.timer = setInterval(() => this.tick(), 60_000);
    this.timer.unref();
  }
  private tick() {
    if (this.stopped || this.running) return;
    this.running = this.repository
      .maintain()
      .catch(() => undefined)
      .finally(() => {
        this.running = undefined;
      });
  }
  async onModuleDestroy() {
    this.stopped = true;
    clearInterval(this.timer);
    await this.running;
  }
}
