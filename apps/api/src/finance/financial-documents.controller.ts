import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import { RequirePermissions } from '../auth/auth.decorators.js';
import type { AuthenticatedRequest } from '../auth/authentication.types.js';
import type { CorrelatedRequest } from '../common/correlation-id.middleware.js';
import { RateLimitPolicy } from '../security/rate-limit.decorator.js';
import {
  CancelFinancialDocumentDto,
  CreateFinancialDocumentDto,
  FinancialDocumentDto,
  FinancialDocumentListQueryDto,
  FinancialDocumentPageDto,
  FinancialDocumentReferenceDataDto,
} from './financial-documents.dto.js';
import { FinancialDocumentsService } from './financial-documents.service.js';

@ApiTags('finance-financial-documents')
@ApiBearerAuth()
@RateLimitPolicy('write')
@Controller('finance/financial-documents')
export class FinancialDocumentsController {
  constructor(
    @Inject(FinancialDocumentsService) private readonly documents: FinancialDocumentsService,
  ) {}

  @Get('reference-data')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'erp.finance' })
  @ApiOkResponse({ type: FinancialDocumentReferenceDataDto })
  referenceData(): Promise<FinancialDocumentReferenceDataDto> {
    return this.documents.referenceData();
  }

  @Get()
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'erp.finance' })
  @ApiQuery({ enum: ['draft', 'cancelled'], name: 'status', required: false })
  @ApiQuery({
    enum: ['invoice', 'proforma', 'credit_note', 'debit_note'],
    name: 'type',
    required: false,
  })
  @ApiQuery({ format: 'uuid', name: 'customerPartnerId', required: false, type: String })
  @ApiQuery({ format: 'date', name: 'dateFrom', required: false, type: String })
  @ApiQuery({ format: 'date', name: 'dateTo', required: false, type: String })
  @ApiQuery({ default: 1, minimum: 1, name: 'page', required: false, type: Number })
  @ApiQuery({
    default: 25,
    maximum: 100,
    minimum: 1,
    name: 'pageSize',
    required: false,
    type: Number,
  })
  @ApiOkResponse({ type: FinancialDocumentPageDto })
  list(@Query() query: FinancialDocumentListQueryDto): Promise<FinancialDocumentPageDto> {
    return this.documents.list(query);
  }

  @Get(':id')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'erp.finance' })
  @ApiOkResponse({ type: FinancialDocumentDto })
  @ApiParam({ format: 'uuid', name: 'id' })
  document(@Param('id') id: string): Promise<FinancialDocumentDto> {
    return this.documents.document(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ action: 'create', module: 'erp.finance' })
  @ApiBody({ type: CreateFinancialDocumentDto })
  @ApiCreatedResponse({ type: FinancialDocumentDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  create(
    @Body() input: CreateFinancialDocumentDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<FinancialDocumentDto> {
    return this.documents.create(input, key, request.authentication, metadata(request));
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ action: 'edit', module: 'erp.finance' })
  @ApiBody({ type: CancelFinancialDocumentDto })
  @ApiOkResponse({ type: FinancialDocumentDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiParam({ format: 'uuid', name: 'id' })
  cancel(
    @Param('id') id: string,
    @Body() input: CancelFinancialDocumentDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<FinancialDocumentDto> {
    return this.documents.cancel(id, input, key, request.authentication, metadata(request));
  }
}

function metadata(request: AuthenticatedRequest) {
  const correlated = request as CorrelatedRequest;
  const userAgent = request.header('user-agent');
  return {
    correlationId: correlated.correlationId,
    ...(request.ip ? { sourceIp: request.ip } : {}),
    ...(userAgent ? { userAgent } : {}),
  };
}
