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
  Put,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import { RequirePermissions } from '../auth/auth.decorators.js';
import type { AuthenticatedRequest } from '../auth/authentication.types.js';
import type { CorrelatedRequest } from '../common/correlation-id.middleware.js';
import { RateLimitPolicy } from '../security/rate-limit.decorator.js';
import {
  CreateCustomerAdvanceDto,
  CustomerAdvanceDto,
  CustomerPaymentAccountDto,
  CustomerPaymentAccountReferenceDataDto,
  UpsertCustomerPaymentTermsDto,
  CreatePosAccountPaymentDto,
  ReversePosAccountPaymentDto,
  CreatePosAccountRefundDto,
} from './finance-customer-accounts.dto.js';
import { FinanceCustomerAccountsService } from './finance-customer-accounts.service.js';

@ApiTags('finance-customer-accounts')
@ApiBearerAuth()
@RateLimitPolicy('write')
@Controller('finance/customer-accounts')
export class FinanceCustomerAccountsController {
  constructor(
    @Inject(FinanceCustomerAccountsService)
    private readonly accounts: FinanceCustomerAccountsService,
  ) {}

  @Get('reference-data')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'erp.finance' })
  @ApiOkResponse({ type: CustomerPaymentAccountReferenceDataDto })
  referenceData(): Promise<CustomerPaymentAccountReferenceDataDto> {
    return this.accounts.referenceData();
  }

  @Get()
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'erp.finance' })
  @ApiOkResponse({ isArray: true, type: CustomerPaymentAccountDto })
  list(): Promise<CustomerPaymentAccountDto[]> {
    return this.accounts.list();
  }

  @Get(':customerPartnerId')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'erp.finance' })
  @ApiOkResponse({ type: CustomerPaymentAccountDto })
  @ApiParam({ format: 'uuid', name: 'customerPartnerId' })
  account(
    @Param('customerPartnerId') customerPartnerId: string,
  ): Promise<CustomerPaymentAccountDto> {
    return this.accounts.account(customerPartnerId);
  }

  @Put(':customerPartnerId/terms')
  @RequirePermissions({ action: 'edit', module: 'erp.finance' })
  @ApiBody({ type: UpsertCustomerPaymentTermsDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ type: CustomerPaymentAccountDto })
  @ApiParam({ format: 'uuid', name: 'customerPartnerId' })
  upsertTerms(
    @Param('customerPartnerId') customerPartnerId: string,
    @Body() input: UpsertCustomerPaymentTermsDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<CustomerPaymentAccountDto> {
    return this.accounts.upsertTerms(
      customerPartnerId,
      input,
      key,
      request.authentication,
      metadata(request),
    );
  }

  @Post('advances')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ action: 'create', module: 'erp.finance' })
  @ApiBody({ type: CreateCustomerAdvanceDto })
  @ApiCreatedResponse({ type: CustomerAdvanceDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  createAdvance(
    @Body() input: CreateCustomerAdvanceDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<CustomerAdvanceDto> {
    return this.accounts.createAdvance(input, key, request.authentication, metadata(request));
  }

  @Post(':customerPartnerId/pos-sales/:saleId/payments')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ action: 'create', module: 'erp.finance' })
  @ApiBody({ type: CreatePosAccountPaymentDto })
  @ApiCreatedResponse({ type: CustomerPaymentAccountDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiParam({ name: 'customerPartnerId', format: 'uuid' })
  @ApiParam({ name: 'saleId', format: 'uuid' })
  collect(
    @Param('customerPartnerId') customerId: string,
    @Param('saleId') saleId: string,
    @Body() input: CreatePosAccountPaymentDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<CustomerPaymentAccountDto> {
    return this.accounts.collectPosBalance(
      customerId,
      saleId,
      input,
      key,
      request.authentication,
      metadata(request),
    );
  }

  @Post(':customerPartnerId/pos-sales/:saleId/returns/:returnId/refunds')
  @HttpCode(HttpStatus.CREATED)
  @RateLimitPolicy('sensitive')
  @RequirePermissions({ action: 'approve', module: 'erp.finance' })
  @ApiBody({ type: CreatePosAccountRefundDto })
  @ApiCreatedResponse({ type: CustomerPaymentAccountDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiParam({ name: 'customerPartnerId', format: 'uuid' })
  @ApiParam({ name: 'saleId', format: 'uuid' })
  @ApiParam({ name: 'returnId', format: 'uuid' })
  refund(
    @Param('customerPartnerId', new ParseUUIDPipe()) customerId: string,
    @Param('saleId', new ParseUUIDPipe()) saleId: string,
    @Param('returnId', new ParseUUIDPipe()) returnId: string,
    @Body() input: CreatePosAccountRefundDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<CustomerPaymentAccountDto> {
    return this.accounts.refundPosReturn(
      customerId,
      saleId,
      returnId,
      input,
      key,
      request.authentication,
      metadata(request),
    );
  }

  @Post(':customerPartnerId/pos-sales/:saleId/payments/:paymentId/reverse')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ action: 'approve', module: 'erp.finance' })
  @ApiBody({ type: ReversePosAccountPaymentDto })
  @ApiOkResponse({ type: CustomerPaymentAccountDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiParam({ name: 'customerPartnerId', format: 'uuid' })
  @ApiParam({ name: 'saleId', format: 'uuid' })
  @ApiParam({ name: 'paymentId', format: 'uuid' })
  reverse(
    @Param('customerPartnerId') customerId: string,
    @Param('saleId') saleId: string,
    @Param('paymentId') paymentId: string,
    @Body() input: ReversePosAccountPaymentDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<CustomerPaymentAccountDto> {
    return this.accounts.reversePosPayment(
      customerId,
      saleId,
      paymentId,
      input,
      key,
      request.authentication,
      metadata(request),
    );
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
