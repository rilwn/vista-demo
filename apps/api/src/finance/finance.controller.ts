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
  CancelFinanceCustomerDocumentDto,
  CreateFinanceCustomerDocumentDto,
  CreateFinancePaymentDto,
  FinanceCustomerDocumentDto,
  FinanceReferenceDataDto,
  FinanceSummaryDto,
} from './finance.dto.js';
import { FinanceService } from './finance.service.js';

@ApiTags('finance')
@ApiBearerAuth()
@RateLimitPolicy('write')
@Controller('finance')
export class FinanceController {
  constructor(@Inject(FinanceService) private readonly finance: FinanceService) {}

  @Get('reference-data')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'erp.finance' })
  @ApiOkResponse({ type: FinanceReferenceDataDto })
  referenceData(): Promise<FinanceReferenceDataDto> {
    return this.finance.referenceData();
  }

  @Get('documents')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'erp.finance' })
  @ApiOkResponse({ isArray: true, type: FinanceCustomerDocumentDto })
  documents(): Promise<FinanceCustomerDocumentDto[]> {
    return this.finance.documents();
  }

  @Get('documents/:id')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'erp.finance' })
  @ApiOkResponse({ type: FinanceCustomerDocumentDto })
  @ApiParam({ format: 'uuid', name: 'id' })
  document(@Param('id') id: string): Promise<FinanceCustomerDocumentDto> {
    return this.finance.document(id);
  }

  @Get('summary')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'erp.finance' })
  @ApiOkResponse({ type: FinanceSummaryDto })
  summary(): Promise<FinanceSummaryDto> {
    return this.finance.summary();
  }

  @Post('documents')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ action: 'create', module: 'erp.finance' })
  @ApiBody({ type: CreateFinanceCustomerDocumentDto })
  @ApiCreatedResponse({ type: FinanceCustomerDocumentDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  createDocument(
    @Body() input: CreateFinanceCustomerDocumentDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<FinanceCustomerDocumentDto> {
    return this.finance.createDocument(input, key, request.authentication, metadata(request));
  }

  @Post('documents/:id/payments')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ action: 'create', module: 'erp.finance' })
  @ApiBody({ type: CreateFinancePaymentDto })
  @ApiCreatedResponse({ type: FinanceCustomerDocumentDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiParam({ format: 'uuid', name: 'id' })
  recordPayment(
    @Param('id') id: string,
    @Body() input: CreateFinancePaymentDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<FinanceCustomerDocumentDto> {
    return this.finance.recordPayment(id, input, key, request.authentication, metadata(request));
  }

  @Post('documents/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ action: 'edit', module: 'erp.finance' })
  @ApiBody({ type: CancelFinanceCustomerDocumentDto })
  @ApiOkResponse({ type: FinanceCustomerDocumentDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiParam({ format: 'uuid', name: 'id' })
  cancelDocument(
    @Param('id') id: string,
    @Body() input: CancelFinanceCustomerDocumentDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<FinanceCustomerDocumentDto> {
    return this.finance.cancelDocument(id, input, key, request.authentication, metadata(request));
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
