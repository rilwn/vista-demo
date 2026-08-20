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
  ApiTags,
} from '@nestjs/swagger';

import { RequirePermissions } from '../auth/auth.decorators.js';
import type { AuthenticatedRequest } from '../auth/authentication.types.js';
import type { CorrelatedRequest } from '../common/correlation-id.middleware.js';
import { RateLimitPolicy } from '../security/rate-limit.decorator.js';
import {
  AllocateFinanceSupplierAdvanceDto,
  CreateFinanceSupplierAdvanceDto,
  CreateFinanceSupplierOffsetDto,
  CreateFinanceSupplierPayableDto,
  CreateFinanceSupplierPaymentDto,
  FinanceSupplierAdvancePageDto,
  FinanceSupplierBankMatchCandidateDto,
  FinanceSupplierListQueryDto,
  FinanceSupplierOffsetDto,
  FinanceSupplierOffsetPageDto,
  FinanceSupplierPayableDto,
  FinanceSupplierPayablePageDto,
  FinanceSupplierPaymentDto,
  FinanceSupplierReferenceDataDto,
  MatchFinanceSupplierBankTransactionDto,
} from './finance-payables.dto.js';
import { FinancePayablesService } from './finance-payables.service.js';

@ApiTags('finance-supplier-subledger')
@ApiBearerAuth()
@RateLimitPolicy('write')
@Controller('finance')
export class FinancePayablesController {
  constructor(@Inject(FinancePayablesService) private readonly payables: FinancePayablesService) {}

  @Get('supplier-reference-data')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'erp.finance' })
  @ApiOkResponse({ type: FinanceSupplierReferenceDataDto })
  referenceData(): Promise<FinanceSupplierReferenceDataDto> {
    return this.payables.referenceData();
  }

  @Get('supplier-payables')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'erp.finance' })
  @ApiOkResponse({ type: FinanceSupplierPayablePageDto })
  listPayables(
    @Query() query: FinanceSupplierListQueryDto,
  ): Promise<FinanceSupplierPayablePageDto> {
    return this.payables.payables(query);
  }

  @Get('supplier-payables/:id')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'erp.finance' })
  @ApiOkResponse({ type: FinanceSupplierPayableDto })
  @ApiParam({ format: 'uuid', name: 'id' })
  payable(@Param('id') id: string): Promise<FinanceSupplierPayableDto> {
    return this.payables.payable(id);
  }

  @Post('supplier-payables')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ action: 'create', module: 'erp.finance' })
  @ApiBody({ type: CreateFinanceSupplierPayableDto })
  @ApiCreatedResponse({ type: FinanceSupplierPayableDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  createPayable(
    @Body() input: CreateFinanceSupplierPayableDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<FinanceSupplierPayableDto> {
    return this.payables.createPayable(input, key, request.authentication, metadata(request));
  }

  @Post('supplier-payables/:id/payments')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ action: 'create', module: 'erp.finance' })
  @ApiBody({ type: CreateFinanceSupplierPaymentDto })
  @ApiCreatedResponse({ type: FinanceSupplierPayableDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiParam({ format: 'uuid', name: 'id' })
  recordPayment(
    @Param('id') id: string,
    @Body() input: CreateFinanceSupplierPaymentDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<FinanceSupplierPayableDto> {
    return this.payables.recordPayment(id, input, key, request.authentication, metadata(request));
  }

  @Get('supplier-advances')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'erp.finance' })
  @ApiOkResponse({ type: FinanceSupplierAdvancePageDto })
  advances(@Query() query: FinanceSupplierListQueryDto): Promise<FinanceSupplierAdvancePageDto> {
    return this.payables.advances(query);
  }

  @Post('supplier-advances')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ action: 'create', module: 'erp.finance' })
  @ApiBody({ type: CreateFinanceSupplierAdvanceDto })
  @ApiCreatedResponse({ type: FinanceSupplierPaymentDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  createAdvance(
    @Body() input: CreateFinanceSupplierAdvanceDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<FinanceSupplierPaymentDto> {
    return this.payables.createAdvance(input, key, request.authentication, metadata(request));
  }

  @Post('supplier-advances/:id/allocations')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ action: 'edit', module: 'erp.finance' })
  @ApiBody({ type: AllocateFinanceSupplierAdvanceDto })
  @ApiOkResponse({ type: FinanceSupplierPaymentDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiParam({ format: 'uuid', name: 'id' })
  allocateAdvance(
    @Param('id') id: string,
    @Body() input: AllocateFinanceSupplierAdvanceDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<FinanceSupplierPaymentDto> {
    return this.payables.allocateAdvance(id, input, key, request.authentication, metadata(request));
  }

  @Get('supplier-offsets')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'erp.finance' })
  @ApiOkResponse({ type: FinanceSupplierOffsetPageDto })
  offsets(@Query() query: FinanceSupplierListQueryDto): Promise<FinanceSupplierOffsetPageDto> {
    return this.payables.offsets(query);
  }

  @Post('supplier-offsets')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ action: 'create', module: 'erp.finance' })
  @ApiBody({ type: CreateFinanceSupplierOffsetDto })
  @ApiCreatedResponse({ type: FinanceSupplierOffsetDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  createOffset(
    @Body() input: CreateFinanceSupplierOffsetDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<FinanceSupplierOffsetDto> {
    return this.payables.createOffset(input, key, request.authentication, metadata(request));
  }

  @Get('bank-transactions/:id/supplier-match-candidates')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'erp.finance' })
  @ApiOkResponse({ isArray: true, type: FinanceSupplierBankMatchCandidateDto })
  @ApiParam({ format: 'uuid', name: 'id' })
  bankCandidates(@Param('id') id: string): Promise<FinanceSupplierBankMatchCandidateDto[]> {
    return this.payables.bankMatchCandidates(id);
  }

  @Post('bank-transactions/:id/supplier-match')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ action: 'edit', module: 'erp.finance' })
  @ApiBody({ type: MatchFinanceSupplierBankTransactionDto })
  @ApiOkResponse({ type: FinanceSupplierPaymentDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiParam({ format: 'uuid', name: 'id' })
  matchBankTransaction(
    @Param('id') id: string,
    @Body() input: MatchFinanceSupplierBankTransactionDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<FinanceSupplierPaymentDto> {
    return this.payables.matchBankTransaction(
      id,
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
