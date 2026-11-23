import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  activityOpenInputSchema,
  activityOpenResponseSchema,
  progressQuerySchema,
  studentProgressResponseSchema,
} from '@alunza/contracts';
import { AuthGuard } from '../identity/auth.guard';
import {
  actor,
  idempotency,
  parse,
  uuid,
} from '../governance/governance.shared';
import type { ApiRequest } from '../http/errors';
import { ProgressService } from './progress.service';
import { phaseSync } from '../http/phase-diagnostics';

@Controller('api/v1')
@UseGuards(AuthGuard)
export class ProgressController {
  constructor(private readonly service: ProgressService) {}

  @Get('me/progress')
  async read(@Req() request: ApiRequest, @Query() query: unknown) {
    const data = await this.service.read(
      actor(request),
      parse(progressQuerySchema, query),
    );
    return phaseSync('progress.responseParse', () =>
      studentProgressResponseSchema.parse({
        data,
        requestId: request.requestId,
      }),
    );
  }

  @Post('activities/:id/open-events')
  async open(
    @Req() request: ApiRequest,
    @Param('id') activityId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    parse(activityOpenInputSchema, body);
    return activityOpenResponseSchema.parse({
      data: await this.service.open(
        actor(request),
        uuid(activityId),
        idempotency(key),
      ),
      requestId: request.requestId,
    });
  }
}
