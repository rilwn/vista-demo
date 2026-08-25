import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import {
  financeAgingBuckets,
  financeAgingKinds,
  financeJournalKinds,
  financeTurnoverKinds,
  vatTreatments,
  type FinanceAgingReport,
  type FinanceAgingReportItem,
  type FinanceAgingTotals,
  type FinanceJournalReport,
  type FinanceJournalReportItem,
  type FinanceJournalTotals,
  type FinanceTurnoverReport,
  type FinanceTurnoverReportItem,
  type FinanceTurnoverTotals,
  type FinanceVatReviewItem,
  type FinanceVatReviewReport,
} from '@vista/contracts';

export class FinanceReportPageQueryDto {
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
}

export class FinanceAgingQueryDto extends FinanceReportPageQueryDto {
  @ApiProperty({ enum: financeAgingKinds })
  @IsIn(financeAgingKinds)
  kind!: FinanceAgingReport['kind'];
}

export class FinanceTurnoverQueryDto extends FinanceReportPageQueryDto {
  @ApiPropertyOptional({ format: 'date', type: String })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ format: 'date', type: String })
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @ApiProperty({ enum: financeTurnoverKinds })
  @IsIn(financeTurnoverKinds)
  kind!: FinanceTurnoverReport['kind'];
}

export class FinanceJournalQueryDto extends FinanceReportPageQueryDto {
  @ApiPropertyOptional({ format: 'date', type: String })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ format: 'date', type: String })
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @ApiProperty({ enum: financeJournalKinds })
  @IsIn(financeJournalKinds)
  kind!: FinanceJournalReport['kind'];
}

export class FinanceVatQueryDto {
  @ApiPropertyOptional({ format: 'date', type: String })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ format: 'date', type: String })
  @IsOptional()
  @IsDateString()
  dateTo?: string;
}

class FinanceAgingReportItemDto implements FinanceAgingReportItem {
  @ApiProperty({ enum: financeAgingBuckets }) bucket!: FinanceAgingReportItem['bucket'];
  @ApiProperty({ minimum: 0, type: Number }) daysOverdue!: number;
  @ApiProperty({ format: 'date', type: String }) documentDate!: string;
  @ApiProperty({ format: 'date', type: String }) dueDate!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) number!: string;
  @ApiProperty({ type: String }) originalBgnTotal!: string;
  @ApiProperty({ type: String }) outstandingBgnTotal!: string;
  @ApiProperty({ format: 'uuid', type: String }) partnerId!: string;
  @ApiProperty({ type: String }) partnerName!: string;
  @ApiProperty({ enum: ['unpaid', 'partially_paid', 'paid', 'overdue'] })
  paymentStatus!: FinanceAgingReportItem['paymentStatus'];
  @ApiProperty({ type: String }) sourceNumber!: string;
}

class FinanceAgingTotalsDto implements FinanceAgingTotals {
  @ApiProperty({ type: String }) current!: string;
  @ApiProperty({ type: String }) days0To30!: string;
  @ApiProperty({ type: String }) days31To60!: string;
  @ApiProperty({ type: String }) days61To90!: string;
  @ApiProperty({ type: String }) over90!: string;
  @ApiProperty({ type: String }) total!: string;
}

export class FinanceAgingReportDto implements FinanceAgingReport {
  @ApiProperty({ format: 'date', type: String }) asOf!: string;
  @ApiProperty({ type: [FinanceAgingReportItemDto] }) items!: FinanceAgingReportItem[];
  @ApiProperty({ enum: financeAgingKinds }) kind!: FinanceAgingReport['kind'];
  @ApiProperty({ minimum: 1, type: Number }) page!: number;
  @ApiProperty({ minimum: 1, type: Number }) pageSize!: number;
  @ApiProperty({ minimum: 0, type: Number }) totalItems!: number;
  @ApiProperty({ minimum: 0, type: Number }) totalPages!: number;
  @ApiProperty({ type: FinanceAgingTotalsDto }) totals!: FinanceAgingTotals;
}

class FinanceTurnoverReportItemDto implements FinanceTurnoverReportItem {
  @ApiProperty({ type: String }) allocatedBgnTotal!: string;
  @ApiProperty({ minimum: 0, type: Number }) documentCount!: number;
  @ApiProperty({ type: String }) grossBgnTotal!: string;
  @ApiProperty({ type: String }) outstandingBgnTotal!: string;
  @ApiProperty({ format: 'uuid', type: String }) partnerId!: string;
  @ApiProperty({ type: String }) partnerName!: string;
}

class FinanceTurnoverTotalsDto implements FinanceTurnoverTotals {
  @ApiProperty({ type: String }) allocatedBgnTotal!: string;
  @ApiProperty({ minimum: 0, type: Number }) documentCount!: number;
  @ApiProperty({ type: String }) grossBgnTotal!: string;
  @ApiProperty({ type: String }) outstandingBgnTotal!: string;
}

