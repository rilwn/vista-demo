import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type {
  ConvertCrmLeadRequest,
  CreateCrmLeadRequest,
  CreateCrmOpportunityRequest,
  CrmLead,
  CrmLeadPage,
  CrmLeadSource,
  CrmLeadStatus,
  CrmOpportunity,
  CrmOpportunityPage,
  CrmOpportunityStage,
  CrmPipelineReferenceData,
  LinkCrmOpportunityQuotationRequest,
  MoveCrmOpportunityRequest,
  PartnerKind,
  QualifyCrmLeadRequest,
} from '@vista/contracts';
import {
  crmLeadSources,
  crmLeadStatuses,
  crmOpportunityStages,
  partnerKinds,
} from '@vista/contracts';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

const uuid = 'loose' as const;
const datePattern = /^\d{4}-\d{2}-\d{2}$/u;
const decimalPattern = /^\d{1,16}(?:\.\d{1,2})?$/u;

export class CreateCrmLeadDto implements CreateCrmLeadRequest {
  @ApiProperty({ maxLength: 255, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  contactName!: string;

  @ApiPropertyOptional({ format: 'email', maxLength: 320, type: String })
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  email?: string;

  @ApiPropertyOptional({ maxLength: 4000, type: String })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  notes?: string;

  @ApiProperty({ maxLength: 255, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  organizationName!: string;

  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID(uuid)
  ownerAccountId!: string;

  @ApiProperty({ enum: crmLeadSources })
  @IsIn(crmLeadSources)
  source!: CrmLeadSource;

  @ApiPropertyOptional({ maxLength: 500, type: String })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  sourceDetails?: string;

  @ApiPropertyOptional({ maxLength: 100, type: String })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  telephone?: string;
}

export class QualifyCrmLeadDto implements QualifyCrmLeadRequest {
  @ApiProperty({ minimum: 1, type: Number })
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiPropertyOptional({ maxLength: 2000, type: String })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  note?: string;
}

class CrmNewCustomerInputDto {
  @ApiProperty({ maxLength: 255, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  displayName!: string;

  @ApiProperty({ enum: partnerKinds })
  @IsIn(partnerKinds)
  kind!: PartnerKind;

  @ApiPropertyOptional({ maxLength: 50, type: String })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  uic?: string;

  @ApiPropertyOptional({ maxLength: 50, type: String })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  vatNumber?: string;
}

class CrmOpportunityInputDto {
  @ApiPropertyOptional({ maxLength: 4000, type: String })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  description?: string;

  @ApiProperty({ example: '1500.00', pattern: decimalPattern.source, type: String })
  @Matches(decimalPattern)
  estimatedRevenueBgn!: string;

  @ApiPropertyOptional({ example: '2026-10-31', pattern: datePattern.source, type: String })
  @IsOptional()
  @Matches(datePattern)
  expectedCloseOn?: string;

  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID(uuid)
  ownerAccountId!: string;

  @ApiProperty({ maximum: 99, minimum: 1, type: Number })
  @IsInt()
  @Min(1)
  @Max(99)
  probabilityPercent!: number;

  @ApiProperty({ maxLength: 255, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title!: string;
}

export class ConvertCrmLeadDto implements ConvertCrmLeadRequest {
  @ApiProperty({ type: Boolean })
  @IsBoolean()
  createOpportunity!: boolean;

  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID(uuid)
  existingCustomerPartnerId?: string;

  @ApiProperty({ minimum: 1, type: Number })
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiPropertyOptional({ type: () => CrmNewCustomerInputDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CrmNewCustomerInputDto)
  newCustomer?: CrmNewCustomerInputDto;

  @ApiPropertyOptional({ maxLength: 2000, type: String })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  note?: string;

  @ApiPropertyOptional({ type: () => CrmOpportunityInputDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CrmOpportunityInputDto)
  opportunity?: CrmOpportunityInputDto;
}

export class CreateCrmOpportunityDto
  extends CrmOpportunityInputDto
  implements CreateCrmOpportunityRequest
{
  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID(uuid)
  customerPartnerId!: string;
}

export class MoveCrmOpportunityDto implements MoveCrmOpportunityRequest {
  @ApiProperty({ minimum: 1, type: Number })
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiPropertyOptional({ maxLength: 2000, type: String })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  note?: string;

  @ApiProperty({ maximum: 100, minimum: 0, type: Number })
  @IsInt()
  @Min(0)
  @Max(100)
  probabilityPercent!: number;

  @ApiProperty({ enum: crmOpportunityStages })
  @IsIn(crmOpportunityStages)
  stage!: CrmOpportunityStage;
}

export class LinkCrmOpportunityQuotationDto implements LinkCrmOpportunityQuotationRequest {
  @ApiProperty({ minimum: 1, type: Number })
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID(uuid)
  quotationId!: string;
}

export class ListCrmLeadsQueryDto {
  @ApiPropertyOptional({ minimum: 1, type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ maximum: 100, minimum: 1, type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @ApiPropertyOptional({ maxLength: 255, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;

  @ApiPropertyOptional({ enum: crmLeadSources })
  @IsOptional()
  @IsIn(crmLeadSources)
  source?: CrmLeadSource;

  @ApiPropertyOptional({ enum: crmLeadStatuses })
  @IsOptional()
  @IsIn(crmLeadStatuses)
  status?: CrmLeadStatus;
}

export class ListCrmOpportunitiesQueryDto {
  @ApiPropertyOptional({ minimum: 1, type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ maximum: 200, minimum: 1, type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;

  @ApiPropertyOptional({ maxLength: 255, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;

  @ApiPropertyOptional({ enum: crmOpportunityStages })
  @IsOptional()
  @IsIn(crmOpportunityStages)
  stage?: CrmOpportunityStage;
}

class CrmLeadHistoryEntryDto {
  @ApiProperty({ format: 'date-time', type: String }) changedAt!: string;
  @ApiProperty({ type: String }) changedByName!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiPropertyOptional({ type: String }) note?: string;
  @ApiProperty({ enum: crmLeadStatuses }) status!: CrmLeadStatus;
  @ApiProperty({ enum: ['created', 'qualified', 'converted'] })
  type!: 'created' | 'qualified' | 'converted';
}

class CrmPersonReferenceDto {
  @ApiProperty({ type: String }) displayName!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
}

class CrmCustomerReferenceDto {
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) name!: string;
}

export class CrmLeadDto implements CrmLead {
  @ApiProperty({ type: String }) contactName!: string;
  @ApiPropertyOptional({ format: 'date-time', type: String }) convertedAt?: string;
  @ApiPropertyOptional({ type: () => CrmCustomerReferenceDto })
  convertedCustomer?: NonNullable<CrmLead['convertedCustomer']>;
  @ApiProperty({ format: 'date-time', type: String }) createdAt!: string;
  @ApiPropertyOptional({ type: String }) email?: string;
  @ApiProperty({ isArray: true, type: () => CrmLeadHistoryEntryDto }) history!: CrmLead['history'];
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) number!: string;
  @ApiPropertyOptional({ type: String }) notes?: string;
  @ApiProperty({ type: String }) organizationName!: string;
  @ApiProperty({ type: () => CrmPersonReferenceDto }) owner!: CrmLead['owner'];
  @ApiPropertyOptional({ format: 'date-time', type: String }) qualifiedAt?: string;
  @ApiProperty({ enum: crmLeadSources }) source!: CrmLeadSource;
  @ApiPropertyOptional({ type: String }) sourceDetails?: string;
  @ApiProperty({ enum: crmLeadStatuses }) status!: CrmLeadStatus;
  @ApiPropertyOptional({ type: String }) telephone?: string;
  @ApiProperty({ format: 'date-time', type: String }) updatedAt!: string;
  @ApiProperty({ type: Number }) version!: number;
}

export class CrmLeadPageDto implements CrmLeadPage {
  @ApiProperty({ isArray: true, type: () => CrmLeadDto }) items!: CrmLead[];
  @ApiProperty({ type: Number }) page!: number;
  @ApiProperty({ type: Number }) pageSize!: number;
  @ApiProperty({ type: Object }) summary!: CrmLeadPage['summary'];
  @ApiProperty({ type: Number }) total!: number;
  @ApiProperty({ type: Number }) totalPages!: number;
}

class CrmOpportunityHistoryEntryDto {
  @ApiProperty({ format: 'date-time', type: String }) changedAt!: string;
  @ApiProperty({ type: String }) changedByName!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ enum: crmOpportunityStages }) nextStage!: CrmOpportunityStage;
  @ApiPropertyOptional({ type: String }) note?: string;
  @ApiPropertyOptional({ enum: crmOpportunityStages }) previousStage?: CrmOpportunityStage;
  @ApiProperty({ type: Number }) probabilityPercent!: number;
  @ApiProperty({ enum: ['created', 'stage_changed', 'quotation_linked'] })
  type!: 'created' | 'stage_changed' | 'quotation_linked';
}

class CrmOpportunityQuotationDto {
  @ApiProperty({ type: String }) currencyCode!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ format: 'date-time', type: String }) linkedAt!: string;
  @ApiProperty({ type: String }) number!: string;
  @ApiProperty({ enum: ['draft', 'confirmed', 'shipped', 'invoiced'] })
  status!: 'draft' | 'confirmed' | 'shipped' | 'invoiced';
  @ApiProperty({ type: String }) total!: string;
}

export class CrmOpportunityDto implements CrmOpportunity {
  @ApiPropertyOptional({ format: 'date-time', type: String }) closedAt?: string;
  @ApiProperty({ format: 'date-time', type: String }) createdAt!: string;
  @ApiProperty({ type: () => CrmCustomerReferenceDto }) customer!: CrmOpportunity['customer'];
  @ApiPropertyOptional({ type: String }) description?: string;
  @ApiProperty({ type: String }) estimatedRevenueBgn!: string;
  @ApiPropertyOptional({ format: 'date', type: String }) expectedCloseOn?: string;
  @ApiProperty({ isArray: true, type: () => CrmOpportunityHistoryEntryDto })
  history!: CrmOpportunity['history'];
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) number!: string;
  @ApiProperty({ type: () => CrmPersonReferenceDto }) owner!: CrmOpportunity['owner'];
  @ApiProperty({ type: Number }) probabilityPercent!: number;
  @ApiProperty({ isArray: true, type: () => CrmOpportunityQuotationDto })
  quotations!: CrmOpportunity['quotations'];
  @ApiPropertyOptional({ format: 'uuid', type: String }) sourceLeadId?: string;
  @ApiProperty({ enum: crmOpportunityStages }) stage!: CrmOpportunityStage;
  @ApiProperty({ type: String }) title!: string;
  @ApiProperty({ format: 'date-time', type: String }) updatedAt!: string;
  @ApiProperty({ type: Number }) version!: number;
  @ApiProperty({ type: String }) weightedRevenueBgn!: string;
}

export class CrmOpportunityPageDto implements CrmOpportunityPage {
  @ApiProperty({ isArray: true, type: () => CrmOpportunityDto }) items!: CrmOpportunity[];
  @ApiProperty({ type: Number }) page!: number;
  @ApiProperty({ type: Number }) pageSize!: number;
  @ApiProperty({ type: Object }) summary!: CrmOpportunityPage['summary'];
  @ApiProperty({ type: Number }) total!: number;
  @ApiProperty({ type: Number }) totalPages!: number;
}

class CrmQuotationReferenceDto {
  @ApiProperty({ type: String }) currencyCode!: string;
  @ApiProperty({ format: 'uuid', type: String }) customerPartnerId!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) number!: string;
  @ApiProperty({ enum: ['draft', 'confirmed', 'shipped', 'invoiced'] })
  status!: 'draft' | 'confirmed' | 'shipped' | 'invoiced';
  @ApiProperty({ type: String }) total!: string;
}

export class CrmPipelineReferenceDataDto implements CrmPipelineReferenceData {
  @ApiProperty({ isArray: true, type: () => CrmPersonReferenceDto })
  assignees!: CrmPipelineReferenceData['assignees'];
  @ApiProperty({ type: String }) businessTimezone!: string;
  @ApiProperty({ isArray: true, type: () => CrmCustomerReferenceDto })
  customers!: CrmPipelineReferenceData['customers'];
  @ApiProperty({ isArray: true, type: () => CrmQuotationReferenceDto })
  quotations!: CrmPipelineReferenceData['quotations'];
}

export class ConvertCrmLeadResultDto {
  @ApiProperty({ type: () => CrmCustomerReferenceDto }) customer!: { id: string; name: string };
  @ApiProperty({ type: () => CrmLeadDto }) lead!: CrmLead;
  @ApiPropertyOptional({ type: () => CrmOpportunityDto }) opportunity?: CrmOpportunity;
}
