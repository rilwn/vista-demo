import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
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
  ValidateNested,
} from 'class-validator';
import {
  financeBankTransactionDirections,
  type CreateFinanceBankStatementLineRequest,
  type CreateFinanceBankStatementRequest,
  type FinanceBankMatchCandidate,
  type FinanceBankStatement,
  type FinanceBankStatementPage,
  type FinanceBankStatementSummary,
  type FinanceBankTransaction,
  type MatchFinanceBankTransactionRequest,
} from '@vista/contracts';

const amount = /^\d+(\.\d{1,4})?$/u;
const balance = /^-?\d+(\.\d{1,4})?$/u;
const currency = /^[A-Za-z]{3}$/u;

export class CreateFinanceBankStatementLineDto implements CreateFinanceBankStatementLineRequest {
  @ApiProperty({ example: '100.0000', type: String })
  @IsString()
  @Matches(amount)
  amount!: string;

  @ApiPropertyOptional({ maxLength: 34, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(34)
  counterpartyIban?: string;

  @ApiProperty({ maxLength: 255, type: String })
  @IsString()
  @MaxLength(255)
  counterpartyName!: string;

  @ApiProperty({ enum: financeBankTransactionDirections })
  @IsIn(financeBankTransactionDirections)
  direction!: CreateFinanceBankStatementLineRequest['direction'];

  @ApiProperty({ maxLength: 500, type: String })
  @IsString()
  @MaxLength(500)
  paymentReference!: string;

  @ApiProperty({ format: 'date', type: String })
  @IsDateString()
  transactionDate!: string;

  @ApiProperty({ format: 'date', type: String })
  @IsDateString()
  valueDate!: string;
}

export class CreateFinanceBankStatementDto implements CreateFinanceBankStatementRequest {
  @ApiProperty({ maxLength: 34, type: String })
  @IsString()
  @MaxLength(34)
  accountIban!: string;

  @ApiProperty({ maxLength: 160, type: String })
  @IsString()
  @MaxLength(160)
  bankName!: string;

  @ApiProperty({ example: '140.0000', type: String })
  @IsString()
  @Matches(balance)
  closingBalance!: string;

  @ApiProperty({ example: 'BGN', type: String })
  @IsString()
  @Matches(currency)
  currencyCode!: string;

  @ApiProperty({ isArray: true, type: CreateFinanceBankStatementLineDto })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => CreateFinanceBankStatementLineDto)
  lines!: CreateFinanceBankStatementLineDto[];

  @ApiProperty({ example: '100.0000', type: String })
  @IsString()
  @Matches(balance)
  openingBalance!: string;

  @ApiProperty({ format: 'date', type: String })
  @IsDateString()
  statementDate!: string;

  @ApiProperty({ maxLength: 120, type: String })
  @IsString()
  @MaxLength(120)
  statementReference!: string;
}

export class MatchFinanceBankTransactionDto implements MatchFinanceBankTransactionRequest {
  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('loose')
  customerDocumentId!: string;

