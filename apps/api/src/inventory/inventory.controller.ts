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
  CreateWarehouseDto,
  CreateStockReservationDto,
  ConfigureStockSettingsDto,
  IssueStockDto,
  ReceiveStockDto,
  ReturnStockDto,
  ReplenishmentStatusDto,
  SerialTraceabilityDto,
  StockBalanceDto,
  StockIssueDto,
  StockReceiptDto,
  StockReturnDto,
  StockReservationDto,
  StockSettingsDto,
  StockTransferDto,
  StocktakeDto,
  TransferStockDto,
  OpenStocktakeDto,
  RecordStocktakeCountDto,
  WarehouseDto,
} from './inventory.dto.js';
import { InventoryService } from './inventory.service.js';

@ApiTags('warehouse inventory')
@ApiBearerAuth()
@RateLimitPolicy('write')
@Controller('warehouse')
export class InventoryController {
  constructor(@Inject(InventoryService) private readonly inventory: InventoryService) {}
  @Get('warehouses')
  @RateLimitPolicy('read')
  @RequirePermissions({ module: 'erp.warehouse', action: 'view' })
  @ApiOkResponse({ isArray: true, type: WarehouseDto })
  warehouses(): Promise<WarehouseDto[]> {
    return this.inventory.warehouses();
  }
  @Post('warehouses')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ module: 'erp.warehouse', action: 'create' })
  @ApiBody({ type: CreateWarehouseDto })
  @ApiCreatedResponse({ type: WarehouseDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  createWarehouse(
    @Body() input: CreateWarehouseDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<WarehouseDto> {
    return this.inventory.createWarehouse(input, key, request.authentication, metadata(request));
  }
  @Get('stock-balances')
  @RateLimitPolicy('read')
  @RequirePermissions({ module: 'erp.warehouse', action: 'view' })
  @ApiOkResponse({ isArray: true, type: StockBalanceDto })
  balances(): Promise<StockBalanceDto[]> {
    return this.inventory.balances();
  }
  @Post('stock-receipts')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ module: 'erp.warehouse', action: 'create' })
  @ApiBody({ type: ReceiveStockDto })
  @ApiCreatedResponse({ type: StockReceiptDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  receive(
    @Body() input: ReceiveStockDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<StockReceiptDto> {
    return this.inventory.receive(input, key, request.authentication, metadata(request));
  }
  @Post('stock-returns')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ module: 'erp.warehouse', action: 'create' })
  @ApiBody({ type: ReturnStockDto })
  @ApiCreatedResponse({ type: StockReturnDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  returnStock(
    @Body() input: ReturnStockDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<StockReturnDto> {
    return this.inventory.returnStock(input, key, request.authentication, metadata(request));
  }
  @Post('stock-issues')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ module: 'erp.warehouse', action: 'create' })
  @ApiBody({ type: IssueStockDto })
  @ApiCreatedResponse({ type: StockIssueDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  issue(
    @Body() input: IssueStockDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<StockIssueDto> {
    return this.inventory.issue(input, key, request.authentication, metadata(request));
  }
  @Post('stock-transfers')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ module: 'erp.warehouse', action: 'create' })
  @ApiBody({ type: TransferStockDto })
  @ApiCreatedResponse({ type: StockTransferDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  transfer(
    @Body() input: TransferStockDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<StockTransferDto> {
    return this.inventory.transfer(input, key, request.authentication, metadata(request));
  }
  @Post('stocktakes')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ module: 'erp.warehouse', action: 'create' })
  @ApiBody({ type: OpenStocktakeDto })
  @ApiCreatedResponse({ type: StocktakeDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  openStocktake(
    @Body() input: OpenStocktakeDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<StocktakeDto> {
    return this.inventory.openStocktake(input, key, request.authentication, metadata(request));
  }
  @Post('stocktakes/:id/counts')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ module: 'erp.warehouse', action: 'create' })
  @ApiBody({ type: RecordStocktakeCountDto })
  @ApiCreatedResponse({ type: StocktakeDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  countStocktake(
    @Body() input: RecordStocktakeCountDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<StocktakeDto> {
    return this.inventory.recordStocktakeCount(
      id,
      input,
      key,
      request.authentication,
      metadata(request),
    );
  }
  @Post('stocktakes/:id/complete')
  @RateLimitPolicy('sensitive')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ module: 'erp.warehouse', action: 'approve' })
  @ApiCreatedResponse({ type: StocktakeDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  completeStocktake(
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<StocktakeDto> {
    return this.inventory.completeStocktake(id, key, request.authentication, metadata(request));
  }
  @Post('stock-reservations')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ module: 'erp.warehouse', action: 'create' })
  @ApiBody({ type: CreateStockReservationDto })
  @ApiCreatedResponse({ type: StockReservationDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  reserveStock(
    @Body() input: CreateStockReservationDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<StockReservationDto> {
    return this.inventory.reserve(input, key, request.authentication, metadata(request));
  }
  @Post('stock-reservations/:id/release')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ module: 'erp.warehouse', action: 'edit' })
  @ApiOkResponse({ type: StockReservationDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  releaseStockReservation(
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<StockReservationDto> {
    return this.inventory.releaseReservation(id, key, request.authentication, metadata(request));
  }
  @Post('stock-settings')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ module: 'erp.warehouse', action: 'edit' })
  @ApiBody({ type: ConfigureStockSettingsDto })
  @ApiOkResponse({ type: StockSettingsDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  configureStockSettings(
    @Body() input: ConfigureStockSettingsDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<StockSettingsDto> {
    return this.inventory.configureStockSettings(
      input,
      key,
      request.authentication,
      metadata(request),
    );
  }
  @Get('replenishment')
  @RateLimitPolicy('read')
  @RequirePermissions({ module: 'erp.warehouse', action: 'view' })
  @ApiOkResponse({ isArray: true, type: ReplenishmentStatusDto })
  replenishment(): Promise<ReplenishmentStatusDto[]> {
    return this.inventory.replenishment();
  }
  @Get('serial-traceability/:serialNumber')
  @RateLimitPolicy('read')
  @RequirePermissions({ module: 'erp.warehouse', action: 'view' })
  @ApiOkResponse({ type: SerialTraceabilityDto })
  serialTraceability(@Param('serialNumber') serialNumber: string): Promise<SerialTraceabilityDto> {
    return this.inventory.serialTraceability(serialNumber);
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
