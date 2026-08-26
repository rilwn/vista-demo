import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiBody,
  ApiHeader,
  ApiOkResponse,
  ApiParam,
  ApiProduces,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';

import { RequirePermissions } from '../auth/auth.decorators.js';
import type {
  AuthenticatedRequest,
  RequestSecurityMetadata,
} from '../auth/authentication.types.js';
import { RateLimitPolicy } from '../security/rate-limit.decorator.js';
import {
  FinanceReportExportsService,
  type FinanceReportExportContent,
} from './finance-report-exports.service.js';
import { FinanceReportExportPageQueryDto } from './finance-report-exports.dto.js';
import {
  CreateServiceReportExportDto,
  ServiceReportDefinitionDto,
  ServiceReportExportDto,
  ServiceReportExportPageDto,
} from './service-report-exports.dto.js';

@ApiTags('service-report-exports')
@ApiBearerAuth()
@Controller('service/report-exports')
export class ServiceReportExportsController {
  constructor(
    @Inject(FinanceReportExportsService) private readonly exports: FinanceReportExportsService,
  ) {}

  @Get('definitions')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'approve', module: 'erp.service' })
  @ApiOkResponse({ isArray: true, type: ServiceReportDefinitionDto })
  definitions(): Promise<ServiceReportDefinitionDto[]> {
    return this.exports.serviceDefinitions();
  }

  @Get()
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'approve', module: 'erp.service' })
  @ApiQuery({ default: 1, minimum: 1, name: 'page', required: false, type: Number })
  @ApiQuery({
    default: 20,
    maximum: 100,
    minimum: 1,
    name: 'pageSize',
    required: false,
    type: Number,
  })
  @ApiOkResponse({ type: ServiceReportExportPageDto })
  list(
    @Query() query: FinanceReportExportPageQueryDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<ServiceReportExportPageDto> {
    return this.exports.serviceList(query, request.authentication);
  }

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @RateLimitPolicy('write')
  @RequirePermissions(
    { action: 'approve', module: 'erp.service' },
    { action: 'create', module: 'erp.service' },
  )
  @ApiAcceptedResponse({ type: ServiceReportExportDto })
  @ApiBody({ type: CreateServiceReportExportDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  create(
    @Body() input: CreateServiceReportExportDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<ServiceReportExportDto> {
    return this.exports.serviceCreate(input, key, request.authentication, requestMetadata(request));
  }

  @Post(':id/retry')
  @HttpCode(HttpStatus.ACCEPTED)
  @RateLimitPolicy('write')
  @RequirePermissions(
    { action: 'approve', module: 'erp.service' },
    { action: 'create', module: 'erp.service' },
  )
  @ApiAcceptedResponse({ type: ServiceReportExportDto })
  @ApiParam({ format: 'uuid', name: 'id' })
  retry(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<ServiceReportExportDto> {
    return this.exports.serviceRetry(id, request.authentication, requestMetadata(request));
  }

  @Get(':id/content')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'approve', module: 'erp.service' })
  @ApiParam({ format: 'uuid', name: 'id' })
  @ApiProduces(
    'text/csv',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  @ApiOkResponse({
    content: {
      'application/pdf': { schema: { format: 'binary', type: 'string' } },
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
        schema: { format: 'binary', type: 'string' },
      },
      'text/csv': { schema: { format: 'binary', type: 'string' } },
    },
    description: 'The completed Service report export.',
  })
  async content(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
  ): Promise<void> {
    sendContent(
      response,
      await this.exports.serviceContent(id, request.authentication, requestMetadata(request)),
    );
  }
}

function requestMetadata(request: AuthenticatedRequest): RequestSecurityMetadata {
  const userAgent = request.header('user-agent');
  return {
    correlationId: request.correlationId,
    ...(request.ip ? { sourceIp: request.ip } : {}),
    ...(userAgent ? { userAgent } : {}),
  };
}

function sendContent(response: Response, content: FinanceReportExportContent): void {
  response.setHeader('Content-Type', content.mediaType);
  response.setHeader('Content-Length', content.buffer.length.toString());
  response.setHeader(
    'Content-Disposition',
    `attachment; filename="${content.fileName.replace(/["\\\r\n]/g, '_')}"`,
  );
  response.setHeader('Cache-Control', 'private, no-store');
  response.send(content.buffer);
}
