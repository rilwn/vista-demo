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
  type ProductSummary,
  type Unit,
} from '@vista/contracts';

export class CreateUnitDto implements CreateUnitRequest {
  @ApiProperty({ maxLength: 30, minLength: 1 })
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  code!: string;
  @ApiProperty({ maxLength: 100, minLength: 1 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;
}

export class ProductBarcodeInputDto {
  @ApiProperty({ maxLength: 80, minLength: 1 })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  barcode!: string;
  @ApiPropertyOptional({ enum: barcodeTypes })
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
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') categoryId!: string;
  @ApiProperty({ maxLength: 255, minLength: 1 })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;
  @ApiProperty({ maxLength: 80, minLength: 1 })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  productCode!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') unitId!: string;
}

export class UnitDto implements Unit {
  @ApiProperty() active!: boolean;
  @ApiProperty() code!: string;
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() version!: number;
}

export class ProductSummaryDto implements ProductSummary {
  @ApiProperty() active!: boolean;
  @ApiProperty({ isArray: true }) barcodes!: ProductSummary['barcodes'];
  @ApiProperty({ format: 'uuid' }) categoryId!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() productCode!: string;
  @ApiProperty({ format: 'uuid' }) unitId!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
  @ApiProperty() version!: number;
  @ApiProperty() trackingMode!: ProductSummary['trackingMode'];
}
