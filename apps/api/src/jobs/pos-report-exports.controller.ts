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
import { FinanceReportExportPageQueryDto } from './finance-report-exports.dto.js';
import {
  FinanceReportExportsService,
  type FinanceReportExportContent,
} from './finance-report-exports.service.js';
import {
  CreatePosReportExportDto,
  PosReportDefinitionDto,
  PosReportExportDto,
  PosReportExportPageDto,
} from './pos-report-exports.dto.js';

@ApiTags('point of sale report exports')
@ApiBearerAuth()
@Controller('pos/report-exports')
export class PosReportExportsController {
  constructor(
    @Inject(FinanceReportExportsService) private readonly exports: FinanceReportExportsService,
  ) {}

  @Get('definitions')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'pos' })
  @ApiOkResponse({ isArray: true, type: PosReportDefinitionDto })
  definitions(): Promise<PosReportDefinitionDto[]> {
    return this.exports.posDefinitions();
  }

  @Get()
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'pos' })
  @ApiQuery({ default: 1, minimum: 1, name: 'page', required: false, type: Number })
  @ApiQuery({
    default: 20,
    maximum: 100,
    minimum: 1,
    name: 'pageSize',
    required: false,
    type: Number,
  })
  @ApiOkResponse({ type: PosReportExportPageDto })
  list(
    @Query() query: FinanceReportExportPageQueryDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<PosReportExportPageDto> {
    return this.exports.posList(query, request.authentication);
  }

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @RateLimitPolicy('write')
  @RequirePermissions({ action: 'view', module: 'pos' }, { action: 'create', module: 'pos' })
  @ApiAcceptedResponse({ type: PosReportExportDto })
  @ApiBody({ type: CreatePosReportExportDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  create(
    @Body() input: CreatePosReportExportDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<PosReportExportDto> {
    return this.exports.posCreate(input, key, request.authentication, metadata(request));
  }

  @Post(':id/retry')
  @HttpCode(HttpStatus.ACCEPTED)
  @RateLimitPolicy('write')
  @RequirePermissions({ action: 'view', module: 'pos' }, { action: 'create', module: 'pos' })
  @ApiAcceptedResponse({ type: PosReportExportDto })
  @ApiParam({ format: 'uuid', name: 'id' })
  retry(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<PosReportExportDto> {
    return this.exports.posRetry(id, request.authentication, metadata(request));
  }

  @Get(':id/content')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'pos' })
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
    description: 'The completed point-of-sale report export.',
  })
  async content(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
  ): Promise<void> {
    sendContent(
      response,
      await this.exports.posContent(id, request.authentication, metadata(request)),
    );
  }
}

function metadata(request: AuthenticatedRequest): RequestSecurityMetadata {
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