  @ApiProperty({ minimum: 1, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class FinanceBankStatementListQueryDto {
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

  @ApiPropertyOptional({ enum: ['open', 'reconciled'] })
  @IsOptional()
  @IsIn(['open', 'reconciled'])
  status?: FinanceBankStatementSummary['status'];
}

class FinanceBankTransactionMatchDto {
  @ApiProperty({ format: 'uuid', type: String }) customerDocumentId!: string;
  @ApiProperty({ type: String }) customerName!: string;
  @ApiProperty({ type: String }) documentNumber!: string;
  @ApiProperty({ format: 'date-time', type: String }) matchedAt!: string;
  @ApiProperty({ enum: ['automatic_reference', 'manual'] })
  method!: NonNullable<FinanceBankTransaction['match']>['method'];
  @ApiProperty({ type: String }) paymentNumber!: string;
}

class FinanceSupplierBankTransactionMatchDto {
  @ApiProperty({ enum: ['advance', 'payment'] }) kind!: 'advance' | 'payment';
  @ApiProperty({ format: 'date-time', type: String }) matchedAt!: string;
  @ApiProperty({ enum: ['automatic_reference', 'manual'] })
  method!: 'automatic_reference' | 'manual';
  @ApiProperty({ type: String }) paymentNumber!: string;
  @ApiProperty({ type: String }) supplierName!: string;
  @ApiProperty({ format: 'uuid', type: String }) supplierPartnerId!: string;
  @ApiPropertyOptional({ format: 'uuid', type: String }) supplierPayableId?: string;
  @ApiPropertyOptional({ type: String }) supplierPayableNumber?: string;
}

class FinanceBankTransactionDto implements FinanceBankTransaction {
  @ApiProperty({ type: String }) amount!: string;
  @ApiPropertyOptional({ type: String }) counterpartyIban?: string;
  @ApiProperty({ type: String }) counterpartyName!: string;
  @ApiProperty({ enum: financeBankTransactionDirections })
  direction!: FinanceBankTransaction['direction'];
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: Number }) lineNumber!: number;
  @ApiPropertyOptional({ type: FinanceBankTransactionMatchDto })
  match?: NonNullable<FinanceBankTransaction['match']>;
  @ApiProperty({ enum: ['matched', 'unmatched'] })
  matchStatus!: FinanceBankTransaction['matchStatus'];
  @ApiProperty({ type: String }) paymentReference!: string;
  @ApiProperty({ format: 'date', type: String }) transactionDate!: string;
  @ApiPropertyOptional({ type: FinanceSupplierBankTransactionMatchDto })
  supplierMatch?: NonNullable<FinanceBankTransaction['supplierMatch']>;
  @ApiProperty({ format: 'date', type: String }) valueDate!: string;
  @ApiProperty({ minimum: 1, type: Number }) version!: number;
}

export class FinanceBankStatementSummaryDto implements FinanceBankStatementSummary {
  @ApiProperty({ type: String }) accountIban!: string;
  @ApiProperty({ type: String }) bankName!: string;
  @ApiProperty({ type: String }) closingBalance!: string;
  @ApiProperty({ format: 'date-time', type: String }) createdAt!: string;
  @ApiProperty({ type: String }) currencyCode!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) incomingTotal!: string;
  @ApiProperty({ type: Number }) matchedIncomingCount!: number;
  @ApiProperty({ type: Number }) matchedOutgoingCount!: number;
  @ApiProperty({ type: String }) number!: string;
  @ApiProperty({ type: String }) openingBalance!: string;
  @ApiProperty({ type: String }) outgoingTotal!: string;
  @ApiProperty({ format: 'date', type: String }) statementDate!: string;
  @ApiProperty({ type: String }) statementReference!: string;
  @ApiProperty({ enum: ['open', 'reconciled'] }) status!: FinanceBankStatementSummary['status'];
  @ApiProperty({ type: Number }) transactionCount!: number;
  @ApiProperty({ type: Number }) unmatchedIncomingCount!: number;
  @ApiProperty({ type: Number }) unmatchedOutgoingCount!: number;
  @ApiProperty({ minimum: 1, type: Number }) version!: number;
}

export class FinanceBankStatementDto
  extends FinanceBankStatementSummaryDto
  implements FinanceBankStatement
{
  @ApiProperty({ isArray: true, type: FinanceBankTransactionDto })
  transactions!: FinanceBankTransaction[];
}

export class FinanceBankStatementPageDto implements FinanceBankStatementPage {
  @ApiProperty({ isArray: true, type: FinanceBankStatementSummaryDto })
  items!: FinanceBankStatementSummary[];
  @ApiProperty({ type: Number }) page!: number;
  @ApiProperty({ type: Number }) pageSize!: number;
  @ApiProperty({ type: Number }) totalItems!: number;
  @ApiProperty({ type: Number }) totalPages!: number;
}

export class FinanceBankMatchCandidateDto implements FinanceBankMatchCandidate {
  @ApiProperty({ format: 'uuid', type: String }) customerDocumentId!: string;
  @ApiProperty({ type: String }) customerName!: string;
  @ApiProperty({ type: String }) documentNumber!: string;
  @ApiProperty({ format: 'date', type: String }) dueDate!: string;
  @ApiProperty({ type: String }) outstandingTotal!: string;
  @ApiProperty({ type: Boolean }) referenceMatched!: boolean;
  @ApiProperty({ type: Number }) score!: number;
  @ApiProperty({ type: String }) sourceInvoiceNumber!: string;
}
