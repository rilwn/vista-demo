import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsUUID } from 'class-validator';
import type {
  PosCashierReportRow,
  PosCategoryReportRow,
  PosLocationReportRow,
  PosPaymentReportRow,
  PosProductReportRow,
  PosReportFilters,
  PosReportLocationOption,
  PosReportOperatorOption,
  PosReportOverview,
  PosReportReferenceData,
  PosReportRegisterOption,
  PosReportTotals,
  PosShiftReportRow,
} from '@vista/contracts';

export class PosReportQueryDto implements PosReportFilters {
  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID('loose')
  businessLocationId?: string;

  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID('loose')
  cashRegisterId?: string;

  @ApiProperty({ format: 'date', type: String })
  @IsDateString({ strict: true })
  dateFrom!: string;

  @ApiProperty({ format: 'date', type: String })
  @IsDateString({ strict: true })
  dateTo!: string;

  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID('loose')
  operatorId?: string;
}

class PosReportReferenceOptionDto implements PosReportLocationOption {
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) name!: string;
}

class PosReportRegisterOptionDto implements PosReportRegisterOption {
  @ApiProperty({ format: 'uuid', type: String }) businessLocationId!: string;
  @ApiProperty({ type: String }) code!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) name!: string;
}

class PosReportOperatorOptionDto implements PosReportOperatorOption {
  @ApiProperty({ format: 'uuid', type: String }) businessLocationId!: string;
  @ApiProperty({ type: String }) code!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) name!: string;
}

export class PosReportReferenceDataDto implements PosReportReferenceData {
  @ApiProperty({ type: String }) businessTimezone!: string;
  @ApiProperty({ isArray: true, type: PosReportReferenceOptionDto })
  locations!: PosReportLocationOption[];
  @ApiProperty({ isArray: true, type: PosReportOperatorOptionDto })
  operators!: PosReportReferenceData['operators'];
  @ApiProperty({ isArray: true, type: PosReportRegisterOptionDto })
  registers!: PosReportRegisterOption[];
}

class PosReportTotalsDto implements PosReportTotals {
  @ApiProperty({ type: String }) averageSaleBgn!: string;
  @ApiProperty({ type: String }) grossReturnsBgn!: string;
  @ApiProperty({ type: String }) grossSalesBgn!: string;
  @ApiProperty({ type: String }) itemQuantityReturned!: string;
  @ApiProperty({ type: String }) itemQuantitySold!: string;
  @ApiProperty({ type: String }) netRevenueBgn!: string;
  @ApiProperty({ type: String }) netSalesBgn!: string;
  @ApiProperty({ minimum: 0, type: Number }) returnCount!: number;
  @ApiProperty({ minimum: 0, type: Number }) saleCount!: number;
  @ApiProperty({ type: String }) vatSalesBgn!: string;
}

class PosCashierReportRowDto implements PosCashierReportRow {
  @ApiProperty({ type: String }) grossReturnsBgn!: string;
  @ApiProperty({ type: String }) grossSalesBgn!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: String }) netRevenueBgn!: string;
  @ApiProperty({ type: String }) operatorCode!: string;
  @ApiProperty({ format: 'uuid', type: String }) operatorId!: string;
  @ApiProperty({ minimum: 0, type: Number }) returnCount!: number;
  @ApiProperty({ minimum: 0, type: Number }) saleCount!: number;
}

class PosProductReportRowDto implements PosProductReportRow {
  @ApiProperty({ type: String }) categoryName!: string;
  @ApiProperty({ type: String }) grossReturnsBgn!: string;
  @ApiProperty({ type: String }) grossSalesBgn!: string;
  @ApiProperty({ type: String }) netRevenueBgn!: string;
  @ApiProperty({ type: String }) productCode!: string;
  @ApiProperty({ format: 'uuid', type: String }) productId!: string;
  @ApiProperty({ type: String }) productName!: string;
  @ApiProperty({ type: String }) quantityReturned!: string;
  @ApiProperty({ type: String }) quantitySold!: string;
}

class PosCategoryReportRowDto implements PosCategoryReportRow {
  @ApiProperty({ format: 'uuid', type: String }) categoryId!: string;
  @ApiProperty({ type: String }) categoryName!: string;
  @ApiProperty({ type: String }) grossReturnsBgn!: string;
  @ApiProperty({ type: String }) grossSalesBgn!: string;
  @ApiProperty({ type: String }) netRevenueBgn!: string;
  @ApiProperty({ type: String }) quantityReturned!: string;
  @ApiProperty({ type: String }) quantitySold!: string;
}

