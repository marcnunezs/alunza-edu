import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  signalRuleActivateSchema,
  signalRuleCreateSchema,
  signalRuleEffectiveResponseSchema,
  signalRuleListQuerySchema,
  signalRuleVersionListResponseSchema,
  signalRuleVersionResponseSchema,
} from '@alunza/contracts';
import { z } from 'zod';
import {
  actor,
  idempotency,
  parse,
  uuid,
} from '../governance/governance.shared';
import type { ApiRequest } from '../http/errors';
import { AuthGuard } from '../identity/auth.guard';
import { RuleVersionsService } from './rule-versions.service';

@Controller('api/v1')
@UseGuards(AuthGuard)
export class RuleVersionsController {
  constructor(private readonly service: RuleVersionsService) {}

  @Get('organizations/:orgId/signal-rules/effective')
  async effective(
    @Req() request: ApiRequest,
    @Param('orgId') organizationId: string,
    @Query() query: unknown,
  ) {
    parse(z.strictObject({}), query);
    return signalRuleEffectiveResponseSchema.parse({
      data: await this.service.effective(actor(request), uuid(organizationId)),
      requestId: request.requestId,
    });
  }

  @Get('organizations/:orgId/signal-rules')
  async list(
    @Req() request: ApiRequest,
    @Param('orgId') organizationId: string,
    @Query() query: unknown,
  ) {
    return signalRuleVersionListResponseSchema.parse({
      ...(await this.service.list(
        actor(request),
        uuid(organizationId),
        parse(signalRuleListQuerySchema, query),
      )),
      requestId: request.requestId,
    });
  }

  @Post('organizations/:orgId/signal-rules')
  async create(
    @Req() request: ApiRequest,
    @Param('orgId') organizationId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    return signalRuleVersionResponseSchema.parse({
      data: await this.service.create(
        actor(request),
        uuid(organizationId),
        parse(signalRuleCreateSchema, body),
        idempotency(key),
      ),
      requestId: request.requestId,
    });
  }

  @Get('signal-rules/:id')
  async get(@Req() request: ApiRequest, @Param('id') id: string) {
    return signalRuleVersionResponseSchema.parse({
      data: await this.service.get(actor(request), uuid(id)),
      requestId: request.requestId,
    });
  }

  @Post('signal-rules/:id/activate')
  @HttpCode(200)
  async activate(
    @Req() request: ApiRequest,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    return signalRuleVersionResponseSchema.parse({
      data: await this.service.activate(
        actor(request),
        uuid(id),
        parse(signalRuleActivateSchema, body),
        idempotency(key),
      ),
      requestId: request.requestId,
    });
  }
}
