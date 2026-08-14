import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import {
  financePaymentMethods,
  type CancelFinanceCustomerDocumentRequest,
  type CreateFinanceCustomerDocumentRequest,
  type CreateFinancePaymentRequest,
  type FinanceCustomerDocument,
  type FinanceInvoiceDraftReference,
  type FinancePayment,
  type FinancePaymentStatusHistoryEntry,
  type FinanceReferenceData,
  type FinanceSummary,
} from '@vista/contracts';

const decimalPattern = /^\d+(\.\d{1,4})?$/u;

export class CreateFinanceCustomerDocumentDto implements CreateFinanceCustomerDocumentRequest {
  @ApiProperty({ format: 'date', type: String })
  @IsDateString()
  dueDate!: string;

  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('4')
  salesInvoiceId!: string;
}

export class CreateFinancePaymentDto implements CreateFinancePaymentRequest {
  @ApiProperty({ example: '125.0000', type: String })
  @IsString()
  @Matches(decimalPattern)
  amount!: string;

  @ApiPropertyOptional({ maxLength: 2000, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiProperty({ format: 'date', type: String })
  @IsDateString()
  paymentDate!: string;

  @ApiProperty({ enum: financePaymentMethods })
  @IsIn(financePaymentMethods)
  paymentMethod!: CreateFinancePaymentRequest['paymentMethod'];

  @ApiPropertyOptional({ maxLength: 255, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  paymentReference?: string;
}

export class CancelFinanceCustomerDocumentDto implements CancelFinanceCustomerDocumentRequest {
  @ApiProperty({ maxLength: 1000, type: String })
  @IsString()
  @MaxLength(1000)
  cancellationReason!: string;

  @ApiProperty({ minimum: 1, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

class FinanceInvoiceDraftReferenceDto implements FinanceInvoiceDraftReference {
  @ApiProperty({ type: String }) currencyCode!: string;
  @ApiProperty({ type: String }) customerName!: string;
  @ApiProperty({ format: 'uuid', type: String }) customerPartnerId!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) number!: string;
  @ApiProperty({ format: 'date-time', type: String }) recordedAt!: string;
  @ApiProperty({ type: String }) total!: string;
}

export class FinanceReferenceDataDto implements FinanceReferenceData {
  @ApiProperty({ isArray: true, type: FinanceInvoiceDraftReferenceDto })
  invoiceDrafts!: FinanceInvoiceDraftReference[];
}

class FinancePaymentDto implements FinancePayment {
  @ApiProperty({ type: String }) amount!: string;
  @ApiProperty({ format: 'date-time', type: String }) allocatedAt!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiPropertyOptional({ type: String }) notes?: string;
  @ApiProperty({ type: String }) number!: string;
  @ApiProperty({ format: 'date', type: String }) paymentDate!: string;
  @ApiProperty({ enum: financePaymentMethods }) paymentMethod!: FinancePayment['paymentMethod'];
  @ApiPropertyOptional({ type: String }) paymentReference?: string;
  @ApiProperty({ format: 'date-time', type: String }) recordedAt!: string;
}

class FinancePaymentStatusHistoryEntryDto {
  @ApiProperty({ format: 'date-time', type: String }) changedAt!: string;
  @ApiPropertyOptional({ type: String }) changedByName?: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ enum: ['unpaid', 'partially_paid', 'paid', 'overdue', 'cancelled'] })
  nextStatus!: FinancePaymentStatusHistoryEntry['nextStatus'];
  @ApiPropertyOptional({ enum: ['unpaid', 'partially_paid', 'paid', 'overdue', 'cancelled'] })
  previousStatus?: FinancePaymentStatusHistoryEntry['previousStatus'];
  @ApiProperty({ type: String }) reason!: string;
}

export class FinanceCustomerDocumentDto implements FinanceCustomerDocument {
  @ApiProperty({ type: String }) allocatedTotal!: string;
  @ApiProperty({ type: String }) bgnTotal!: string;
  @ApiProperty({ format: 'date-time', type: String }) createdAt!: string;
  @ApiProperty({ type: String }) currencyCode!: string;
  @ApiProperty({ type: String }) customerName!: string;
  @ApiProperty({ format: 'uuid', type: String }) customerPartnerId!: string;
  @ApiProperty({ format: 'date', type: String }) documentDate!: string;
  @ApiProperty({ format: 'date', type: String }) dueDate!: string;
  @ApiProperty({ type: String }) exchangeRate!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) number!: string;
  @ApiProperty({ type: String }) outstandingTotal!: string;
  @ApiProperty({ enum: ['unpaid', 'partially_paid', 'paid', 'overdue', 'cancelled'] })
  paymentStatus!: FinanceCustomerDocument['paymentStatus'];
  @ApiProperty({ isArray: true, type: FinancePaymentDto }) payments!: FinancePayment[];
  @ApiProperty({ format: 'date', type: String }) rateDate!: string;
  @ApiProperty({ type: String }) rateSource!: string;
  @ApiProperty({ enum: ['pending_finance_review', 'cancelled'] })
  reviewState!: FinanceCustomerDocument['reviewState'];
  @ApiProperty({ type: String }) sourceInvoiceNumber!: string;
  @ApiProperty({ format: 'uuid', type: String }) sourceSalesInvoiceId!: string;
  @ApiProperty({ isArray: true, type: FinancePaymentStatusHistoryEntryDto })
  statusHistory!: FinancePaymentStatusHistoryEntry[];
  @ApiProperty({ type: String }) total!: string;
  @ApiProperty({ minimum: 1, type: Number }) version!: number;
}

export class FinanceSummaryDto implements FinanceSummary {
  @ApiProperty({ type: Number }) activeDocuments!: number;
  @ApiProperty({ type: String }) overdueOutstanding!: string;
  @ApiProperty({ type: Number }) paidDocuments!: number;
  @ApiProperty({ type: String }) totalOutstanding!: string;
}
