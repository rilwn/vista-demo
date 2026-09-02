import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type {
  CreateCrmReferralRequest,
  CrmAfterSalesOverview,
  CrmCustomerSurvey,
  CrmNpsSummary,
  CrmReferral,
  CrmSurveySourceReference,
  CrmWarrantyCard,
  RecordCrmSurveyResponseRequest,
  SendCrmCustomerSurveyRequest,
  UpdateCrmWarrantyOfferRequest,
} from '@vista/contracts';
import { crmSurveySourceKinds, crmWarrantyOfferStatuses } from '@vista/contracts';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { WarrantyClaimDto } from '../service/service.dto.js';

const uuid = 'loose' as const;

export class UpdateCrmWarrantyOfferDto implements UpdateCrmWarrantyOfferRequest {
  @ApiProperty({ enum: crmWarrantyOfferStatuses })
  @IsIn(crmWarrantyOfferStatuses)
  offerStatus!: UpdateCrmWarrantyOfferRequest['offerStatus'];
}

export class SendCrmCustomerSurveyDto implements SendCrmCustomerSurveyRequest {
  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID(uuid)
  sourceId!: string;

  @ApiProperty({ enum: crmSurveySourceKinds })
  @IsIn(crmSurveySourceKinds)
  sourceKind!: SendCrmCustomerSurveyRequest['sourceKind'];
}

export class RecordCrmSurveyResponseDto implements RecordCrmSurveyResponseRequest {
  @ApiPropertyOptional({ maxLength: 2000, type: String })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  comment?: string;

  @ApiProperty({ maximum: 10, minimum: 0, type: Number })
  @IsInt()
  @Min(0)
  @Max(10)
  score!: number;
}

export class CreateCrmReferralDto implements CreateCrmReferralRequest {
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

  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID(uuid)
  referringCustomerPartnerId!: string;

  @ApiPropertyOptional({ maxLength: 100, type: String })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  telephone?: string;
}

class CrmWarrantyCardDto implements CrmWarrantyCard {
  @ApiProperty({ type: Number }) claimCount!: number;
  @ApiProperty({ format: 'uuid', type: String }) customerEquipmentId!: string;
  @ApiProperty({ format: 'uuid', type: String }) customerLocationId!: string;
  @ApiProperty({ type: String }) customerLocationName!: string;
  @ApiProperty({ type: String }) customerName!: string;
  @ApiProperty({ format: 'uuid', type: String }) customerPartnerId!: string;
  @ApiProperty({ type: String }) deviceName!: string;
  @ApiPropertyOptional({ type: String }) handoverNumber?: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ format: 'date-time', type: String }) issuedAt!: string;
  @ApiProperty({ type: String }) number!: string;
  @ApiProperty({ enum: crmWarrantyOfferStatuses }) offerStatus!: CrmWarrantyCard['offerStatus'];
  @ApiProperty({ type: Number }) remainingDays!: number;
  @ApiProperty({ type: String }) serialNumber!: string;
  @ApiProperty({ enum: ['active', 'expired'] }) status!: CrmWarrantyCard['status'];
  @ApiProperty({ format: 'date', type: String }) warrantyEndsOn!: string;
  @ApiProperty({ format: 'date', type: String }) warrantyStartsOn!: string;
}

class CrmSurveySourceReferenceDto implements CrmSurveySourceReference {
  @ApiProperty({ format: 'uuid', type: String }) customerLocationId!: string;
  @ApiProperty({ type: String }) customerName!: string;
  @ApiProperty({ format: 'uuid', type: String }) customerPartnerId!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) label!: string;
  @ApiProperty({ enum: crmSurveySourceKinds }) sourceKind!: CrmSurveySourceReference['sourceKind'];
}

export class CrmCustomerSurveyDto implements CrmCustomerSurvey {
  @ApiPropertyOptional({ type: String }) comment?: string;
  @ApiProperty({ type: String }) customerName!: string;
  @ApiProperty({ format: 'uuid', type: String }) customerPartnerId!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) number!: string;
  @ApiPropertyOptional({ format: 'date-time', type: String }) respondedAt?: string;
  @ApiPropertyOptional({ maximum: 10, minimum: 0, type: Number }) score?: number;
  @ApiProperty({ format: 'date-time', type: String }) sentAt!: string;
  @ApiProperty({ enum: crmSurveySourceKinds }) sourceKind!: CrmCustomerSurvey['sourceKind'];
  @ApiProperty({ type: String }) sourceLabel!: string;
  @ApiProperty({ enum: ['awaiting_response', 'responded'] }) status!: CrmCustomerSurvey['status'];
}

class CrmNpsTrendPointDto {
  @ApiProperty({ type: String }) label!: string;
  @ApiProperty({ type: Number }) responses!: number;
  @ApiProperty({ maximum: 100, minimum: -100, type: Number }) score!: number;
}

class CrmNpsSummaryDto implements CrmNpsSummary {
  @ApiProperty({ type: Number }) detractors!: number;
  @ApiProperty({ type: Number }) passives!: number;
  @ApiProperty({ type: Number }) promoters!: number;
  @ApiProperty({ type: Number }) responses!: number;
  @ApiPropertyOptional({ maximum: 100, minimum: -100, type: Number }) score?: number;
  @ApiProperty({ isArray: true, type: CrmNpsTrendPointDto }) trend!: CrmNpsSummary['trend'];
}

export class CrmReferralDto implements CrmReferral {
  @ApiProperty({ type: String }) contactName!: string;
  @ApiProperty({ format: 'date-time', type: String }) createdAt!: string;
  @ApiPropertyOptional({ type: String }) email?: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ format: 'uuid', type: String }) leadId!: string;
  @ApiProperty({ type: String }) leadNumber!: string;
  @ApiPropertyOptional({ type: String }) notes?: string;
  @ApiProperty({ type: String }) number!: string;
  @ApiProperty({ type: String }) organizationName!: string;
  @ApiProperty({ type: String }) referringCustomerName!: string;
  @ApiProperty({ format: 'uuid', type: String }) referringCustomerPartnerId!: string;
  @ApiPropertyOptional({ type: String }) telephone?: string;
}

class CrmAfterSalesAssigneeDto {
  @ApiProperty({ type: String }) displayName!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
}

class CrmAfterSalesCustomerDto {
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) name!: string;
}

export class CrmAfterSalesOverviewDto implements CrmAfterSalesOverview {
  @ApiProperty({ isArray: true, type: CrmAfterSalesAssigneeDto })
  assignees!: CrmAfterSalesOverview['assignees'];
  @ApiProperty({ type: String }) businessTimezone!: string;
  @ApiProperty({ isArray: true, type: WarrantyClaimDto }) claims!: CrmAfterSalesOverview['claims'];
  @ApiProperty({ isArray: true, type: CrmAfterSalesCustomerDto })
  customers!: CrmAfterSalesOverview['customers'];
  @ApiProperty({ type: CrmNpsSummaryDto }) nps!: CrmNpsSummary;
  @ApiProperty({ isArray: true, type: CrmReferralDto }) referrals!: CrmReferral[];
  @ApiProperty({ isArray: true, type: CrmSurveySourceReferenceDto })
  surveySources!: CrmSurveySourceReference[];
  @ApiProperty({ isArray: true, type: CrmCustomerSurveyDto }) surveys!: CrmCustomerSurvey[];
  @ApiProperty({ isArray: true, type: CrmWarrantyCardDto }) warrantyCards!: CrmWarrantyCard[];
}

export { CrmWarrantyCardDto };
