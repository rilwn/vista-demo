import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type {
  BusinessBranch,
  BusinessLocation,
  BusinessOperator,
  CashRegister,
  CreateBusinessBranchRequest,
  CreateBusinessLocationRequest,
  CreateBusinessOperatorRequest,
  CreateCashRegisterRequest,
  CreateLegalBusinessEntityRequest,
  LegalBusinessEntity,
  OrganizationMember,
  OrganizationTopology,
} from '@vista/contracts';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateLegalBusinessEntityDto implements CreateLegalBusinessEntityRequest {
  @ApiProperty({ maxLength: 30, minLength: 1, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  code!: string;

  @ApiProperty({ maxLength: 255, minLength: 1, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @ApiPropertyOptional({ maxLength: 30, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  uic?: string;

  @ApiPropertyOptional({ maxLength: 30, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  vatNumber?: string;
}

export class CreateBusinessBranchDto implements CreateBusinessBranchRequest {
  @ApiProperty({ maxLength: 30, minLength: 1, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  code!: string;

  @ApiProperty({ maxLength: 255, minLength: 1, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;
}

export class CreateBusinessLocationDto implements CreateBusinessLocationRequest {
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

  @ApiProperty({ maxLength: 30, minLength: 1, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  code!: string;

  @ApiPropertyOptional({ default: 'BG', maxLength: 2, minLength: 2, type: String })
  @IsOptional()
  @Matches(/^[A-Za-z]{2}$/u)
  countryCode?: string;

  @ApiProperty({ description: 'Client-configurable location classification', type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  locationType!: string;

  @ApiProperty({ maxLength: 255, minLength: 1, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @ApiPropertyOptional({ maxLength: 30, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  postalCode?: string;
}

export class CreateBusinessOperatorDto implements CreateBusinessOperatorRequest {
  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('4')
  accountId!: string;

  @ApiProperty({ maxLength: 30, minLength: 1, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  code!: string;
}

export class CreateCashRegisterDto implements CreateCashRegisterRequest {
  @ApiProperty({ maxLength: 30, minLength: 1, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  code!: string;

  @ApiProperty({ maxLength: 120, minLength: 1, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ maxItems: 100, type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  operatorIds?: string[];
}

export class LegalBusinessEntityDto implements LegalBusinessEntity {
  @ApiProperty({ type: Boolean }) active!: boolean;
  @ApiProperty({ type: String }) code!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiPropertyOptional({ type: String }) uic?: string;
  @ApiPropertyOptional({ type: String }) vatNumber?: string;
  @ApiProperty({ type: Number }) version!: number;
}

export class BusinessBranchDto implements BusinessBranch {
  @ApiProperty({ type: Boolean }) active!: boolean;
  @ApiProperty({ type: String }) code!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ format: 'uuid', type: String }) legalEntityId!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: Number }) version!: number;
}

export class BusinessLocationDto implements BusinessLocation {
  @ApiProperty({ type: Boolean }) active!: boolean;
  @ApiProperty({ type: String }) addressLine1!: string;
  @ApiPropertyOptional({ type: String }) addressLine2?: string;
  @ApiProperty({ format: 'uuid', type: String }) branchId!: string;
  @ApiProperty({ type: String }) city!: string;
  @ApiProperty({ type: String }) code!: string;
  @ApiProperty({ type: String }) countryCode!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) locationType!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiPropertyOptional({ type: String }) postalCode?: string;
  @ApiProperty({ type: Number }) version!: number;
}

export class OrganizationMemberDto implements OrganizationMember {
  @ApiProperty({ format: 'uuid', type: String }) accountId!: string;
  @ApiProperty({ type: String }) displayName!: string;
  @ApiProperty({ type: String }) email!: string;
}

export class BusinessOperatorDto extends OrganizationMemberDto implements BusinessOperator {
  @ApiProperty({ type: Boolean }) active!: boolean;
  @ApiProperty({ format: 'uuid', type: String }) businessLocationId!: string;
  @ApiProperty({ type: String }) code!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: Number }) version!: number;
}

export class CashRegisterDto implements CashRegister {
  @ApiProperty({ type: Boolean }) active!: boolean;
  @ApiProperty({ format: 'uuid', type: String }) businessLocationId!: string;
  @ApiProperty({ type: String }) code!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ isArray: true, type: String }) operatorIds!: string[];
  @ApiProperty({ type: Number }) version!: number;
}

export class OrganizationTopologyDto implements OrganizationTopology {
  @ApiProperty({ isArray: true, type: () => BusinessBranchDto }) branches!: BusinessBranch[];
  @ApiProperty({ isArray: true, type: () => CashRegisterDto }) cashRegisters!: CashRegister[];
  @ApiProperty({ isArray: true, type: () => LegalBusinessEntityDto })
  legalEntities!: LegalBusinessEntity[];
  @ApiProperty({ isArray: true, type: () => BusinessLocationDto }) locations!: BusinessLocation[];
  @ApiProperty({ isArray: true, type: () => BusinessOperatorDto }) operators!: BusinessOperator[];
}
