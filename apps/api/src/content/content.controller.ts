import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import * as contracts from '@alunza/contracts';
import type { Response } from 'express';
import type { ApiRequest } from '../http/errors';
import { AuthGuard } from '../identity/auth.guard';
import {
  actor,
  idempotency,
  parse,
  revision,
  uuid,
} from '../governance/governance.shared';
import {
  academicPaginationSchema,
  exercisePaginationSchema,
} from '../academic/academic.shared';
import { answer } from '../http/responses';
import { ContentService } from './content.service';

@Controller('api/v1')
@UseGuards(AuthGuard)
export class ContentController {
  constructor(private readonly service: ContentService) {}
  @Get('organizations/:orgId/concepts')
  async concepts(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Query() q: unknown,
  ) {
    return contracts.conceptListResponseSchema.parse({
      ...(await this.service.concepts(
        actor(r),
        uuid(org),
        parse(academicPaginationSchema, q),
      )),
      requestId: r.requestId,
    });
  }
  @Get('concepts/:id')
  async concept(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    return answer(
      contracts.conceptResponseSchema,
      await this.service.getConcept(actor(r), uuid(id)),
      r,
      res,
    );
  }
  @Post('organizations/:orgId/concepts')
  async createConcept(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return answer(
      contracts.conceptResponseSchema,
      await this.service.createConcept(
        actor(r),
        uuid(org),
        parse(contracts.conceptCreateSchema, body),
        idempotency(key),
      ),
      r,
      res,
    );
  }
  @Patch('concepts/:id')
  async updateConcept(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return answer(
      contracts.conceptResponseSchema,
      await this.service.updateConcept(
        actor(r),
        uuid(id),
        parse(contracts.conceptUpdateSchema, body),
        revision(match),
      ),
      r,
      res,
    );
  }
  @Post('concepts/:id/archive')
  @HttpCode(200)
  async archiveConcept(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('if-match') match: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return answer(
      contracts.conceptResponseSchema,
      await this.service.archiveConcept(
        actor(r),
        uuid(id),
        parse(contracts.academicArchiveSchema, body).reason,
        revision(match),
        idempotency(key),
      ),
      r,
      res,
    );
  }
  @Get('organizations/:orgId/exercises')
  async exercises(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Query() q: unknown,
  ) {
    return contracts.exerciseListResponseSchema.parse({
      ...(await this.service.exercises(
        actor(r),
        uuid(org),
        parse(exercisePaginationSchema, q),
      )),
      requestId: r.requestId,
    });
  }
  @Get('exercises/:id')
  async exercise(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    return answer(
      contracts.exerciseResponseSchema,
      await this.service.getExercise(actor(r), uuid(id)),
      r,
      res,
    );
  }
  @Post('organizations/:orgId/exercises')
  async createExercise(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return answer(
      contracts.exerciseResponseSchema,
      await this.service.createExercise(
        actor(r),
        uuid(org),
        parse(contracts.exerciseVersionInputSchema, body),
        idempotency(key),
      ),
      r,
      res,
    );
  }
  @Get('exercises/:id/versions')
  async versions(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Query() q: unknown,
  ) {
    return contracts.exerciseVersionListResponseSchema.parse({
      ...(await this.service.versions(
        actor(r),
        uuid(id),
        parse(academicPaginationSchema, q),
      )),
      requestId: r.requestId,
    });
  }
  @Post('exercises/:id/versions')
  async createVersion(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('if-match') match: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    return answer(
      contracts.exerciseVersionResponseSchema,
      await this.service.createVersion(
        actor(r),
        uuid(id),
        parse(contracts.exerciseVersionInputSchema, body),
        revision(match),
        idempotency(key),
      ),
      r,
    );
  }
  @Post('exercises/:id/archive')
  @HttpCode(200)
  async archiveExercise(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('if-match') match: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return answer(
      contracts.exerciseResponseSchema,
      await this.service.archiveExercise(
        actor(r),
        uuid(id),
        parse(contracts.academicArchiveSchema, body).reason,
        revision(match),
        idempotency(key),
      ),
      r,
      res,
    );
  }
}
