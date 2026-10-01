import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
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
import { AcademicService } from './academic.service';

export function result<T extends z.ZodType>(
  schema: T,
  data: unknown,
  request: ApiRequest,
  response?: Response,
) {
  if (response && data && typeof data === 'object' && 'revision' in data)
    response.setHeader('ETag', `"${data.revision}"`);
  return schema.parse({ data, requestId: request.requestId });
}
export function listing<T extends z.ZodType>(
  schema: T,
  data: { data: unknown; page: unknown },
  request: ApiRequest,
) {
  return schema.parse({ ...data, requestId: request.requestId });
}

@Controller('api/v1')
@UseGuards(AuthGuard)
export class AcademicController {
  constructor(private readonly service: AcademicService) {}
  @Get('organizations/:orgId/courses')
  async courses(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Query() q: unknown,
  ) {
    return listing(
      c.courseListResponseSchema,
      await this.service.courses(
        actor(r),
        uuid(org),
        parse(c.academicPageQuerySchema, q),
      ),
      r,
    );
  }
  @Post('organizations/:orgId/courses')
  async createCourse(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return result(
      c.courseResponseSchema,
      await this.service.createCourse(
        actor(r),
        uuid(org),
        parse(c.courseCreateSchema, body),
        idempotency(key),
      ),
      r,
      res,
    );
  }
  @Get('courses/:id')
  async course(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    return result(
      c.courseResponseSchema,
      await this.service.course(actor(r), uuid(id)),
      r,
      res,
    );
  }
  @Patch('courses/:id')
  async updateCourse(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return result(
      c.courseResponseSchema,
      await this.service.updateCourse(
        actor(r),
        uuid(id),
        parse(c.courseUpdateSchema, body),
        revision(match),
      ),
      r,
      res,
    );
  }
  @Post('courses/:id/archive')
  @HttpCode(200)
  async archiveCourse(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    parse(c.academicArchiveSchema, body ?? {});
    return result(
      c.courseResponseSchema,
      await this.service.archiveCourse(actor(r), uuid(id), revision(match)),
      r,
      res,
    );
  }
  @Get('organizations/:orgId/classes')
  async classes(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Query() q: unknown,
  ) {
    return listing(
      c.academicClassListResponseSchema,
      await this.service.classes(
        actor(r),
        uuid(org),
        parse(c.academicPageQuerySchema, q),
      ),
      r,
    );
  }
  @Post('organizations/:orgId/classes')
  async createClass(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return result(
      c.academicClassResponseSchema,
      await this.service.createClass(
        actor(r),
        uuid(org),
        parse(c.classCreateSchema, body),
        idempotency(key),
      ),
      r,
      res,
    );
  }
  @Get('classes/:id')
  async class(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    return result(
      c.academicClassResponseSchema,
      await this.service.class(actor(r), uuid(id)),
      r,
      res,
    );
  }
  @Patch('classes/:id')
  async updateClass(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return result(
      c.academicClassResponseSchema,
      await this.service.updateClass(
        actor(r),
        uuid(id),
        parse(c.classUpdateSchema, body),
        revision(match),
      ),
      r,
      res,
    );
  }
  @Put('classes/:id/teacher')
  async teacher(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return result(
      c.academicClassResponseSchema,
      await this.service.assignTeacher(
        actor(r),
        uuid(id),
        parse(c.classTeacherSchema, body).teacherId,
        revision(match),
      ),
      r,
      res,
    );
  }
  @Post('classes/:id/archive')
  @HttpCode(200)
  async archiveClass(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    parse(c.academicArchiveSchema, body ?? {});
    return result(
      c.academicClassResponseSchema,
      await this.service.archiveClass(actor(r), uuid(id), revision(match)),
      r,
      res,
    );
  }
  @Get('classes/:id/join-codes')
  async codes(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Query() q: unknown,
  ) {
    return listing(
      c.joinCodeListResponseSchema,
      await this.service.codes(
        actor(r),
        uuid(id),
        parse(c.academicPageQuerySchema, q),
      ),
      r,
    );
  }
  @Post('classes/:id/join-codes')
  async issueCode(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return result(
      c.issuedJoinCodeResponseSchema,
      await this.service.issueCode(
        actor(r),
        uuid(id),
        parse(c.joinCodeCreateSchema, body).expiresAt,
      ),
      r,
      res,
    );
  }
  @Post('classes/:id/join-codes/:codeId/revoke')
  @HttpCode(200)
  async revokeCode(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Param('codeId') codeId: string,
    @Body() body: unknown,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    parse(c.academicArchiveSchema, body ?? {});
    return result(
      c.joinCodeResponseSchema,
      await this.service.revokeCode(
        actor(r),
        uuid(id),
        uuid(codeId),
        revision(match),
      ),
      r,
      res,
    );
  }
  @Post('class-enrollments/preview')
  @HttpCode(200)
  async preview(@Req() r: ApiRequest, @Body() body: unknown) {
    const input = parse(c.classEnrollmentInputSchema, body);
    return result(
      c.classJoinPreviewResponseSchema,
      await this.service.previewEnrollment(
        actor(r),
        input.organizationId,
        input.code,
      ),
      r,
    );
  }
  @Post('class-enrollments')
  async enroll(
    @Req() r: ApiRequest,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    const input = parse(c.classEnrollmentInputSchema, body);
    return result(
      c.classEnrollmentResponseSchema,
      await this.service.enroll(
        actor(r),
        input.organizationId,
        input.code,
        idempotency(key),
      ),
      r,
    );
  }
}
