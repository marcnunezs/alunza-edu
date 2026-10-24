import {
  Body,
  Controller,
  Headers,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  RUN_CODE_BYTES,
  runExecutionInputSchema,
  runExecutionResponseSchema,
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
import { PracticeService } from './practice.service';

@Controller('api/v1')
@UseGuards(AuthGuard)
export class PracticeController {
  constructor(private readonly service: PracticeService) {}

  @Post('activities/:id/exercises/:assignmentId/executions')
  async run(
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
    return runExecutionResponseSchema.parse({
      data: await this.service.run(
        actor(request),
        uuid(activity),
        uuid(assignment),
        parse(runExecutionInputSchema, body),
        idempotency(key),
      ),
      requestId: request.requestId,
    });
  }
}
