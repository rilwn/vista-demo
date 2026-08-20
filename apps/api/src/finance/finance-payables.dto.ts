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
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import type {
  AllocateFinanceSupplierAdvanceRequest,
  CreateFinanceSupplierAdvanceRequest,
  CreateFinanceSupplierOffsetRequest,
  CreateFinanceSupplierPayableRequest,
  CreateFinanceSupplierPaymentRequest,
  FinanceOffsetReceivableReference,
  FinanceSupplierAdvancePage,
  FinanceSupplierBankMatchCandidate,
  FinanceSupplierInvoiceReference,
  FinanceSupplierOffset,
  FinanceSupplierOffsetPage,
  FinanceSupplierPayable,
  FinanceSupplierPayablePage,
  FinanceSupplierPayment,
  FinanceSupplierPaymentAllocation,
  FinanceSupplierReference,
  FinanceSupplierReferenceData,
  MatchFinanceSupplierBankTransactionRequest,
} from '@vista/contracts';

const amountPattern = /^\d+(\.\d{1,4})?$/u;
const supplierPaymentMethods = ['cash', 'bank_transfer', 'pos_terminal', 'card'] as const;

export class CreateFinanceSupplierPayableDto implements CreateFinanceSupplierPayableRequest {
  @ApiProperty({ format: 'date', type: String })
  @IsDateString()
  dueDate!: string;

  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('loose')
  supplierInvoiceId!: string;
}

export class CreateFinanceSupplierPaymentDto implements CreateFinanceSupplierPaymentRequest {
  @ApiProperty({ example: '125.0000', type: String })
  @IsString()
  @Matches(amountPattern)
  amount!: string;

