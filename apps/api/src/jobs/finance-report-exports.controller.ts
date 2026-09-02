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
  CreateFinanceReportExportDto,
  FinanceReportDefinitionDto,
  FinanceReportExportDto,
  FinanceReportExportPageDto,
  FinanceReportExportPageQueryDto,
} from './finance-report-exports.dto.js';
import {
  FinanceReportExportsService,
  type FinanceReportExportContent,
} from './finance-report-exports.service.js';

@ApiTags('finance-report-exports')
@ApiBearerAuth()
@Controller('finance/report-exports')
export class FinanceReportExportsController {
  constructor(
    @Inject(FinanceReportExportsService) private readonly exports: FinanceReportExportsService,
  ) {}

  @Get('definitions')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'erp.finance' })
  @ApiOkResponse({ isArray: true, type: FinanceReportDefinitionDto })
  definitions(): Promise<FinanceReportDefinitionDto[]> {
    return this.exports.definitions();
  }

  @Get()
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'erp.finance' })
  @ApiQuery({ default: 1, minimum: 1, name: 'page', required: false, type: Number })
  @ApiQuery({
    default: 20,
    maximum: 100,
    minimum: 1,
    name: 'pageSize',
    required: false,
    type: Number,
  })
  @ApiOkResponse({ type: FinanceReportExportPageDto })
  list(
    @Query() query: FinanceReportExportPageQueryDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<FinanceReportExportPageDto> {
    return this.exports.list(query, request.authentication);
  }

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @RateLimitPolicy('write')
  @RequirePermissions({ action: 'create', module: 'erp.finance' })
  @ApiAcceptedResponse({ type: FinanceReportExportDto })
  @ApiBody({ type: CreateFinanceReportExportDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  create(
    @Body() input: CreateFinanceReportExportDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<FinanceReportExportDto> {
    return this.exports.create(input, key, request.authentication, requestMetadata(request));
  }

  @Post(':id/retry')
  @HttpCode(HttpStatus.ACCEPTED)
  @RateLimitPolicy('write')
  @RequirePermissions({ action: 'create', module: 'erp.finance' })
  @ApiAcceptedResponse({ type: FinanceReportExportDto })
  @ApiParam({ format: 'uuid', name: 'id' })
  retry(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<FinanceReportExportDto> {
    return this.exports.retry(id, request.authentication, requestMetadata(request));
  }

  @Get(':id/content')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'erp.finance' })
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
    description: 'The completed report export.',
  })
  async content(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
  ): Promise<void> {
    sendContent(
      response,
      await this.exports.content(id, request.authentication, requestMetadata(request)),
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
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader(
    'Content-Disposition',
    `attachment; filename*=UTF-8''${encodeURIComponent(content.fileName)}`,
  );
  response.setHeader('Content-Length', String(content.buffer.length));
  response.setHeader('Content-Type', content.mediaType);
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.status(HttpStatus.OK).send(content.buffer);
}
