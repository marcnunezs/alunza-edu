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
import { AcademicService } from './academic.service';
import { academicPaginationSchema } from './academic.shared';
import { z } from 'zod';
import { answer } from '../http/responses';
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
    return contracts.courseListResponseSchema.parse({
      ...(await this.service.courses(
        actor(r),
        uuid(org),
        parse(academicPaginationSchema, q),
      )),
      requestId: r.requestId,
    });
  }
  @Post('organizations/:orgId/courses')
  async createCourse(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return answer(
      contracts.courseResponseSchema,
      await this.service.createCourse(
        actor(r),
        uuid(org),
        parse(contracts.courseCreateSchema, body),
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
    return answer(
      contracts.courseResponseSchema,
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
    return answer(
      contracts.courseResponseSchema,
      await this.service.updateCourse(
        actor(r),
        uuid(id),
        parse(contracts.courseUpdateSchema, body),
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
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return answer(
      contracts.courseResponseSchema,
      await this.service.archive(
        actor(r),
        'course',
        uuid(id),
        parse(contracts.academicArchiveSchema, body).reason,
        revision(match),
        idempotency(key),
      ),
      r,
      res,
    );
  }
  @Get('courses/:id/teachers')
  async teachers(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Query() q: unknown,
  ) {
    return contracts.courseTeacherListResponseSchema.parse({
      ...(await this.service.courseTeachers(
        actor(r),
        uuid(id),
        parse(academicPaginationSchema, q),
      )),
      requestId: r.requestId,
    });
  }
  @Put('courses/:id/teachers/:teacherId')
  async grant(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Param('teacherId') teacher: string,
    @Body() body: unknown,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return answer(
      contracts.courseResponseSchema,
      await this.service.grantTeacher(
        actor(r),
        uuid(id),
        uuid(teacher),
        parse(contracts.courseTeacherGrantSchema, body).enabled,
        revision(match),
      ),
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
    return contracts.classListResponseSchema.parse({
      ...(await this.service.classes(
        actor(r),
        uuid(org),
        parse(academicPaginationSchema, q),
      )),
      requestId: r.requestId,
    });
  }
  @Post('organizations/:orgId/classes')
  async createClass(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return answer(
      contracts.classResponseSchema,
      await this.service.createClass(
        actor(r),
        uuid(org),
        parse(contracts.classCreateSchema, body),
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
    return answer(
      contracts.classResponseSchema,
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
    return answer(
      contracts.classResponseSchema,
      await this.service.updateClass(
        actor(r),
        uuid(id),
        parse(contracts.classUpdateSchema, body),
        revision(match),
      ),
      r,
      res,
    );
  }
  @Put('classes/:id/teacher')
  async assign(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return answer(
      contracts.classResponseSchema,
      await this.service.assignTeacher(
        actor(r),
        uuid(id),
        parse(contracts.teacherAssignmentSchema, body).teacherId,
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
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return answer(
      contracts.classResponseSchema,
      await this.service.archive(
        actor(r),
        'class',
        uuid(id),
        parse(contracts.academicArchiveSchema, body).reason,
        revision(match),
        idempotency(key),
      ),
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
    return contracts.joinCodeListResponseSchema.parse({
      ...(await this.service.codes(
        actor(r),
        uuid(id),
        parse(academicPaginationSchema, q),
      )),
      requestId: r.requestId,
    });
  }
  @Post('classes/:id/join-codes')
  async issueCode(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('if-match') match: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return answer(
      contracts.joinCodeResponseSchema,
      await this.service.issueCode(
        actor(r),
        uuid(id),
        parse(contracts.joinCodeCreateSchema, body).expiresAt,
        revision(match),
        idempotency(key),
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
    @Param('codeId') code: string,
    @Body() body: unknown,
    @Headers('if-match') match: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    parse(z.strictObject({}), body ?? {});
    return answer(
      contracts.joinCodeResponseSchema,
      await this.service.revokeCode(
        actor(r),
        uuid(id),
        uuid(code),
        revision(match),
        idempotency(key),
      ),
      r,
      res,
    );
  }
  @Post('class-enrollments/preview')
  @HttpCode(200)
  async preview(@Req() r: ApiRequest, @Body() body: unknown) {
    return answer(
      contracts.enrollmentResponseSchema,
      await this.service.enrollment(
        actor(r),
        parse(contracts.enrollmentInputSchema, body).code,
      ),
      r,
    );
  }
  @Post('class-enrollments')
  @HttpCode(200)
  async enroll(
    @Req() r: ApiRequest,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    return answer(
      contracts.enrollmentResponseSchema,
      await this.service.enrollment(
        actor(r),
        parse(contracts.enrollmentInputSchema, body).code,
        idempotency(key),
      ),
      r,
    );
  }
  @Get('classes/:id/students')
  async students(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Query() q: unknown,
  ) {
    return contracts.classStudentListResponseSchema.parse({
      ...(await this.service.students(
        actor(r),
        uuid(id),
        parse(academicPaginationSchema, q),
      )),
      requestId: r.requestId,
    });
  }
}
