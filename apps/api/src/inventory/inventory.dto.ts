import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  warehouseTypes,
  stockReservationReferenceTypes,
  type CreateStockReservationRequest,
  type ConfigureStockSettingsRequest,
  type CreateWarehouseRequest,
  stockIssueReasons,
  type IssueStockRequest,
  type ReceiveStockRequest,
  type ReturnStockRequest,
  type ReplenishmentStatus,
  type SerialTraceability,
  type SerialTraceEvent,
  type SerialTraceParty,
  type StockBalance,
  type StockIssue,
  type StockReceipt,
  type StockReturn,
  type StockReservation,
  type StockSettings,
  type StockTransfer,
  type TransferStockRequest,
  type OpenStocktakeRequest,
  type RecordStocktakeCountRequest,
  type StocktakeBatchCount,
  type Stocktake,
  type Warehouse,
  stockReturnDispositions,
} from '@vista/contracts';

export class CreateWarehouseDto {
  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @IsOptional()
  @IsUUID('loose')
  businessLocationId?: string;

  @ApiProperty({ type: String, maxLength: 30, minLength: 1 })
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  code!: string;
  @ApiProperty({ type: String, maxLength: 120, minLength: 1 })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;
  @ApiPropertyOptional({ enum: warehouseTypes })
  @IsOptional()
  @IsIn(warehouseTypes)
  type?: CreateWarehouseRequest['type'];

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @IsOptional()
  @IsUUID('loose')
  technicianOperatorId?: string;
}

