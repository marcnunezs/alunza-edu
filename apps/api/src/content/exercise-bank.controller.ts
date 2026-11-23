import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  exerciseBankDetailResponseSchema,
  exerciseBankGovernanceInputSchema,
  exerciseVersionResponseSchema,
  exerciseBankListResponseSchema,
  exerciseBankQuerySchema,
  exerciseBankUsesQuerySchema,
  exerciseBankUsesResponseSchema,
  exerciseBankVersionsQuerySchema,
  exerciseBankVersionsResponseSchema,
} from '@alunza/contracts';
import { z } from 'zod';
import {
  actor,
  idempotency,
  parse,
  revision,
  uuid,
} from '../governance/governance.shared';
import type { Response } from 'express';
import { answer } from '../http/responses';
import type { ApiRequest } from '../http/errors';
import { AuthGuard } from '../identity/auth.guard';
import { ExerciseBankService } from './exercise-bank.service';

const noFilters = z.strictObject({});

@Controller('api/v1')
@UseGuards(AuthGuard)
export class ExerciseBankController {
  constructor(private readonly service: ExerciseBankService) {}

  @Get('organizations/:orgId/exercise-bank')
  async list(
    @Req() request: ApiRequest,
    @Param('orgId') organizationId: string,
    @Query() query: unknown,
  ) {
    return exerciseBankListResponseSchema.parse({
      data: await this.service.list(
        actor(request),
        uuid(organizationId),
        parse(exerciseBankQuerySchema, query),
      ),
      requestId: request.requestId,
    });
  }

  @Get('exercises/:id/governance')
  async detail(
    @Req() request: ApiRequest,
    @Param('id') exerciseId: string,
    @Query() query: unknown,
    @Res({ passthrough: true }) response?: Response,
  ) {
    parse(noFilters, query);
    return answer(
      exerciseBankDetailResponseSchema,
      await this.service.detail(actor(request), uuid(exerciseId)),
      request,
      response,
    );
  }

  @Get('exercises/:id/governance/content')
  async content(
    @Req() request: ApiRequest,
    @Param('id') exerciseId: string,
    @Query() query: unknown,
  ) {
    parse(noFilters, query);
    return answer(
      exerciseVersionResponseSchema,
      await this.service.content(actor(request), uuid(exerciseId)),
      request,
    );
  }

  @Patch('exercises/:id/governance')
  async govern(
    @Req() request: ApiRequest,
    @Param('id') exerciseId: string,
    @Body() body: unknown,
    @Headers('if-match') match: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response?: Response,
  ) {
    return answer(
      exerciseBankDetailResponseSchema,
      await this.service.govern(
        actor(request),
        uuid(exerciseId),
        parse(exerciseBankGovernanceInputSchema, body),
        revision(match),
        idempotency(key),
      ),
      request,
      response,
    );
  }

  @Get('exercises/:id/governance/versions')
  async versions(
    @Req() request: ApiRequest,
    @Param('id') exerciseId: string,
    @Query() query: unknown,
  ) {
    return exerciseBankVersionsResponseSchema.parse({
      data: await this.service.versions(
        actor(request),
        uuid(exerciseId),
        parse(exerciseBankVersionsQuerySchema, query),
      ),
      requestId: request.requestId,
    });
  }

  @Get('exercises/:id/governance/uses')
  async uses(
    @Req() request: ApiRequest,
    @Param('id') exerciseId: string,
    @Query() query: unknown,
  ) {
    return exerciseBankUsesResponseSchema.parse({
      data: await this.service.uses(
        actor(request),
        uuid(exerciseId),
        parse(exerciseBankUsesQuerySchema, query),
      ),
      requestId: request.requestId,
    });
  }
}
