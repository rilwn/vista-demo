import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import {
  financeAgingBuckets,
  financeAgingKinds,
  financeTurnoverKinds,
  type FinanceAgingReport,
  type FinanceAgingReportItem,
  type FinanceAgingTotals,
  type FinanceTurnoverReport,
  type FinanceTurnoverReportItem,
  type FinanceTurnoverTotals,
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
