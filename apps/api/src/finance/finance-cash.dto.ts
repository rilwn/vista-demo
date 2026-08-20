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
} from 'class-validator';
import {
  financeCashVoucherDirections,
  financeCashVoucherStatuses,
  type CancelFinanceCashVoucherRequest,
  type CreateFinanceCashVoucherRequest,
  type FinanceCashCollectionReference,
  type FinanceCashDailyReport,
  type FinanceCashOperatorReference,
  type FinanceCashPartnerReference,
  type FinanceCashReferenceData,
  type FinanceCashRegisterReference,
  type FinanceCashVoucher,
  type FinanceCashVoucherPage,
} from '@vista/contracts';

const amountPattern = /^\d+(\.\d{1,4})?$/u;

export class CreateFinanceCashVoucherDto implements CreateFinanceCashVoucherRequest {
  @ApiProperty({ example: '125.0000', type: String })
  @IsString()
  @Matches(amountPattern)
  amount!: string;

  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('loose')
  cashRegisterId!: string;

  @ApiPropertyOptional({ maxLength: 255, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  counterpartyName?: string;

  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID('loose')
  counterpartyPartnerId?: string;

  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID('loose')
  customerDocumentId?: string;

  @ApiProperty({ enum: financeCashVoucherDirections })
  @IsIn(financeCashVoucherDirections)
  direction!: CreateFinanceCashVoucherRequest['direction'];

  @ApiPropertyOptional({ maxLength: 2000, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('loose')
  operatorId!: string;

  @ApiPropertyOptional({ maxLength: 255, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  paymentReference?: string;

  @ApiProperty({ maxLength: 500, type: String })
  @IsString()
  @MaxLength(500)
  purpose!: string;

  @ApiProperty({ format: 'date', type: String })
  @IsDateString()
  voucherDate!: string;
}

export class CancelFinanceCashVoucherDto implements CancelFinanceCashVoucherRequest {
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

export class FinanceCashVoucherListQueryDto {
  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID('loose')
  cashRegisterId?: string;

  @ApiPropertyOptional({ format: 'date', type: String })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ format: 'date', type: String })
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @ApiPropertyOptional({ enum: financeCashVoucherDirections })
  @IsOptional()
  @IsIn(financeCashVoucherDirections)
  direction?: FinanceCashVoucher['direction'];

  @ApiPropertyOptional({ default: 1, minimum: 1, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20, maximum: 100, minimum: 1, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;

  @ApiPropertyOptional({ enum: financeCashVoucherStatuses })
  @IsOptional()
  @IsIn(financeCashVoucherStatuses)
  status?: FinanceCashVoucher['status'];
}

export class FinanceCashDailyReportQueryDto {
  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('loose')
  cashRegisterId!: string;

  @ApiProperty({ format: 'date', type: String })
  @IsDateString()
  date!: string;
}

class FinanceCashOperatorReferenceDto implements FinanceCashOperatorReference {
  @ApiProperty({ type: String }) code!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) name!: string;
}

class FinanceCashRegisterReferenceDto implements FinanceCashRegisterReference {
  @ApiProperty({ type: String }) branchName!: string;
  @ApiProperty({ format: 'uuid', type: String }) businessLocationId!: string;
  @ApiProperty({ type: String }) businessLocationName!: string;
  @ApiProperty({ type: String }) code!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ isArray: true, type: FinanceCashOperatorReferenceDto })
  operators!: FinanceCashOperatorReference[];
}

class FinanceCashPartnerReferenceDto implements FinanceCashPartnerReference {
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ enum: ['customer', 'supplier'], isArray: true })
  roles!: Array<'customer' | 'supplier'>;
}

class FinanceCashCollectionReferenceDto implements FinanceCashCollectionReference {
  @ApiProperty({ type: String }) customerName!: string;
  @ApiProperty({ format: 'uuid', type: String }) customerPartnerId!: string;
  @ApiProperty({ format: 'date', type: String }) dueDate!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) number!: string;
  @ApiProperty({ type: String }) outstandingTotal!: string;
  @ApiProperty({ type: String }) sourceInvoiceNumber!: string;
}

export class FinanceCashReferenceDataDto implements FinanceCashReferenceData {
  @ApiProperty({ format: 'date', type: String }) businessDate!: string;
  @ApiProperty({ isArray: true, type: FinanceCashRegisterReferenceDto })
  cashRegisters!: FinanceCashRegisterReference[];
  @ApiProperty({ isArray: true, type: FinanceCashCollectionReferenceDto })
  openCollections!: FinanceCashCollectionReference[];
  @ApiProperty({ isArray: true, type: FinanceCashPartnerReferenceDto })
  partners!: FinanceCashPartnerReference[];
}

export class FinanceCashVoucherDto implements FinanceCashVoucher {
  @ApiProperty({ type: String }) amount!: string;
  @ApiProperty({ type: String }) branchName!: string;
  @ApiProperty({ format: 'uuid', type: String }) businessLocationId!: string;
  @ApiProperty({ type: String }) businessLocationName!: string;
  @ApiPropertyOptional({ format: 'date-time', type: String }) cancelledAt?: string;
  @ApiPropertyOptional({ type: String }) cancellationReason?: string;
  @ApiProperty({ type: String }) cashRegisterCode!: string;
  @ApiProperty({ format: 'uuid', type: String }) cashRegisterId!: string;
  @ApiProperty({ type: String }) cashRegisterName!: string;
  @ApiPropertyOptional({ type: String }) collectionNumber?: string;
  @ApiProperty({ type: String }) counterpartyName!: string;
  @ApiPropertyOptional({ format: 'uuid', type: String }) counterpartyPartnerId?: string;
  @ApiProperty({ format: 'date-time', type: String }) createdAt!: string;
  @ApiProperty({ type: String }) currencyCode!: string;
  @ApiPropertyOptional({ format: 'uuid', type: String }) customerDocumentId?: string;
  @ApiProperty({ enum: financeCashVoucherDirections })
  direction!: FinanceCashVoucher['direction'];
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) issuedByName!: string;
  @ApiPropertyOptional({ type: String }) notes?: string;
  @ApiProperty({ type: String }) number!: string;
  @ApiProperty({ type: String }) operatorCode!: string;
  @ApiProperty({ format: 'uuid', type: String }) operatorId!: string;
  @ApiProperty({ type: String }) operatorName!: string;
  @ApiPropertyOptional({ type: String }) paymentNumber?: string;
  @ApiPropertyOptional({ type: String }) paymentReference?: string;
  @ApiProperty({ type: String }) purpose!: string;
  @ApiProperty({ enum: financeCashVoucherStatuses }) status!: FinanceCashVoucher['status'];
  @ApiProperty({ minimum: 1, type: Number }) version!: number;
  @ApiProperty({ format: 'date', type: String }) voucherDate!: string;
}

