import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { auditListResponseSchema, auditQuerySchema } from '@alunza/contracts';
import { actor, parse, uuid } from '../governance/governance.shared';
import type { ApiRequest } from '../http/errors';
import { AuthGuard } from '../identity/auth.guard';
import { AuditService } from './audit.service';

@Controller('api/v1')
@UseGuards(AuthGuard)
export class AuditController {
  constructor(private readonly service: AuditService) {}

  @Get('organizations/:orgId/audit-events')
  async list(
    @Req() request: ApiRequest,
    @Param('orgId') organizationId: string,
    @Query() query: unknown,
  ) {
    const result = auditListResponseSchema.parse({
      data: await this.service.list(
        actor(request),
        uuid(organizationId),
        parse(auditQuerySchema, query),
      ),
      requestId: request.requestId,
    });
    // Never attach a requested organization to the operational log before SQL
    // authorization succeeds and the public projection has been validated.
    request.auditOrganizationId = result.data.organizationId;
    return result;
  }
}
