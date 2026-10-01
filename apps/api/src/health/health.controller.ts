import { Controller, Get, Req } from '@nestjs/common';
import { healthResponseSchema } from '@alunza/contracts';
import { DatabaseService } from '../database/database.service';
import type { ApiRequest } from '../http/errors';
import { LivenessService } from './liveness.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly liveness: LivenessService,
    private readonly database: DatabaseService,
  ) {}

  @Get('live')
  live(@Req() request: ApiRequest) {
    return healthResponseSchema.parse({
      data: { status: this.liveness.status() },
      requestId: request.requestId,
    });
  }

  @Get('ready')
  async ready(@Req() request: ApiRequest) {
    await this.database.ready();
    return this.live(request);
  }
}
