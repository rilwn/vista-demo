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
import type {
  AuthenticatedRequest,
  RequestSecurityMetadata,
} from '../auth/authentication.types.js';
import type { CorrelatedRequest } from '../common/correlation-id.middleware.js';
import { RateLimitPolicy } from '../security/rate-limit.decorator.js';
import {
  CreatePosCashSaleDto,
  ClosePosShiftDto,
  OpenPosShiftDto,
  PosCatalogPageDto,
  PosCatalogQueryDto,
  PosCustomerOptionDto,
  PosCustomerQueryDto,
  PosSaleDto,
  PosSalePageDto,
  PosSalePageQueryDto,
  PosShiftDto,
  PosTerminalContextDto,
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
      query.page,
      query.pageSize,
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

  @Post('sales')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ action: 'create', module: 'pos' })
  @ApiBody({ type: CreatePosCashSaleDto })
  @ApiCreatedResponse({ type: PosSaleDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  completeSale(
    @Body() input: CreatePosCashSaleDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<PosSaleDto> {
    return this.pos.completeCashSale(input, key, request.authentication, metadata(request));
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
    return this.pos.sales(query.page, query.pageSize, request.authentication);
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
