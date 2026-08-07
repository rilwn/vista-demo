import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
} from 'class-validator';
import {
  warehouseTypes,
  type CreateWarehouseRequest,
  type ReceiveStockRequest,
  type StockBalance,
  type StockReceipt,
  type Warehouse,
} from '@vista/contracts';

export class CreateWarehouseDto {
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
  @ApiProperty({ type: String, format: 'uuid' }) @IsUUID('4') productId!: string;
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
  @ApiProperty({ type: String, format: 'uuid' }) @IsUUID('4') warehouseId!: string;
}

export class WarehouseDto implements Warehouse {
  @ApiProperty({ type: Boolean }) active!: boolean;
  @ApiProperty({ type: String }) code!: string;
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ enum: warehouseTypes }) type!: Warehouse['type'];
  @ApiProperty({ type: Number }) version!: number;
}

export class StockBalanceDto implements StockBalance {
  @ApiProperty({ type: String, format: 'uuid' }) productId!: string;
  @ApiProperty({ type: String }) quantity!: string;
  @ApiProperty({ type: String, format: 'uuid' }) warehouseId!: string;
}

export class StockReceiptDto implements StockReceipt {
  @ApiPropertyOptional({ type: String, format: 'uuid' }) batchId?: string;
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) productId!: string;
  @ApiProperty({ type: String }) quantity!: string;
  @ApiProperty({ type: [String], format: 'uuid' }) serialItemIds!: string[];
  @ApiProperty({ type: String, format: 'uuid' }) warehouseId!: string;
}
