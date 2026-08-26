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
  financialDocumentStatuses,
  financialDocumentTypes,
  vatTreatments,
  type CancelFinancialDocumentRequest,
  type CreateFinancialDocumentLineRequest,
  type CreateFinancialDocumentRequest,
  type FinancialDocument,
  type FinancialDocumentPage,
  type FinancialDocumentReferenceData,
  type FinancialDocumentStatus,
  type FinancialDocumentType,
  type VatTreatment,
} from '@vista/contracts';

const decimal4 = /^\d+(\.\d{1,4})?$/u;
const decimal8 = /^\d+(\.\d{1,8})?$/u;
const currency = /^[A-Za-z]{3}$/u;
// PostgreSQL accepts the complete 8-4-4-4-12 UUID representation. References
// can therefore include stable deterministic identifiers as well as UUID v4s.
const postgresUuid = 'loose' as const;

export class CreateFinancialDocumentLineDto implements CreateFinancialDocumentLineRequest {
  @ApiProperty({ maxLength: 500, type: String })
  @IsString()
  @MaxLength(500)
  description!: string;

  @ApiProperty({ example: '0.0000', type: String })
  @IsString()
  @Matches(decimal4)
  discountPercent!: string;

  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID(postgresUuid)
  productId?: string;

  @ApiProperty({ example: '1.0000', type: String })
  @IsString()
  @Matches(decimal4)
  quantity!: string;

  @ApiProperty({ example: 'PCS', maxLength: 30, type: String })
  @IsString()
  @MaxLength(30)
  unitCode!: string;

  @ApiProperty({ example: '100.0000', type: String })
  @IsString()
  @Matches(decimal4)
  unitPrice!: string;

  @ApiPropertyOptional({ example: '20.0000', type: String })
  @IsOptional()
  @IsString()
  @Matches(decimal4)
  vatRate?: string;

  @ApiProperty({ enum: vatTreatments })
  @IsIn(vatTreatments)
  vatTreatment!: VatTreatment;
}

export class CreateFinancialDocumentDto implements CreateFinancialDocumentRequest {
  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID(postgresUuid)
  businessLocationId!: string;

  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID(postgresUuid)
  cashRegisterId?: string;

  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID(postgresUuid)
  correctionOfDocumentId?: string;