  @ApiPropertyOptional({ maxLength: 2000, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiProperty({ format: 'date', type: String })
  @IsDateString()
  paymentDate!: string;

  @ApiProperty({ enum: supplierPaymentMethods })
  @IsIn(supplierPaymentMethods)
  paymentMethod!: CreateFinanceSupplierPaymentRequest['paymentMethod'];

  @ApiPropertyOptional({ maxLength: 255, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  paymentReference?: string;
}

export class CreateFinanceSupplierAdvanceDto
  extends CreateFinanceSupplierPaymentDto
  implements CreateFinanceSupplierAdvanceRequest
{
  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('loose')
  supplierPartnerId!: string;
}

export class AllocateFinanceSupplierAdvanceDto implements AllocateFinanceSupplierAdvanceRequest {
  @ApiProperty({ example: '125.0000', type: String })
  @IsString()
  @Matches(amountPattern)
  amount!: string;

  @ApiProperty({ minimum: 1, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedAdvanceVersion!: number;

  @ApiProperty({ minimum: 1, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedPayableVersion!: number;

  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('loose')
  supplierPayableId!: string;
}

export class CreateFinanceSupplierOffsetDto implements CreateFinanceSupplierOffsetRequest {
  @ApiProperty({ example: '125.0000', type: String })
  @IsString()
  @Matches(amountPattern)
  amount!: string;

  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('loose')
  customerDocumentId!: string;

  @ApiProperty({ minimum: 1, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedCustomerDocumentVersion!: number;

  @ApiProperty({ minimum: 1, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedSupplierPayableVersion!: number;

  @ApiProperty({ format: 'date', type: String })
  @IsDateString()
  offsetDate!: string;

  @ApiProperty({ maxLength: 1000, type: String })
  @IsString()
  @MaxLength(1000)
  reason!: string;

  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('loose')
  supplierPayableId!: string;
}

export class MatchFinanceSupplierBankTransactionDto implements MatchFinanceSupplierBankTransactionRequest {
  @ApiProperty({ minimum: 1, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiProperty({ enum: ['advance', 'payable'] })
  @IsIn(['advance', 'payable'])
  mode!: MatchFinanceSupplierBankTransactionRequest['mode'];

  @ApiPropertyOptional({ format: 'uuid', type: String })
  @ValidateIf((value: MatchFinanceSupplierBankTransactionDto) => value.mode === 'advance')
  @IsUUID('loose')
  supplierPartnerId?: string;

  @ApiPropertyOptional({ format: 'uuid', type: String })
  @ValidateIf((value: MatchFinanceSupplierBankTransactionDto) => value.mode === 'payable')
  @IsUUID('loose')
  supplierPayableId?: string;
}

export class FinanceSupplierListQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 50, maximum: 100, minimum: 1, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 50;

  @ApiPropertyOptional({ enum: ['unpaid', 'partially_paid', 'paid', 'overdue'] })
  @IsOptional()
  @IsIn(['unpaid', 'partially_paid', 'paid', 'overdue'])
  status?: FinanceSupplierPayable['paymentStatus'];

  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID('loose')
  supplierPartnerId?: string;
}

class FinanceSupplierInvoiceReferenceDto implements FinanceSupplierInvoiceReference {
  @ApiProperty({ type: String }) currencyCode!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ format: 'date', type: String }) invoiceDate!: string;
  @ApiProperty({ type: String }) invoiceNumber!: string;
  @ApiPropertyOptional({ type: Number }) paymentTermsDays?: number;
  @ApiProperty({ format: 'date', type: String }) suggestedDueDate!: string;
  @ApiProperty({ type: String }) supplierName!: string;
  @ApiProperty({ format: 'uuid', type: String }) supplierPartnerId!: string;
  @ApiProperty({ type: String }) total!: string;
}

class FinanceSupplierReferenceDto implements FinanceSupplierReference {
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) name!: string;
}

class FinanceOffsetReceivableReferenceDto implements FinanceOffsetReceivableReference {
  @ApiProperty({ type: String }) customerName!: string;
  @ApiProperty({ format: 'uuid', type: String }) customerPartnerId!: string;
  @ApiProperty({ format: 'date', type: String }) dueDate!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) number!: string;
  @ApiProperty({ type: String }) outstandingTotal!: string;
  @ApiProperty({ type: String }) sourceInvoiceNumber!: string;
  @ApiProperty({ type: Number }) version!: number;
}

export class FinanceSupplierReferenceDataDto implements FinanceSupplierReferenceData {
  @ApiProperty({ format: 'date', type: String }) businessDate!: string;
  @ApiProperty({ isArray: true, type: FinanceOffsetReceivableReferenceDto })
  openReceivables!: FinanceOffsetReceivableReference[];
  @ApiProperty({ isArray: true, type: FinanceSupplierInvoiceReferenceDto })
  supplierInvoices!: FinanceSupplierInvoiceReference[];
  @ApiProperty({ isArray: true, type: FinanceSupplierReferenceDto })
  suppliers!: FinanceSupplierReference[];
}

class FinanceSupplierPaymentAllocationDto implements FinanceSupplierPaymentAllocation {
  @ApiProperty({ format: 'date-time', type: String }) allocatedAt!: string;
  @ApiProperty({ type: String }) amount!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) payableNumber!: string;
  @ApiProperty({ format: 'uuid', type: String }) supplierPayableId!: string;
}

export class FinanceSupplierPaymentDto implements FinanceSupplierPayment {
  @ApiProperty({ type: String }) allocatedTotal!: string;
  @ApiProperty({ isArray: true, type: FinanceSupplierPaymentAllocationDto })
  allocations!: FinanceSupplierPaymentAllocation[];
  @ApiProperty({ type: String }) amount!: string;
  @ApiProperty({ type: String }) availableTotal!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ enum: ['payment', 'advance', 'offset'] }) kind!: FinanceSupplierPayment['kind'];
  @ApiPropertyOptional({ type: String }) notes?: string;
  @ApiProperty({ type: String }) number!: string;
  @ApiProperty({ format: 'date', type: String }) paymentDate!: string;
  @ApiProperty({ enum: ['cash', 'bank_transfer', 'pos_terminal', 'card', 'offset'] })
  paymentMethod!: FinanceSupplierPayment['paymentMethod'];
  @ApiPropertyOptional({ type: String }) paymentReference?: string;
  @ApiProperty({ format: 'date-time', type: String }) recordedAt!: string;
  @ApiPropertyOptional({ format: 'uuid', type: String }) sourceBankTransactionId?: string;
  @ApiProperty({ type: String }) supplierName!: string;
  @ApiProperty({ format: 'uuid', type: String }) supplierPartnerId!: string;
  @ApiProperty({ type: Number }) version!: number;
}

export class FinanceSupplierPayableDto implements FinanceSupplierPayable {
  @ApiProperty({ type: String }) allocatedTotal!: string;
  @ApiProperty({ type: String }) bgnTotal!: string;
  @ApiProperty({ format: 'date-time', type: String }) createdAt!: string;
  @ApiProperty({ type: String }) currencyCode!: string;
  @ApiProperty({ format: 'date', type: String }) documentDate!: string;
  @ApiProperty({ format: 'date', type: String }) dueDate!: string;
  @ApiProperty({ type: String }) exchangeRate!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) number!: string;
  @ApiProperty({ type: String }) outstandingTotal!: string;
  @ApiProperty({ enum: ['unpaid', 'partially_paid', 'paid', 'overdue'] })
  paymentStatus!: FinanceSupplierPayable['paymentStatus'];
  @ApiProperty({ isArray: true, type: FinanceSupplierPaymentDto })
  payments!: FinanceSupplierPayment[];
  @ApiProperty({ format: 'date', type: String }) rateDate!: string;
  @ApiProperty({ type: String }) rateSource!: string;
  @ApiProperty({ format: 'uuid', type: String }) sourceSupplierInvoiceId!: string;
  @ApiProperty({ type: String }) sourceSupplierInvoiceNumber!: string;
  @ApiProperty({ type: String }) supplierName!: string;
  @ApiProperty({ format: 'uuid', type: String }) supplierPartnerId!: string;
  @ApiProperty({ type: String }) total!: string;
  @ApiProperty({ type: Number }) version!: number;
}

export class FinanceSupplierPayablePageDto implements FinanceSupplierPayablePage {
  @ApiProperty({ isArray: true, type: FinanceSupplierPayableDto })
  items!: FinanceSupplierPayable[];
  @ApiProperty({ type: Number }) page!: number;
  @ApiProperty({ type: Number }) pageSize!: number;
  @ApiProperty({ type: Number }) totalItems!: number;
  @ApiProperty({ type: Number }) totalPages!: number;
}

export class FinanceSupplierAdvancePageDto implements FinanceSupplierAdvancePage {
  @ApiProperty({ isArray: true, type: FinanceSupplierPaymentDto })
  items!: FinanceSupplierPayment[];
  @ApiProperty({ type: Number }) page!: number;
  @ApiProperty({ type: Number }) pageSize!: number;
  @ApiProperty({ type: Number }) totalItems!: number;
  @ApiProperty({ type: Number }) totalPages!: number;
}

export class FinanceSupplierOffsetDto implements FinanceSupplierOffset {
  @ApiProperty({ type: String }) amount!: string;
  @ApiProperty({ format: 'date-time', type: String }) createdAt!: string;
  @ApiProperty({ format: 'uuid', type: String }) customerDocumentId!: string;
  @ApiProperty({ type: String }) customerDocumentNumber!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) number!: string;
  @ApiProperty({ format: 'date', type: String }) offsetDate!: string;
  @ApiProperty({ format: 'uuid', type: String }) partnerId!: string;
  @ApiProperty({ type: String }) partnerName!: string;
  @ApiProperty({ type: String }) reason!: string;
  @ApiProperty({ format: 'uuid', type: String }) supplierPayableId!: string;
  @ApiProperty({ type: String }) supplierPayableNumber!: string;
}

export class FinanceSupplierOffsetPageDto implements FinanceSupplierOffsetPage {
  @ApiProperty({ isArray: true, type: FinanceSupplierOffsetDto }) items!: FinanceSupplierOffset[];
  @ApiProperty({ type: Number }) page!: number;
  @ApiProperty({ type: Number }) pageSize!: number;
  @ApiProperty({ type: Number }) totalItems!: number;
  @ApiProperty({ type: Number }) totalPages!: number;
}

export class FinanceSupplierBankMatchCandidateDto implements FinanceSupplierBankMatchCandidate {
  @ApiProperty({ format: 'date', type: String }) dueDate!: string;
  @ApiProperty({ type: String }) outstandingTotal!: string;
  @ApiProperty({ type: String }) payableNumber!: string;
  @ApiProperty({ type: Boolean }) referenceMatched!: boolean;
  @ApiProperty({ type: Number }) score!: number;
  @ApiProperty({ type: String }) sourceSupplierInvoiceNumber!: string;
  @ApiProperty({ type: String }) supplierName!: string;
  @ApiProperty({ format: 'uuid', type: String }) supplierPartnerId!: string;
  @ApiProperty({ format: 'uuid', type: String }) supplierPayableId!: string;
}
