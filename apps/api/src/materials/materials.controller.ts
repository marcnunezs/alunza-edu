import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Injectable,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
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
import { answer } from '../http/responses';
import {
  MaterialsRepository,
  materialQuerySchema,
  materialChunkQuerySchema,
} from './materials.repository';
import { MaterialsService } from './materials.service';
type UploadedMaterial = { originalname: string; buffer: Buffer; size: number };

@Injectable()
export class MaterialUploadGuard implements CanActivate {
  constructor(private readonly repository: MaterialsRepository) {}
  async canActivate(context: ExecutionContext) {
    const r = context.switchToHttp().getRequest<ApiRequest>();
    const source = r.params.sourceId;
    await this.repository.authorizeUpload(
      actor(r),
      source ? null : uuid(String(r.params.classId)),
      source ? uuid(String(source)) : undefined,
    );
    return true;
  }
}
const uploadInterceptor = FileInterceptor('file', {
  defParamCharset: 'utf8',
  limits: {
    fileSize: contracts.MATERIAL_MAX_BYTES,
    files: 1,
    fields: 2,
    // Busboy emits partsLimit when it reaches the threshold, including a
    // valid final part. files/fields still enforce one file and two fields.
    parts: 4,
    fieldSize: 1000,
  },
});
@Controller('api/v1')
@UseGuards(AuthGuard)
export class MaterialsController {
  constructor(private readonly service: MaterialsService) {}
  @Get('classes/:classId/sources')
  async list(
    @Req() r: ApiRequest,
    @Param('classId') cls: string,
    @Query() q: unknown,
  ) {
    return contracts.materialSourceListResponseSchema.parse({
      ...(await this.service.list(
        actor(r),
        uuid(cls),
        parse(materialQuerySchema, q),
      )),
      requestId: r.requestId,
    });
  }
  @Get('classes/:classId/source-scopes')
  async scopes(
    @Req() r: ApiRequest,
    @Param('classId') cls: string,
    @Query() q: unknown,
  ) {
    return contracts.materialScopeListResponseSchema.parse({
      ...(await this.service.scopes(
        actor(r),
        uuid(cls),
        parse(materialQuerySchema, q),
      )),
      requestId: r.requestId,
    });
  }
  @Get('sources/:sourceId')
  async detail(
    @Req() r: ApiRequest,
    @Param('sourceId') source: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    return answer(
      contracts.materialSourceResponseSchema,
      await this.service.detail(actor(r), uuid(source)),
      r,
      res,
    );
  }
  @Post('classes/:classId/sources')
  @HttpCode(202)
  @UseGuards(MaterialUploadGuard)
  @UseInterceptors(uploadInterceptor)
  async upload(
    @Req() r: ApiRequest,
    @Param('classId') cls: string,
    @Body() body: unknown,
    @UploadedFile() file: UploadedMaterial | undefined,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    return answer(
      contracts.materialOperationResponseSchema,
      await this.service.upload(
        actor(r),
        uuid(cls),
        null,
        null,
        parse(contracts.materialUploadInputSchema, body),
        file,
        idempotency(key),
      ),
      r,
    );
  }
  @Get('sources/:sourceId/versions')
  async versions(
    @Req() r: ApiRequest,
    @Param('sourceId') source: string,
    @Query() q: unknown,
  ) {
    return contracts.materialVersionListResponseSchema.parse({
      ...(await this.service.versions(
        actor(r),
        uuid(source),
        parse(materialQuerySchema, q),
      )),
      requestId: r.requestId,
    });
  }
  @Post('sources/:sourceId/versions')
  @HttpCode(202)
  @UseGuards(MaterialUploadGuard)
  @UseInterceptors(uploadInterceptor)
  async replace(
    @Req() r: ApiRequest,
    @Param('sourceId') source: string,
    @Body() body: unknown,
    @UploadedFile() file: UploadedMaterial | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('if-match') match: string | undefined,
  ) {
    return answer(
      contracts.materialOperationResponseSchema,
      await this.service.upload(
        actor(r),
        null,
        uuid(source),
        revision(match),
        parse(z.strictObject({}), body),
        file,
        idempotency(key),
      ),
      r,
    );
  }
  @Get('sources/:sourceId/versions/:versionId/chunks')
  async chunks(
    @Req() r: ApiRequest,
    @Param('sourceId') source: string,
    @Param('versionId') version: string,
    @Query() q: unknown,
  ) {
    return contracts.materialChunkListResponseSchema.parse({
      ...(await this.service.chunks(
        actor(r),
        uuid(source),
        uuid(version),
        parse(materialChunkQuerySchema, q),
      )),
      requestId: r.requestId,
    });
  }
  @Post('sources/:sourceId/reindex')
  @HttpCode(202)
  async reindex(
    @Req() r: ApiRequest,
    @Param('sourceId') source: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('if-match') match: string | undefined,
  ) {
    return answer(
      contracts.materialOperationResponseSchema,
      await this.service.reindex(
        actor(r),
        uuid(source),
        parse(contracts.materialReindexInputSchema, body).versionId,
        revision(match),
        idempotency(key),
      ),
      r,
    );
  }
  @Patch('sources/:sourceId/visibility')
  async visibility(
    @Req() r: ApiRequest,
    @Param('sourceId') source: string,
    @Body() body: unknown,
    @Headers('if-match') match: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return answer(
      contracts.materialSourceResponseSchema,
      await this.service.visibility(
        actor(r),
        uuid(source),
        parse(contracts.materialVisibilityInputSchema, body).visible,
        revision(match),
      ),
      r,
      res,
    );
  }
  @Post('sources/:sourceId/archive')
  @HttpCode(200)
  async archive(
    @Req() r: ApiRequest,
    @Param('sourceId') source: string,
    @Body() body: unknown,
    @Headers('if-match') match: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return answer(
      contracts.materialSourceResponseSchema,
      await this.service.archive(
        actor(r),
        uuid(source),
        parse(contracts.materialArchiveInputSchema, body).reason,
        revision(match),
        idempotency(key),
      ),
      r,
      res,
    );
  }
  @Get('sources/:sourceId/jobs/:jobId')
  async job(
    @Req() r: ApiRequest,
    @Param('sourceId') source: string,
    @Param('jobId') id: string,
  ) {
    return answer(
      contracts.materialJobResponseSchema,
      await this.service.job(actor(r), uuid(source), uuid(id)),
      r,
    );
  }
  @Get('sources/:sourceId/versions/:versionId/content')
  async content(
    @Req() r: ApiRequest,
    @Param('sourceId') source: string,
    @Param('versionId') version: string,
    @Res() res: Response,
  ) {
    const result = await this.service.content(
      actor(r),
      uuid(source),
      uuid(version),
    );
    res.setHeader('Content-Type', result.mimeType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="material.${result.mimeType === 'application/pdf' ? 'pdf' : result.mimeType === 'text/markdown' ? 'md' : 'txt'}"; filename*=UTF-8''${encodeURIComponent(result.fileName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16)}`)}`,
    );
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Length', result.bytes.length);
    res.send(Buffer.from(result.bytes));
  }
}
