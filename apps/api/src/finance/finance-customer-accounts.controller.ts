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
