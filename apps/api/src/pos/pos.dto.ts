import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
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
import type {
  CreatePosCashSaleRequest,
  CreatePosSaleLineRequest,
  ClosePosShiftRequest,
  OpenPosShiftRequest,
  PosCatalogItem,
  PosCatalogPage,
  PosCustomerOption,
  PosSale,
  PosSaleLine,
  PosSalePage,
  PosShift,
  PosTerminalContext,
  PosVatTreatment,
} from '@vista/contracts';

const decimalPattern = /^\d+(\.\d{1,4})?$/u;

export class PosCatalogQueryDto {
  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID('loose')
  customerPartnerId?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 24, maximum: 100, minimum: 1, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 24;

  @ApiPropertyOptional({ maxLength: 120, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('loose')
  shiftId!: string;
}

export class PosCustomerQueryDto {
  @ApiPropertyOptional({ maxLength: 120, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}

export class PosSalePageQueryDto {
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

export class OpenPosShiftDto implements OpenPosShiftRequest {
  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('loose')
  cashRegisterId!: string;

  @ApiProperty({ example: '100.0000', type: String })
  @IsString()
  @Matches(decimalPattern)
  openingCashBgn!: string;
}

export class ClosePosShiftDto implements ClosePosShiftRequest {
  @ApiProperty({ example: '160.0000', type: String })
  @IsString()
  @Matches(decimalPattern)
  closingCashBgn!: string;

  @ApiProperty({ minimum: 1, type: Number })
  @IsInt()
  @Min(1)
  version!: number;
}

export class CreatePosSaleLineDto implements CreatePosSaleLineRequest {
  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID('loose')
  batchId?: string;

  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('loose')
  productId!: string;

  @ApiProperty({ example: '1.0000', type: String })
  @IsString()
  @Matches(decimalPattern)
  quantity!: string;

  @ApiPropertyOptional({ isArray: true, maxItems: 100, type: String })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  serialNumbers?: string[];
}

export class CreatePosCashSaleDto implements CreatePosCashSaleRequest {
  @ApiProperty({ example: '100.0000', type: String })
  @IsString()
  @Matches(decimalPattern)
  cashTendered!: string;

  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('loose')
  clientTransactionId!: string;

  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID('loose')
  customerLocationId?: string;

  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID('loose')
  customerPartnerId?: string;

  @ApiProperty({ isArray: true, type: CreatePosSaleLineDto })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreatePosSaleLineDto)
  lines!: CreatePosSaleLineDto[];

  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('loose')
  shiftId!: string;
}

class PosRegisterOptionDto {
  @ApiProperty({ format: 'uuid', type: String }) businessLocationId!: string;
  @ApiProperty({ type: String }) businessLocationName!: string;
  @ApiProperty({ type: String }) code!: string;
  @ApiPropertyOptional({ type: String }) fiscalDeviceLabel?: string;
  @ApiProperty({ enum: ['disabled', 'hardware', 'simulator'] })
  fiscalMode!: 'disabled' | 'hardware' | 'simulator';
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: String }) operatorCode!: string;
  @ApiProperty({ format: 'uuid', type: String }) operatorId!: string;
  @ApiProperty({ format: 'uuid', type: String }) warehouseId!: string;
  @ApiProperty({ type: String }) warehouseName!: string;
}

export class PosShiftDto implements PosShift {
  @ApiProperty({ format: 'uuid', type: String }) cashRegisterId!: string;
  @ApiProperty({ type: String }) cashRegisterName!: string;
  @ApiPropertyOptional({ format: 'date-time', type: String }) closedAt?: string;
  @ApiPropertyOptional({ type: String }) closingCashBgn?: string;
  @ApiProperty({ type: String }) expectedCashBgn!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ format: 'date-time', type: String }) openedAt!: string;
  @ApiProperty({ type: String }) openingCashBgn!: string;
  @ApiProperty({ type: String }) operatorCode!: string;
  @ApiProperty({ format: 'uuid', type: String }) operatorId!: string;
  @ApiProperty({ type: String }) shiftNumber!: string;
  @ApiProperty({ enum: ['closed', 'open'] }) status!: 'closed' | 'open';
  @ApiProperty({ type: Number }) version!: number;
  @ApiProperty({ format: 'uuid', type: String }) warehouseId!: string;
  @ApiProperty({ type: String }) warehouseName!: string;
}

export class PosTerminalContextDto implements PosTerminalContext {
  @ApiPropertyOptional({ type: PosShiftDto }) currentShift?: PosShift;
  @ApiProperty({ isArray: true, type: PosRegisterOptionDto })
  registers!: PosTerminalContext['registers'];
}

