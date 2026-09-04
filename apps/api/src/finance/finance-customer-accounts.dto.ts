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
import type {
  CreateCustomerAdvanceRequest,
  CustomerAccountEntry,
  CustomerAdvance,
  CustomerPaymentAccount,
  CustomerPaymentAccountReferenceData,
  CustomerPaymentTerms,
  UpsertCustomerPaymentTermsRequest,
} from '@vista/contracts';

const amountPattern = /^\d+(\.\d{1,4})?$/u;

export class UpsertCustomerPaymentTermsDto implements UpsertCustomerPaymentTermsRequest {
  @ApiProperty({ example: '2000.0000', type: String })
  @IsString()
  @Matches(amountPattern)
  creditLimitBgn!: string;

  @ApiPropertyOptional({ minimum: 1, type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion?: number;

  @ApiProperty({ type: Boolean })
  @IsBoolean()
  onAccountEnabled!: boolean;

  @ApiProperty({ maximum: 365, minimum: 0, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  paymentTermsDays!: number;

  @ApiProperty({ enum: ['active', 'suspended'] })
  @IsIn(['active', 'suspended'])
  status!: UpsertCustomerPaymentTermsRequest['status'];

  @ApiProperty({ format: 'date', type: String })
  @IsDateString()
  validFrom!: string;

  @ApiPropertyOptional({ format: 'date', type: String })
  @IsOptional()
  @IsDateString()
  validTo?: string;
}

export class CreateCustomerAdvanceDto implements CreateCustomerAdvanceRequest {
  @ApiProperty({ example: '150.0000', type: String })
  @IsString()
  @Matches(amountPattern)
  amount!: string;

  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('loose')
  customerPartnerId!: string;

  @ApiProperty({ enum: ['bank_transfer', 'card', 'cash', 'pos_terminal'] })
  @IsIn(['bank_transfer', 'card', 'cash', 'pos_terminal'])
  paymentMethod!: CreateCustomerAdvanceRequest['paymentMethod'];

  @ApiPropertyOptional({ maxLength: 255, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  paymentReference?: string;

  @ApiProperty({ format: 'date', type: String })
  @IsDateString()
  receivedOn!: string;
}

export class CustomerPaymentTermsDto implements CustomerPaymentTerms {
  @ApiProperty({ type: String }) creditLimitBgn!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: Boolean }) onAccountEnabled!: boolean;
  @ApiProperty({ type: Number }) paymentTermsDays!: number;
  @ApiProperty({ enum: ['active', 'suspended'] }) status!: CustomerPaymentTerms['status'];
  @ApiProperty({ format: 'date', type: String }) validFrom!: string;
  @ApiPropertyOptional({ format: 'date', type: String }) validTo?: string;
  @ApiProperty({ type: Number }) version!: number;
}

export class CustomerAdvanceDto implements CustomerAdvance {
  @ApiProperty({ type: String }) amount!: string;
  @ApiProperty({ type: String }) availableAmount!: string;
  @ApiProperty({ format: 'uuid', type: String }) customerPartnerId!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) number!: string;
  @ApiProperty({ enum: ['bank_transfer', 'card', 'cash', 'pos_terminal'] })
  paymentMethod!: CustomerAdvance['paymentMethod'];
  @ApiPropertyOptional({ type: String }) paymentReference?: string;
  @ApiProperty({ format: 'date', type: String }) receivedOn!: string;
}

export class CustomerAccountEntryDto implements CustomerAccountEntry {
  @ApiProperty({ type: String }) amount!: string;
  @ApiProperty({ format: 'date', type: String }) dueOn!: string;
  @ApiProperty({ enum: ['charge', 'return_credit'] })
  entryType!: CustomerAccountEntry['entryType'];
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ format: 'date-time', type: String }) occurredAt!: string;
  @ApiProperty({ type: String }) saleNumber!: string;
  @ApiPropertyOptional({ type: String }) returnNumber?: string;
}

export class CustomerPaymentAccountDto implements CustomerPaymentAccount {
  @ApiProperty({ type: String }) advanceBalance!: string;
  @ApiProperty({ isArray: true, type: CustomerAdvanceDto }) advances!: CustomerAdvance[];
  @ApiProperty({ type: String }) availableCredit!: string;
  @ApiProperty({ type: String }) customerName!: string;
  @ApiProperty({ format: 'uuid', type: String }) customerPartnerId!: string;
  @ApiProperty({ isArray: true, type: CustomerAccountEntryDto }) entries!: CustomerAccountEntry[];
  @ApiProperty({ type: String }) outstandingBalance!: string;
  @ApiPropertyOptional({ type: CustomerPaymentTermsDto }) terms?: CustomerPaymentTerms;
  @ApiPropertyOptional({ type: String }) uic?: string;
}

class CustomerPaymentAccountCustomerDto {
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiPropertyOptional({ type: String }) uic?: string;
}

export class CustomerPaymentAccountReferenceDataDto implements CustomerPaymentAccountReferenceData {
  @ApiProperty({ isArray: true, type: CustomerPaymentAccountCustomerDto })
  customers!: CustomerPaymentAccountReferenceData['customers'];
}
