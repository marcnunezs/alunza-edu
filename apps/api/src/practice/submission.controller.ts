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
  RUN_CODE_BYTES,
  activityProgressResponseSchema,
  attemptListQuerySchema,
  attemptListResponseSchema,
  attemptResponseSchema,
  submitAttemptInputSchema,
} from '@alunza/contracts';
import { AuthGuard } from '../identity/auth.guard';
import {
  actor,
  idempotency,
  parse,
  uuid,
} from '../governance/governance.shared';
import { ApiError } from '../http/errors';
import type { ApiRequest } from '../http/errors';
import { SubmissionService } from './submission.service';

@Controller('api/v1')
@UseGuards(AuthGuard)
export class SubmissionController {
  constructor(private readonly service: SubmissionService) {}

  @Post('activities/:id/exercises/:assignmentId/attempts')
  async submit(
    @Req() request: ApiRequest,
    @Param('id') activity: string,
    @Param('assignmentId') assignment: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    if (
      typeof body === 'object' &&
      body !== null &&
      'code' in body &&
      typeof body.code === 'string' &&
      Buffer.byteLength(body.code, 'utf8') > RUN_CODE_BYTES
    )
      throw new ApiError(
        'CODE_TOO_LARGE',
        'El código supera el límite de 65536 bytes.',
        413,
      );
    return attemptResponseSchema.parse({
      data: await this.service.submit(
        actor(request),
        uuid(activity),
        uuid(assignment),
        parse(submitAttemptInputSchema, body),
        idempotency(key),
      ),
      requestId: request.requestId,
    });
  }

  @Get('activities/:id/exercises/:assignmentId/attempts')
  async list(
    @Req() request: ApiRequest,
    @Param('id') activity: string,
    @Param('assignmentId') assignment: string,
    @Query() query: unknown,
  ) {
    return attemptListResponseSchema.parse({
      ...(await this.service.list(
        actor(request),
        uuid(activity),
        uuid(assignment),
        parse(attemptListQuerySchema, query),
      )),
      requestId: request.requestId,
    });
  }

  @Get('attempts/:id')
  async detail(@Req() request: ApiRequest, @Param('id') attempt: string) {
    return attemptResponseSchema.parse({
      data: await this.service.detail(actor(request), uuid(attempt)),
      requestId: request.requestId,
    });
  }

  @Get('activities/:id/progress')
  async progress(@Req() request: ApiRequest, @Param('id') activity: string) {
    return activityProgressResponseSchema.parse({
      data: await this.service.progress(actor(request), uuid(activity)),
      requestId: request.requestId,
    });
  }
}
