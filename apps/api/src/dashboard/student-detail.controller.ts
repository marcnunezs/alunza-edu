import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import * as c from '@alunza/contracts';
import { AuthGuard } from '../identity/auth.guard';
import {
  actor,
  parse,
  uuid as validateUuid,
} from '../governance/governance.shared';
import { answer } from '../http/responses';
import type { ApiRequest } from '../http/errors';
import { StudentDetailService } from './student-detail.service';

type Route = Record<string, string>;
const uuid = (value: string | undefined) =>
  validateUuid(value ?? '').toLowerCase();
const scope = (request: ApiRequest, params: Route) =>
  [actor(request), uuid(params.classId), uuid(params.studentId)] as const;

@Controller('api/v1/classes/:classId/students/:studentId')
@UseGuards(AuthGuard)
export class StudentDetailController {
  constructor(private readonly service: StudentDetailService) {}

  @Get('progress')
  async progress(
    @Req() req: ApiRequest,
    @Param() params: Route,
    @Query() query: unknown,
  ) {
    return answer(
      c.studentDetailProgressResponseSchema,
      await this.service.progress(
        ...scope(req, params),
        parse(c.studentDetailQuerySchema, query),
      ),
      req,
    );
  }

  @Get('evidence')
  async evidence(
    @Req() req: ApiRequest,
    @Param() params: Route,
    @Query() query: unknown,
  ) {
    return answer(
      c.studentDetailEvidenceResponseSchema,
      await this.service.evidence(
        ...scope(req, params),
        parse(c.studentDetailEvidenceQuerySchema, query),
      ),
      req,
    );
  }

  @Get('attempts/:attemptId')
  async attempt(
    @Req() req: ApiRequest,
    @Param() params: Route,
    @Query() query: unknown,
  ) {
    return answer(
      c.studentDetailAttemptResponseSchema,
      await this.service.attempt(
        ...scope(req, params),
        uuid(params.attemptId),
        parse(c.studentDetailItemQuerySchema, query),
      ),
      req,
    );
  }

  @Get('attempts/:attemptId/feedback')
  async feedbackHistory(
    @Req() req: ApiRequest,
    @Param() params: Route,
    @Query() query: unknown,
  ) {
    return answer(
      c.studentDetailFeedbackHistoryResponseSchema,
      await this.service.feedbackHistory(
        ...scope(req, params),
        uuid(params.attemptId),
        parse(c.studentDetailFeedbackQuerySchema, query),
      ),
      req,
    );
  }

  @Get('feedback/:feedbackId')
  async feedback(
    @Req() req: ApiRequest,
    @Param() params: Route,
    @Query() query: unknown,
  ) {
    return answer(
      c.studentDetailFeedbackResponseSchema,
      await this.service.feedback(
        ...scope(req, params),
        uuid(params.feedbackId),
        parse(c.studentDetailItemQuerySchema, query),
      ),
      req,
    );
  }

  @Get('feedback/:feedbackId/sources/:chunkId')
  async reference(
    @Req() req: ApiRequest,
    @Param() params: Route,
    @Query() query: unknown,
  ) {
    return answer(
      c.studentDetailReferenceResponseSchema,
      await this.service.reference(
        ...scope(req, params),
        uuid(params.feedbackId),
        uuid(params.chunkId),
        parse(c.studentDetailItemQuerySchema, query),
      ),
      req,
    );
  }

  @Get('feedback/:feedbackId/sources/:chunkId/content')
  async content(
    @Req() req: ApiRequest,
    @Param() params: Route,
    @Query() query: unknown,
    @Res() res: Response,
  ) {
    const result = await this.service.content(
      ...scope(req, params),
      uuid(params.feedbackId),
      uuid(params.chunkId),
      parse(c.studentDetailItemQuerySchema, query),
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

  @Get('signals')
  async signals(
    @Req() req: ApiRequest,
    @Param() params: Route,
    @Query() query: unknown,
  ) {
    return answer(
      c.studentDetailSignalsResponseSchema,
      await this.service.signals(
        ...scope(req, params),
        parse(c.studentDetailSignalsQuerySchema, query),
      ),
      req,
    );
  }

  @Get('signals/:signalId')
  async signal(
    @Req() req: ApiRequest,
    @Param() params: Route,
    @Query() query: unknown,
  ) {
    return answer(
      c.studentDetailSignalResponseSchema,
      await this.service.signal(
        ...scope(req, params),
        uuid(params.signalId),
        parse(c.studentDetailItemQuerySchema, query),
      ),
      req,
    );
  }
}
