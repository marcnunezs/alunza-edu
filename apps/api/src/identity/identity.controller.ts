import { Controller, Get, Param, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import {
  meResponseSchema,
  organizationResponseSchema,
} from '@alunza/contracts';
import { z } from 'zod';
import { ApiError, unauthenticated } from '../http/errors';
import type { ApiRequest } from '../http/errors';
import { AuthGuard } from './auth.guard';
import { IdentityRepository } from './identity.repository';

@Controller('api/v1')
@UseGuards(AuthGuard)
export class IdentityController {
  constructor(private readonly identity: IdentityRepository) {}

  @Get('me')
  async me(@Req() request: ApiRequest) {
    if (!request.actorId) throw unauthenticated();
    return meResponseSchema.parse({
      data: await this.identity.me(request.actorId, request.sessionId),
      requestId: request.requestId,
    });
  }

  @Get('organizations/:orgId')
  async organization(
    @Param('orgId') orgId: string,
    @Req() request: ApiRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (!request.actorId) throw unauthenticated();
    if (!z.uuid().safeParse(orgId).success) {
      throw new ApiError(
        'INVALID_REQUEST',
        'El identificador no es válido.',
        400,
      );
    }
    const data = await this.identity.organization(
      request.actorId,
      orgId,
      request.sessionId,
    );
    response.setHeader('ETag', `"${data.revision}"`);
    return organizationResponseSchema.parse({
      data,
      requestId: request.requestId,
    });
  }
}
