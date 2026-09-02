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
  CreateCrmReportExportDto,
  CrmReportDefinitionDto,
  CrmReportExportDto,
  CrmReportExportPageDto,
} from './crm-report-exports.dto.js';
import { FinanceReportExportPageQueryDto } from './finance-report-exports.dto.js';
import {
  FinanceReportExportsService,
  type FinanceReportExportContent,
} from './finance-report-exports.service.js';

@ApiTags('crm report exports')
@ApiBearerAuth()
@Controller('crm/report-exports')
export class CrmReportExportsController {
  constructor(
    @Inject(FinanceReportExportsService) private readonly exports: FinanceReportExportsService,
  ) {}

  @Get('definitions')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'crm' })
  @ApiOkResponse({ isArray: true, type: CrmReportDefinitionDto })
  definitions(): Promise<CrmReportDefinitionDto[]> {
    return this.exports.crmDefinitions();
  }

  @Get()
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'crm' })
  @ApiQuery({ default: 1, minimum: 1, name: 'page', required: false, type: Number })
  @ApiQuery({
    default: 20,
    maximum: 100,
    minimum: 1,
    name: 'pageSize',
    required: false,
    type: Number,
  })
  @ApiOkResponse({ type: CrmReportExportPageDto })
  list(
    @Query() query: FinanceReportExportPageQueryDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<CrmReportExportPageDto> {
    return this.exports.crmList(query, request.authentication);
  }

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @RateLimitPolicy('write')
  @RequirePermissions({ action: 'view', module: 'crm' }, { action: 'create', module: 'crm' })
  @ApiAcceptedResponse({ type: CrmReportExportDto })
  @ApiBody({ type: CreateCrmReportExportDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  create(
    @Body() input: CreateCrmReportExportDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<CrmReportExportDto> {
    return this.exports.crmCreate(input, key, request.authentication, requestMetadata(request));
  }

  @Post(':id/retry')
  @HttpCode(HttpStatus.ACCEPTED)
  @RateLimitPolicy('write')
  @RequirePermissions({ action: 'view', module: 'crm' }, { action: 'create', module: 'crm' })
  @ApiAcceptedResponse({ type: CrmReportExportDto })
  @ApiParam({ format: 'uuid', name: 'id' })
  retry(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<CrmReportExportDto> {
    return this.exports.crmRetry(id, request.authentication, requestMetadata(request));
  }

  @Get(':id/content')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'crm' })
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
    description: 'The completed CRM report export.',
  })
  async content(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
  ): Promise<void> {
    sendContent(
      response,
      await this.exports.crmContent(id, request.authentication, requestMetadata(request)),
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
