import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import {
  dashboardQuerySchema,
  dashboardResponseSchema,
  dashboardEvidenceQuerySchema,
  dashboardEvidenceResponseSchema,
  dashboardSignalQuerySchema,
  dashboardSignalsResponseSchema,
  dashboardSignalDetailQuerySchema,
  dashboardSignalDetailResponseSchema,
} from '@alunza/contracts';
import { AuthGuard } from '../identity/auth.guard';
import { actor, parse, uuid } from '../governance/governance.shared';
import type { ApiRequest } from '../http/errors';
import { DashboardService } from './dashboard.service';
import { phaseSync } from '../http/phase-diagnostics';

@Controller('api/v1/classes/:id')
@UseGuards(AuthGuard)
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  @Get('dashboard')
  async dashboard(
    @Req() request: ApiRequest,
    @Param('id') classId: string,
    @Query() query: unknown,
  ) {
    const data = await this.service.dashboard(
      actor(request),
      uuid(classId),
      parse(dashboardQuerySchema, query),
    );
    return phaseSync('dashboard.responseParse', () =>
      dashboardResponseSchema.parse({
        data,
        requestId: request.requestId,
      }),
    );
  }

  @Get('dashboard/evidence')
  async evidence(
    @Req() request: ApiRequest,
    @Param('id') classId: string,
    @Query() query: unknown,
  ) {
    return dashboardEvidenceResponseSchema.parse({
      data: await this.service.evidence(
        actor(request),
        uuid(classId),
        parse(dashboardEvidenceQuerySchema, query),
      ),
      requestId: request.requestId,
    });
  }

  @Get('signals')
  async signals(
    @Req() request: ApiRequest,
    @Param('id') classId: string,
    @Query() query: unknown,
  ) {
    const data = await this.service.signals(
      actor(request),
      uuid(classId),
      parse(dashboardSignalQuerySchema, query),
    );
    return phaseSync('dashboard.responseParse', () =>
      dashboardSignalsResponseSchema.parse({
        data,
        requestId: request.requestId,
      }),
    );
  }

  @Get('signals/:signalId')
  async signal(
    @Req() request: ApiRequest,
    @Param('id') classId: string,
    @Param('signalId') signalId: string,
    @Query() query: unknown,
  ) {
    return dashboardSignalDetailResponseSchema.parse({
      data: await this.service.signal(
        actor(request),
        uuid(classId),
        uuid(signalId),
        parse(dashboardSignalDetailQuerySchema, query),
      ),
      requestId: request.requestId,
    });
  }
}
