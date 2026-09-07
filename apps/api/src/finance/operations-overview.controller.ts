import { Controller, Get, Inject, Query, Req, ValidationPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../auth/authentication.types.js';
import { RateLimitPolicy } from '../security/rate-limit.decorator.js';
import { OperationsOverviewDto, OperationsOverviewQueryDto } from './operations-overview.dto.js';
import { OperationsOverviewService } from './operations-overview.service.js';

@ApiTags('operations-overview')
@ApiBearerAuth()
@Controller('operations/overview')
export class OperationsOverviewController {
  constructor(
    @Inject(OperationsOverviewService) private readonly reports: OperationsOverviewService,
  ) {}
  @Get()
  @RateLimitPolicy('read')
  @ApiOkResponse({ type: OperationsOverviewDto })
  @ApiQuery({ name: 'dateFrom', type: String, format: 'date' })
  @ApiQuery({ name: 'dateTo', type: String, format: 'date' })
  @ApiQuery({
    name: 'warrantyDays',
    type: Number,
    minimum: 1,
    maximum: 365,
    default: 30,
    required: false,
  })
  overview(
    @Query(
      new ValidationPipe({
        expectedType: OperationsOverviewQueryDto,
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    )
    query: OperationsOverviewQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.reports.overview(query, request.authentication);
  }
}