export class FinanceCashVoucherPageDto implements FinanceCashVoucherPage {
  @ApiProperty({ isArray: true, type: FinanceCashVoucherDto }) items!: FinanceCashVoucher[];
  @ApiProperty({ type: Number }) page!: number;
  @ApiProperty({ type: Number }) pageSize!: number;
  @ApiProperty({ type: Number }) totalItems!: number;
  @ApiProperty({ type: Number }) totalPages!: number;
}

export class FinanceCashDailyReportDto implements FinanceCashDailyReport {
  @ApiProperty({ type: String }) cashRegisterCode!: string;
  @ApiProperty({ format: 'uuid', type: String }) cashRegisterId!: string;
  @ApiProperty({ type: String }) cashRegisterName!: string;
  @ApiProperty({ type: String }) closingBalance!: string;
  @ApiProperty({ format: 'date-time', type: String }) generatedAt!: string;
  @ApiProperty({ type: String }) openingBalance!: string;
  @ApiProperty({ type: Number }) paymentCount!: number;
  @ApiProperty({ type: String }) paymentTotal!: string;
  @ApiProperty({ type: Number }) receiptCount!: number;
  @ApiProperty({ type: String }) receiptTotal!: string;
  @ApiProperty({ format: 'date', type: String }) reportDate!: string;
  @ApiProperty({ isArray: true, type: FinanceCashVoucherDto }) vouchers!: FinanceCashVoucher[];
}
