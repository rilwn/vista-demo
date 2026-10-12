import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Matches,
  MaxLength,
  Min,
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
  type SerialTraceDetail,
  type SerialTraceEvent,
  type SerialTraceParty,
  type StockBalance,
  type StockMovementJournalItem,
  type StockMovementJournalPage,
  type StockMovementJournalQuery,
  type StockMovementType,
  type StockIssue,
  type StockReceipt,
  type StockReturn,
  type StockReservation,
  type StockReservationPage,
  type StockReservationQuery,
  type StockSettings,
  type StockTransfer,
  type TransferStockRequest,
  type OpenStocktakeRequest,
  type RecordStocktakeCountRequest,
  type StocktakeBatchCount,
  type Stocktake,
  type Warehouse,
  stockMovementTypes,
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

export class StockMovementJournalQueryDto implements StockMovementJournalQuery {
  @ApiPropertyOptional({ enum: stockMovementTypes })
  @IsOptional()
  @IsIn(stockMovementTypes)
  movementType?: StockMovementType;

  @ApiPropertyOptional({ default: 1, minimum: 1, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 25, maximum: 100, minimum: 1, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 25;

  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID('loose')
  productId?: string;

  @ApiPropertyOptional({ maxLength: 120, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID('loose')
  warehouseId?: string;
}

export class SerialTraceabilitySearchQueryDto {
  @ApiProperty({ maxLength: 120, minLength: 2, type: String })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  search!: string;
}

export class StockMovementJournalItemDto implements StockMovementJournalItem {
  @ApiProperty({ type: String }) actorDisplayName!: string;
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'date-time' }) occurredAt!: string;
  @ApiProperty({ enum: stockMovementTypes }) movementType!: StockMovementType;
  @ApiProperty({ type: String }) productCode!: string;
  @ApiProperty({ type: String, format: 'uuid' }) productId!: string;
  @ApiProperty({ type: String }) productName!: string;
  @ApiProperty({ type: String }) quantity!: string;
  @ApiProperty({ type: String }) referenceLabel!: string;
  @ApiProperty({ type: String }) referenceType!: string;
  @ApiPropertyOptional({ type: String }) sourceHref?: string;
  @ApiProperty({ type: String }) totalCostBgn!: string;
  @ApiProperty({ type: String }) unitCostBgn!: string;
  @ApiProperty({ type: String, format: 'uuid' }) warehouseId!: string;
  @ApiProperty({ type: String }) warehouseName!: string;
}

export class StockMovementJournalPageDto implements StockMovementJournalPage {
  @ApiProperty({ isArray: true, type: StockMovementJournalItemDto })
  items!: StockMovementJournalItem[];
  @ApiProperty({ type: Number }) page!: number;
  @ApiProperty({ type: Number }) pageSize!: number;
  @ApiProperty({ type: Number }) total!: number;
  @ApiProperty({ type: Number }) totalPages!: number;
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
  @ApiProperty({ type: String }) referenceLabel!: string;
  @ApiProperty({ enum: stockReservationReferenceTypes })
  referenceType!: StockReservation['referenceType'];
  @ApiProperty({ type: String }) remainingQuantity!: string;
  @ApiProperty({ type: [String], format: 'uuid' }) serialItemIds!: string[];
  @ApiProperty({ enum: ['active', 'released', 'consumed'] })
  status!: StockReservation['status'];
  @ApiProperty({ type: String, format: 'uuid' }) warehouseId!: string;
}

export class StockReservationQueryDto implements StockReservationQuery {
  @ApiPropertyOptional({ default: 1, minimum: 1, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 25, maximum: 100, minimum: 1, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 25;
}

export class StockReservationPageDto implements StockReservationPage {
  @ApiProperty({ isArray: true, type: StockReservationDto }) items!: StockReservation[];
  @ApiProperty({ type: Number }) page!: number;
  @ApiProperty({ type: Number }) pageSize!: number;
  @ApiProperty({ type: Number }) total!: number;
  @ApiProperty({ type: Number }) totalPages!: number;
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
interface SerialTraceProduct {
  displayName: string;
  id?: string;
}
class SerialTraceProductDto implements SerialTraceProduct {
  @ApiProperty({ type: String }) displayName!: string;
  @ApiPropertyOptional({ type: String, format: 'uuid' }) id?: string;
}
export class SerialTraceDetailDto implements SerialTraceDetail {
  @ApiProperty({ type: String }) label!: string;
  @ApiProperty({ type: String }) value!: string;
}
export class SerialTraceEventDto implements SerialTraceEvent {
  @ApiPropertyOptional({ type: SerialTracePartyDto }) actor?: SerialTraceParty;
  @ApiPropertyOptional({ type: SerialTracePartyDto }) customer?: SerialTraceParty;
  @ApiPropertyOptional({ type: SerialTracePartyDto }) customerLocation?: SerialTraceParty;
  @ApiPropertyOptional({ type: String }) description?: string;
  @ApiPropertyOptional({ type: [SerialTraceDetailDto] }) details?: SerialTraceDetail[];
  @ApiProperty({ type: String }) eventId!: string;
  @ApiProperty({
    enum: [
      'receipt',
      'transfer',
      'sale',
      'handover',
      'issue',
      'return_registered',
      'return_received',
      'service_requested',
      'service_scheduled',
      'service_started',
      'repair_completed',
      'stocktake',
    ],
  })
  eventType!: SerialTraceEvent['eventType'];
  @ApiPropertyOptional({ type: SerialTracePartyDto }) fromWarehouse?: SerialTraceParty;
  @ApiPropertyOptional({ type: String, format: 'uuid' }) movementId?: string;
  @ApiProperty({ type: String, format: 'date-time' }) occurredAt!: string;
  @ApiProperty({ type: String }) referenceId!: string;
  @ApiProperty({ type: String }) referenceType!: string;
  @ApiPropertyOptional({ type: SerialTracePartyDto }) supplier?: SerialTraceParty;
  @ApiPropertyOptional({ type: SerialTracePartyDto }) technician?: SerialTraceParty;
  @ApiPropertyOptional({ type: SerialTracePartyDto }) toWarehouse?: SerialTraceParty;
  @ApiPropertyOptional({ type: String }) unitCostBgn?: string;
  @ApiPropertyOptional({ type: SerialTracePartyDto }) warehouse?: SerialTraceParty;
}
class SerialTraceCustomerEquipmentDto {
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: SerialTracePartyDto }) location!: SerialTraceParty;
  @ApiProperty({ enum: ['active', 'under_repair', 'retired'] })
  status!: 'active' | 'under_repair' | 'retired';
}
class SerialTraceCustodyDto {
  @ApiProperty({ type: String }) displayName!: string;
  @ApiProperty({ enum: ['customer', 'service', 'warehouse'] })
  type!: 'customer' | 'service' | 'warehouse';
}
export class SerialTraceabilityDto implements SerialTraceability {
  @ApiProperty({ type: SerialTraceCustodyDto })
  currentCustody!: SerialTraceability['currentCustody'];
  @ApiPropertyOptional({ type: SerialTracePartyDto }) currentWarehouse?: SerialTraceParty;
  @ApiPropertyOptional({ type: SerialTracePartyDto }) customer?: SerialTraceParty;
  @ApiPropertyOptional({ type: SerialTraceCustomerEquipmentDto })
  customerEquipment?: NonNullable<SerialTraceability['customerEquipment']>;
  @ApiProperty({ type: [SerialTraceEventDto] }) events!: SerialTraceEvent[];
  @ApiProperty({ type: Boolean }) inventoryRecordLinked!: boolean;
  @ApiProperty({ type: SerialTraceProductDto }) product!: SerialTraceability['product'];
  @ApiPropertyOptional({ type: String, format: 'uuid' }) serialItemId?: string;
  @ApiProperty({ type: String }) serialNumber!: string;
  @ApiProperty({ enum: ['available', 'issued', 'missing'] })
  status!: SerialTraceability['status'];
}
