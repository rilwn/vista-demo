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
  Put,
  Query,
  Req,
  Res,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiHeader,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiAcceptedResponse,
  ApiParam,
  ApiProduces,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { reportingScopes } from '@vista/contracts';
import type { AuthenticatedRequest } from '../auth/authentication.types.js';
import { RateLimitPolicy } from '../security/rate-limit.decorator.js';
import { FinanceReportExportsService } from './finance-report-exports.service.js';
import { FinanceReportExportPageQueryDto } from './finance-report-exports.dto.js';
import { LibraryExportDto as FinanceReportExportDto } from './reporting-hub.dto.js';
import { reportAccess } from './reporting-access.js';
import { ReportingHubService } from './reporting-hub.service.js';
import {
  LibraryDefinitionDto,
  LibraryViewPageDto,
  ReportScheduleDto,
  ReportScheduleInputDto,
  ReportSchedulePageDto,
  ReportScheduleStateDto,
  ReportRunPageDto,
  ReportDashboardPreferencesDto,
} from './reporting-hub.dto.js';
const pipe = (expectedType: new () => object) =>
  new ValidationPipe({
    expectedType,
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });
@ApiTags('reporting')
@ApiBearerAuth()
@Controller('reporting')
export class ReportingHubController {
  constructor(
    @Inject(ReportingHubService) private readonly hub: ReportingHubService,
    @Inject(FinanceReportExportsService) private readonly exports: FinanceReportExportsService,
  ) {}
  @Get('context')
  @RateLimitPolicy('read')
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['timezone'],
      properties: { timezone: { type: 'string' } },
    },
  })
  context() {
    return this.hub.context();
  }
  @Get('definitions')
  @RateLimitPolicy('read')
  @ApiOkResponse({ type: [LibraryDefinitionDto] })
  definitions(@Req() req: AuthenticatedRequest) {
    return this.hub.definitions(req.authentication);
  }
  @Get('views')
  @RateLimitPolicy('read')
  @ApiOkResponse({ type: LibraryViewPageDto })
  @ApiQuery({ name: 'page', type: Number, required: false })
  @ApiQuery({ name: 'pageSize', type: Number, required: false })
  views(
    @Query(pipe(FinanceReportExportPageQueryDto)) query: FinanceReportExportPageQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.hub.views(query, req.authentication);
  }
  @Post('views/:scope/:id/export')
  @HttpCode(202)
  @RateLimitPolicy('write')
  @ApiAcceptedResponse({ type: FinanceReportExportDto })
  @ApiParam({ name: 'scope', enum: reportingScopes })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  exportView(
    @Param('scope') value: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    const scope = reportAccess(req.authentication, value, true);
    return this.hub.exportView(scope, id, key, req.authentication, {
      correlationId: req.correlationId,
    });
  }
  @Get('schedules')
  @RateLimitPolicy('read')
  @ApiOkResponse({ type: ReportSchedulePageDto })
  @ApiQuery({ name: 'page', type: Number, required: false })
  @ApiQuery({ name: 'pageSize', type: Number, required: false })
  schedules(
    @Query(pipe(FinanceReportExportPageQueryDto)) query: FinanceReportExportPageQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.hub.schedules(query, req.authentication);
  }
  @Post('schedules')
  @RateLimitPolicy('write')
  @ApiCreatedResponse({ type: ReportScheduleDto })
  @ApiBody({ type: ReportScheduleInputDto })
  create(
    @Body(pipe(ReportScheduleInputDto)) input: ReportScheduleInputDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.hub.createSchedule(input, req.authentication, { correlationId: req.correlationId });
  }
  @Put('schedules/:id/state')
  @RateLimitPolicy('write')
  @ApiOkResponse({ type: ReportScheduleDto })
  @ApiBody({ type: ReportScheduleStateDto })
  @ApiParam({ name: 'id', format: 'uuid' })
  state(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(pipe(ReportScheduleStateDto)) input: ReportScheduleStateDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.hub.state(id, input, req.authentication, { correlationId: req.correlationId });
  }
  @Get('schedules/:id/runs')
  @RateLimitPolicy('read')
  @ApiOkResponse({ type: ReportRunPageDto })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiQuery({ name: 'page', type: Number, required: false })
  @ApiQuery({ name: 'pageSize', type: Number, required: false })
  runs(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query(pipe(FinanceReportExportPageQueryDto)) query: FinanceReportExportPageQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.hub.runs(id, query, req.authentication);
  }
  @Post('exports/:scope/:id/retry')
  @HttpCode(202)
  @RateLimitPolicy('write')
  @ApiAcceptedResponse({ type: FinanceReportExportDto })
  @ApiParam({ name: 'scope', enum: reportingScopes })
  @ApiParam({ name: 'id', format: 'uuid' })
  retry(
    @Param('scope') value: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const scope = reportAccess(req.authentication, value, true);
    return this.exports.retryForScope(
      id,
      req.authentication,
      { correlationId: req.correlationId },
      scope,
    );
  }
  @Get('exports/:scope/:id')
  @RateLimitPolicy('read')
  @ApiOkResponse({ type: FinanceReportExportDto })
  @ApiParam({ name: 'scope', enum: reportingScopes })
  @ApiParam({ name: 'id', format: 'uuid' })
  exportStatus(
    @Param('scope') value: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.exports.getForScope(
      id,
      req.authentication,
      reportAccess(req.authentication, value),
    );
  }
  @Get('exports/:scope/:id/content')
  @RateLimitPolicy('read')
  @ApiParam({ name: 'scope', enum: reportingScopes })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiProduces(
    'text/csv',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  async download(
    @Param('scope') value: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ) {
    const file = await this.exports.contentForScope(
      id,
      req.authentication,
      { correlationId: req.correlationId },
      reportAccess(req.authentication, value),
    );
    res.setHeader('Content-Type', file.mediaType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.fileName.replace(/["\\\r\n]/g, '_')}"`,
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(file.buffer);
  }
  @Get('dashboards/:scope')
  @RateLimitPolicy('read')
  @ApiParam({ name: 'scope', enum: ['finance', 'service', 'crm', 'pos'] })
  @ApiOkResponse({ type: ReportDashboardPreferencesDto })
  preferences(@Param('scope') scope: string, @Req() req: AuthenticatedRequest) {
    return this.hub.preferences(scope, req.authentication);
  }
  @Put('dashboards/:scope')
  @RateLimitPolicy('write')
  @ApiParam({ name: 'scope', enum: ['finance', 'service', 'crm', 'pos'] })
  @ApiBody({ type: ReportDashboardPreferencesDto })
  @ApiOkResponse({ type: ReportDashboardPreferencesDto })
  savePreferences(
    @Param('scope') scope: string,
    @Body(pipe(ReportDashboardPreferencesDto)) input: ReportDashboardPreferencesDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.hub.savePreferences(scope, input, req.authentication, {
      correlationId: req.correlationId,
    });
  }
}
