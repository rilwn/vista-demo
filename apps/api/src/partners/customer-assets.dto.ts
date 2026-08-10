import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  customerEquipmentStatuses,
  type CreateCustomerEquipmentRequest,
  type CreateCustomerLocationRequest,
  type CustomerEquipment,
  type CustomerEquipmentStatus,
  type CustomerLocation,
  type CustomerLocationProfile,
  type PartnerContact,
  type RecordVersionRequest,
  type UpdateCustomerEquipmentRequest,
  type UpdateCustomerLocationRequest,
} from '@vista/contracts';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  Matches,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

import { PartnerContactDto } from './partners.dto.js';

export class CreateCustomerLocationDto implements CreateCustomerLocationRequest {
  @ApiProperty({ maxLength: 255, minLength: 1, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  addressLine1!: string;

  @ApiPropertyOptional({ maxLength: 255, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  addressLine2?: string;

  @ApiProperty({ maxLength: 150, minLength: 1, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  city!: string;

  @ApiPropertyOptional({ default: 'BG', maxLength: 2, minLength: 2, type: String })
  @IsOptional()
  @Matches(/^[A-Za-z]{2}$/u)
  countryCode?: string;

  @ApiProperty({
    description: 'Client-configurable location classification',
    maxLength: 100,
    type: String,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  locationType!: string;

  @ApiProperty({ maxLength: 255, minLength: 1, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @ApiPropertyOptional({ maxLength: 30, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  postalCode?: string;

  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID('4')
  responsibleContactId?: string;
}

export class CreateCustomerEquipmentDto implements CreateCustomerEquipmentRequest {
  @ApiProperty({ maxLength: 255, minLength: 1, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  deviceName!: string;

  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID('4')
  productId?: string;

  @ApiProperty({ format: 'date', type: String })
  @IsDateString()
  purchaseDate!: string;

  @ApiProperty({ maxLength: 120, minLength: 1, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  serialNumber!: string;

  @ApiPropertyOptional({ enum: customerEquipmentStatuses, type: String })
  @IsOptional()
  @IsIn(customerEquipmentStatuses)
  status?: CustomerEquipmentStatus;

  @ApiPropertyOptional({ format: 'date', type: String })
  @IsOptional()
  @IsDateString()
  warrantyEndsOn?: string;

  @ApiPropertyOptional({
    description: 'Defaults to purchaseDate',
    format: 'date',
    type: String,
  })
  @IsOptional()
  @IsDateString()
  warrantyStartsOn?: string;
}

export class UpdateCustomerLocationDto
  extends CreateCustomerLocationDto
  implements UpdateCustomerLocationRequest
{
  @ApiProperty({ minimum: 1, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class UpdateCustomerEquipmentDto implements UpdateCustomerEquipmentRequest {
  @ApiProperty({ maxLength: 255, minLength: 1, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  deviceName!: string;

  @ApiProperty({ minimum: 1, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiProperty({ format: 'date', type: String })
  @IsDateString()
  purchaseDate!: string;

  @ApiProperty({ enum: customerEquipmentStatuses, type: String })
  @IsIn(customerEquipmentStatuses)
  status!: CustomerEquipmentStatus;

  @ApiPropertyOptional({ format: 'date', type: String })
  @IsOptional()
  @IsDateString()
  warrantyEndsOn?: string;

  @ApiProperty({ format: 'date', type: String })
  @IsDateString()
  warrantyStartsOn!: string;
}

export class CustomerAssetVersionDto implements RecordVersionRequest {
  @ApiProperty({ minimum: 1, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class CustomerLocationDto implements CustomerLocation {
  @ApiProperty({ type: Boolean }) active!: boolean;
  @ApiProperty({ type: String }) addressLine1!: string;
  @ApiPropertyOptional({ type: String }) addressLine2?: string;
  @ApiProperty({ type: String }) city!: string;
  @ApiProperty({ type: String }) countryCode!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) locationType!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ format: 'uuid', type: String }) partnerId!: string;
  @ApiPropertyOptional({ type: String }) postalCode?: string;
  @ApiPropertyOptional({ type: () => PartnerContactDto }) responsibleContact?: PartnerContact;
  @ApiProperty({ type: Number }) version!: number;
}

export class CustomerEquipmentDto implements CustomerEquipment {
  @ApiProperty({ type: Boolean }) active!: boolean;
  @ApiProperty({ format: 'uuid', type: String }) customerLocationId!: string;
  @ApiProperty({ type: String }) deviceName!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiPropertyOptional({ format: 'uuid', type: String }) productId?: string;
  @ApiProperty({ format: 'date', type: String }) purchaseDate!: string;
  @ApiProperty({ type: String }) serialNumber!: string;
  @ApiPropertyOptional({ format: 'uuid', type: String }) serializedItemId?: string;
  @ApiProperty({ enum: customerEquipmentStatuses, type: String })
  status!: CustomerEquipmentStatus;
  @ApiProperty({ type: Number }) version!: number;
  @ApiPropertyOptional({ format: 'date', type: String }) warrantyEndsOn?: string;
  @ApiProperty({ format: 'date', type: String }) warrantyStartsOn!: string;
}

export class CustomerLocationProfileDto implements CustomerLocationProfile {
  @ApiProperty({ isArray: true, type: () => CustomerEquipmentDto })
  equipment!: CustomerEquipment[];

  @ApiProperty({ type: () => CustomerLocationDto }) location!: CustomerLocation;
}
