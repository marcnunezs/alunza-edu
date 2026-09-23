import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import * as contracts from '@alunza/contracts';
import type { Response } from 'express';
import { z } from 'zod';
import type { ApiRequest } from '../http/errors';
import { AuthGuard } from '../identity/auth.guard';
import {
  actor,
  idempotency,
  parse,
  revision,
  uuid,
} from '../governance/governance.shared';
import { activityPaginationSchema } from '../academic/academic.shared';
import { answer } from '../http/responses';
import { ActivitiesService } from './activities.service';

@Controller('api/v1')
@UseGuards(AuthGuard)
export class ActivitiesController {
  constructor(private readonly service: ActivitiesService) {}
  @Get('classes/:id/activities')
  async list(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Query() q: unknown,
  ) {
    return contracts.activityListResponseSchema.parse({
      ...(await this.service.activities(
        actor(r),
        uuid(id),
        parse(activityPaginationSchema, q),
      )),
      requestId: r.requestId,
    });
  }
  @Post('classes/:id/activities')
  async create(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return answer(
      contracts.activityResponseSchema,
      await this.service.create(
        actor(r),
        uuid(id),
        parse(contracts.activityInputSchema, body),
        idempotency(key),
      ),
      r,
      res,
    );
  }
  @Get('activities/:id')
  async get(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    return answer(
      contracts.activityResponseSchema,
      await this.service.activity(actor(r), uuid(id)),
      r,
      res,
    );
  }
  @Patch('activities/:id')
  async update(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return answer(
      contracts.activityResponseSchema,
      await this.service.update(
        actor(r),
        uuid(id),
        parse(contracts.activityUpdateSchema, body),
        revision(match),
      ),
      r,
      res,
    );
  }
  @Post('activities/:id/publish')
  @HttpCode(200)
  async publish(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('if-match') match: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    parse(z.strictObject({}), body ?? {});
    return answer(
      contracts.activityResponseSchema,
      await this.service.changeState(
        actor(r),
        uuid(id),
        'publish',
        revision(match),
        idempotency(key),
      ),
      r,
      res,
    );
  }
  @Post('activities/:id/close')
  @HttpCode(200)
  async close(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('if-match') match: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    parse(z.strictObject({}), body ?? {});
    return answer(
      contracts.activityResponseSchema,
      await this.service.changeState(
        actor(r),
        uuid(id),
        'close',
        revision(match),
        idempotency(key),
      ),
      r,
      res,
    );
  }
  @Get('activities/:id/exercises/:assignmentId')
  async exercise(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Param('assignmentId') assignment: string,
  ) {
    return answer(
      contracts.studentExerciseResponseSchema,
      await this.service.studentExercise(actor(r), uuid(id), uuid(assignment)),
      r,
    );
  }
}
