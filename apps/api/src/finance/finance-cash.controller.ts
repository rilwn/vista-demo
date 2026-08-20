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
  CancelFinanceCashVoucherDto,
  CreateFinanceCashVoucherDto,
  FinanceCashDailyReportDto,
  FinanceCashDailyReportQueryDto,
  FinanceCashReferenceDataDto,
  FinanceCashVoucherDto,
  FinanceCashVoucherListQueryDto,
  FinanceCashVoucherPageDto,
} from './finance-cash.dto.js';
import { FinanceCashService } from './finance-cash.service.js';

@ApiTags('finance-cash')
@ApiBearerAuth()
@RateLimitPolicy('write')
@Controller('finance/cash')
export class FinanceCashController {
  constructor(@Inject(FinanceCashService) private readonly cash: FinanceCashService) {}

  @Get('reference-data')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'erp.finance' })
  @ApiOkResponse({ type: FinanceCashReferenceDataDto })
  referenceData(): Promise<FinanceCashReferenceDataDto> {
    return this.cash.referenceData();
  }

  @Get('vouchers')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'erp.finance' })
  @ApiOkResponse({ type: FinanceCashVoucherPageDto })
  @ApiQuery({ format: 'uuid', name: 'cashRegisterId', required: false, type: String })
  @ApiQuery({ format: 'date', name: 'dateFrom', required: false, type: String })
  @ApiQuery({ format: 'date', name: 'dateTo', required: false, type: String })
  @ApiQuery({ enum: ['receipt', 'payment'], name: 'direction', required: false })
  @ApiQuery({ default: 1, minimum: 1, name: 'page', required: false, type: Number })
  @ApiQuery({
    default: 20,
    maximum: 100,
    minimum: 1,
    name: 'pageSize',
    required: false,
    type: Number,
  })
  @ApiQuery({ enum: ['issued', 'cancelled'], name: 'status', required: false })
  vouchers(@Query() query: FinanceCashVoucherListQueryDto): Promise<FinanceCashVoucherPageDto> {
    return this.cash.vouchers(query);
  }

  @Get('vouchers/:id')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'erp.finance' })
  @ApiOkResponse({ type: FinanceCashVoucherDto })
  @ApiParam({ format: 'uuid', name: 'id' })
  voucher(@Param('id') id: string): Promise<FinanceCashVoucherDto> {
    return this.cash.voucher(id);
  }

  @Get('daily-report')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'erp.finance' })
  @ApiOkResponse({ type: FinanceCashDailyReportDto })
  @ApiQuery({ format: 'uuid', name: 'cashRegisterId', type: String })
  @ApiQuery({ format: 'date', name: 'date', type: String })
  dailyReport(@Query() query: FinanceCashDailyReportQueryDto): Promise<FinanceCashDailyReportDto> {
    return this.cash.dailyReport(query);
  }

  @Post('vouchers')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ action: 'create', module: 'erp.finance' })
  @ApiBody({ type: CreateFinanceCashVoucherDto })
  @ApiCreatedResponse({ type: FinanceCashVoucherDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  createVoucher(
    @Body() input: CreateFinanceCashVoucherDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<FinanceCashVoucherDto> {
    return this.cash.createVoucher(input, key, request.authentication, metadata(request));
  }

  @Post('vouchers/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ action: 'edit', module: 'erp.finance' })
  @ApiBody({ type: CancelFinanceCashVoucherDto })
  @ApiOkResponse({ type: FinanceCashVoucherDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiParam({ format: 'uuid', name: 'id' })
  cancelVoucher(
    @Param('id') id: string,
    @Body() input: CancelFinanceCashVoucherDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<FinanceCashVoucherDto> {
    return this.cash.cancelVoucher(id, input, key, request.authentication, metadata(request));
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
