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
import { SavedCrmReportDto, SavedCrmReportPageDto } from './saved-crm-reports.dto.js';
import { SavedCrmReportsService } from './saved-crm-reports.service.js';

@ApiTags('crm-reports')
@ApiBearerAuth()
@Controller('crm/saved-reports')
export class SavedCrmReportsController {
  constructor(@Inject(SavedCrmReportsService) private readonly reports: SavedCrmReportsService) {}

  @Get()
  @RateLimitPolicy('read')
  @RequirePermissions({ module: 'crm', action: 'view' })
  @ApiOkResponse({ type: SavedCrmReportPageDto })
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
  @RequirePermissions({ module: 'crm', action: 'view' }, { module: 'crm', action: 'create' })
  @ApiBody({ type: SavedCrmReportDto })
  @ApiCreatedResponse({ type: SavedCrmReportDto })
  save(
    @Body(
      new ValidationPipe({
        expectedType: SavedCrmReportDto,
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    )
    input: SavedCrmReportDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.reports.save(input, request.authentication, {
      correlationId: request.correlationId,
    });
  }
}
