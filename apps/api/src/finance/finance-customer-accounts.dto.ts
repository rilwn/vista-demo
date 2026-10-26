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
  CustomerOpenReceivable,
  CustomerPaymentAccount,
  CustomerPaymentAccountReferenceData,
  CustomerPaymentTerms,
  UpsertCustomerPaymentTermsRequest,
  CreatePosAccountPaymentRequest,
  ReversePosAccountPaymentRequest,
  PosAccountReceivable,
  PosAccountPayment,
  PosAccountReturnCredit,
  CreatePosAccountRefundRequest,
} from '@vista/contracts';

const amountPattern = /^\d+(\.\d{1,4})?$/u;

export class UpsertCustomerPaymentTermsDto implements UpsertCustomerPaymentTermsRequest {
  @ApiProperty({ example: '2000.0000', type: String })
  @IsString()
  @Matches(amountPattern)
  creditLimitEur!: string;

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
  @ApiProperty({ type: String }) creditLimitEur!: string;
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

export class CreatePosAccountPaymentDto implements CreatePosAccountPaymentRequest {
  @ApiProperty({ type: String }) @IsString() @Matches(amountPattern) amount!: string;
  @ApiProperty({ type: String }) @IsString() @Matches(amountPattern) expectedOutstanding!: string;
  @ApiProperty({ format: 'date', type: String })
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/u)
  paymentDate!: string;
  @ApiProperty({ enum: ['cash', 'bank_transfer', 'card', 'pos_terminal'] })
  @IsIn(['cash', 'bank_transfer', 'card', 'pos_terminal'])
  paymentMethod!: CreatePosAccountPaymentRequest['paymentMethod'];
  @ApiPropertyOptional({ type: String, maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  paymentReference?: string;
}
export class ReversePosAccountPaymentDto implements ReversePosAccountPaymentRequest {
  @ApiProperty({ type: String, minLength: 10, maxLength: 1000 })
  @IsString()
  @MaxLength(1000)
  reason!: string;
  @ApiProperty({ type: String }) @IsString() @Matches(amountPattern) expectedOutstanding!: string;
}
class PosAccountInvoiceDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) number!: string;
}
export class CreatePosAccountRefundDto implements CreatePosAccountRefundRequest {
  @ApiProperty({ type: String }) @IsString() @Matches(amountPattern) amount!: string;
  @ApiProperty({ type: String }) @IsString() @Matches(amountPattern) expectedRefundDue!: string;
  @ApiProperty({ type: String, format: 'date' }) @IsDateString() refundedOn!: string;
  @ApiProperty({ enum: ['cash', 'bank_transfer'] })
  @IsIn(['cash', 'bank_transfer'])
  paymentMethod!: 'cash' | 'bank_transfer';
  @ApiProperty({ type: String, minLength: 3, maxLength: 255 })
  @IsString()
  @MaxLength(255)
  paymentReference!: string;
}
class PosRefundPaymentAllocationDto {
  @ApiProperty({ type: String }) number!: string;
  @ApiProperty({ type: String }) amount!: string;
}
class PosAccountRefundDto {
  @ApiProperty({ type: String }) number!: string;
  @ApiProperty({ type: String }) amount!: string;
  @ApiProperty({ type: String, format: 'date' }) refundedOn!: string;
  @ApiProperty({ enum: ['cash', 'bank_transfer'] }) paymentMethod!: 'cash' | 'bank_transfer';
  @ApiProperty({ type: String }) paymentReference!: string;
  @ApiProperty({ type: PosRefundPaymentAllocationDto, isArray: true })
  payments!: PosRefundPaymentAllocationDto[];
}
class PosReturnCreditNoteDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) number!: string;
  @ApiProperty({ enum: ['draft', 'issued'] }) status!: 'draft' | 'issued';
}
class PosAccountReturnCreditDto implements PosAccountReturnCredit {
  @ApiProperty({ type: String, format: 'uuid' }) returnId!: string;
  @ApiProperty({ type: String }) returnNumber!: string;
  @ApiProperty({ type: String, format: 'date' }) returnedOn!: string;
  @ApiProperty({ type: String }) returnTotal!: string;
  @ApiProperty({ type: String }) releasedTotal!: string;
  @ApiProperty({ type: String }) refundableTotal!: string;
  @ApiProperty({ type: String }) refundedTotal!: string;
  @ApiProperty({ type: String }) refundDue!: string;
  @ApiPropertyOptional({ type: PosAccountInvoiceDto }) invoice?: PosAccountInvoiceDto;
  @ApiPropertyOptional({ type: PosReturnCreditNoteDto }) creditNote?: PosReturnCreditNoteDto;
  @ApiProperty({ type: PosAccountRefundDto, isArray: true }) refunds!: PosAccountRefundDto[];
}
class PosAccountReversalDto {
  @ApiProperty({ type: String }) number!: string;
  @ApiProperty({ type: String }) reason!: string;
  @ApiProperty({ type: String, format: 'date' }) reversedOn!: string;
}
export class PosAccountPaymentDto implements PosAccountPayment {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) number!: string;
  @ApiProperty({ type: String }) amount!: string;
  @ApiProperty({ enum: ['cash', 'bank_transfer', 'card', 'pos_terminal'] })
  paymentMethod!: PosAccountPayment['paymentMethod'];
  @ApiProperty({ type: String, format: 'date' }) paymentDate!: string;
  @ApiPropertyOptional({ type: String }) paymentReference?: string;
  @ApiPropertyOptional({ type: PosAccountReversalDto }) reversal?: PosAccountReversalDto;
}
class PosAccountReceivableDto implements PosAccountReceivable {
  @ApiPropertyOptional({ type: PosAccountReturnCreditDto, isArray: true })
  returnCredits?: PosAccountReturnCreditDto[];
  @ApiPropertyOptional({ type: String }) refundDue?: string;
  @ApiPropertyOptional({ type: String }) refundedTotal?: string;
  @ApiProperty({ type: String, format: 'uuid' }) saleId!: string;
  @ApiProperty({ type: String }) saleNumber!: string;
  @ApiProperty({ type: String }) receiptNumber!: string;
  @ApiPropertyOptional({ type: PosAccountInvoiceDto }) invoice?: PosAccountInvoiceDto;
  @ApiProperty({ type: String, format: 'date' }) dueOn!: string;
  @ApiProperty({ type: String }) originalTotal!: string;
  @ApiProperty({ type: String }) returnCredit!: string;
  @ApiProperty({ type: String }) paidTotal!: string;
  @ApiProperty({ type: String }) outstandingTotal!: string;
  @ApiProperty({ enum: ['unpaid', 'partially_paid', 'paid', 'overdue'] })
  status!: PosAccountReceivable['status'];
  @ApiProperty({ type: PosAccountPaymentDto, isArray: true }) payments!: PosAccountPaymentDto[];
}

