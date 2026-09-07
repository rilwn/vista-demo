import { Body, Controller, Get, Inject, Post, Query, Req, ValidationPipe } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermissions } from '../auth/auth.decorators.js';
import type { AuthenticatedRequest } from '../auth/authentication.types.js';
import { RateLimitPolicy } from '../security/rate-limit.decorator.js';
import { FinanceReportExportPageQueryDto } from './finance-report-exports.dto.js';
import { SavedFinanceReportDto, SavedFinanceReportPageDto } from './saved-finance-reports.dto.js';
import { SavedFinanceReportsService } from './saved-finance-reports.service.js';

@ApiTags('finance-reports')
@ApiBearerAuth()
@Controller('finance/saved-reports')
export class SavedFinanceReportsController {
  constructor(
    @Inject(SavedFinanceReportsService) private readonly reports: SavedFinanceReportsService,
  ) {}

  @Get()
  @RateLimitPolicy('read')
  @RequirePermissions({ module: 'erp.finance', action: 'view' })
  @ApiOkResponse({ type: SavedFinanceReportPageDto })
  @ApiQuery({ name: 'page', required: false, type: Number, minimum: 1, default: 1 })
  @ApiQuery({
    name: 'pageSize',
    required: false,
    type: Number,
    minimum: 1,
    maximum: 100,
    default: 20,
  })
  list(
    @Query(
      new ValidationPipe({
        expectedType: FinanceReportExportPageQueryDto,
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    )
    query: FinanceReportExportPageQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.reports.list(query, request.authentication);
  }

  @Post()
  @RateLimitPolicy('write')
  @RequirePermissions(
    { module: 'erp.finance', action: 'view' },
    { module: 'erp.finance', action: 'create' },
  )
  @ApiBody({ type: SavedFinanceReportDto })
  @ApiCreatedResponse({ type: SavedFinanceReportDto })
  save(
    @Body(
      new ValidationPipe({
        expectedType: SavedFinanceReportDto,
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    )
    input: SavedFinanceReportDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.reports.save(input, request.authentication, {
      correlationId: request.correlationId,
    });
  }
}
