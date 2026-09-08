import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiParam,
  ApiProduces,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { hasPermission } from '@vista/auth';
import {
  erpReportDefinitionKeys,
  type ErpReportExport,
  type ErpReportExportPage,
  type ErpReportScope,
} from '@vista/contracts';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../auth/authentication.types.js';
import { ApiErrorException } from '../common/api-error.exception.js';
import { RateLimitPolicy } from '../security/rate-limit.decorator.js';
import { FinanceReportExportsService, reportFilters } from './finance-report-exports.service.js';
import { FinanceReportExportPageQueryDto } from './finance-report-exports.dto.js';
import { ErpReportDataService } from './erp-report-data.service.js';
import { erpReportDefinitions } from './erp-report-definitions.js';
import { SavedErpReportsService } from './saved-erp-reports.service.js';
import {
  CreateErpReportExportDto,
  ErpReportDefinitionDto,
  ErpReportExportDto,
  ErpReportExportPageDto,
  ErpReportScopeDto,
  ErpReportPreviewQueryDto,
  ErpReportPreviewDto,
  SavedErpReportDto,
  SavedErpReportPageDto,
} from './erp-report-exports.dto.js';
const scopePipe = new ValidationPipe({
  expectedType: ErpReportScopeDto,
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});
function pipe(expectedType: new () => object) {
  return new ValidationPipe({
    expectedType,
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });
}
function authorize(scope: ErpReportScope, request: AuthenticatedRequest, create = false) {
  if (!['procurement', 'warehouse', 'sales', 'logistics'].includes(scope))
    throw new ApiErrorException(
      'REPORT_SCOPE_INVALID',
      'Choose an available reporting module.',
      400,
    );
  if (
    !hasPermission(request.authentication.permissions, {
      module: `erp.${scope}`,
      action: 'view',
    }) ||
    (create &&
      !hasPermission(request.authentication.permissions, {
        module: `erp.${scope}`,
        action: 'create',
      }))
  )
    throw new ApiErrorException(
      'FORBIDDEN',
      'Your account cannot perform this report action.',
      403,
    );
}
function checkDefinition(scope: ErpReportScope, key: string) {
  if (!erpReportDefinitions().some((d) => d.key === key && d.key.startsWith(scope + '.')))
    throw new ApiErrorException('REPORT_NOT_FOUND', 'This report is not available.', 404);
}
@ApiTags('erp-reports')
@ApiBearerAuth()
@ApiParam({ name: 'scope', enum: ['procurement', 'warehouse', 'sales', 'logistics'] })
@Controller('erp/reports/:scope')
export class ErpReportExportsController {
  constructor(
    @Inject(FinanceReportExportsService) private readonly exports: FinanceReportExportsService,
    @Inject(ErpReportDataService) private readonly data: ErpReportDataService,
    @Inject(SavedErpReportsService) private readonly saved: SavedErpReportsService,
  ) {}
  @Get('definitions')
  @RateLimitPolicy('read')
  @ApiOkResponse({ type: ErpReportDefinitionDto, isArray: true })
  definitions(@Param(scopePipe) params: ErpReportScopeDto, @Req() request: AuthenticatedRequest) {
    authorize(params.scope, request);
    return erpReportDefinitions().filter((d) => d.key.startsWith(params.scope + '.'));
  }
  @Get('preview')
  @ApiQuery({ name: 'definitionKey', enum: erpReportDefinitionKeys })
  @ApiQuery({ name: 'dateFrom', type: String, format: 'date', required: false })
  @ApiQuery({ name: 'dateTo', type: String, format: 'date', required: false })
  @ApiQuery({ name: 'search', type: String, required: false })
  @ApiQuery({ name: 'page', type: Number, required: false, default: 1 })
  @RateLimitPolicy('read')
  @ApiOkResponse({ type: ErpReportPreviewDto })
  preview(
    @Param(scopePipe) params: ErpReportScopeDto,
    @Query(pipe(ErpReportPreviewQueryDto)) query: ErpReportPreviewQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    authorize(params.scope, request);
    checkDefinition(params.scope, query.definitionKey);
    const filters = reportFilters({ ...query, format: 'csv' }, query.definitionKey);
    return this.data.read(query.definitionKey, filters, query.page);
  }
  @Get('saved')
  @ApiQuery({ name: 'page', type: Number, required: false, default: 1 })
  @ApiQuery({ name: 'pageSize', type: Number, required: false, default: 20 })
  @RateLimitPolicy('read')
  @ApiOkResponse({ type: SavedErpReportPageDto })
  listSaved(
    @Param(scopePipe) params: ErpReportScopeDto,
    @Query(pipe(FinanceReportExportPageQueryDto)) query: FinanceReportExportPageQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    authorize(params.scope, request);
    return this.saved.list(params.scope, query, request.authentication);
  }
  @Post('saved')
  @RateLimitPolicy('write')
  @ApiBody({ type: SavedErpReportDto })
  @ApiCreatedResponse({ type: SavedErpReportDto })
  save(
    @Param(scopePipe) params: ErpReportScopeDto,
    @Body(pipe(SavedErpReportDto)) input: SavedErpReportDto,
    @Req() request: AuthenticatedRequest,
  ) {
    authorize(params.scope, request, true);
    checkDefinition(params.scope, input.definitionKey);
    return this.saved.save(params.scope, input, request.authentication, {
      correlationId: request.correlationId,
    });
  }
  @Get('exports')
  @ApiQuery({ name: 'page', type: Number, required: false, default: 1 })
  @ApiQuery({ name: 'pageSize', type: Number, required: false, default: 20 })
  @RateLimitPolicy('read')
  @ApiOkResponse({ type: ErpReportExportPageDto })
  list(
    @Param(scopePipe) params: ErpReportScopeDto,
    @Query(pipe(FinanceReportExportPageQueryDto)) query: FinanceReportExportPageQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    authorize(params.scope, request);
    return this.exports.listForScope(
      query,
      request.authentication,
      params.scope,
    ) as Promise<ErpReportExportPage>;
  }
  @Post('exports')
  @HttpCode(202)
  @RateLimitPolicy('write')
  @ApiBody({ type: CreateErpReportExportDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiAcceptedResponse({ type: ErpReportExportDto })
  create(
    @Param(scopePipe) params: ErpReportScopeDto,
    @Body(pipe(CreateErpReportExportDto)) input: CreateErpReportExportDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    authorize(params.scope, request, true);
    checkDefinition(params.scope, input.definitionKey);
    return this.exports.createForScope(
      input,
      key,
      request.authentication,
      { correlationId: request.correlationId },
      params.scope,
    ) as Promise<ErpReportExport>;
  }
  @Post('exports/:id/retry')
  @HttpCode(202)
  @RateLimitPolicy('write')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiAcceptedResponse({ type: ErpReportExportDto })
  retry(
    @Param('scope') scope: ErpReportScope,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    this.definitions({ scope }, request);
    authorize(scope, request, true);
    return this.exports.retryForScope(
      id,
      request.authentication,
      { correlationId: request.correlationId },
      scope,
    ) as Promise<ErpReportExport>;
  }
  @Get('exports/:id/content')
  @RateLimitPolicy('read')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiProduces(
    'text/csv',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  async content(
    @Param('scope') scope: ErpReportScope,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
  ) {
    this.definitions({ scope }, request);
    const file = await this.exports.contentForScope(
      id,
      request.authentication,
      { correlationId: request.correlationId },
      scope,
    );
    response.setHeader('Content-Type', file.mediaType);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.fileName.replace(/["\\\r\n]/g, '_')}"`,
    );
    response.setHeader('Cache-Control', 'private, no-store');
    response.send(file.buffer);
  }
}