export class FinanceTurnoverReportDto implements FinanceTurnoverReport {
  @ApiProperty({ format: 'date', type: String }) dateFrom!: string;
  @ApiProperty({ format: 'date', type: String }) dateTo!: string;
  @ApiProperty({ type: [FinanceTurnoverReportItemDto] }) items!: FinanceTurnoverReportItem[];
  @ApiProperty({ enum: financeTurnoverKinds }) kind!: FinanceTurnoverReport['kind'];
  @ApiProperty({ minimum: 1, type: Number }) page!: number;
  @ApiProperty({ minimum: 1, type: Number }) pageSize!: number;
  @ApiProperty({ minimum: 0, type: Number }) totalItems!: number;
  @ApiProperty({ minimum: 0, type: Number }) totalPages!: number;
  @ApiProperty({ type: FinanceTurnoverTotalsDto }) totals!: FinanceTurnoverTotals;
}

class FinanceJournalReportItemDto implements FinanceJournalReportItem {
  @ApiProperty({ type: String }) currencyCode!: string;
  @ApiProperty({ format: 'date', type: String }) documentDate!: string;
  @ApiProperty({ enum: ['invoice', 'proforma', 'credit_note', 'debit_note', 'supplier_invoice'] })
  documentType!: FinanceJournalReportItem['documentType'];
  @ApiPropertyOptional({ type: String }) exchangeRate?: string;
  @ApiProperty({ type: String }) grossBgnTotal!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) netBgnTotal!: string;
  @ApiProperty({ type: String }) number!: string;
  @ApiProperty({ type: String }) partnerName!: string;
  @ApiPropertyOptional({ type: String }) partnerVatNumber?: string;
  @ApiPropertyOptional({ type: String }) sourceNumber?: string;
  @ApiProperty({ enum: ['cancelled', 'draft', 'recorded'] })
  status!: FinanceJournalReportItem['status'];
  @ApiProperty({ type: Boolean }) taxBreakdownComplete!: boolean;
  @ApiPropertyOptional({ format: 'date', type: String }) taxEventDate?: string;
  @ApiProperty({ type: String }) vatBgnTotal!: string;
}

class FinanceJournalTotalsDto implements FinanceJournalTotals {
  @ApiProperty({ minimum: 0, type: Number }) documentCount!: number;
  @ApiProperty({ type: String }) grossBgnTotal!: string;
  @ApiProperty({ minimum: 0, type: Number }) incompleteTaxDocuments!: number;
  @ApiProperty({ type: String }) netBgnTotal!: string;
  @ApiProperty({ type: String }) vatBgnTotal!: string;
}

export class FinanceJournalReportDto implements FinanceJournalReport {
  @ApiProperty({ format: 'date', type: String }) dateFrom!: string;
  @ApiProperty({ format: 'date', type: String }) dateTo!: string;
  @ApiProperty({ type: [FinanceJournalReportItemDto] }) items!: FinanceJournalReportItem[];
  @ApiProperty({ enum: financeJournalKinds }) kind!: FinanceJournalReport['kind'];
  @ApiProperty({ minimum: 1, type: Number }) page!: number;
  @ApiProperty({ minimum: 1, type: Number }) pageSize!: number;
  @ApiProperty({ minimum: 0, type: Number }) totalItems!: number;
  @ApiProperty({ minimum: 0, type: Number }) totalPages!: number;
  @ApiProperty({ type: FinanceJournalTotalsDto }) totals!: FinanceJournalTotals;
}

class FinanceVatReviewItemDto implements FinanceVatReviewItem {
  @ApiProperty({ enum: ['input', 'output'] }) direction!: FinanceVatReviewItem['direction'];
  @ApiProperty({ minimum: 0, type: Number }) documentCount!: number;
  @ApiProperty({ type: String }) netBgnTotal!: string;
  @ApiProperty({ type: String }) vatBgnTotal!: string;
  @ApiProperty({ type: String }) vatRate!: string;
  @ApiProperty({ enum: vatTreatments }) vatTreatment!: FinanceVatReviewItem['vatTreatment'];
}

export class FinanceVatReviewReportDto implements FinanceVatReviewReport {
  @ApiProperty({ format: 'date', type: String }) dateFrom!: string;
  @ApiProperty({ format: 'date', type: String }) dateTo!: string;
  @ApiProperty({ type: [String] }) incompletePurchaseDocumentNumbers!: string[];
  @ApiProperty({ minimum: 0, type: Number }) incompletePurchaseDocuments!: number;
  @ApiProperty({ type: [FinanceVatReviewItemDto] }) items!: FinanceVatReviewItem[];
  @ApiProperty({ type: String }) recordedDifferenceBgn!: string;
  @ApiProperty({ type: String }) recordedInputVatBgn!: string;
  @ApiProperty({ type: String }) recordedOutputVatBgn!: string;
}