  @ApiPropertyOptional({ maxLength: 1000, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  correctionReason?: string;

  @ApiProperty({ example: 'BGN', type: String })
  @IsString()
  @Matches(currency)
  currencyCode!: string;

  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID(postgresUuid)
  customerPartnerId!: string;

  @ApiProperty({ enum: financialDocumentTypes })
  @IsIn(financialDocumentTypes)
  documentType!: FinancialDocumentType;

  @ApiPropertyOptional({ format: 'date', type: String })
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiProperty({ example: '1.00000000', type: String })
  @IsString()
  @Matches(decimal8)
  exchangeRate!: string;

  @ApiProperty({ format: 'date', type: String })
  @IsDateString()
  issueDate!: string;

  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID(postgresUuid)
  legalEntityId!: string;

  @ApiPropertyOptional({ isArray: true, type: CreateFinancialDocumentLineDto })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreateFinancialDocumentLineDto)
  lines?: CreateFinancialDocumentLineDto[];

  @ApiPropertyOptional({ maxLength: 2000, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID(postgresUuid)
  operatorId?: string;

  @ApiProperty({ format: 'date', type: String })
  @IsDateString()
  rateDate!: string;

  @ApiProperty({ maxLength: 120, type: String })
  @IsString()
  @MaxLength(120)
  rateSource!: string;

  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID(postgresUuid)
  sourceSalesInvoiceId?: string;

  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID(postgresUuid)
  sourceServiceWorkOrderId?: string;

  @ApiProperty({ format: 'date', type: String })
  @IsDateString()
  taxEventDate!: string;
}

export class CancelFinancialDocumentDto implements CancelFinancialDocumentRequest {
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

export class FinancialDocumentListQueryDto {
  @ApiPropertyOptional({ enum: financialDocumentStatuses })
  @IsOptional()
  @IsIn(financialDocumentStatuses)
  status?: FinancialDocumentStatus;

  @ApiPropertyOptional({ enum: financialDocumentTypes })
  @IsOptional()
  @IsIn(financialDocumentTypes)
  type?: FinancialDocumentType;

  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID(postgresUuid)
  customerPartnerId?: string;

  @ApiPropertyOptional({ format: 'date', type: String })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ format: 'date', type: String })
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @ApiPropertyOptional({ default: 1, maximum: 100, minimum: 1, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 25, maximum: 100, minimum: 1, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 25;
}

class FinancialDocumentPartySnapshotDto {
  @ApiProperty({ type: String }) address!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiPropertyOptional({ type: String }) uic?: string;
  @ApiPropertyOptional({ type: String }) vatNumber?: string;
}

class FinancialDocumentCorrectionReferenceDto {
  @ApiProperty({ type: String }) currencyCode!: string;
  @ApiProperty({ type: String }) customerName!: string;
  @ApiProperty({ format: 'uuid', type: String }) customerPartnerId!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) number!: string;
  @ApiProperty({ enum: ['invoice'] }) type!: 'invoice';
}

class FinancialDocumentLineDto {
  @ApiProperty({ type: String }) description!: string;
  @ApiProperty({ type: String }) discountPercent!: string;
  @ApiProperty({ type: String }) grossTotal!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: Number }) lineNumber!: number;
  @ApiProperty({ type: String }) netTotal!: string;
  @ApiPropertyOptional({ format: 'uuid', type: String }) productId?: string;
  @ApiProperty({ type: String }) quantity!: string;
  @ApiProperty({ type: String }) unitCode!: string;
  @ApiProperty({ type: String }) unitPrice!: string;
  @ApiProperty({ type: String }) vatAmount!: string;
  @ApiProperty({ type: String }) vatRate!: string;
  @ApiProperty({ enum: vatTreatments }) vatTreatment!: VatTreatment;
}

class FinancialDocumentVatSummaryDto {
  @ApiProperty({ type: String }) netTotal!: string;
  @ApiProperty({ type: String }) vatAmount!: string;
  @ApiProperty({ type: String }) vatRate!: string;
  @ApiProperty({ enum: vatTreatments }) vatTreatment!: VatTreatment;
}

export class FinancialDocumentDto implements FinancialDocument {
  @ApiProperty({ type: String }) bgnGrossTotal!: string;
  @ApiProperty({ type: String }) bgnNetTotal!: string;
  @ApiProperty({ type: String }) bgnVatTotal!: string;
  @ApiProperty({ type: String }) branchName!: string;
  @ApiProperty({ format: 'uuid', type: String }) businessLocationId!: string;
  @ApiProperty({ type: String }) businessLocationName!: string;
  @ApiPropertyOptional({ type: String }) cancellationReason?: string;
  @ApiPropertyOptional({ type: String }) cashRegisterName?: string;
  @ApiPropertyOptional({ type: FinancialDocumentCorrectionReferenceDto })
  correctionOf?: NonNullable<FinancialDocument['correctionOf']>;
  @ApiPropertyOptional({ type: String }) correctionReason?: string;
  @ApiProperty({ format: 'date-time', type: String }) createdAt!: string;
  @ApiProperty({ type: String }) currencyCode!: string;
  @ApiProperty({ format: 'uuid', type: String }) customerPartnerId!: string;
  @ApiProperty({ type: FinancialDocumentPartySnapshotDto })
  customerSnapshot!: FinancialDocument['customerSnapshot'];
  @ApiProperty({ enum: financialDocumentTypes }) documentType!: FinancialDocumentType;
  @ApiPropertyOptional({ format: 'date', type: String }) dueDate?: string;
  @ApiProperty({ type: String }) exchangeRate!: string;
  @ApiProperty({ type: String }) grossTotal!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ format: 'date', type: String }) issueDate!: string;
  @ApiProperty({ type: FinancialDocumentPartySnapshotDto })
  issuerSnapshot!: FinancialDocument['issuerSnapshot'];
  @ApiProperty({ format: 'uuid', type: String }) legalEntityId!: string;
  @ApiProperty({ isArray: true, type: FinancialDocumentLineDto })
  lines!: FinancialDocument['lines'];
  @ApiProperty({ type: String }) netTotal!: string;
  @ApiPropertyOptional({ type: String }) notes?: string;
  @ApiProperty({ type: String }) number!: string;
  @ApiPropertyOptional({ type: String }) officialNumber?: string;
  @ApiPropertyOptional({ type: String }) operatorName?: string;
  @ApiProperty({ format: 'date', type: String }) rateDate!: string;
  @ApiProperty({ type: String }) rateSource!: string;
  @ApiPropertyOptional({ format: 'uuid', type: String }) sourceSalesInvoiceId?: string;
  @ApiPropertyOptional({ type: String }) sourceSalesInvoiceNumber?: string;
  @ApiPropertyOptional({ format: 'uuid', type: String }) sourceServiceWorkOrderId?: string;
  @ApiPropertyOptional({ type: String }) sourceServiceWorkOrderNumber?: string;
  @ApiProperty({ enum: financialDocumentStatuses }) status!: FinancialDocumentStatus;
  @ApiProperty({ format: 'date', type: String }) taxEventDate!: string;
  @ApiProperty({ isArray: true, type: FinancialDocumentVatSummaryDto })
  vatSummary!: FinancialDocument['vatSummary'];
  @ApiProperty({ type: String }) vatTotal!: string;
  @ApiProperty({ minimum: 1, type: Number }) version!: number;
}

export class FinancialDocumentPageDto implements FinancialDocumentPage {
  @ApiProperty({ isArray: true, type: FinancialDocumentDto }) items!: FinancialDocument[];
  @ApiProperty({ type: Number }) page!: number;
  @ApiProperty({ type: Number }) pageSize!: number;
  @ApiProperty({ type: Number }) totalItems!: number;
  @ApiProperty({ type: Number }) totalPages!: number;
}

