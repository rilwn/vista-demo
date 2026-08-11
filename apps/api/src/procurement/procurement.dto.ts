import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  supplierClaimStatuses,
  supplierClaimTypes,
  purchaseOrderStatuses,
  type CreateSupplierClaimRequest,
  type CreateSupplierEvaluationRequest,
  type CreateSupplierInvoiceLineRequest,
  type CreateSupplierInvoiceRequest,
  type ProcurementSupplierRecord,
  type CreatePurchaseOrderLineRequest,
  type CreatePurchaseOrderRequest,
  type GoodsReceipt,
  type GoodsReceiptLine,
  type PurchaseOrder,
  type PurchaseOrderLine,
  type PurchaseOrderPage,
  type ProcurementReferenceData,
  type ReceivePurchaseOrderLineRequest,
  type ReceivePurchaseOrderRequest,
  type SupplierClaim,
  type SupplierClaimStatusEvent,
  type SupplierCommercialProfile,
  type SupplierEvaluation,
  type SupplierInvoice,
  type SupplierInvoiceLine,
  type UpdateSupplierClaimStatusRequest,
  type UpdateSupplierCommercialProfileRequest,
} from '@vista/contracts';

const decimalPattern = /^\d+(\.\d{1,4})?$/u;

export class CreatePurchaseOrderLineDto implements CreatePurchaseOrderLineRequest {
  @ApiProperty({ format: 'date', type: String })
  @IsDateString()
  expectedDeliveryDate!: string;

  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('4')
  productId!: string;

  @ApiProperty({ example: '1.0000', type: String })
  @IsString()
  @Matches(decimalPattern)
  quantity!: string;

  @ApiProperty({ example: '125.5000', type: String })
  @IsString()
  @Matches(decimalPattern)
  unitPrice!: string;
}

export class CreatePurchaseOrderDto implements CreatePurchaseOrderRequest {
  @ApiProperty({ example: 'BGN', maxLength: 3, minLength: 3, type: String })
  @IsString()
  @Matches(/^[A-Za-z]{3}$/u)
  currencyCode!: string;

  @ApiProperty({ isArray: true, type: CreatePurchaseOrderLineDto })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreatePurchaseOrderLineDto)
  lines!: CreatePurchaseOrderLineDto[];

  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('4')
  supplierPartnerId!: string;

  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('4')
  warehouseId!: string;
}

export class ReceivePurchaseOrderLineDto implements ReceivePurchaseOrderLineRequest {
  @ApiPropertyOptional({ maxLength: 100, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  batchNumber?: string;

  @ApiPropertyOptional({ format: 'date', type: String })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('4')
  orderLineId!: string;

  @ApiProperty({ example: '1.0000', type: String })
  @IsString()
  @Matches(decimalPattern)
  quantity!: string;

  @ApiPropertyOptional({ isArray: true, maxItems: 500, type: String })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  serialNumbers?: string[];

  @ApiPropertyOptional({ example: '125.5000', type: String })
  @IsOptional()
  @IsString()
  @Matches(decimalPattern)
  unitCostBgn?: string;
}

export class ReceivePurchaseOrderDto implements ReceivePurchaseOrderRequest {
  @ApiProperty({ isArray: true, type: ReceivePurchaseOrderLineDto })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ReceivePurchaseOrderLineDto)
  lines!: ReceivePurchaseOrderLineDto[];

  @ApiPropertyOptional({ maxLength: 120, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  supplierDeliveryReference?: string;
}

export class ListPurchaseOrdersQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1, type: Number })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 25, maximum: 100, minimum: 1, type: Number })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 25;

  @ApiPropertyOptional({ enum: purchaseOrderStatuses })
  @IsOptional()
  @IsIn(purchaseOrderStatuses)
  status?: PurchaseOrder['status'];

  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID('4')
  supplierPartnerId?: string;
}

export class PurchaseOrderLineDto implements PurchaseOrderLine {
  @ApiProperty({ type: String }) deliveredQuantity!: string;
  @ApiProperty({ format: 'date', type: String }) expectedDeliveryDate!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) invoicedQuantity!: string;
  @ApiProperty({ type: String }) orderedQuantity!: string;
  @ApiProperty({ format: 'uuid', type: String }) productId!: string;
  @ApiProperty({ type: String }) productName!: string;
  @ApiProperty({ type: String }) unitPrice!: string;
}

export class GoodsReceiptLineDto implements GoodsReceiptLine {
  @ApiPropertyOptional({ format: 'uuid', type: String }) batchId?: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ format: 'uuid', type: String }) orderLineId!: string;
  @ApiProperty({ format: 'uuid', type: String }) productId!: string;
  @ApiProperty({ type: String }) quantity!: string;
  @ApiProperty({ isArray: true, type: String }) serialItemIds!: string[];
  @ApiProperty({ format: 'uuid', type: String }) stockMovementId!: string;
  @ApiProperty({ type: String }) totalCostBgn!: string;
  @ApiProperty({ type: String }) unitCostBgn!: string;
}

