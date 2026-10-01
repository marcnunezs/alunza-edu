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
import type { Response } from 'express';
import * as c from '@alunza/contracts';
import type { ApiRequest } from '../http/errors';
import { AuthGuard } from '../identity/auth.guard';
import {
  actor,
  idempotency,
  parse,
  revision,
  uuid,
} from '../governance/governance.shared';
import { ContentService } from './content.service';
import { listing, result } from './academic.controller';

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
    return listing(
      c.conceptListResponseSchema,
      await this.service.concepts(
        actor(r),
        uuid(org),
        parse(c.academicPageQuerySchema, q),
      ),
      r,
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
    return result(
      c.conceptResponseSchema,
      await this.service.createConcept(
        actor(r),
        uuid(org),
        parse(c.conceptInputSchema, body),
        idempotency(key),
      ),
      r,
      res,
    );
  }
  @Get('concepts/:id')
  async concept(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    return result(
      c.conceptResponseSchema,
      await this.service.concept(actor(r), uuid(id)),
      r,
      res,
    );
  }
  @Get('concepts/:id/versions')
  async conceptVersions(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Query() q: unknown,
  ) {
    return listing(
      c.conceptVersionListResponseSchema,
      await this.service.conceptVersions(
        actor(r),
        uuid(id),
        parse(c.academicPageQuerySchema, q),
      ),
      r,
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
    return result(
      c.conceptResponseSchema,
      await this.service.updateConcept(
        actor(r),
        uuid(id),
        parse(c.conceptUpdateSchema, body),
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
    @Res({ passthrough: true }) res: Response,
  ) {
    parse(c.academicArchiveSchema, body ?? {});
    return result(
      c.conceptResponseSchema,
      await this.service.archiveConcept(actor(r), uuid(id), revision(match)),
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
    return listing(
      c.exerciseListResponseSchema,
      await this.service.exercises(
        actor(r),
        uuid(org),
        parse(c.academicPageQuerySchema, q),
      ),
      r,
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
    return result(
      c.exerciseResponseSchema,
      await this.service.createExercise(
        actor(r),
        uuid(org),
        parse(c.exerciseCreateSchema, body),
        idempotency(key),
      ),
      r,
      res,
    );
  }
  @Get('exercises/:id')
  async exercise(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    return result(
      c.exerciseResponseSchema,
      await this.service.exercise(actor(r), uuid(id)),
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
    return listing(
      c.exerciseVersionListResponseSchema,
      await this.service.versions(
        actor(r),
        uuid(id),
        parse(c.academicPageQuerySchema, q),
      ),
      r,
    );
  }
  @Post('exercises/:id/versions')
  async createVersion(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('if-match') match: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return result(
      c.exerciseResponseSchema,
      await this.service.createVersion(
        actor(r),
        uuid(id),
        parse(c.exerciseVersionInputSchema, body),
        revision(match),
        idempotency(key),
      ),
      r,
      res,
    );
  }
  @Post('exercises/:id/archive')
  @HttpCode(200)
  async archiveExercise(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    parse(c.academicArchiveSchema, body ?? {});
    return result(
      c.exerciseArchiveResponseSchema,
      await this.service.archiveExercise(actor(r), uuid(id), revision(match)),
      r,
      res,
    );
  }
}
