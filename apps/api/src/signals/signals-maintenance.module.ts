import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { APP_CONFIG } from '../config';
import type { AppConfig } from '../config';
import { DatabaseService } from '../database/database.service';
import { SignalsRepository } from './signals.repository';

/** Local maintenance creates no HTTP listener, runner or background worker. */
@Module({})
export class SignalsMaintenanceModule {
  static register(config: AppConfig): DynamicModule {
    return {
      module: SignalsMaintenanceModule,
      providers: [
        { provide: APP_CONFIG, useValue: config },
        DatabaseService,
        SignalsRepository,
      ],
      exports: [SignalsRepository],
    };
  }
}
