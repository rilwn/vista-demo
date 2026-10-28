import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type {
  CreateCrmReferralRequest,
  CrmAfterSalesOverview,
  CrmCustomerSurvey,
  CrmPublicSurvey,
  CrmNpsSummary,
  CrmReferral,
  CrmWarrantyCardReconciliationResult,
  CrmWarrantyCardReconciliationStatus,
  CrmWarrantyCoverageOffer,
  CrmWarrantyCoverageOfferType,
  CreateCrmWarrantyCoverageOfferRequest,
  CrmSurveySourceReference,
  CrmWarrantyCard,
  RecordCrmSurveyResponseRequest,
  SendCrmCustomerSurveyRequest,
  TransitionCrmWarrantyCoverageOfferRequest,
  UpdateCrmWarrantyOfferRequest,
} from '@vista/contracts';
import {
  crmSurveySourceKinds,
  crmWarrantyCoverageOfferStatuses,
  crmWarrantyCoverageOfferTypes,
  crmWarrantyOfferStatuses,
} from '@vista/contracts';
import {
  IsDateString,
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
} from 'class-validator';

import { WarrantyClaimDto } from '../service/service.dto.js';

const uuid = 'loose' as const;
const amountPattern = /^\d{1,12}\.\d{2}$/u;

export class CreateCrmWarrantyCoverageOfferDto implements CreateCrmWarrantyCoverageOfferRequest {
  @ApiProperty({ format: 'date', type: String })
  @IsDateString({ strict: true })
  coverageStartsOn!: string;

  @ApiProperty({ maximum: 120, minimum: 1, type: Number })
  @IsInt()
  @Min(1)
  @Max(120)
  durationMonths!: number;

  @ApiProperty({ enum: crmWarrantyCoverageOfferTypes })
  @IsIn(crmWarrantyCoverageOfferTypes)
  offerType!: CrmWarrantyCoverageOfferType;

  @ApiProperty({ example: '240.00', type: String })
  @IsString()
  @Matches(amountPattern)
  quotedAmount!: string;

  @ApiProperty({ maxLength: 2000, minLength: 10, type: String })
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  terms!: string;

  @ApiProperty({ format: 'date', type: String })
  @IsDateString({ strict: true })
  validUntil!: string;

  @ApiPropertyOptional({ maximum: 120, minimum: 1, type: Number })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  visitFrequencyMonths?: number;
}

export class TransitionCrmWarrantyCoverageOfferDto implements TransitionCrmWarrantyCoverageOfferRequest {
  @ApiProperty({ enum: ['offered', 'accepted', 'declined'] })
  @IsIn(['offered', 'accepted', 'declined'])
  nextStatus!: TransitionCrmWarrantyCoverageOfferRequest['nextStatus'];
}

export class UpdateCrmWarrantyOfferDto implements UpdateCrmWarrantyOfferRequest {
  @ApiProperty({ enum: crmWarrantyOfferStatuses })
  @IsIn(crmWarrantyOfferStatuses)
  offerStatus!: UpdateCrmWarrantyOfferRequest['offerStatus'];
}

export class SendCrmCustomerSurveyDto implements SendCrmCustomerSurveyRequest {
  @ApiProperty({ example: 'customer@example.com', format: 'email', maxLength: 320, type: String })
  @IsEmail()
  @MaxLength(320)
  recipientEmail!: string;

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
  @ApiProperty({ isArray: true, type: String }) recipientEmails!: string[];
  @ApiProperty({ enum: crmSurveySourceKinds }) sourceKind!: CrmSurveySourceReference['sourceKind'];
}

export class CrmCustomerSurveyDto implements CrmCustomerSurvey {
  @ApiPropertyOptional({ type: String }) comment?: string;
  @ApiProperty({ type: String }) customerName!: string;
  @ApiProperty({ format: 'uuid', type: String }) customerPartnerId!: string;
  @ApiPropertyOptional({ enum: ['pending', 'processing', 'delivered', 'failed', 'cancelled'] })
  deliveryStatus?: NonNullable<CrmCustomerSurvey['deliveryStatus']>;
  @ApiPropertyOptional({ format: 'email', type: String }) recipientEmail?: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) number!: string;
  @ApiPropertyOptional({ format: 'date-time', type: String }) respondedAt?: string;
  @ApiPropertyOptional({ maximum: 10, minimum: 0, type: Number }) score?: number;
  @ApiProperty({ format: 'date-time', type: String }) sentAt!: string;
  @ApiProperty({ enum: crmSurveySourceKinds }) sourceKind!: CrmCustomerSurvey['sourceKind'];
  @ApiProperty({ type: String }) sourceLabel!: string;
  @ApiProperty({ enum: ['awaiting_response', 'responded'] }) status!: CrmCustomerSurvey['status'];
}

