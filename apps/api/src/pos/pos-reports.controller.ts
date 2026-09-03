import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';

import { RequirePermissions } from '../auth/auth.decorators.js';
import { RateLimitPolicy } from '../security/rate-limit.decorator.js';
import {
  PosReportOverviewDto,
  PosReportQueryDto,
  PosReportReferenceDataDto,
} from './pos-reports.dto.js';
import { PosReportsService } from './pos-reports.service.js';

@ApiTags('point of sale reports')
@ApiBearerAuth()
@Controller('pos/reports')
export class PosReportsController {
  constructor(@Inject(PosReportsService) private readonly reports: PosReportsService) {}

  @Get('reference-data')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'pos' })
  @ApiOkResponse({ type: PosReportReferenceDataDto })
  referenceData(): Promise<PosReportReferenceDataDto> {
    return this.reports.referenceData();
  }

  @Get('overview')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'pos' })
  @ApiQuery({ format: 'date', name: 'dateFrom', required: true, type: String })
  @ApiQuery({ format: 'date', name: 'dateTo', required: true, type: String })
  @ApiQuery({ format: 'uuid', name: 'businessLocationId', required: false, type: String })
  @ApiQuery({ format: 'uuid', name: 'cashRegisterId', required: false, type: String })
  @ApiQuery({ format: 'uuid', name: 'operatorId', required: false, type: String })
  @ApiOkResponse({ type: PosReportOverviewDto })
  overview(@Query() query: PosReportQueryDto): Promise<PosReportOverviewDto> {
    return this.reports.overview(query);
  }
}
