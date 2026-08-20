import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type {
  CreateServiceSubscriptionRequest,
  GenerateSubscriptionInvoiceDraftsResult,
  SalesSubscriptionReferenceData,
  ServiceSubscriptionContract,
  SubscriptionInvoiceDraft,
  UpdateServiceSubscriptionRequest,
} from '@vista/contracts';

const decimalPattern = /^\d+(\.\d{1,4})?$/u;

export class CreateServiceSubscriptionDto implements CreateServiceSubscriptionRequest {
  @ApiProperty({ example: '120.0000', type: String })
  @IsString()
  @Matches(decimalPattern)
  billingAmount!: string;

  @ApiProperty({ maximum: 120, minimum: 1, type: Number })
  @IsInt()
  @Min(1)
  @Max(120)
  billingFrequencyMonths!: number;

  @ApiProperty({ example: 'BGN', type: String })
  @IsString()
  @Matches(/^[A-Za-z]{3}$/u)
  currencyCode!: string;

  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('loose')
  customerLocationId!: string;

  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('loose')
  customerPartnerId!: string;

  @ApiProperty({ format: 'uuid', isArray: true, maxItems: 100, minItems: 1, type: String })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('loose', { each: true })
  equipmentIds!: string[];

  @ApiProperty({ isArray: true, maxItems: 50, minItems: 1, type: String })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  includedServices!: string[];

  @ApiProperty({ format: 'date', type: String })
  @IsDateString()
  nextInvoiceDate!: string;

  @ApiProperty({ format: 'date', type: String })
  @IsDateString()
  validFrom!: string;

  @ApiPropertyOptional({ format: 'date', type: String })
  @IsOptional()
  @IsDateString()
  validTo?: string;

  @ApiProperty({ maximum: 120, minimum: 1, type: Number })
  @IsInt()
  @Min(1)
  @Max(120)
  visitFrequencyMonths!: number;
}

export class UpdateServiceSubscriptionDto
  extends CreateServiceSubscriptionDto
  implements UpdateServiceSubscriptionRequest
{
  @ApiProperty({ type: Boolean })
  @IsBoolean()
  active!: boolean;

  @ApiProperty({ minimum: 1, type: Number })
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

class SubscriptionCustomerOptionDto {
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) name!: string;
}

class SubscriptionLocationOptionDto {
  @ApiProperty({ format: 'uuid', type: String }) customerPartnerId!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) name!: string;
}

class SubscriptionEquipmentOptionDto {
  @ApiProperty({ format: 'uuid', type: String }) customerLocationId!: string;
  @ApiProperty({ type: String }) deviceName!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) serialNumber!: string;
}

export class SalesSubscriptionReferenceDataDto implements SalesSubscriptionReferenceData {
  @ApiProperty({ isArray: true, type: SubscriptionCustomerOptionDto })
  customers!: SalesSubscriptionReferenceData['customers'];
  @ApiProperty({ isArray: true, type: SubscriptionEquipmentOptionDto })
  equipment!: SalesSubscriptionReferenceData['equipment'];
  @ApiProperty({ isArray: true, type: SubscriptionLocationOptionDto })
  locations!: SalesSubscriptionReferenceData['locations'];
}

class SubscriptionInvoiceDraftDto implements SubscriptionInvoiceDraft {
  @ApiProperty({ type: String }) amount!: string;
  @ApiProperty({ format: 'date', type: String }) billingDate!: string;
  @ApiProperty({ type: String }) currencyCode!: string;
  @ApiProperty({ format: 'date-time', type: String }) generatedAt!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) number!: string;
  @ApiProperty({ format: 'date', type: String }) servicePeriodEnd!: string;
  @ApiProperty({ format: 'date', type: String }) servicePeriodStart!: string;
  @ApiProperty({ enum: ['draft'] }) status!: 'draft';
}

class SubscriptionEquipmentDto {
  @ApiProperty({ type: String }) deviceName!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) serialNumber!: string;
}

export class ServiceSubscriptionContractDto implements ServiceSubscriptionContract {
  @ApiProperty({ type: Boolean }) active!: boolean;
  @ApiProperty({ type: String }) billingAmount!: string;
  @ApiProperty({ type: Number }) billingFrequencyMonths!: number;
  @ApiProperty({ format: 'date-time', type: String }) createdAt!: string;
  @ApiProperty({ type: String }) currencyCode!: string;
  @ApiProperty({ format: 'uuid', type: String }) customerLocationId!: string;
  @ApiProperty({ type: String }) customerLocationName!: string;
  @ApiProperty({ type: String }) customerName!: string;
  @ApiProperty({ format: 'uuid', type: String }) customerPartnerId!: string;
  @ApiProperty({ isArray: true, type: SubscriptionEquipmentDto })
  equipment!: ServiceSubscriptionContract['equipment'];
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ isArray: true, type: String }) includedServices!: string[];
  @ApiProperty({ isArray: true, type: SubscriptionInvoiceDraftDto })
  invoiceDrafts!: SubscriptionInvoiceDraft[];
  @ApiProperty({ format: 'date', type: String }) nextInvoiceDate!: string;
  @ApiProperty({ type: String }) number!: string;
  @ApiProperty({ format: 'date-time', type: String }) updatedAt!: string;
  @ApiProperty({ format: 'date', type: String }) validFrom!: string;
  @ApiPropertyOptional({ format: 'date', type: String }) validTo?: string;
  @ApiProperty({ type: Number }) version!: number;
  @ApiProperty({ type: Number }) visitFrequencyMonths!: number;
}

export class GenerateSubscriptionInvoiceDraftsResultDto implements GenerateSubscriptionInvoiceDraftsResult {
  @ApiProperty({ format: 'date', type: String }) asOf!: string;
  @ApiProperty({ format: 'uuid', isArray: true, type: String }) draftIds!: string[];
  @ApiProperty({ type: Number }) generatedCount!: number;
}
