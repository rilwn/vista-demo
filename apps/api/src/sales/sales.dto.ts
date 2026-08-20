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
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  vatTreatments,
  type ConfirmSalesQuotationLineRequest,
  type ConfirmSalesQuotationRequest,
  type AcceptSalesHandoverRequest,
  type CreateSalesQuotationLineRequest,
  type CreateSalesQuotationRequest,
  type CreateSalesShipmentLineRequest,
  type CreateSalesShipmentRequest,
  type SalesHandoverCertificate,
  type SalesHandoverCertificateLine,
  type SalesInvoice,
  type SalesInvoiceLine,
  type SalesOrder,
  type SalesOrderLine,
  type SalesQuotationLine,
  type SalesReferenceData,
  type SalesShipment,
  type SalesShipmentLine,
  type SalesWorkflow,
  type VatTreatment,
} from '@vista/contracts';

const decimalPattern = /^\d+(\.\d{1,4})?$/u;

export class CreateSalesQuotationLineDto implements CreateSalesQuotationLineRequest {
  @ApiProperty({ example: '0.0000', type: String })
  @IsString()
  @Matches(decimalPattern)
  discountPercent!: string;

  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('loose')
  productId!: string;

  @ApiProperty({ example: '1.0000', type: String })
  @IsString()
  @Matches(decimalPattern)
  quantity!: string;

  @ApiProperty({ example: '125.0000', type: String })
  @IsString()
  @Matches(decimalPattern)
  unitPrice!: string;

  @ApiProperty({ enum: vatTreatments })
  @IsIn(vatTreatments)
  vatTreatment!: VatTreatment;
}

export class CreateSalesQuotationDto implements CreateSalesQuotationRequest {
  @ApiProperty({ example: 'BGN', type: String })
  @IsString()
  @Matches(/^[A-Za-z]{3}$/u)
  currencyCode!: string;

  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('loose')
  customerPartnerId!: string;

  @ApiProperty({ isArray: true, type: CreateSalesQuotationLineDto })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreateSalesQuotationLineDto)
  lines!: CreateSalesQuotationLineDto[];

  @ApiProperty({ example: '0.0000', type: String })
  @IsString()
  @Matches(decimalPattern)
  overallDiscountPercent!: string;

  @ApiProperty({ format: 'date', type: String })
  @IsDateString()
  validUntil!: string;

  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('loose')
  warehouseId!: string;
}

export class ConfirmSalesQuotationLineDto implements ConfirmSalesQuotationLineRequest {
  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('loose')
  quotationLineId!: string;

  @ApiPropertyOptional({ isArray: true, maxItems: 500, type: String })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  serialNumbers?: string[];
}

export class ConfirmSalesQuotationDto implements ConfirmSalesQuotationRequest {
  @ApiProperty({ isArray: true, type: ConfirmSalesQuotationLineDto })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ConfirmSalesQuotationLineDto)
  lines!: ConfirmSalesQuotationLineDto[];
}

export class CreateSalesShipmentLineDto implements CreateSalesShipmentLineRequest {
  @ApiPropertyOptional({ maxLength: 100, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  batchNumber?: string;

  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('loose')
  orderLineId!: string;
}

export class CreateSalesShipmentDto implements CreateSalesShipmentRequest {
  @ApiProperty({ isArray: true, type: CreateSalesShipmentLineDto })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreateSalesShipmentLineDto)
  lines!: CreateSalesShipmentLineDto[];
}

export class AcceptSalesHandoverDto implements AcceptSalesHandoverRequest {
  @ApiProperty({ type: String })
  @IsString()
  @MaxLength(255)
  acceptedByName!: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  acceptanceNotes?: string;

  @ApiProperty({ minimum: 1, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

class SalesCustomerOptionDto {
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) name!: string;
}

class SalesProductOptionDto extends SalesCustomerOptionDto {
  @ApiProperty({ type: String }) productCode!: string;
  @ApiProperty({ enum: ['batch', 'none', 'serial'] }) trackingMode!: 'batch' | 'none' | 'serial';
}

class SalesSerialOptionDto {
  @ApiProperty({ format: 'uuid', type: String }) productId!: string;
  @ApiProperty({ type: String }) serialNumber!: string;
  @ApiProperty({ format: 'uuid', type: String }) warehouseId!: string;
}

class SalesBatchOptionDto {
  @ApiProperty({ type: String }) batchNumber!: string;
  @ApiProperty({ format: 'uuid', type: String }) productId!: string;
  @ApiProperty({ type: String }) quantity!: string;
  @ApiProperty({ format: 'uuid', type: String }) warehouseId!: string;
}

export class SalesReferenceDataDto implements SalesReferenceData {
  @ApiProperty({ isArray: true, type: SalesBatchOptionDto })
  batches!: SalesReferenceData['batches'];
  @ApiProperty({ isArray: true, type: SalesCustomerOptionDto })
  customers!: SalesReferenceData['customers'];
  @ApiProperty({ isArray: true, type: SalesProductOptionDto })
  products!: SalesReferenceData['products'];
  @ApiProperty({ isArray: true, type: SalesSerialOptionDto })
  serials!: SalesReferenceData['serials'];
  @ApiProperty({ isArray: true, type: SalesCustomerOptionDto })
  warehouses!: SalesReferenceData['warehouses'];
}

export class SalesQuotationLineDto implements SalesQuotationLine {
  @ApiProperty({ type: String }) discountPercent!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) lineTotal!: string;
  @ApiProperty({ format: 'uuid', type: String }) productId!: string;
  @ApiProperty({ type: String }) productName!: string;
  @ApiProperty({ type: String }) quantity!: string;
  @ApiProperty({ enum: ['batch', 'none', 'serial'] }) trackingMode!: 'batch' | 'none' | 'serial';
  @ApiProperty({ type: String }) unitPrice!: string;
  @ApiProperty({ enum: vatTreatments }) vatTreatment!: VatTreatment;
}

export class SalesOrderLineDto implements SalesOrderLine {
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ format: 'uuid', type: String }) productId!: string;
  @ApiProperty({ type: String }) productName!: string;
  @ApiProperty({ type: String }) quantity!: string;
  @ApiProperty({ format: 'uuid', type: String }) reservationId!: string;
  @ApiProperty({ isArray: true, type: String }) reservedSerialNumbers!: string[];
  @ApiProperty({ enum: ['batch', 'none', 'serial'] }) trackingMode!: 'batch' | 'none' | 'serial';
}

