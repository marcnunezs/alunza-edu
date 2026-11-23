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
import type { Response } from 'express';
import * as c from '@alunza/contracts';
import type { ApiRequest } from '../http/errors';
import { answer } from '../http/responses';
import {
  actor,
  idempotency,
  parse,
  uuid,
} from '../governance/governance.shared';
import { AuthGuard } from '../identity/auth.guard';
import { HelpRepository } from './help.repository';
import { HelpService } from './help.service';

@Controller('api/v1')
@UseGuards(AuthGuard)
export class HelpController {
  constructor(
    private readonly repository: HelpRepository,
    private readonly service: HelpService,
  ) {}

  @Post('attempts/:attemptId/feedback-requests')
  @HttpCode(202)
  async request(
    @Req() req: ApiRequest,
    @Param('attemptId') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    return answer(
      c.helpRequestResponseSchema,
      await this.repository.request(
        actor(req),
        uuid(id),
        parse(c.helpRequestInputSchema, body),
        idempotency(key),
      ),
      req,
    );
  }

  @Get('feedback-requests/:id')
  async requestStatus(@Req() req: ApiRequest, @Param('id') id: string) {
    return answer(
      c.helpRequestResponseSchema,
      await this.repository.requestStatus(actor(req), uuid(id)),
      req,
    );
  }

  @Get('attempts/:attemptId/feedback')
  async history(
    @Req() req: ApiRequest,
    @Param('attemptId') id: string,
    @Query() query: unknown,
  ) {
    return answer(
      c.helpHistoryResponseSchema,
      await this.repository.history(
        actor(req),
        uuid(id),
        parse(c.helpHistoryQuerySchema, query),
      ),
      req,
    );
  }

  @Get('feedback/:id')
  async feedback(@Req() req: ApiRequest, @Param('id') id: string) {
    return answer(
      c.helpFeedbackResponseSchema,
      await this.repository.feedback(actor(req), uuid(id)),
      req,
    );
  }

  @Post('feedback/:id/viewed')
  @HttpCode(200)
  async viewed(
    @Req() req: ApiRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return answer(
      c.helpFeedbackResponseSchema,
      await this.repository.viewed(
        actor(req),
        uuid(id),
        parse(c.helpViewedInputSchema, body).presentationToken,
      ),
      req,
    );
  }

  @Get('feedback/:id/sources/:chunkId')
  async reference(
    @Req() req: ApiRequest,
    @Param('id') id: string,
    @Param('chunkId') chunk: string,
  ) {
    return answer(
      c.helpReferenceResponseSchema,
      await this.service.reference(actor(req), uuid(id), uuid(chunk)),
      req,
    );
  }

  @Get('feedback/:id/sources/:chunkId/content')
  async content(
    @Req() req: ApiRequest,
    @Param('id') id: string,
    @Param('chunkId') chunk: string,
    @Res() res: Response,
  ) {
    const result = await this.service.content(
      actor(req),
      uuid(id),
      uuid(chunk),
    );
    res.setHeader('Content-Type', result.mimeType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="referencia.${result.mimeType === 'application/pdf' ? 'pdf' : result.mimeType === 'text/markdown' ? 'md' : 'txt'}"; filename*=UTF-8''${encodeURIComponent(result.fileName).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16)}`)}`,
    );
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Length', result.bytes.length);
    res.send(Buffer.from(result.bytes));
  }
}