export class GoodsReceiptDto implements GoodsReceipt {
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ isArray: true, type: GoodsReceiptLineDto }) lines!: GoodsReceiptLineDto[];
  @ApiProperty({ format: 'uuid', type: String }) purchaseOrderId!: string;
  @ApiProperty({ format: 'date-time', type: String }) receivedAt!: string;
  @ApiPropertyOptional({ type: String }) supplierDeliveryReference?: string;
  @ApiProperty({ format: 'uuid', type: String }) warehouseId!: string;
}

export class PurchaseOrderDto implements PurchaseOrder {
  @ApiProperty({ format: 'date-time', type: String }) createdAt!: string;
  @ApiProperty({ type: String }) currencyCode!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ isArray: true, type: PurchaseOrderLineDto }) lines!: PurchaseOrderLineDto[];
  @ApiProperty({ isArray: true, type: GoodsReceiptDto }) receipts!: GoodsReceiptDto[];
  @ApiProperty({ isArray: true, type: () => SupplierInvoiceDto })
  supplierInvoices!: SupplierInvoice[];
  @ApiProperty({ enum: purchaseOrderStatuses }) status!: PurchaseOrder['status'];
  @ApiProperty({ type: String }) supplierName!: string;
  @ApiProperty({ format: 'uuid', type: String }) supplierPartnerId!: string;
  @ApiProperty({ format: 'date-time', type: String }) updatedAt!: string;
  @ApiProperty({ type: Number }) version!: number;
  @ApiProperty({ format: 'uuid', type: String }) warehouseId!: string;
  @ApiProperty({ type: String }) warehouseName!: string;
}

export class PurchaseOrderPageDto implements PurchaseOrderPage {
  @ApiProperty({ isArray: true, type: PurchaseOrderDto }) items!: PurchaseOrderDto[];
  @ApiProperty({ type: Number }) page!: number;
  @ApiProperty({ type: Number }) pageSize!: number;
  @ApiProperty({ type: Number }) total!: number;
  @ApiProperty({ type: Number }) totalPages!: number;
}

class ProcurementSupplierOptionDto {
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) name!: string;
}

class ProcurementProductOptionDto {
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: String }) productCode!: string;
  @ApiProperty({ type: Boolean }) requiresExpiry!: boolean;
  @ApiProperty({ enum: ['none', 'serial', 'batch'] })
  trackingMode!: ProcurementReferenceData['products'][number]['trackingMode'];
}

class ProcurementWarehouseOptionDto {
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) name!: string;
}

export class ProcurementReferenceDataDto implements ProcurementReferenceData {
  @ApiProperty({ isArray: true, type: ProcurementProductOptionDto })
  products!: ProcurementReferenceData['products'];
  @ApiProperty({ isArray: true, type: ProcurementSupplierOptionDto })
  suppliers!: ProcurementReferenceData['suppliers'];
  @ApiProperty({ isArray: true, type: ProcurementWarehouseOptionDto })
  warehouses!: ProcurementReferenceData['warehouses'];
}

export class UpdateSupplierCommercialProfileDto implements UpdateSupplierCommercialProfileRequest {
  @ApiPropertyOptional({ maxLength: 500, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  deliveryTerms?: string;

  @ApiProperty({ minimum: 0, type: Number })
  @IsInt()
  @Min(0)
  expectedVersion!: number;

  @ApiPropertyOptional({ maximum: 3650, minimum: 0, type: Number })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3650)
  paymentTermsDays?: number;
}

export class CreateSupplierEvaluationDto implements CreateSupplierEvaluationRequest {
  @ApiPropertyOptional({ maxLength: 1000, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @ApiProperty({ maximum: 5, minimum: 1, type: Number })
  @IsInt()
  @Min(1)
  @Max(5)
  score!: number;
}

export class SupplierCommercialProfileDto implements SupplierCommercialProfile {
  @ApiPropertyOptional({ type: String }) deliveryTerms?: string;
  @ApiPropertyOptional({ type: Number }) paymentTermsDays?: number;
  @ApiProperty({ type: String }) supplierName!: string;
  @ApiProperty({ format: 'uuid', type: String }) supplierPartnerId!: string;
  @ApiPropertyOptional({ format: 'date-time', type: String }) updatedAt?: string;
  @ApiProperty({ type: Number }) version!: number;
}

export class SupplierEvaluationDto implements SupplierEvaluation {
  @ApiProperty({ format: 'date-time', type: String }) evaluatedAt!: string;
  @ApiProperty({ format: 'uuid', type: String }) evaluatedByAccountId!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiPropertyOptional({ type: String }) notes?: string;
  @ApiProperty({ type: Number }) score!: number;
  @ApiProperty({ format: 'uuid', type: String }) supplierPartnerId!: string;
}

class SupplierContactDto {
  @ApiPropertyOptional({ type: String }) email?: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiPropertyOptional({ type: String }) role?: string;
  @ApiPropertyOptional({ type: String }) telephone?: string;
}

export class ProcurementSupplierRecordDto implements ProcurementSupplierRecord {
  @ApiProperty({ isArray: true, type: SupplierContactDto })
  contacts!: ProcurementSupplierRecord['contacts'];
  @ApiProperty({ isArray: true, type: SupplierEvaluationDto })
  evaluations!: SupplierEvaluation[];
  @ApiProperty({ type: SupplierCommercialProfileDto })
  profile!: SupplierCommercialProfile;
}

export class CreateSupplierInvoiceLineDto implements CreateSupplierInvoiceLineRequest {
  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('4')
  orderLineId!: string;

  @ApiProperty({ type: String })
  @IsString()
  @Matches(decimalPattern)
  quantity!: string;

  @ApiProperty({ type: String })
  @IsString()
  @Matches(decimalPattern)
  unitPrice!: string;
}

export class CreateSupplierInvoiceDto implements CreateSupplierInvoiceRequest {
  @ApiProperty({ format: 'date', type: String })
  @IsDateString()
  invoiceDate!: string;

  @ApiProperty({ maxLength: 120, type: String })
  @IsString()
  @MaxLength(120)
  invoiceNumber!: string;

  @ApiProperty({ isArray: true, type: CreateSupplierInvoiceLineDto })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreateSupplierInvoiceLineDto)
  lines!: CreateSupplierInvoiceLineDto[];

  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('4')
  purchaseOrderId!: string;
}

export class SupplierInvoiceLineDto implements SupplierInvoiceLine {
  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ type: String }) lineTotal!: string;
  @ApiProperty({ format: 'uuid', type: String }) orderLineId!: string;
  @ApiProperty({ format: 'uuid', type: String }) productId!: string;
  @ApiProperty({ type: String }) productName!: string;
  @ApiProperty({ type: String }) quantity!: string;
  @ApiProperty({ type: String }) unitPrice!: string;
}

