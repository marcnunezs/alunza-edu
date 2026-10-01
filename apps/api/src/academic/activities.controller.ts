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
import type { Response } from 'express';
import * as c from '@alunza/contracts';
import type { ApiRequest } from '../http/errors';
import { AuthGuard } from '../identity/auth.guard';
import {
  actor,
  idempotency,
  parse,
  revision,
  uuid,
} from '../governance/governance.shared';
import { ActivitiesService } from './activities.service';
import { listing, result } from './academic.controller';

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
    return listing(
      c.activityListResponseSchema,
      await this.service.list(
        actor(r),
        uuid(id),
        parse(c.academicPageQuerySchema, q),
      ),
      r,
    );
  }
  @Post('classes/:id/activities')
  async create(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return result(
      c.activityResponseSchema,
      await this.service.create(
        actor(r),
        uuid(id),
        parse(c.activityInputSchema, body),
        idempotency(key),
      ),
      r,
      res,
    );
  }
  @Get('activities/:id')
  async activity(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    return result(
      c.activityResponseSchema,
      await this.service.get(actor(r), uuid(id)),
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
    return result(
      c.activityResponseSchema,
      await this.service.update(
        actor(r),
        uuid(id),
        parse(c.activityUpdateSchema, body),
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
    @Res({ passthrough: true }) res: Response,
  ) {
    parse(c.academicArchiveSchema, body ?? {});
    return result(
      c.activityResponseSchema,
      await this.service.transition(
        actor(r),
        uuid(id),
        'publish',
        revision(match),
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
    @Res({ passthrough: true }) res: Response,
  ) {
    parse(c.academicArchiveSchema, body ?? {});
    return result(
      c.activityResponseSchema,
      await this.service.transition(
        actor(r),
        uuid(id),
        'close',
        revision(match),
      ),
      r,
      res,
    );
  }
  @Get('activities/:id/exercises/:assignmentId')
  async exercise(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Param('assignmentId') assignmentId: string,
  ) {
    return result(
      c.studentExerciseResponseSchema,
      await this.service.studentExercise(
        actor(r),
        uuid(id),
        uuid(assignmentId),
      ),
      r,
    );
  }
}