class PosCatalogBatchDto {
  @ApiProperty({ format: 'uuid', type: String }) batchId!: string;
  @ApiProperty({ type: String }) batchNumber!: string;
  @ApiPropertyOptional({ format: 'date', type: String }) expiresOn?: string;
  @ApiProperty({ type: String }) quantity!: string;
}

export class PosCatalogItemDto implements PosCatalogItem {
  @ApiProperty({ type: String }) availableQuantity!: string;
  @ApiProperty({ isArray: true, type: String }) barcodes!: string[];
  @ApiProperty({ isArray: true, type: PosCatalogBatchDto }) batches!: PosCatalogItem['batches'];
  @ApiProperty({ enum: ['BGN'] }) currencyCode!: 'BGN';
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiPropertyOptional({ format: 'uuid', type: String }) priceListId?: string;
  @ApiPropertyOptional({ type: String }) priceListName?: string;
  @ApiProperty({ type: String }) productCode!: string;
  @ApiProperty({ isArray: true, type: String }) serialNumbers!: string[];
  @ApiProperty({ enum: ['batch', 'none', 'serial'] })
  trackingMode!: PosCatalogItem['trackingMode'];
  @ApiProperty({ type: String }) unitCode!: string;
  @ApiPropertyOptional({ type: String }) unitPrice?: string;
  @ApiPropertyOptional({ enum: ['exempt', 'ica', 'reduced_9', 'standard_20', 'zero'] })
  vatTreatment?: PosVatTreatment;
}

export class PosCatalogPageDto implements PosCatalogPage {
  @ApiProperty({ isArray: true, type: PosCatalogItemDto }) items!: PosCatalogItem[];
  @ApiProperty({ type: Number }) page!: number;
  @ApiProperty({ type: Number }) pageSize!: number;
  @ApiProperty({ type: Number }) total!: number;
  @ApiProperty({ type: Number }) totalPages!: number;
}

class PosCustomerLocationOptionDto {
  @ApiProperty({ type: String }) city!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) name!: string;
}

export class PosCustomerOptionDto implements PosCustomerOption {
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ isArray: true, type: PosCustomerLocationOptionDto })
  locations!: PosCustomerOption['locations'];
  @ApiProperty({ type: String }) name!: string;
  @ApiPropertyOptional({ type: String }) uic?: string;
  @ApiPropertyOptional({ type: String }) vatNumber?: string;
}

export class PosSaleLineDto implements PosSaleLine {
  @ApiProperty({ type: String }) grossTotal!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) netTotal!: string;
  @ApiProperty({ type: String }) productCode!: string;
  @ApiProperty({ format: 'uuid', type: String }) productId!: string;
  @ApiProperty({ type: String }) productName!: string;
  @ApiProperty({ type: String }) quantity!: string;
  @ApiProperty({ isArray: true, type: String }) serialNumbers!: string[];
  @ApiProperty({ type: String }) unitPrice!: string;
  @ApiProperty({ type: String }) vatTotal!: string;
  @ApiProperty({ enum: ['exempt', 'ica', 'reduced_9', 'standard_20', 'zero'] })
  vatTreatment!: PosSaleLine['vatTreatment'];
}

export class PosSaleDto implements PosSale {
  @ApiProperty({ type: String }) cashTendered!: string;
  @ApiProperty({ type: String }) changeAmount!: string;
  @ApiProperty({ format: 'date-time', type: String }) completedAt!: string;
  @ApiProperty({ enum: ['BGN'] }) currencyCode!: 'BGN';
  @ApiPropertyOptional({ type: String }) customerName?: string;
  @ApiPropertyOptional({ format: 'uuid', type: String }) customerPartnerId?: string;
  @ApiProperty({ type: String }) fiscalAdapter!: string;
  @ApiProperty({ type: String }) fiscalReceiptNumber!: string;
  @ApiProperty({ enum: ['fiscalized', 'reversed', 'simulated'] })
  fiscalStatus!: PosSale['fiscalStatus'];
  @ApiProperty({ type: String }) grossTotal!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ isArray: true, type: PosSaleLineDto }) lines!: PosSaleLine[];
  @ApiProperty({ type: String }) netTotal!: string;
  @ApiProperty({ type: String }) saleNumber!: string;
  @ApiProperty({ format: 'uuid', type: String }) shiftId!: string;
  @ApiProperty({ enum: ['completed', 'reversed'] }) status!: PosSale['status'];
  @ApiProperty({ type: String }) vatTotal!: string;
}

export class PosSalePageDto implements PosSalePage {
  @ApiProperty({ isArray: true, type: PosSaleDto }) items!: PosSale[];
  @ApiProperty({ type: Number }) page!: number;
  @ApiProperty({ type: Number }) pageSize!: number;
  @ApiProperty({ type: Number }) total!: number;
  @ApiProperty({ type: Number }) totalPages!: number;
}
