import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
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
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  partnerKinds,
  partnerRoles,
  type CreatePartnerRequest,
  type PartnerDuplicateCandidate,
  type PartnerDuplicateResponse,
  type PartnerKind,
  type PartnerPage,
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
