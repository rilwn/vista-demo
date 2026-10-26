import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
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
} from 'class-validator';
import {
  vatTreatments,
  type RecurringInvoiceContract,
  type RecurringInvoicePage,
  type RecurringInvoicePeriod,
  type RecurringInvoiceProcessResult,
  type RecurringInvoiceProfile,
  type RecurringInvoiceProfileInput,
  type VatTreatment,
} from '@vista/contracts';

export class RecurringInvoiceQueryDto {
  @ApiPropertyOptional({ type: Number, default: 1, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;
  @ApiPropertyOptional({ type: Number, default: 20, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
  @ApiPropertyOptional({ type: String, maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}
export class RecurringInvoiceProfileInputDto implements RecurringInvoiceProfileInput {
  @ApiProperty({ type: Boolean }) @IsBoolean() enabled!: boolean;
  @ApiProperty({ type: String, format: 'uuid' }) @IsUUID('loose') legalEntityId!: string;
  @ApiProperty({ type: String, format: 'uuid' }) @IsUUID('loose') businessLocationId!: string;
  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @IsOptional()
  @IsUUID('loose')
  cashRegisterId?: string;
  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @IsOptional()
  @IsUUID('loose')
  operatorId?: string;
  @ApiProperty({ type: String, format: 'date' })
  @IsDateString({ strict: true })
  firstBillingDate!: string;
  @ApiProperty({ type: Number, minimum: 0, maximum: 3650 })
  @IsInt()
  @Min(0)
  @Max(3650)
  paymentTermsDays!: number;
  @ApiProperty({ type: String, enum: vatTreatments })
  @IsIn(vatTreatments)
  vatTreatment!: VatTreatment;
  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  @Matches(/^\d{1,3}(\.\d{1,4})?$/u)
  vatRate?: string;
  @ApiProperty({ type: Number, minimum: 1 }) @IsInt() @Min(1) contractVersion!: number;
  @ApiPropertyOptional({ type: Number, minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  expectedVersion?: number;
}
class RecurringInvoiceProfileDto
  extends RecurringInvoiceProfileInputDto
  implements RecurringInvoiceProfile
{
  @ApiProperty({ type: Number }) version!: number;
  @ApiProperty({ type: String }) approvedByName!: string;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: string;
}
class RecurringInvoiceDocumentDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) number!: string;
}
class RecurringInvoicePeriodDto implements RecurringInvoicePeriod {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'date' }) billingDate!: string;
  @ApiProperty({ type: String, format: 'date' }) servicePeriodStart!: string;
  @ApiProperty({ type: String, format: 'date' }) servicePeriodEnd!: string;
  @ApiProperty({ type: String }) amount!: string;
  @ApiProperty({ type: String }) currencyCode!: string;
  @ApiProperty({
    type: String,
    enum: ['waiting', 'issued', 'manual_review', 'needs_review', 'retry'],
  })
  status!: RecurringInvoicePeriod['status'];
  @ApiPropertyOptional({ type: String }) errorCode?: string;
  @ApiPropertyOptional({ type: RecurringInvoiceDocumentDto })
  document?: RecurringInvoiceDocumentDto;
}
export class RecurringInvoiceContractDto implements RecurringInvoiceContract {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) number!: string;
  @ApiProperty({ type: String }) customerName!: string;
  @ApiProperty({ type: String }) customerLocationName!: string;
  @ApiProperty({ type: Boolean }) active!: boolean;
  @ApiProperty({ type: String }) billingAmount!: string;
  @ApiProperty({ type: String }) currencyCode!: string;
  @ApiProperty({ type: Number }) billingFrequencyMonths!: number;
  @ApiProperty({ type: String, format: 'date' }) nextBillingDate!: string;
  @ApiProperty({ type: Number }) contractVersion!: number;
  @ApiPropertyOptional({ type: RecurringInvoiceProfileDto }) profile?: RecurringInvoiceProfileDto;
  @ApiProperty({ type: RecurringInvoicePeriodDto, isArray: true })
  periods!: RecurringInvoicePeriodDto[];
}
export class RecurringInvoicePageDto implements RecurringInvoicePage {
  @ApiProperty({ type: RecurringInvoiceContractDto, isArray: true })
  items!: RecurringInvoiceContractDto[];
  @ApiProperty({ type: Number }) page!: number;
  @ApiProperty({ type: Number }) pageSize!: number;
  @ApiProperty({ type: Number }) totalItems!: number;
  @ApiProperty({ type: Number }) totalPages!: number;
}
export class RecurringInvoiceProcessResultDto implements RecurringInvoiceProcessResult {
  @ApiProperty({ type: Number }) issuedCount!: number;
  @ApiProperty({ type: Number }) reviewCount!: number;
  @ApiProperty({ type: Number }) retryCount!: number;
  @ApiProperty({ type: Number }) skippedCount!: number;
}
