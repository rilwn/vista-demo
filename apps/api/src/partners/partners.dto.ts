import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
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
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  partnerKinds,
  partnerAddressTypes,
  partnerRoles,
  type CreatePartnerAddressRequest,
  type CreatePartnerBankAccountRequest,
  type CreatePartnerContactRequest,
  type CreatePartnerRequest,
  type RecordVersionRequest,
  type UpdatePartnerRequest,
  type PartnerAddress,
  type PartnerAddressType,
  type PartnerBankAccount,
  type PartnerContact,
  type PartnerDuplicateCandidate,
  type PartnerDuplicateResponse,
  type PartnerKind,
  type PartnerPage,
  type PartnerProfile,
  type PartnerRole,
  type PartnerSummary,
} from '@vista/contracts';

export class CreatePartnerDto implements CreatePartnerRequest {
  @ApiPropertyOptional({ maxLength: 255, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  companyRepresentative?: string;

  @ApiProperty({ maxLength: 255, minLength: 1, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  displayName!: string;

  @ApiProperty({ enum: partnerKinds })
  @IsIn(partnerKinds)
  kind!: PartnerKind;

  @ApiProperty({ enum: partnerRoles, isArray: true, minItems: 1 })
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(partnerRoles, { each: true })
  roles!: PartnerRole[];

  @ApiPropertyOptional({ maxLength: 50, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  uic?: string;

  @ApiPropertyOptional({ maxLength: 50, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  vatNumber?: string;
}

export class UpdatePartnerDto extends CreatePartnerDto implements UpdatePartnerRequest {
  @ApiProperty({ minimum: 1, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class RecordVersionDto implements RecordVersionRequest {
  @ApiProperty({ minimum: 1, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class PartnerListQueryDto {
  @ApiPropertyOptional({ default: 'asc', enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  direction: 'asc' | 'desc' = 'asc';

  @ApiPropertyOptional({ enum: partnerKinds })
  @IsOptional()
  @IsIn(partnerKinds)
  kind?: PartnerKind;

  @ApiPropertyOptional({ default: 1, minimum: 1, type: Number })
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

  @ApiPropertyOptional({ enum: partnerRoles })
  @IsOptional()
  @IsIn(partnerRoles)
  role?: PartnerRole;

  @ApiPropertyOptional({ maxLength: 255, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;

  @ApiPropertyOptional({ default: 'displayName', enum: ['createdAt', 'displayName', 'updatedAt'] })
  @IsOptional()
  @IsIn(['createdAt', 'displayName', 'updatedAt'])
  sortBy: 'createdAt' | 'displayName' | 'updatedAt' = 'displayName';
}

export class PartnerDuplicateQueryDto {
  @ApiPropertyOptional({ maxLength: 255, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({ maxLength: 50, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  uic?: string;
}

export class PartnerSummaryDto implements PartnerSummary {
  @ApiProperty({ type: Boolean })
  @IsBoolean()
  active!: boolean;

  @ApiPropertyOptional({ type: String })
  companyRepresentative?: string;

  @ApiProperty({ format: 'date-time', type: String })
  createdAt!: string;

  @ApiProperty({ type: String })
  displayName!: string;

  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID()
  id!: string;

  @ApiProperty({ enum: partnerKinds })
  kind!: PartnerKind;

  @ApiProperty({ enum: partnerRoles, isArray: true })
  roles!: PartnerRole[];

  @ApiPropertyOptional({ type: String })
  uic?: string;

  @ApiProperty({ format: 'date-time', type: String })
  updatedAt!: string;

  @ApiPropertyOptional({ type: String })
  vatNumber?: string;

  @ApiProperty({ type: Number })
  version!: number;
}

export class PartnerPageDto implements PartnerPage {
  @ApiProperty({ isArray: true, type: PartnerSummaryDto })
  items!: PartnerSummaryDto[];

  @ApiProperty({ type: Number })
  page!: number;

  @ApiProperty({ type: Number })
  pageSize!: number;

  @ApiProperty({ type: Number })
  total!: number;

  @ApiProperty({ type: Number })
  totalPages!: number;
}

export class PartnerDuplicateCandidateDto implements PartnerDuplicateCandidate {
  @ApiProperty({ type: String })
  displayName!: string;

  @ApiProperty({ format: 'uuid', type: String })
  id!: string;

  @ApiProperty({ enum: partnerKinds })
  kind!: PartnerKind;

  @ApiProperty({ enum: ['name', 'uic'], isArray: true })
  matchedBy!: Array<'name' | 'uic'>;

  @ApiProperty({ enum: partnerRoles, isArray: true })
  roles!: PartnerRole[];

  @ApiPropertyOptional({ type: String })
  uic?: string;
}

export class PartnerDuplicateResponseDto implements PartnerDuplicateResponse {
  @ApiProperty({ isArray: true, type: PartnerDuplicateCandidateDto })
  candidates!: PartnerDuplicateCandidateDto[];
}

export class CreatePartnerAddressDto implements CreatePartnerAddressRequest {
  @ApiProperty({ maxLength: 255, minLength: 1, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  addressLine1!: string;

  @ApiPropertyOptional({ maxLength: 255, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  addressLine2?: string;

  @ApiProperty({ maxLength: 150, minLength: 1, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  city!: string;

  @ApiPropertyOptional({ default: 'BG', maxLength: 2, minLength: 2, type: String })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z]{2}$/u)
  countryCode?: string;

  @ApiPropertyOptional({ maxLength: 30, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  postalCode?: string;

  @ApiProperty({ enum: partnerAddressTypes })
  @IsIn(partnerAddressTypes)
  type!: PartnerAddressType;
}

export class CreatePartnerContactDto implements CreatePartnerContactRequest {
  @ApiPropertyOptional({ maxLength: 100, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  contactRole?: string;

  @ApiProperty({ maxLength: 255, minLength: 1, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  displayName!: string;

  @ApiPropertyOptional({ maxLength: 320, type: String })
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  email?: string;

  @ApiPropertyOptional({ maxLength: 150, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  jobTitle?: string;

  @ApiPropertyOptional({ maxLength: 100, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  telephone?: string;
}

export class CreatePartnerBankAccountDto implements CreatePartnerBankAccountRequest {
  @ApiPropertyOptional({ maxLength: 255, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  bankName?: string;

  @ApiPropertyOptional({ maxLength: 20, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  bic?: string;

  @ApiPropertyOptional({ default: 'BGN', maxLength: 3, minLength: 3, type: String })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z]{3}$/u)
  currencyCode?: string;

  @ApiProperty({ maxLength: 34, minLength: 15, type: String })
  @IsString()
  @MinLength(15)
  @MaxLength(34)
  iban!: string;
}

export class PartnerAddressDto implements PartnerAddress {
  @ApiProperty({ type: Boolean })
  active!: boolean;

  @ApiProperty({ type: String })
  addressLine1!: string;

  @ApiPropertyOptional({ type: String })
  addressLine2?: string;

  @ApiProperty({ type: String })
  city!: string;

  @ApiProperty({ type: String })
  countryCode!: string;

  @ApiProperty({ format: 'uuid', type: String })
  id!: string;

  @ApiPropertyOptional({ type: String })
  postalCode?: string;

  @ApiProperty({ enum: partnerAddressTypes })
  type!: PartnerAddressType;
}

export class PartnerContactDto implements PartnerContact {
  @ApiProperty({ type: Boolean })
  active!: boolean;

  @ApiPropertyOptional({ type: String })
  contactRole?: string;

  @ApiProperty({ type: String })
  displayName!: string;

  @ApiPropertyOptional({ type: String })
  email?: string;

  @ApiProperty({ format: 'uuid', type: String })
  id!: string;

  @ApiPropertyOptional({ type: String })
  jobTitle?: string;

  @ApiPropertyOptional({ type: String })
  telephone?: string;
}

export class PartnerBankAccountDto implements PartnerBankAccount {
  @ApiProperty({ type: Boolean })
  active!: boolean;

  @ApiPropertyOptional({ type: String })
  bankName?: string;

  @ApiPropertyOptional({ type: String })
  bic?: string;

  @ApiProperty({ type: String })
  currencyCode!: string;

  @ApiProperty({ type: String })
  iban!: string;

  @ApiProperty({ format: 'uuid', type: String })
  id!: string;
}

export class PartnerProfileDto implements PartnerProfile {
  @ApiProperty({ isArray: true, type: PartnerAddressDto })
  addresses!: PartnerAddressDto[];

  @ApiProperty({ isArray: true, type: PartnerBankAccountDto })
  bankAccounts!: PartnerBankAccountDto[];

  @ApiProperty({ isArray: true, type: PartnerContactDto })
  contacts!: PartnerContactDto[];

  @ApiProperty({ type: PartnerSummaryDto })
  partner!: PartnerSummaryDto;
}