class PosPaymentReportRowDto implements PosPaymentReportRow {
  @ApiProperty({ type: String }) collectedBgn!: string;
  @ApiProperty({ enum: ['card', 'cash'] }) method!: 'card' | 'cash';
  @ApiProperty({ type: String }) netBgn!: string;
  @ApiProperty({ type: String }) refundedBgn!: string;
}

class PosLocationReportRowDto implements PosLocationReportRow {
  @ApiProperty({ type: String }) averageSaleBgn!: string;
  @ApiProperty({ format: 'uuid', type: String }) businessLocationId!: string;
  @ApiProperty({ type: String }) grossReturnsBgn!: string;
  @ApiProperty({ type: String }) grossSalesBgn!: string;
  @ApiProperty({ type: String }) locationName!: string;
  @ApiProperty({ type: String }) netRevenueBgn!: string;
  @ApiProperty({ type: Number }) revenueSharePercent!: number;
  @ApiProperty({ minimum: 0, type: Number }) returnCount!: number;
  @ApiProperty({ minimum: 0, type: Number }) saleCount!: number;
}

class PosShiftReportRowDto implements PosShiftReportRow {
  @ApiProperty({ type: String }) cashRegisterCode!: string;
  @ApiProperty({ format: 'uuid', type: String }) cashRegisterId!: string;
  @ApiProperty({ type: String }) cashRegisterName!: string;
  @ApiProperty({ type: String }) cashRefundsBgn!: string;
  @ApiProperty({ type: String }) cashSalesBgn!: string;
  @ApiPropertyOptional({ format: 'date-time', type: String }) closedAt?: string;
  @ApiPropertyOptional({ type: String }) closingCashBgn?: string;
  @ApiPropertyOptional({ type: String }) differenceBgn?: string;
  @ApiProperty({ type: String }) expectedCashBgn!: string;
  @ApiProperty({ enum: ['disabled', 'hardware', 'simulator'] })
  fiscalMode!: PosShiftReportRow['fiscalMode'];
  @ApiProperty({ type: String }) grossReturnsBgn!: string;
  @ApiProperty({ type: String }) grossSalesBgn!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) locationName!: string;
  @ApiProperty({ type: String }) netRevenueBgn!: string;
  @ApiProperty({ format: 'date-time', type: String }) openedAt!: string;
  @ApiProperty({ type: String }) openingCashBgn!: string;
  @ApiProperty({ type: String }) operatorCode!: string;
  @ApiProperty({ format: 'uuid', type: String }) operatorId!: string;
  @ApiProperty({ type: String }) operatorName!: string;
  @ApiProperty({ enum: ['x', 'z'] }) reportType!: 'x' | 'z';
  @ApiProperty({ minimum: 0, type: Number }) returnCount!: number;
  @ApiProperty({ minimum: 0, type: Number }) saleCount!: number;
  @ApiProperty({ type: String }) shiftNumber!: string;
  @ApiProperty({ enum: ['closed', 'open'] }) status!: 'closed' | 'open';
}

export class PosReportOverviewDto implements PosReportOverview {
  @ApiProperty({ isArray: true, type: PosCashierReportRowDto })
  cashiers!: PosCashierReportRow[];
  @ApiProperty({ isArray: true, type: PosCategoryReportRowDto })
  categories!: PosCategoryReportRow[];
  @ApiProperty({ format: 'date', type: String }) dateFrom!: string;
  @ApiProperty({ format: 'date', type: String }) dateTo!: string;
  @ApiProperty({ format: 'date-time', type: String }) generatedAt!: string;
  @ApiProperty({ isArray: true, type: PosLocationReportRowDto })
  locations!: PosLocationReportRow[];
  @ApiProperty({ isArray: true, type: PosPaymentReportRowDto })
  payments!: PosPaymentReportRow[];
  @ApiProperty({ isArray: true, type: PosProductReportRowDto })
  products!: PosProductReportRow[];
  @ApiProperty({ isArray: true, type: PosShiftReportRowDto })
  shifts!: PosShiftReportRow[];
  @ApiProperty({ type: String }) timezone!: string;
  @ApiProperty({ type: PosReportTotalsDto }) totals!: PosReportTotals;
}
