import {
  Body,
  Controller,
  Get,
  Head,
  Headers,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import {
  auditExportRequestSchema,
  auditExportResponseSchema,
} from '@alunza/contracts';
import type { AuditExportMetadata } from '@alunza/contracts';
import {
  actor,
  idempotency,
  parse,
  uuid,
} from '../governance/governance.shared';
import type { ApiRequest } from '../http/errors';
import { AuthGuard } from '../identity/auth.guard';
import { AuditExportService } from './audit-export.service';

const noQuery = z.strictObject({});
export function exportHeaders(
  response: Response,
  metadata: AuditExportMetadata,
) {
  response.setHeader('Content-Type', 'text/csv; charset=utf-8');
  response.setHeader('Content-Length', metadata.byteLength);
  response.setHeader(
    'Content-Disposition',
    `attachment; filename="${metadata.fileName}"`,
  );
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
}

// Observe the terminal event synchronously: close can follow finish before its
// asynchronous transaction resolves. Only the first event owns the ticket.
export function observeDelivery(
  response: Response,
  finish: (outcome: 'FINISHED' | 'ABORTED') => Promise<unknown>,
  release: () => void,
) {
  let settled = false;
  const settle = (outcome: 'FINISHED' | 'ABORTED') => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    response.off('finish', finished);
    response.off('close', closed);
    release();
    // A failed callback remains PENDING for maintenance to classify UNKNOWN.
    void finish(outcome).catch(() => undefined);
  };
  const finished = () => settle('FINISHED');
  const closed = () => settle('ABORTED');
  const timer = setTimeout(() => {
    settle('ABORTED');
    response.destroy();
  }, 30_000);
  timer.unref();
  response.once('finish', finished);
  response.once('close', closed);
  if (response.destroyed) closed();
  return { aborted: () => settle('ABORTED') };
}

@Controller('api/v1/organizations/:orgId/audit-exports')
@UseGuards(AuthGuard)
export class AuditExportController {
  constructor(private readonly service: AuditExportService) {}
  @Post()
  async create(
    @Req() request: ApiRequest,
    @Param('orgId') org: string,
    @Headers('idempotency-key') key: string | undefined,
    @Query() query: unknown,
    @Body() body: unknown,
  ) {
    parse(noQuery, query);
    const data = await this.service.create(
      actor(request),
      uuid(org),
      idempotency(key),
      parse(auditExportRequestSchema, body),
    );
    const result = auditExportResponseSchema.parse({
      data,
      requestId: request.requestId,
    });
    request.auditOrganizationId = data.organizationId;
    return result;
  }
  @Get(':exportId')
  async metadata(
    @Req() request: ApiRequest,
    @Param('orgId') org: string,
    @Param('exportId') id: string,
    @Query() query: unknown,
  ) {
    parse(noQuery, query);
    const data = await this.service.metadata(
      actor(request),
      uuid(org),
      uuid(id),
    );
    const result = auditExportResponseSchema.parse({
      data,
      requestId: request.requestId,
    });
    request.auditOrganizationId = data.organizationId;
    return result;
  }
  @Head(':exportId/content')
  async head(
    @Req() request: ApiRequest,
    @Res() response: Response,
    @Param('orgId') org: string,
    @Param('exportId') id: string,
    @Query() query: unknown,
  ) {
    parse(noQuery, query);
    const data = await this.service.metadata(
      actor(request),
      uuid(org),
      uuid(id),
    );
    request.auditOrganizationId = data.organizationId;
    exportHeaders(response, data);
    response.status(200).end();
  }
  @Get(':exportId/content')
  async content(
    @Req() request: ApiRequest,
    @Res() response: Response,
    @Param('orgId') org: string,
    @Param('exportId') id: string,
    @Query() query: unknown,
  ) {
    parse(noQuery, query);
    const result = await this.service.content(
      actor(request),
      uuid(org),
      uuid(id),
    );
    request.auditOrganizationId = result.metadata.organizationId;
    const observer = observeDelivery(
      response,
      (outcome) => this.service.finishDelivery(result.ticket, outcome),
      result.release,
    );
    if (response.destroyed) return;
    try {
      exportHeaders(response, result.metadata);
      response.status(200).end(result.bytes);
    } catch (error) {
      observer.aborted();
      throw error;
    }
  }
}