export class SupplierInvoiceDto implements SupplierInvoice {
  @ApiProperty({ type: String }) currencyCode!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ format: 'date', type: String }) invoiceDate!: string;
  @ApiProperty({ type: String }) invoiceNumber!: string;
  @ApiProperty({ isArray: true, type: SupplierInvoiceLineDto }) lines!: SupplierInvoiceLine[];
  @ApiProperty({ format: 'uuid', type: String }) purchaseOrderId!: string;
  @ApiProperty({ format: 'date-time', type: String }) recordedAt!: string;
  @ApiProperty({ type: String }) supplierName!: string;
  @ApiProperty({ format: 'uuid', type: String }) supplierPartnerId!: string;
  @ApiProperty({ type: String }) total!: string;
}

export class CreateSupplierClaimDto implements CreateSupplierClaimRequest {
  @ApiProperty({ maxLength: 2000, type: String })
  @IsString()
  @MaxLength(2000)
  description!: string;

  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('4')
  goodsReceiptLineId!: string;

  @ApiProperty({ type: String })
  @IsString()
  @Matches(decimalPattern)
  quantity!: string;

  @ApiProperty({ enum: supplierClaimTypes })
  @IsIn(supplierClaimTypes)
  type!: SupplierClaim['type'];
}

export class UpdateSupplierClaimStatusDto implements UpdateSupplierClaimStatusRequest {
  @ApiProperty({ minimum: 1, type: Number })
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiPropertyOptional({ maxLength: 1000, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @ApiProperty({ enum: supplierClaimStatuses })
  @IsIn(supplierClaimStatuses)
  status!: SupplierClaim['status'];
}

export class SupplierClaimStatusEventDto implements SupplierClaimStatusEvent {
  @ApiProperty({ format: 'date-time', type: String }) changedAt!: string;
  @ApiProperty({ format: 'uuid', type: String }) changedByAccountId!: string;
  @ApiPropertyOptional({ enum: supplierClaimStatuses }) fromStatus?: SupplierClaim['status'];
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiPropertyOptional({ type: String }) note?: string;
  @ApiProperty({ enum: supplierClaimStatuses }) toStatus!: SupplierClaim['status'];
}

export class SupplierClaimDto implements SupplierClaim {
  @ApiProperty({ format: 'date-time', type: String }) createdAt!: string;
  @ApiProperty({ type: String }) description!: string;
  @ApiProperty({ format: 'uuid', type: String }) goodsReceiptId!: string;
  @ApiProperty({ format: 'uuid', type: String }) goodsReceiptLineId!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ format: 'uuid', type: String }) productId!: string;
  @ApiProperty({ type: String }) productName!: string;
  @ApiProperty({ format: 'uuid', type: String }) purchaseOrderId!: string;
  @ApiProperty({ type: String }) quantity!: string;
  @ApiProperty({ enum: supplierClaimStatuses }) status!: SupplierClaim['status'];
  @ApiProperty({ isArray: true, type: SupplierClaimStatusEventDto })
  statusHistory!: SupplierClaimStatusEvent[];
  @ApiProperty({ type: String }) supplierName!: string;
  @ApiProperty({ format: 'uuid', type: String }) supplierPartnerId!: string;
  @ApiProperty({ enum: supplierClaimTypes }) type!: SupplierClaim['type'];
  @ApiProperty({ format: 'date-time', type: String }) updatedAt!: string;
  @ApiProperty({ type: Number }) version!: number;
}
