import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
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
import {
  CreateWarehouseDto,
  ReceiveStockDto,
  StockBalanceDto,
  StockReceiptDto,
  WarehouseDto,
} from './inventory.dto.js';
import { InventoryService } from './inventory.service.js';

@ApiTags('warehouse inventory')
@ApiBearerAuth()
@Controller('warehouse')
export class InventoryController {
  constructor(@Inject(InventoryService) private readonly inventory: InventoryService) {}
  @Get('warehouses')
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
