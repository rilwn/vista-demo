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
import type {
  AuthenticatedRequest,
  RequestSecurityMetadata,
} from '../auth/authentication.types.js';
import type { CorrelatedRequest } from '../common/correlation-id.middleware.js';
import { RateLimitPolicy } from '../security/rate-limit.decorator.js';
import {
  CreatePosDiscountAuthorizationDto,
  CreatePosReturnDto,
  CreatePosSaleDto,
  ClosePosShiftDto,
  EnrolPosLoyaltyDto,
  OpenPosShiftDto,
  PosCatalogPageDto,
  PosCatalogQueryDto,
  PosCustomerOptionDto,
  PosCustomerQueryDto,
  PosDiscountAuthorizationDto,
  PosLoyaltyAccountDto,
  PosLoyaltyLedgerDto,
  PosBasketPricingDto,
  PosQuickAccessDto,
  PosQuickAccessQueryDto,
  PosReturnDto,
  PosReturnPageDto,
  PosReturnPageQueryDto,
  PosSaleDto,
  PosSalePageDto,
  PosSalePageQueryDto,
  PosShiftDto,
  PosTerminalContextDto,
  PricePosBasketDto,
  UpdatePosQuickAccessDto,
} from './pos.dto.js';
import { PosService } from './pos.service.js';

@ApiTags('point of sale')
@ApiBearerAuth()
@RateLimitPolicy('write')
@Controller('pos')
export class PosController {
  constructor(@Inject(PosService) private readonly pos: PosService) {}

