import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import {
  organizationCreateSchema,
  organizationUpdateSchema,
  organizationArchiveSchema,
  memberUpdateSchema,
  organizationResponseSchema,
  organizationListResponseSchema,
  memberResponseSchema,
  memberListResponseSchema,
} from '@alunza/contracts';
import type { Response } from 'express';
import type { ApiRequest } from '../http/errors';
import { AuthGuard } from '../identity/auth.guard';
import { GovernanceService } from './governance.service';
import {
  actor,
  idempotency,
  organizationPaginationSchema,
  memberPaginationSchema,
  parse,
  revision,
  uuid,
} from './governance.shared';

@Controller('api/v1/organizations')
@UseGuards(AuthGuard)
export class GovernanceController {
  constructor(private readonly governance: GovernanceService) {}
  @Get()
  async list(@Req() request: ApiRequest, @Query() query: unknown) {
    return organizationListResponseSchema.parse({
      ...(await this.governance.organizations(
        actor(request),
        parse(organizationPaginationSchema, query),
      )),
      requestId: request.requestId,
    });
  }
  @Post()
  async create(
    @Req() request: ApiRequest,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const data = await this.governance.createOrganization(
      actor(request),
      parse(organizationCreateSchema, body),
      idempotency(key),
    );
    response.setHeader('ETag', `"${data.revision}"`);
    return organizationResponseSchema.parse({
      data,
      requestId: request.requestId,
    });
  }
  @Patch(':orgId')
  async update(
    @Req() request: ApiRequest,
    @Param('orgId') orgId: string,
    @Body() body: unknown,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const data = await this.governance.updateOrganization(
      actor(request),
      uuid(orgId),
      parse(organizationUpdateSchema, body),
      revision(match),
    );
    response.setHeader('ETag', `"${data.revision}"`);
    return organizationResponseSchema.parse({
      data,
      requestId: request.requestId,
    });
  }
  @Post(':orgId/archive')
  @HttpCode(200)
  async archive(
    @Req() request: ApiRequest,
    @Param('orgId') orgId: string,
    @Body() body: unknown,
    @Headers('if-match') match: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const data = await this.governance.archiveOrganization(
      actor(request),
      uuid(orgId),
      parse(organizationArchiveSchema, body),
      revision(match),
      idempotency(key),
    );
    response.setHeader('ETag', `"${data.revision}"`);
    return organizationResponseSchema.parse({
      data,
      requestId: request.requestId,
    });
  }
  @Get(':orgId/members')
  async members(
    @Req() request: ApiRequest,
    @Param('orgId') orgId: string,
    @Query() query: unknown,
  ) {
    return memberListResponseSchema.parse({
      ...(await this.governance.members(
        actor(request),
        uuid(orgId),
        parse(memberPaginationSchema, query),
      )),
      requestId: request.requestId,
    });
  }
  @Patch(':orgId/members/:userId')
  async member(
    @Req() request: ApiRequest,
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
    @Body() body: unknown,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const data = await this.governance.updateMember(
      actor(request),
      uuid(orgId),
      uuid(userId),
      parse(memberUpdateSchema, body),
      revision(match),
    );
    response.setHeader('ETag', `"${data.revision}"`);
    return memberResponseSchema.parse({ data, requestId: request.requestId });
  }
}
