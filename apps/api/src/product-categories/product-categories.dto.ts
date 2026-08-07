import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  productTrackingModes,
  type CreateProductCategoryRequest,
  type ProductCategory,
  type ProductTrackingMode,
} from '@vista/contracts';

export class CreateProductCategoryDto implements CreateProductCategoryRequest {
  @ApiProperty({ maxLength: 150, minLength: 1, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  name!: string;

  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID('4')
  parentId?: string;

  @ApiPropertyOptional({ default: false, type: Boolean })
  @IsOptional()
  @IsBoolean()
  requiresExpiry?: boolean;

  @ApiPropertyOptional({ default: 'none', enum: productTrackingModes })
  @IsOptional()
  @IsIn(productTrackingModes)
  trackingMode?: ProductTrackingMode;
}

export class ProductCategoryDto implements ProductCategory {
  @ApiProperty({ type: Boolean })
  @IsBoolean()
  active!: boolean;

  @ApiProperty({ format: 'date-time', type: String })
  createdAt!: string;

  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('4')
  id!: string;

  @ApiProperty({ type: String })
  name!: string;

  @ApiPropertyOptional({ format: 'uuid', type: String })
  parentId?: string;

  @ApiProperty({ type: Boolean })
  requiresExpiry!: boolean;

  @ApiProperty({ enum: productTrackingModes })
  trackingMode!: ProductTrackingMode;

  @ApiProperty({ format: 'date-time', type: String })
  updatedAt!: string;

  @ApiProperty({ type: Number })
  version!: number;
}
