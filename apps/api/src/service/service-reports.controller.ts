import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';

import { RequirePermissions } from '../auth/auth.decorators.js';
import { RateLimitPolicy } from '../security/rate-limit.decorator.js';
import { ServiceReportOverviewDto, ServiceReportQueryDto } from './service-reports.dto.js';
import { ServiceReportsService } from './service-reports.service.js';

@ApiTags('service-reports')
@ApiBearerAuth()
@Controller('service/reports')
export class ServiceReportsController {
  constructor(@Inject(ServiceReportsService) private readonly reports: ServiceReportsService) {}

  @Get('overview')
  @RequirePermissions({ action: 'approve', module: 'erp.service' })
  @RateLimitPolicy('read')
  @ApiQuery({ format: 'date', name: 'dateFrom', type: String })
  @ApiQuery({ format: 'date', name: 'dateTo', type: String })
  @ApiOkResponse({ type: ServiceReportOverviewDto })
  overview(@Query() query: ServiceReportQueryDto): Promise<ServiceReportOverviewDto> {
    return this.reports.overview(query.dateFrom, query.dateTo);
  }
}