export class CustomerAccountEntryDto implements CustomerAccountEntry {
  @ApiProperty({ type: String }) amount!: string;
  @ApiProperty({ format: 'date', type: String }) dueOn!: string;
  @ApiProperty({ enum: ['charge', 'return_credit', 'payment', 'payment_reversal'] })
  entryType!: CustomerAccountEntry['entryType'];
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ format: 'date-time', type: String }) occurredAt!: string;
  @ApiProperty({ type: String }) saleNumber!: string;
  @ApiPropertyOptional({ type: String }) returnNumber?: string;
  @ApiPropertyOptional({ type: String }) paymentNumber?: string;
}

class CustomerOpenReceivableDto implements CustomerOpenReceivable {
  @ApiProperty({ type: String }) allocatedTotal!: string;
  @ApiProperty({ format: 'date', type: String }) dueDate!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) number!: string;
  @ApiProperty({ type: String }) outstandingTotal!: string;
  @ApiProperty({ enum: ['unpaid', 'partially_paid', 'paid', 'overdue'] })
  paymentStatus!: CustomerOpenReceivable['paymentStatus'];
  @ApiProperty({ type: String }) sourceInvoiceNumber!: string;
  @ApiProperty({ type: String }) total!: string;
}

export class CustomerPaymentAccountDto implements CustomerPaymentAccount {
  @ApiProperty({ type: String }) advanceBalance!: string;
  @ApiProperty({ isArray: true, type: CustomerAdvanceDto }) advances!: CustomerAdvance[];
  @ApiProperty({ type: String }) availableCredit!: string;
  @ApiProperty({ type: String }) customerName!: string;
  @ApiProperty({ format: 'uuid', type: String }) customerPartnerId!: string;
  @ApiProperty({ isArray: true, type: CustomerAccountEntryDto }) entries!: CustomerAccountEntry[];
  @ApiPropertyOptional({ type: PosAccountReceivableDto, isArray: true })
  posReceivables?: PosAccountReceivableDto[];
  @ApiProperty({ isArray: true, type: CustomerOpenReceivableDto })
  openReceivables!: CustomerOpenReceivable[];
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
  @ApiPropertyOptional({ type: String }) businessTimezone?: string;
  @ApiProperty({ isArray: true, type: CustomerPaymentAccountCustomerDto })
  customers!: CustomerPaymentAccountReferenceData['customers'];
}
