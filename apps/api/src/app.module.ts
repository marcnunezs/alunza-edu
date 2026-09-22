import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { APP_CONFIG } from './config';
import type { AppConfig } from './config';
import { DatabaseService } from './database/database.service';
import { HealthController } from './health/health.controller';
import { LivenessService } from './health/liveness.service';
import { AuthGuard } from './identity/auth.guard';
import { IdentityController } from './identity/identity.controller';
import { IdentityRepository } from './identity/identity.repository';
import { GovernanceController } from './governance/governance.controller';
import { GovernanceService } from './governance/governance.service';
import { InvitationController } from './governance/invitation.controller';
import { InvitationService } from './governance/invitation.service';
import { InvitationWorker } from './governance/invitation.worker';
import { InvitationAuthAdapter } from './governance/invitation-auth.adapter';
import {
  JWT_KEY_RESOLVER,
  JwtVerifier,
  remoteKeyResolver,
} from './identity/jwt-verifier';

@Module({})
export class AppModule {
  static register(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      controllers: [
        HealthController,
        IdentityController,
        GovernanceController,
        InvitationController,
      ],
      providers: [
        { provide: APP_CONFIG, useValue: config },
        {
          provide: JWT_KEY_RESOLVER,
          useFactory: remoteKeyResolver,
          inject: [APP_CONFIG],
        },
        DatabaseService,
        LivenessService,
        JwtVerifier,
        AuthGuard,
        IdentityRepository,
        GovernanceService,
        InvitationService,
        InvitationAuthAdapter,
        InvitationWorker,
      ],
    };
  }
}
