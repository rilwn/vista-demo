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
import { SavedPosReportDto, SavedPosReportPageDto } from './saved-pos-reports.dto.js';
import { SavedPosReportsService } from './saved-pos-reports.service.js';

@ApiTags('pos-reports')
@ApiBearerAuth()
@Controller('pos/saved-reports')
export class SavedPosReportsController {
  constructor(@Inject(SavedPosReportsService) private readonly reports: SavedPosReportsService) {}

  @Get()
  @RateLimitPolicy('read')
  @RequirePermissions({ module: 'pos', action: 'view' })
  @ApiOkResponse({ type: SavedPosReportPageDto })
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
  @RequirePermissions({ module: 'pos', action: 'view' }, { module: 'pos', action: 'create' })
  @ApiBody({ type: SavedPosReportDto })
  @ApiCreatedResponse({ type: SavedPosReportDto })
  save(
    @Body(
      new ValidationPipe({
        expectedType: SavedPosReportDto,
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    )
    input: SavedPosReportDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.reports.save(input, request.authentication, {
      correlationId: request.correlationId,
    });
  }
}
