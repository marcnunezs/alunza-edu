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
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  invitationCreateSchema,
  invitationAcceptSchema,
  invitationProofSchema,
  invitationResponseSchema,
  invitationListResponseSchema,
  invitationAcceptanceResponseSchema,
} from '@alunza/contracts';
import type { Response } from 'express';
import { z } from 'zod';
import type { ApiRequest } from '../http/errors';
import { AuthGuard } from '../identity/auth.guard';
import {
  actor,
  idempotency,
  invitationPaginationSchema,
  parse,
  revision,
  uuid,
} from './governance.shared';
import { InvitationService } from './invitation.service';

@Controller('api/v1')
export class InvitationController {
  constructor(private readonly invitations: InvitationService) {}
  @Get('organizations/:orgId/invitations')
  @UseGuards(AuthGuard)
  async list(
    @Req() request: ApiRequest,
    @Param('orgId') orgId: string,
    @Query() query: unknown,
  ) {
    return invitationListResponseSchema.parse({
      ...(await this.invitations.list(
        actor(request),
        uuid(orgId),
        parse(invitationPaginationSchema, query),
      )),
      requestId: request.requestId,
    });
  }
  @Get('organizations/:orgId/invitations/:id')
  @UseGuards(AuthGuard)
  async get(
    @Req() request: ApiRequest,
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const data = await this.invitations.get(
      actor(request),
      uuid(orgId),
      uuid(id),
    );
    response.setHeader('ETag', `"${data.revision}"`);
    return invitationResponseSchema.parse({
      data,
      requestId: request.requestId,
    });
  }
  @Post('organizations/:orgId/invitations')
  @UseGuards(AuthGuard)
  @HttpCode(202)
  async create(
    @Req() request: ApiRequest,
    @Param('orgId') orgId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const data = await this.invitations.create(
      actor(request),
      uuid(orgId),
      parse(invitationCreateSchema, body),
      idempotency(key),
    );
    response.setHeader('ETag', `"${data.revision}"`);
    return invitationResponseSchema.parse({
      data,
      requestId: request.requestId,
    });
  }
  @Post('organizations/:orgId/invitations/:id/resend')
  @UseGuards(AuthGuard)
  @HttpCode(202)
  async resend(
    @Req() request: ApiRequest,
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    parse(z.strictObject({}), body ?? {});
    const data = await this.invitations.change(
      actor(request),
      uuid(orgId),
      uuid(id),
      'resend',
      revision(match),
      idempotency(key),
    );
    response.setHeader('ETag', `"${data.revision}"`);
    return invitationResponseSchema.parse({
      data,
      requestId: request.requestId,
    });
  }
  @Post('organizations/:orgId/invitations/:id/revoke')
  @UseGuards(AuthGuard)
  @HttpCode(200)
  async revoke(
    @Req() request: ApiRequest,
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    parse(z.strictObject({}), body ?? {});
    const data = await this.invitations.change(
      actor(request),
      uuid(orgId),
      uuid(id),
      'revoke',
      revision(match),
      idempotency(key),
    );
    response.setHeader('ETag', `"${data.revision}"`);
    return invitationResponseSchema.parse({
      data,
      requestId: request.requestId,
    });
  }
  @Post('invitations/:id/accept')
  @UseGuards(AuthGuard)
  @HttpCode(200)
  async accept(
    @Req() request: ApiRequest,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    const data = await this.invitations.accept(
      actor(request),
      uuid(id),
      parse(invitationAcceptSchema, body),
      idempotency(key),
    );
    return invitationAcceptanceResponseSchema.parse({
      data,
      requestId: request.requestId,
    });
  }
  @Post('invitations/:id/renew-auth')
  @HttpCode(202)
  async renew(
    @Req() request: ApiRequest,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    const data = await this.invitations.renew(
      uuid(id),
      parse(invitationProofSchema, body),
      idempotency(key),
      request.requestId,
    );
    return invitationResponseSchema.parse({
      data,
      requestId: request.requestId,
    });
  }
}