export class ReceiveStockDto implements ReceiveStockRequest {
  @ApiPropertyOptional({ type: String, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  batchNumber?: string;
  @ApiPropertyOptional({ type: String, format: 'date' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
  @ApiProperty({ type: String, format: 'uuid' }) @IsUUID('loose') productId!: string;
  @ApiProperty({ type: String, example: '1.0000' })
  @IsString()
  @Matches(/^\d+(\.\d{1,4})?$/u)
  quantity!: string;
  @ApiProperty({ type: String, maxLength: 120, minLength: 1 })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  referenceId!: string;
  @ApiPropertyOptional({ type: [String], maxItems: 500 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  serialNumbers?: string[];
  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @IsOptional()
  @IsUUID('loose')
  supplierPartnerId?: string;
  @ApiPropertyOptional({ type: String, example: '125.5000' })
  @IsOptional()
  @IsString()
  @Matches(/^\d+(\.\d{1,4})?$/u)
  unitCostBgn?: string;
  @ApiProperty({ type: String, format: 'uuid' }) @IsUUID('loose') warehouseId!: string;
}

export class IssueStockDto implements IssueStockRequest {
  @ApiPropertyOptional({ type: String, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  batchNumber?: string;
  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @IsOptional()
  @IsUUID('loose')
  customerPartnerId?: string;
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID('loose')
  productId!: string;
  @ApiProperty({ type: String, example: '1.0000' })
  @IsString()
  @Matches(/^\d+(\.\d{1,4})?$/u)
  quantity!: string;
  @ApiProperty({ enum: stockIssueReasons })
  @IsIn(stockIssueReasons)
  reason!: IssueStockRequest['reason'];
  @ApiProperty({ type: String, maxLength: 120, minLength: 1 })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  referenceId!: string;
  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @IsOptional()
  @IsUUID('loose')
  reservationId?: string;
  @ApiPropertyOptional({ type: [String], maxItems: 500 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  serialNumbers?: string[];
  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @IsOptional()
  @IsUUID('loose')
  technicianAccountId?: string;
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID('loose')
  warehouseId!: string;
}

export class WarehouseDto implements Warehouse {
  @ApiProperty({ type: Boolean }) active!: boolean;
  @ApiPropertyOptional({ type: String, format: 'uuid' }) businessLocationId?: string;
  @ApiProperty({ type: String }) code!: string;
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiPropertyOptional({ type: String, format: 'uuid' }) technicianOperatorId?: string;
  @ApiProperty({ enum: warehouseTypes }) type!: Warehouse['type'];
  @ApiProperty({ type: Number }) version!: number;
}

export class StockBalanceDto implements StockBalance {
  @ApiProperty({ type: String }) availableQuantity!: string;
  @ApiProperty({ type: String }) averageUnitCostBgn!: string;
  @ApiProperty({ type: String }) inventoryValueBgn!: string;
  @ApiProperty({ type: String, format: 'uuid' }) productId!: string;
  @ApiProperty({ type: String }) quantity!: string;
  @ApiProperty({ type: String }) reservedQuantity!: string;
  @ApiProperty({ type: String, format: 'uuid' }) warehouseId!: string;
}

export class StockReceiptDto implements StockReceipt {
  @ApiPropertyOptional({ type: String, format: 'uuid' }) batchId?: string;
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) productId!: string;
  @ApiProperty({ type: String }) quantity!: string;
  @ApiProperty({ type: [String], format: 'uuid' }) serialItemIds!: string[];
  @ApiProperty({ type: String }) totalCostBgn!: string;
  @ApiProperty({ type: String }) unitCostBgn!: string;
  @ApiProperty({ type: String, format: 'uuid' }) warehouseId!: string;
}

export class StockIssueDto implements StockIssue {
  @ApiPropertyOptional({ type: String, format: 'uuid' }) batchId?: string;
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) productId!: string;
  @ApiProperty({ type: String }) quantity!: string;
  @ApiProperty({ enum: stockIssueReasons }) reason!: StockIssue['reason'];
  @ApiPropertyOptional({ type: String, format: 'uuid' }) reservationId?: string;
  @ApiProperty({ type: [String], format: 'uuid' }) serialItemIds!: string[];
  @ApiProperty({ type: String }) totalCostBgn!: string;
  @ApiProperty({ type: String }) unitCostBgn!: string;
  @ApiProperty({ type: String, format: 'uuid' }) warehouseId!: string;
}

export class ReturnStockDto implements ReturnStockRequest {
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID('loose')
  destinationWarehouseId!: string;

  @ApiProperty({ enum: stockReturnDispositions })
  @IsIn(stockReturnDispositions)
  disposition!: ReturnStockRequest['disposition'];

  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID('loose')
  originalIssueId!: string;

  @ApiProperty({ type: String, example: '1.0000' })
  @IsString()
  @Matches(/^\d+(\.\d{1,4})?$/u)
  quantity!: string;

  @ApiProperty({ type: String, maxLength: 120, minLength: 1 })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  referenceId!: string;

  @ApiPropertyOptional({ type: [String], maxItems: 500 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  serialNumbers?: string[];
}

export class StockReturnDto implements StockReturn {
  @ApiPropertyOptional({ type: String, format: 'uuid' }) batchId?: string;
  @ApiProperty({ type: String, format: 'uuid' }) destinationWarehouseId!: string;
  @ApiProperty({ enum: stockReturnDispositions }) disposition!: StockReturn['disposition'];
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) originalIssueId!: string;
  @ApiProperty({ type: String, format: 'uuid' }) productId!: string;
  @ApiProperty({ type: String }) quantity!: string;
  @ApiProperty({ isArray: true, type: String }) serialItemIds!: string[];
  @ApiProperty({ type: String }) totalCostBgn!: string;
  @ApiProperty({ type: String }) unitCostBgn!: string;
}

export class TransferStockDto implements TransferStockRequest {
  @ApiPropertyOptional({ type: String, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  batchNumber?: string;
  @ApiProperty({ type: String, format: 'uuid' }) @IsUUID('loose') fromWarehouseId!: string;
  @ApiProperty({ type: String, format: 'uuid' }) @IsUUID('loose') productId!: string;
  @ApiProperty({ type: String, example: '1.0000' })
  @IsString()
  @Matches(/^\d+(\.\d{1,4})?$/u)
  quantity!: string;
  @ApiProperty({ type: String, maxLength: 120, minLength: 1 })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  referenceId!: string;
  @ApiPropertyOptional({ type: [String], maxItems: 500 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  serialNumbers?: string[];
  @ApiProperty({ type: String, format: 'uuid' }) @IsUUID('loose') toWarehouseId!: string;
}

export class StockTransferDto implements StockTransfer {
  @ApiPropertyOptional({ type: String, format: 'uuid' }) batchId?: string;
  @ApiProperty({ type: String, format: 'uuid' }) fromMovementId!: string;
  @ApiProperty({ type: String, format: 'uuid' }) fromWarehouseId!: string;
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) productId!: string;
  @ApiProperty({ type: String }) quantity!: string;
  @ApiProperty({ type: [String], format: 'uuid' }) serialItemIds!: string[];
  @ApiProperty({ type: String, format: 'uuid' }) toMovementId!: string;
  @ApiProperty({ type: String, format: 'uuid' }) toWarehouseId!: string;
  @ApiProperty({ type: String }) totalCostBgn!: string;
  @ApiProperty({ type: String }) unitCostBgn!: string;
}

export class OpenStocktakeDto implements OpenStocktakeRequest {
  @ApiProperty({ type: String, maxLength: 120, minLength: 1 })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  referenceId!: string;
  @ApiProperty({ type: String, format: 'uuid' }) @IsUUID('loose') warehouseId!: string;
}
export class RecordStocktakeCountDto implements RecordStocktakeCountRequest {
  @ApiPropertyOptional({ type: () => [StocktakeBatchCountDto], maxItems: 500 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => StocktakeBatchCountDto)
  batches?: StocktakeBatchCountDto[];
  @ApiProperty({ type: String, example: '1.0000' })
  @IsString()
  @Matches(/^\d+(\.\d{1,4})?$/u)
  countedQuantity!: string;
  @ApiProperty({ type: String, format: 'uuid' }) @IsUUID('loose') productId!: string;
  @ApiPropertyOptional({ type: [String], maxItems: 500 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  serialNumbers?: string[];
}
export class StocktakeBatchCountDto implements StocktakeBatchCount {
  @ApiProperty({ type: String, maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  batchNumber!: string;
  @ApiProperty({ type: String, example: '1.0000' })
  @IsString()
  @Matches(/^\d+(\.\d{1,4})?$/u)
  countedQuantity!: string;
  @ApiPropertyOptional({ type: String, format: 'date' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
export class StocktakeDto implements Stocktake {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) referenceId!: string;
  @ApiProperty({ enum: ['open', 'completed', 'cancelled'] }) status!: Stocktake['status'];
  @ApiProperty({ type: String, format: 'uuid' }) warehouseId!: string;
}

export class CreateStockReservationDto implements CreateStockReservationRequest {
  @ApiProperty({ type: String, format: 'uuid' }) @IsUUID('loose') productId!: string;
  @ApiProperty({ type: String, example: '1.0000' })
  @IsString()
  @Matches(/^\d+(\.\d{1,4})?$/u)
  quantity!: string;
  @ApiProperty({ type: String, maxLength: 120, minLength: 1 })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  referenceId!: string;
  @ApiProperty({ enum: stockReservationReferenceTypes })
  @IsIn(stockReservationReferenceTypes)
  referenceType!: CreateStockReservationRequest['referenceType'];
  @ApiPropertyOptional({ type: [String], maxItems: 500 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  serialNumbers?: string[];
  @ApiProperty({ type: String, format: 'uuid' }) @IsUUID('loose') warehouseId!: string;
}

export class StockReservationDto implements StockReservation {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) initialQuantity!: string;
  @ApiProperty({ type: String, format: 'uuid' }) productId!: string;
  @ApiProperty({ type: String }) referenceId!: string;
  @ApiProperty({ enum: stockReservationReferenceTypes })
  referenceType!: StockReservation['referenceType'];
  @ApiProperty({ type: String }) remainingQuantity!: string;
  @ApiProperty({ type: [String], format: 'uuid' }) serialItemIds!: string[];
  @ApiProperty({ enum: ['active', 'released', 'consumed'] })
  status!: StockReservation['status'];
  @ApiProperty({ type: String, format: 'uuid' }) warehouseId!: string;
}

export class ConfigureStockSettingsDto implements ConfigureStockSettingsRequest {
  @ApiPropertyOptional({ type: [String], format: 'uuid', maxItems: 50 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('loose', { each: true })
  alertRecipientAccountIds?: string[];

  @ApiProperty({ type: String, example: '2.0000' })
  @IsString()
  @Matches(/^\d+(\.\d{1,4})?$/u)
  minimumQuantity!: string;
  @ApiProperty({ type: String, format: 'uuid' }) @IsUUID('loose') productId!: string;
  @ApiProperty({ type: String, example: '8.0000' })
  @IsString()
  @Matches(/^\d+(\.\d{1,4})?$/u)
  targetQuantity!: string;
  @ApiProperty({ type: String, format: 'uuid' }) @IsUUID('loose') warehouseId!: string;
}
export class StockSettingsDto implements StockSettings {
  @ApiProperty({ type: [String], format: 'uuid' }) alertRecipientAccountIds!: string[];
  @ApiProperty({ type: String }) minimumQuantity!: string;
  @ApiProperty({ type: String, format: 'uuid' }) productId!: string;
  @ApiProperty({ type: String }) targetQuantity!: string;
  @ApiProperty({ type: Number }) version!: number;
  @ApiProperty({ type: String, format: 'uuid' }) warehouseId!: string;
}
export class ReplenishmentStatusDto implements ReplenishmentStatus {
  @ApiProperty({ type: String }) availableQuantity!: string;
  @ApiProperty({ type: Boolean }) lowStock!: boolean;
  @ApiProperty({ type: String }) minimumQuantity!: string;
  @ApiProperty({ type: String }) physicalQuantity!: string;
  @ApiProperty({ type: String, format: 'uuid' }) productId!: string;
  @ApiProperty({ type: String }) recommendedQuantity!: string;
  @ApiProperty({ type: String }) reservedQuantity!: string;
  @ApiProperty({ type: String }) targetQuantity!: string;
  @ApiProperty({ type: String, format: 'uuid' }) warehouseId!: string;
}

export class SerialTracePartyDto implements SerialTraceParty {
  @ApiProperty({ type: String }) displayName!: string;
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
}
export class SerialTraceEventDto implements SerialTraceEvent {
  @ApiProperty({ type: SerialTracePartyDto }) actor!: SerialTraceParty;
  @ApiPropertyOptional({ type: SerialTracePartyDto }) customer?: SerialTraceParty;
  @ApiProperty({ enum: ['receipt', 'transfer', 'issue', 'return', 'stocktake'] })
  eventType!: SerialTraceEvent['eventType'];
  @ApiPropertyOptional({ type: SerialTracePartyDto }) fromWarehouse?: SerialTraceParty;
  @ApiProperty({ type: String, format: 'uuid' }) movementId!: string;
  @ApiProperty({ type: String, format: 'date-time' }) occurredAt!: string;
  @ApiProperty({ type: String }) referenceId!: string;
  @ApiProperty({ type: String }) referenceType!: string;
  @ApiPropertyOptional({ type: SerialTracePartyDto }) supplier?: SerialTraceParty;
  @ApiPropertyOptional({ type: SerialTracePartyDto }) technician?: SerialTraceParty;
  @ApiPropertyOptional({ type: SerialTracePartyDto }) toWarehouse?: SerialTraceParty;
  @ApiProperty({ type: String }) unitCostBgn!: string;
  @ApiProperty({ type: SerialTracePartyDto }) warehouse!: SerialTraceParty;
}
export class SerialTraceabilityDto implements SerialTraceability {
  @ApiProperty({ type: SerialTracePartyDto }) currentWarehouse!: SerialTraceParty;
  @ApiProperty({ type: [SerialTraceEventDto] }) events!: SerialTraceEvent[];
  @ApiProperty({ type: SerialTracePartyDto }) product!: SerialTraceParty;
  @ApiProperty({ type: String, format: 'uuid' }) serialItemId!: string;
  @ApiProperty({ type: String }) serialNumber!: string;
  @ApiProperty({ enum: ['available', 'issued', 'missing'] })
  status!: SerialTraceability['status'];
}
