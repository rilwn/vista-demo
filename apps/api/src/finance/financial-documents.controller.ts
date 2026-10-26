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
  ApiBearerAuth,
  ApiAcceptedResponse,
  ApiBody,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiParam,
  ApiProduces,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import { RequirePermissions } from '../auth/auth.decorators.js';
import type { AuthenticatedRequest } from '../auth/authentication.types.js';
import type { CorrelatedRequest } from '../common/correlation-id.middleware.js';
import type { Response } from 'express';
import { RateLimitPolicy } from '../security/rate-limit.decorator.js';
import { SalesPricingService } from '../sales/sales-pricing.service.js';
import { ResolveSalesPriceQueryDto, SalesResolvedPriceDto } from '../sales/sales-pricing.dto.js';
import {
  CancelFinancialDocumentDto,
  CreateFinancialDocumentDto,
  FinancialDocumentDto,
  FinancialDocumentListQueryDto,
  FinancialDocumentPageDto,
  FinancialDocumentReferenceDataDto,
  IssueFinancialDocumentDto,
  QueuedEmailReceiptDto,
  SendDocumentEmailDto,
  FinanceExchangeRateDto,
  FinanceExchangeRateQueryDto,
} from './financial-documents.dto.js';
import { FinancialDocumentsService } from './financial-documents.service.js';

@ApiTags('finance-financial-documents')
@ApiBearerAuth()
@RateLimitPolicy('write')
@Controller('finance/financial-documents')
export class FinancialDocumentsController {
  constructor(
    @Inject(FinancialDocumentsService) private readonly documents: FinancialDocumentsService,
    @Inject(SalesPricingService) private readonly pricing: SalesPricingService,
  ) {}

  @Post('from-pos-return/:returnId')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ action: 'create', module: 'erp.finance' })
  @ApiParam({ name: 'returnId', format: 'uuid' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ type: FinancialDocumentDto })
  fromPosReturn(
    @Param('returnId', new ParseUUIDPipe()) returnId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<FinancialDocumentDto> {
    return this.documents.createFromPosReturn(
      returnId,
      key,
      request.authentication,
      metadata(request),
    );
  }

  @Get('reference-data')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'erp.finance' })
  @ApiOkResponse({ type: FinancialDocumentReferenceDataDto })
  referenceData(): Promise<FinancialDocumentReferenceDataDto> {
    return this.documents.referenceData();
  }

  @Get('exchange-rate')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'erp.finance' })
  @ApiQuery({ example: 'USD', name: 'currencyCode', type: String })
  @ApiQuery({ format: 'date', name: 'rateDate', type: String })
  @ApiOkResponse({ type: FinanceExchangeRateDto })
  exchangeRate(@Query() query: FinanceExchangeRateQueryDto): Promise<FinanceExchangeRateDto> {
    return this.documents.exchangeRate(query.currencyCode, query.rateDate);
  }

  @Get('prices/resolve')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'erp.finance' })
  @ApiOkResponse({ type: SalesResolvedPriceDto })
  @ApiQuery({ format: 'date', name: 'asOf', type: String })
  @ApiQuery({ format: 'uuid', name: 'customerPartnerId', type: String })
  @ApiQuery({ example: 'EUR', name: 'currencyCode', type: String })
  @ApiQuery({ format: 'uuid', name: 'productId', type: String })
  resolvePrice(@Query() query: ResolveSalesPriceQueryDto): Promise<SalesResolvedPriceDto> {
    return this.pricing.resolvePrice(
      query.customerPartnerId,
      query.productId,
      query.asOf,
      query.currencyCode,
    );
  }

  @Get()
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'erp.finance' })
  @ApiQuery({ enum: ['draft', 'issued', 'cancelled'], name: 'status', required: false })
  @ApiQuery({
    enum: ['invoice', 'proforma', 'credit_note', 'debit_note'],
    name: 'type',
    required: false,
  })
  @ApiQuery({ format: 'uuid', name: 'customerPartnerId', required: false, type: String })
  @ApiQuery({ format: 'date', name: 'dateFrom', required: false, type: String })
  @ApiQuery({ format: 'date', name: 'dateTo', required: false, type: String })
  @ApiQuery({ maxLength: 120, name: 'search', required: false, type: String })
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

  @Get(':id/pdf')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'erp.finance' })
  @ApiParam({ format: 'uuid', name: 'id' })
  @ApiProduces('application/pdf')
  @ApiOkResponse({
    content: { 'application/pdf': { schema: { format: 'binary', type: 'string' } } },
    description: 'Printable financial document. Drafts are marked as drafts.',
  })
  async pdf(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
  ): Promise<void> {
    const content = await this.documents.pdf(id, request.authentication);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(content.fileName)}`,
    );
    response.setHeader('Content-Length', String(content.buffer.length));
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.status(HttpStatus.OK).send(content.buffer);
  }

  @Post(':id/email')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions({ action: 'edit', module: 'erp.finance' })
  @ApiBody({ type: SendDocumentEmailDto })
  @ApiAcceptedResponse({ type: QueuedEmailReceiptDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiParam({ format: 'uuid', name: 'id' })
  email(
    @Param('id') id: string,
    @Body() input: SendDocumentEmailDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<QueuedEmailReceiptDto> {
    return this.documents.email(id, input, key, request.authentication, metadata(request));
  }

  @Post(':id/collection')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ action: 'create', module: 'erp.finance' })
  @ApiBody({ type: IssueFinancialDocumentDto })
  @ApiOkResponse({ type: FinancialDocumentDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiParam({ format: 'uuid', name: 'id' })
  collection(
    @Param('id') id: string,
    @Body() input: IssueFinancialDocumentDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<FinancialDocumentDto> {
    return this.documents.addToCollections(
      id,
      input,
      key,
      request.authentication,
      metadata(request),
    );
  }

  @Post(':id/issue')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ action: 'edit', module: 'erp.finance' })
  @ApiBody({ type: IssueFinancialDocumentDto })
  @ApiOkResponse({ type: FinancialDocumentDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiParam({ format: 'uuid', name: 'id' })
  issue(
    @Param('id') id: string,
    @Body() input: IssueFinancialDocumentDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<FinancialDocumentDto> {
    return this.documents.issue(id, input, key, request.authentication, metadata(request));
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
