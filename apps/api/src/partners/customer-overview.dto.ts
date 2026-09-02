import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type {
  CustomerFinancialDocumentSummary,
  CustomerOperationalOverview,
  CustomerOverviewSummary,
  CustomerPaymentSummary,
  CustomerPurchaseHistoryEntry,
  CustomerPurchaseLine,
  CustomerReceivableSummary,
  FinancePaymentMethod,
  FinancePaymentStatus,
} from '@vista/contracts';

import { CustomerLocationProfileDto } from './customer-assets.dto.js';
import { PartnerProfileDto } from './partners.dto.js';

export class CustomerOverviewQueryDto {
  @ApiPropertyOptional({ default: 10, maximum: 50, minimum: 1, type: Number })
  @Type(() => Number)
  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(50)
  limit = 10;
}

export class CustomerOverviewSummaryDto implements CustomerOverviewSummary {
  @ApiProperty({ type: Number })
  activeEquipment!: number;

  @ApiProperty({ type: Number })
  activeLocations!: number;

  @ApiProperty({ type: Number })
  financialDocuments!: number;

  @ApiPropertyOptional({ format: 'date-time', type: String })
  lastPurchaseAt?: string;

  @ApiProperty({ type: Number })
  openReceivables!: number;

  @ApiProperty({ example: '60.0000', type: String })
  outstandingBgn!: string;

  @ApiProperty({ type: Number })
  payments!: number;

  @ApiProperty({ type: Number })
  purchases!: number;
}

export class CustomerPurchaseLineDto implements CustomerPurchaseLine {
  @ApiProperty({ example: '50.0000', type: String })
  lineTotal!: string;

  @ApiProperty({ format: 'uuid', type: String })
  productId!: string;

  @ApiProperty({ type: String })
  productName!: string;

  @ApiProperty({ example: '1.0000', type: String })
  quantity!: string;

  @ApiProperty({ example: '50.0000', type: String })
  unitPrice!: string;
}

export class CustomerPurchaseHistoryEntryDto implements CustomerPurchaseHistoryEntry {
  @ApiProperty({ example: 'BGN', type: String })
  currencyCode!: string;

  @ApiProperty({ format: 'uuid', type: String })
  id!: string;

  @ApiProperty({ isArray: true, type: CustomerPurchaseLineDto })
  lines!: CustomerPurchaseLine[];

  @ApiProperty({ type: String })
  number!: string;

  @ApiProperty({ format: 'date-time', type: String })
  recordedAt!: string;

  @ApiProperty({ enum: ['erp_sales', 'pos'] })
  source!: CustomerPurchaseHistoryEntry['source'];

  @ApiPropertyOptional({ format: 'uuid', type: String })
  sourceShipmentId?: string;

  @ApiProperty({ example: '60.0000', type: String })
  total!: string;
}

export class CustomerFinancialDocumentSummaryDto implements CustomerFinancialDocumentSummary {
  @ApiProperty({ example: '60.0000', type: String })
  bgnGrossTotal!: string;

  @ApiProperty({ example: 'BGN', type: String })
  currencyCode!: string;

  @ApiProperty({ enum: ['invoice', 'proforma', 'credit_note', 'debit_note'] })
  documentType!: CustomerFinancialDocumentSummary['documentType'];

  @ApiProperty({ type: String })
  draftNumber!: string;

  @ApiPropertyOptional({ format: 'date', type: String })
  dueDate?: string;

  @ApiProperty({ example: '60.0000', type: String })
  grossTotal!: string;

  @ApiProperty({ format: 'uuid', type: String })
  id!: string;

  @ApiProperty({ format: 'date', type: String })
  issueDate!: string;

  @ApiPropertyOptional({ type: String })
  officialNumber?: string;

  @ApiPropertyOptional({ format: 'uuid', type: String })
  sourceSalesInvoiceId?: string;

  @ApiProperty({ enum: ['draft', 'cancelled'] })
  status!: CustomerFinancialDocumentSummary['status'];
}

export class CustomerReceivableSummaryDto implements CustomerReceivableSummary {
  @ApiProperty({ example: '20.0000', type: String })
  allocatedTotal!: string;

  @ApiProperty({ example: '60.0000', type: String })
  bgnTotal!: string;

  @ApiProperty({ example: 'BGN', type: String })
  currencyCode!: string;

  @ApiProperty({ format: 'date', type: String })
  documentDate!: string;

  @ApiProperty({ format: 'date', type: String })
  dueDate!: string;

  @ApiProperty({ format: 'uuid', type: String })
  id!: string;

  @ApiProperty({ type: String })
  number!: string;

  @ApiProperty({ example: '40.0000', type: String })
  outstandingTotal!: string;

  @ApiProperty({ enum: ['unpaid', 'partially_paid', 'paid', 'overdue', 'cancelled'] })
  paymentStatus!: FinancePaymentStatus;

  @ApiProperty({ format: 'uuid', type: String })
  sourceSalesInvoiceId!: string;

  @ApiProperty({ example: '60.0000', type: String })
  total!: string;
}

export class CustomerPaymentSummaryDto implements CustomerPaymentSummary {
  @ApiProperty({ example: '20.0000', type: String })
  amount!: string;

  @ApiProperty({ example: 'BGN', type: String })
  currencyCode!: string;

  @ApiProperty({ format: 'uuid', type: String })
  id!: string;

  @ApiProperty({ type: String })
  number!: string;

  @ApiProperty({ format: 'date', type: String })
  paymentDate!: string;

  @ApiProperty({ enum: ['cash', 'bank_transfer', 'pos_terminal', 'card', 'offset'] })
  paymentMethod!: FinancePaymentMethod;

  @ApiPropertyOptional({ type: String })
  paymentReference?: string;

  @ApiProperty({ format: 'date-time', type: String })
  recordedAt!: string;
}

export class CustomerOperationalOverviewDto implements CustomerOperationalOverview {
  @ApiProperty({ isArray: true, type: CustomerFinancialDocumentSummaryDto })
  financialDocuments!: CustomerFinancialDocumentSummary[];

  @ApiProperty({ isArray: true, type: CustomerLocationProfileDto })
  locations!: CustomerLocationProfileDto[];

  @ApiProperty({ isArray: true, type: CustomerPaymentSummaryDto })
  payments!: CustomerPaymentSummary[];

  @ApiProperty({ type: PartnerProfileDto })
  profile!: PartnerProfileDto;

  @ApiProperty({ isArray: true, type: CustomerPurchaseHistoryEntryDto })
  purchases!: CustomerPurchaseHistoryEntry[];

  @ApiProperty({ isArray: true, type: CustomerReceivableSummaryDto })
  receivables!: CustomerReceivableSummary[];

  @ApiProperty({ type: CustomerOverviewSummaryDto })
  summary!: CustomerOverviewSummary;
}