export class CrmPublicSurveyDto implements CrmPublicSurvey {
  @ApiProperty({ format: 'date-time', type: String }) expiresAt!: string;
  @ApiProperty({ type: String }) number!: string;
  @ApiPropertyOptional({ maximum: 10, minimum: 0, type: Number }) score?: number;
  @ApiProperty({ enum: crmSurveySourceKinds }) sourceKind!: CrmPublicSurvey['sourceKind'];
  @ApiProperty({ enum: ['awaiting_response', 'responded', 'expired'] })
  status!: CrmPublicSurvey['status'];
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

class CrmWarrantyCardReconciliationStatusDto implements CrmWarrantyCardReconciliationStatus {
  @ApiProperty({ type: Number }) eligibleSoldSerials!: number;
  @ApiProperty({ type: Number }) missingCards!: number;
  @ApiProperty({ type: Number }) registeredSoldSerials!: number;
}

export class CrmWarrantyCardReconciliationResultDto implements CrmWarrantyCardReconciliationResult {
  @ApiProperty({ type: Number }) cardsCreated!: number;
}

export class CrmWarrantyCoverageOfferDto implements CrmWarrantyCoverageOffer {
  @ApiProperty({ format: 'date', type: String }) coverageStartsOn!: string;
  @ApiProperty({ type: String }) customerName!: string;
  @ApiProperty({ format: 'uuid', type: String }) customerPartnerId!: string;
  @ApiProperty({ format: 'date-time', type: String }) createdAt!: string;
  @ApiProperty({ enum: ['EUR'] }) currencyCode!: 'EUR';
  @ApiProperty({ type: String }) deviceName!: string;
  @ApiProperty({ maximum: 120, minimum: 1, type: Number }) durationMonths!: number;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) number!: string;
  @ApiProperty({ enum: crmWarrantyCoverageOfferTypes })
  offerType!: CrmWarrantyCoverageOffer['offerType'];
  @ApiProperty({ type: String }) quotedAmount!: string;
  @ApiProperty({ type: String }) serialNumber!: string;
  @ApiProperty({ enum: crmWarrantyCoverageOfferStatuses })
  status!: CrmWarrantyCoverageOffer['status'];
  @ApiProperty({ type: String }) terms!: string;
  @ApiProperty({ format: 'date', type: String }) validUntil!: string;
  @ApiPropertyOptional({ maximum: 120, minimum: 1, type: Number })
  visitFrequencyMonths?: number;
  @ApiProperty({ format: 'uuid', type: String }) warrantyCardId!: string;
  @ApiProperty({ format: 'date', type: String }) warrantyEndsOn!: string;
}

export class CrmAfterSalesOverviewDto implements CrmAfterSalesOverview {
  @ApiProperty({ isArray: true, type: CrmAfterSalesAssigneeDto })
  assignees!: CrmAfterSalesOverview['assignees'];
  @ApiProperty({ type: String }) businessTimezone!: string;
  @ApiProperty({ isArray: true, type: WarrantyClaimDto }) claims!: CrmAfterSalesOverview['claims'];
  @ApiProperty({ isArray: true, type: CrmWarrantyCoverageOfferDto })
  coverageOffers!: CrmAfterSalesOverview['coverageOffers'];
  @ApiProperty({ isArray: true, type: CrmAfterSalesCustomerDto })
  customers!: CrmAfterSalesOverview['customers'];
  @ApiProperty({ type: CrmNpsSummaryDto }) nps!: CrmNpsSummary;
  @ApiProperty({ isArray: true, type: CrmReferralDto }) referrals!: CrmReferral[];
  @ApiProperty({ isArray: true, type: CrmSurveySourceReferenceDto })
  surveySources!: CrmSurveySourceReference[];
  @ApiProperty({ isArray: true, type: CrmCustomerSurveyDto }) surveys!: CrmCustomerSurvey[];
  @ApiProperty({ type: CrmWarrantyCardReconciliationStatusDto })
  warrantyCardReconciliation!: CrmWarrantyCardReconciliationStatus;
  @ApiProperty({ isArray: true, type: CrmWarrantyCardDto }) warrantyCards!: CrmWarrantyCard[];
}

export { CrmWarrantyCardDto };