export class SalesOrderDto implements SalesOrder {
  @ApiProperty({ format: 'date-time', type: String }) confirmedAt!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ isArray: true, type: SalesOrderLineDto }) lines!: SalesOrderLine[];
  @ApiProperty({ type: String }) number!: string;
  @ApiProperty({ enum: ['confirmed', 'shipped', 'invoiced'] }) status!: SalesOrder['status'];
}

export class SalesShipmentLineDto implements SalesShipmentLine {
  @ApiPropertyOptional({ type: String }) batchNumber?: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ format: 'uuid', type: String }) orderLineId!: string;
  @ApiProperty({ format: 'uuid', type: String }) productId!: string;
  @ApiProperty({ type: String }) productName!: string;
  @ApiProperty({ type: String }) quantity!: string;
  @ApiProperty({ isArray: true, type: String }) serialNumbers!: string[];
  @ApiProperty({ format: 'uuid', type: String }) stockMovementId!: string;
}

export class SalesShipmentDto implements SalesShipment {
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ isArray: true, type: SalesShipmentLineDto }) lines!: SalesShipmentLine[];
  @ApiProperty({ type: String }) number!: string;
  @ApiProperty({ format: 'date-time', type: String }) shippedAt!: string;
}

class SalesHandoverCertificateLineDto implements SalesHandoverCertificateLine {
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ format: 'uuid', type: String }) productId!: string;
  @ApiProperty({ type: String }) productName!: string;
  @ApiProperty({ type: String }) quantity!: string;
  @ApiProperty({ isArray: true, type: String }) serialNumbers!: string[];
}

class SalesHandoverCertificateDto implements SalesHandoverCertificate {
  @ApiPropertyOptional({ type: String }) acceptanceNotes?: string;
  @ApiPropertyOptional({ format: 'date-time', type: String }) acceptedAt?: string;
  @ApiPropertyOptional({ type: String }) acceptedByName?: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ isArray: true, type: SalesHandoverCertificateLineDto })
  lines!: SalesHandoverCertificateLine[];
  @ApiProperty({ type: String }) number!: string;
  @ApiProperty({ format: 'date-time', type: String }) preparedAt!: string;
  @ApiProperty({ enum: ['prepared', 'accepted'] }) status!: 'accepted' | 'prepared';
  @ApiProperty({ type: Number }) version!: number;
}

export class SalesInvoiceLineDto implements SalesInvoiceLine {
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) lineTotal!: string;
  @ApiProperty({ format: 'uuid', type: String }) productId!: string;
  @ApiProperty({ type: String }) productName!: string;
  @ApiProperty({ type: String }) quantity!: string;
  @ApiProperty({ type: String }) unitPrice!: string;
  @ApiProperty({ enum: vatTreatments }) vatTreatment!: VatTreatment;
}

export class SalesInvoiceDto implements SalesInvoice {
  @ApiProperty({ type: String }) currencyCode!: string;
  @ApiProperty({ type: String }) customerName!: string;
  @ApiProperty({ format: 'uuid', type: String }) customerPartnerId!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ isArray: true, type: SalesInvoiceLineDto }) lines!: SalesInvoiceLine[];
  @ApiProperty({ type: String }) number!: string;
  @ApiProperty({ format: 'date-time', type: String }) recordedAt!: string;
  @ApiProperty({ enum: ['draft'] }) status!: 'draft';
  @ApiProperty({ type: String }) subtotal!: string;
  @ApiProperty({ type: String }) total!: string;
  @ApiProperty({ type: String }) vatTotal!: string;
}

export class SalesWorkflowDto implements SalesWorkflow {
  @ApiProperty({ format: 'date-time', type: String }) createdAt!: string;
  @ApiProperty({ type: String }) currencyCode!: string;
  @ApiProperty({ type: String }) customerName!: string;
  @ApiProperty({ format: 'uuid', type: String }) customerPartnerId!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiPropertyOptional({ type: SalesHandoverCertificateDto })
  handover?: SalesHandoverCertificate;
  @ApiPropertyOptional({ type: SalesInvoiceDto }) invoice?: SalesInvoice;
  @ApiProperty({ isArray: true, type: SalesQuotationLineDto }) lines!: SalesQuotationLine[];
  @ApiProperty({ type: String }) number!: string;
  @ApiPropertyOptional({ type: SalesOrderDto }) order?: SalesOrder;
  @ApiProperty({ type: String }) overallDiscountPercent!: string;
  @ApiPropertyOptional({ type: SalesShipmentDto }) shipment?: SalesShipment;
  @ApiProperty({ enum: ['draft', 'confirmed', 'shipped', 'invoiced'] })
  status!: SalesWorkflow['status'];
  @ApiProperty({ type: String }) subtotal!: string;
  @ApiProperty({ type: String }) total!: string;
  @ApiProperty({ format: 'date', type: String }) validUntil!: string;
  @ApiProperty({ type: String }) vatTotal!: string;
  @ApiProperty({ format: 'uuid', type: String }) warehouseId!: string;
  @ApiProperty({ type: String }) warehouseName!: string;
}
