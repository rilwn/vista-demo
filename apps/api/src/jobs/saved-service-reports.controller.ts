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
import { SavedServiceReportDto, SavedServiceReportPageDto } from './saved-service-reports.dto.js';
import { SavedServiceReportsService } from './saved-service-reports.service.js';

@ApiTags('service-reports')
@ApiBearerAuth()
@Controller('service/saved-reports')
export class SavedServiceReportsController {
  constructor(
    @Inject(SavedServiceReportsService) private readonly reports: SavedServiceReportsService,
  ) {}

  @Get()
  @RateLimitPolicy('read')
  @RequirePermissions({ module: 'erp.service', action: 'approve' })
  @ApiOkResponse({ type: SavedServiceReportPageDto })
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
    { module: 'erp.service', action: 'approve' },
    { module: 'erp.service', action: 'create' },
  )
  @ApiBody({ type: SavedServiceReportDto })
  @ApiCreatedResponse({ type: SavedServiceReportDto })
  save(
    @Body(
      new ValidationPipe({
        expectedType: SavedServiceReportDto,
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    )
    input: SavedServiceReportDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.reports.save(input, request.authentication, {
      correlationId: request.correlationId,
    });
  }
}