  @Get('terminal-context')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'pos' })
  @ApiOkResponse({ type: PosTerminalContextDto })
  terminalContext(@Req() request: AuthenticatedRequest): Promise<PosTerminalContextDto> {
    return this.pos.terminalContext(request.authentication);
  }

  @Post('shifts')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ action: 'create', module: 'pos' })
  @ApiBody({ type: OpenPosShiftDto })
  @ApiCreatedResponse({ type: PosShiftDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  openShift(
    @Body() input: OpenPosShiftDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<PosShiftDto> {
    return this.pos.openShift(input, key, request.authentication, metadata(request));
  }

  @Post('shifts/:id/close')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ action: 'create', module: 'pos' })
  @ApiBody({ type: ClosePosShiftDto })
  @ApiOkResponse({ type: PosShiftDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiParam({ format: 'uuid', name: 'id', type: String })
  closeShift(
    @Param('id') id: string,
    @Body() input: ClosePosShiftDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<PosShiftDto> {
    return this.pos.closeShift(id, input, key, request.authentication, metadata(request));
  }

  @Get('catalog')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'pos' })
  @ApiOkResponse({ type: PosCatalogPageDto })
  @ApiQuery({ format: 'uuid', name: 'shiftId', required: true, type: String })
  @ApiQuery({ format: 'uuid', name: 'customerPartnerId', required: false, type: String })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  catalog(
    @Query() query: PosCatalogQueryDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<PosCatalogPageDto> {
    return this.pos.catalog(
      query.shiftId,
      query.customerPartnerId,
      query.search,
      query.page ?? 1,
      query.pageSize ?? 24,
      request.authentication,
    );
  }

  @Get('customers')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'pos' })
  @ApiOkResponse({ isArray: true, type: PosCustomerOptionDto })
  @ApiQuery({ name: 'search', required: false, type: String })
  customers(@Query() query: PosCustomerQueryDto): Promise<PosCustomerOptionDto[]> {
    return this.pos.customers(query.search);
  }

  @Get('quick-access')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'pos' })
  @ApiOkResponse({ type: PosQuickAccessDto })
  @ApiQuery({ format: 'uuid', name: 'shiftId', required: true, type: String })
  @ApiQuery({ format: 'uuid', name: 'customerPartnerId', required: false, type: String })
  quickAccess(
    @Query() query: PosQuickAccessQueryDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<PosQuickAccessDto> {
    return this.pos.quickAccess(query.shiftId, query.customerPartnerId, request.authentication);
  }

  @Put('quick-access')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ action: 'edit', module: 'pos' })
  @ApiBody({ type: UpdatePosQuickAccessDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ type: PosQuickAccessDto })
  updateQuickAccess(
    @Body() input: UpdatePosQuickAccessDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<PosQuickAccessDto> {
    return this.pos.updateQuickAccess(input, key, request.authentication, metadata(request));
  }

  @Post('baskets/price')
  @HttpCode(HttpStatus.OK)
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'pos' })
  @ApiBody({ type: PricePosBasketDto })
  @ApiOkResponse({ type: PosBasketPricingDto })
  priceBasket(
    @Body() input: PricePosBasketDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<PosBasketPricingDto> {
    return this.pos.priceBasket(input, request.authentication);
  }

  @Post('discount-authorizations')
  @HttpCode(HttpStatus.CREATED)
  @RateLimitPolicy('sensitive')
  @RequirePermissions({ action: 'create', module: 'pos' })
  @ApiBody({ type: CreatePosDiscountAuthorizationDto })
  @ApiCreatedResponse({ type: PosDiscountAuthorizationDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  authorizeDiscount(
    @Body() input: CreatePosDiscountAuthorizationDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<PosDiscountAuthorizationDto> {
    return this.pos.authorizeDiscount(input, key, request.authentication, metadata(request));
  }

  @Post('loyalty/accounts')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ action: 'create', module: 'pos' })
  @ApiBody({ type: EnrolPosLoyaltyDto })
  @ApiCreatedResponse({ type: PosLoyaltyAccountDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  enrolLoyalty(
    @Body() input: EnrolPosLoyaltyDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<PosLoyaltyAccountDto> {
    return this.pos.enrolLoyalty(input, key, request.authentication, metadata(request));
  }

  @Get('loyalty/customers/:customerPartnerId')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'pos' })
  @ApiOkResponse({ type: PosLoyaltyLedgerDto })
  @ApiParam({ format: 'uuid', name: 'customerPartnerId', type: String })
  loyaltyLedger(
    @Param('customerPartnerId') customerPartnerId: string,
  ): Promise<PosLoyaltyLedgerDto> {
    return this.pos.loyaltyLedger(customerPartnerId);
  }

  @Post('sales')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ action: 'create', module: 'pos' })
  @ApiBody({ type: CreatePosSaleDto })
  @ApiCreatedResponse({ type: PosSaleDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  completeSale(
    @Body() input: CreatePosSaleDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<PosSaleDto> {
    return this.pos.completeSale(input, key, request.authentication, metadata(request));
  }

  @Get('sales')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'pos' })
  @ApiOkResponse({ type: PosSalePageDto })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  sales(
    @Query() query: PosSalePageQueryDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<PosSalePageDto> {
    return this.pos.sales(query.page ?? 1, query.pageSize ?? 25, request.authentication);
  }

  @Post('returns')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ action: 'edit', module: 'pos' })
  @ApiBody({ type: CreatePosReturnDto })
  @ApiCreatedResponse({ type: PosReturnDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  createReturn(
    @Body() input: CreatePosReturnDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<PosReturnDto> {
    return this.pos.createReturn(input, key, request.authentication, metadata(request));
  }

  @Get('returns')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'pos' })
  @ApiOkResponse({ type: PosReturnPageDto })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  returns(
    @Query() query: PosReturnPageQueryDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<PosReturnPageDto> {
    return this.pos.returns(query.page ?? 1, query.pageSize ?? 25, request.authentication);
  }
}

function metadata(request: AuthenticatedRequest): RequestSecurityMetadata {
  const correlated = request as CorrelatedRequest;
  const userAgent = request.header('user-agent');
  return {
    correlationId: correlated.correlationId,
    ...(request.ip ? { sourceIp: request.ip } : {}),
    ...(userAgent ? { userAgent } : {}),
  };
}
