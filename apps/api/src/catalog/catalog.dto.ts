import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  barcodeTypes,
  type CreateProductRequest,
  type CreateUnitRequest,
  type ProductBarcode,
  type ProductSummary,
  type Unit,
} from '@vista/contracts';

export class CreateUnitDto implements CreateUnitRequest {
  @ApiProperty({ type: String, maxLength: 30, minLength: 1 })
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  code!: string;
  @ApiProperty({ type: String, maxLength: 100, minLength: 1 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;
}

export class ProductBarcodeInputDto {
  @ApiProperty({ type: String, maxLength: 80, minLength: 1 })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  barcode!: string;
  @ApiPropertyOptional({ type: String, enum: barcodeTypes })
  @IsOptional()
  @IsIn(barcodeTypes)
  barcodeType?: (typeof barcodeTypes)[number];
}

export class CreateProductDto implements CreateProductRequest {
  @ApiPropertyOptional({ isArray: true, type: ProductBarcodeInputDto })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ProductBarcodeInputDto)
  barcodes?: ProductBarcodeInputDto[];
  @ApiProperty({ type: String, format: 'uuid' }) @IsUUID('4') categoryId!: string;
  @ApiProperty({ type: String, maxLength: 255, minLength: 1 })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;
  @ApiProperty({ type: String, maxLength: 80, minLength: 1 })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  productCode!: string;
  @ApiProperty({ type: String, format: 'uuid' }) @IsUUID('4') unitId!: string;
}

export class UnitDto implements Unit {
  @ApiProperty({ type: Boolean }) active!: boolean;
  @ApiProperty({ type: String }) code!: string;
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: Number }) version!: number;
}

export class ProductBarcodeDto implements ProductBarcode {
  @ApiProperty({ type: Boolean }) active!: boolean;
  @ApiProperty({ type: String }) barcode!: string;
  @ApiProperty({ enum: barcodeTypes }) barcodeType!: ProductBarcode['barcodeType'];
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
}

export class ProductSummaryDto implements ProductSummary {
  @ApiProperty({ type: Boolean }) active!: boolean;
  @ApiProperty({ isArray: true, type: ProductBarcodeDto }) barcodes!: ProductSummary['barcodes'];
  @ApiProperty({ type: String, format: 'uuid' }) categoryId!: string;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: String }) productCode!: string;
  @ApiProperty({ type: String, format: 'uuid' }) unitId!: string;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: string;
  @ApiProperty({ type: Number }) version!: number;
  @ApiProperty({ enum: ['none', 'serial', 'batch'] }) trackingMode!: ProductSummary['trackingMode'];
}
