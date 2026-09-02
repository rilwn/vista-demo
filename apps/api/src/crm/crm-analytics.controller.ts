import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';

import { RequirePermissions } from '../auth/auth.decorators.js';
import { RateLimitPolicy } from '../security/rate-limit.decorator.js';
import { CrmAnalyticsService } from './crm-analytics.service.js';
import { CrmAnalyticsOverviewDto, CrmAnalyticsQueryDto } from './crm-analytics.dto.js';

@ApiTags('crm analytics')
@ApiBearerAuth()
@Controller('crm/analytics')
export class CrmAnalyticsController {
  constructor(@Inject(CrmAnalyticsService) private readonly analytics: CrmAnalyticsService) {}

  @Get('overview')
  @RequirePermissions({ action: 'view', module: 'crm' })
  @RateLimitPolicy('read')
  @ApiQuery({ format: 'date', name: 'dateFrom', type: String })
  @ApiQuery({ format: 'date', name: 'dateTo', type: String })
  @ApiOkResponse({ type: CrmAnalyticsOverviewDto })
  overview(@Query() query: CrmAnalyticsQueryDto): Promise<CrmAnalyticsOverviewDto> {
    return this.analytics.overview(query.dateFrom, query.dateTo);
  }
}