class FinancialDocumentNamedReferenceDto {
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) name!: string;
}

class FinancialDocumentScopeReferenceDto {
  @ApiProperty({ format: 'uuid', type: String }) branchId!: string;
  @ApiProperty({ type: String }) branchName!: string;
  @ApiProperty({ isArray: true, type: FinancialDocumentNamedReferenceDto })
  cashRegisters!: FinancialDocumentReferenceData['scopes'][number]['cashRegisters'];
  @ApiProperty({ format: 'uuid', type: String }) legalEntityId!: string;
  @ApiProperty({ type: String }) legalEntityName!: string;
  @ApiProperty({ format: 'uuid', type: String }) locationId!: string;
  @ApiProperty({ type: String }) locationName!: string;
  @ApiProperty({ isArray: true, type: FinancialDocumentNamedReferenceDto })
  operators!: FinancialDocumentReferenceData['scopes'][number]['operators'];
}

class FinancialDocumentCustomerReferenceDto {
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiPropertyOptional({ type: String }) uic?: string;
  @ApiPropertyOptional({ type: String }) vatNumber?: string;
}

class FinancialDocumentProductReferenceDto {
  @ApiProperty({ type: String }) code!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: String }) unitCode!: string;
  @ApiProperty({ type: String }) unitName!: string;
}

class FinancialDocumentSalesDraftLineReferenceDto {
  @ApiProperty({ type: String }) description!: string;
  @ApiProperty({ type: String }) discountPercent!: string;
  @ApiProperty({ format: 'uuid', type: String }) productId!: string;
  @ApiProperty({ type: String }) quantity!: string;
  @ApiProperty({ type: String }) unitCode!: string;
  @ApiProperty({ type: String }) unitPrice!: string;
  @ApiProperty({ enum: vatTreatments }) vatTreatment!: VatTreatment;
}

class FinancialDocumentSalesDraftReferenceDto {
  @ApiProperty({ type: String }) currencyCode!: string;
  @ApiProperty({ type: String }) customerName!: string;
  @ApiProperty({ format: 'uuid', type: String }) customerPartnerId!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ enum: financialDocumentTypes, isArray: true })
  linkedDocumentTypes!: FinancialDocumentType[];
  @ApiProperty({ isArray: true, type: FinancialDocumentSalesDraftLineReferenceDto })
  lines!: FinancialDocumentReferenceData['salesDrafts'][number]['lines'];
  @ApiProperty({ type: String }) number!: string;
  @ApiProperty({ type: String }) total!: string;
}

class FinancialDocumentServiceDraftLineReferenceDto {
  @ApiProperty({ type: String }) description!: string;
  @ApiProperty({ type: String }) discountPercent!: string;
  @ApiPropertyOptional({ format: 'uuid', type: String }) productId?: string;
  @ApiProperty({ type: String }) quantity!: string;
  @ApiProperty({ type: String }) unitCode!: string;
  @ApiProperty({ type: String }) unitPrice!: string;
  @ApiProperty({ enum: vatTreatments }) vatTreatment!: VatTreatment;
}

class FinancialDocumentServiceDraftReferenceDto {
  @ApiProperty({ enum: ['BGN'] }) currencyCode!: 'BGN';
  @ApiProperty({ type: String }) customerName!: string;
  @ApiProperty({ format: 'uuid', type: String }) customerPartnerId!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ enum: financialDocumentTypes, isArray: true })
  linkedDocumentTypes!: FinancialDocumentType[];
  @ApiProperty({ isArray: true, type: FinancialDocumentServiceDraftLineReferenceDto })
  lines!: FinancialDocumentReferenceData['serviceDrafts'][number]['lines'];
  @ApiProperty({ type: String }) number!: string;
  @ApiProperty({ type: String }) total!: string;
}

export class FinancialDocumentReferenceDataDto implements FinancialDocumentReferenceData {
  @ApiProperty({ example: 'Europe/Sofia', type: String }) businessTimezone!: string;
  @ApiProperty({ isArray: true, type: FinancialDocumentCorrectionReferenceDto })
  correctionDocuments!: FinancialDocumentReferenceData['correctionDocuments'];
  @ApiProperty({ isArray: true, type: FinancialDocumentCustomerReferenceDto })
  customers!: FinancialDocumentReferenceData['customers'];
  @ApiProperty({ isArray: true, type: FinancialDocumentProductReferenceDto })
  products!: FinancialDocumentReferenceData['products'];
  @ApiProperty({ isArray: true, type: FinancialDocumentSalesDraftReferenceDto })
  salesDrafts!: FinancialDocumentReferenceData['salesDrafts'];
  @ApiProperty({ isArray: true, type: FinancialDocumentServiceDraftReferenceDto })
  serviceDrafts!: FinancialDocumentReferenceData['serviceDrafts'];
  @ApiProperty({ isArray: true, type: FinancialDocumentScopeReferenceDto })
  scopes!: FinancialDocumentReferenceData['scopes'];
}
