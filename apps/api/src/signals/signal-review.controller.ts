import {
  Body,
  Controller,
  Param,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  signalReviewInputSchema,
  signalReviewQuerySchema,
  signalReviewResponseSchema,
} from '@alunza/contracts';
import { AuthGuard } from '../identity/auth.guard';
import { actor, parse, uuid } from '../governance/governance.shared';
import type { ApiRequest } from '../http/errors';
import { SignalReviewService } from './signal-review.service';

@Controller('api/v1/signals')
@UseGuards(AuthGuard)
export class SignalReviewController {
  constructor(private readonly service: SignalReviewService) {}

  @Put(':id/review')
  async review(
    @Req() request: ApiRequest,
    @Param('id') signalId: string,
    @Body() body: unknown,
    @Query() query: unknown,
  ) {
    const who = actor(request);
    const id = uuid(signalId).toLowerCase();
    parse(signalReviewInputSchema, body);
    parse(signalReviewQuerySchema, query);
    return signalReviewResponseSchema.parse({
      data: await this.service.review(who, id),
      requestId: request.requestId,
    });
  }
}
