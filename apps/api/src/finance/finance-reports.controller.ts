import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';

import { RequirePermissions } from '../auth/auth.decorators.js';
import { RateLimitPolicy } from '../security/rate-limit.decorator.js';
import {
  FinanceAgingQueryDto,
  FinanceAgingReportDto,
  FinanceTurnoverQueryDto,
  FinanceTurnoverReportDto,
} from './finance-reports.dto.js';
import { FinanceReportsService } from './finance-reports.service.js';

@ApiTags('finance-reports')
@ApiBearerAuth()
@RateLimitPolicy('read')
@Controller('finance/reports')
export class FinanceReportsController {
  constructor(@Inject(FinanceReportsService) private readonly reports: FinanceReportsService) {}

  @Get('aging')
  @RequirePermissions({ action: 'view', module: 'erp.finance' })
  @ApiOkResponse({ type: FinanceAgingReportDto })
  @ApiQuery({ enum: ['receivable', 'payable'], name: 'kind' })
  @ApiQuery({ default: 1, minimum: 1, name: 'page', required: false, type: Number })
  @ApiQuery({
    default: 50,
    maximum: 100,
    minimum: 1,
    name: 'pageSize',
    required: false,
    type: Number,
  })
  aging(@Query() query: FinanceAgingQueryDto): Promise<FinanceAgingReportDto> {
    return this.reports.aging(query);
  }

  @Get('turnover')
  @RequirePermissions({ action: 'view', module: 'erp.finance' })
  @ApiOkResponse({ type: FinanceTurnoverReportDto })
  @ApiQuery({ format: 'date', name: 'dateFrom', required: false, type: String })
  @ApiQuery({ format: 'date', name: 'dateTo', required: false, type: String })
  @ApiQuery({ enum: ['customer', 'supplier'], name: 'kind' })
  @ApiQuery({ default: 1, minimum: 1, name: 'page', required: false, type: Number })
  @ApiQuery({
    default: 50,
    maximum: 100,
    minimum: 1,
    name: 'pageSize',
    required: false,
    type: Number,
  })
  turnover(@Query() query: FinanceTurnoverQueryDto): Promise<FinanceTurnoverReportDto> {
    return this.reports.turnover(query);
  }
}
