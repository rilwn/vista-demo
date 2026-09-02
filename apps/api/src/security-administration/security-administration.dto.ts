import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { permissionActions, permissionModules } from '@vista/auth';
import type {
  ApiPermission,
  AuditEventPage,
  AuditEventRecord,
  AuditIntegrityResult,
  ChangeAccountStatusRequest,
  CreateSecurityAccountRequest,
  CreateSecurityRoleRequest,
  AccountRecoveryHandoff,
  IssueAccountRecoveryHandoffRequest,
  ReplaceAccountRolesRequest,
  RolePermission,
  SecurityAccount,
  SecurityAccountPage,
  SecurityAccountStatus,
  SecurityRole,
  SecurityRoleBrief,
  SecuritySession,
} from '@vista/contracts';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsISO8601,
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

export class SecurityAccountListQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1, type: Number })
  @IsInt()
  @Min(1)
  @Type(() => Number)
  @IsOptional()
  page = 1;

  @ApiPropertyOptional({ default: 25, maximum: 100, minimum: 1, type: Number })
  @IsInt()
  @Max(100)
  @Min(1)
  @Type(() => Number)
  @IsOptional()
  pageSize = 25;

  @ApiPropertyOptional({ maxLength: 200, type: String })
  @IsString()
  @MaxLength(200)
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ enum: ['active', 'disabled', 'locked'] })
  @IsIn(['active', 'disabled', 'locked'])
  @IsOptional()
  status?: SecurityAccountStatus;
}

export class CreateSecurityAccountDto implements CreateSecurityAccountRequest {
  @ApiProperty({ maxLength: 255, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  displayName!: string;

  @ApiProperty({ format: 'email', maxLength: 320, type: String })
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @ApiProperty({ maxLength: 100, pattern: '^[A-Za-z0-9._-]+$', type: String })
  @Matches(/^[A-Za-z0-9._-]+$/u)
  @MaxLength(100)
  employeeNumber!: string;

  @ApiProperty({ format: 'password', maxLength: 128, type: String, writeOnly: true })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  initialPassword!: string;
}

export class SecurityPermissionDto implements RolePermission {
  @ApiProperty({ enum: permissionActions })
  @IsIn(permissionActions)
  action!: RolePermission['action'];

  @ApiProperty({ enum: permissionModules })
  @IsIn(permissionModules)
  module!: RolePermission['module'];
}

export class CreateSecurityRoleDto implements CreateSecurityRoleRequest {
  @ApiProperty({ maxLength: 100, pattern: '^[a-z][a-z0-9._-]{2,99}$', type: String })
  @Matches(/^[a-z][a-z0-9._-]{2,99}$/u)
  code!: string;

  @ApiPropertyOptional({ maxLength: 2000, type: String })
  @IsString()
  @MaxLength(2000)
  @IsOptional()
  description?: string;

  @ApiProperty({ type: Boolean })
  @IsBoolean()
  isAdministrative!: boolean;

  @ApiProperty({ maxLength: 255, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @ApiProperty({ type: [SecurityPermissionDto] })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SecurityPermissionDto)
  permissions!: RolePermission[];
}

export class ReplaceAccountRolesDto implements ReplaceAccountRolesRequest {
  @ApiProperty({ minimum: 1, type: Number })
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiProperty({ format: 'uuid', type: [String] })
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  roleIds!: string[];
}

export class ChangeAccountStatusDto implements ChangeAccountStatusRequest {
  @ApiProperty({ minimum: 1, type: Number })
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class IssueAccountRecoveryHandoffDto implements IssueAccountRecoveryHandoffRequest {
  @ApiProperty({ minimum: 1, type: Number })
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiProperty({ maxLength: 1000, minLength: 3, type: String })
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason!: string;
}

export class AccountRecoveryHandoffDto implements AccountRecoveryHandoff {
  @ApiProperty({ format: 'email', type: String })
  email!: string;

  @ApiProperty({ format: 'date-time', type: String })
  expiresAt!: string;

  @ApiProperty({
    description: 'One-time recovery code. It is returned only when issued.',
    type: String,
  })
  recoveryCode!: string;
}

export class SecuritySessionListQueryDto {
  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsUUID('loose')
  @IsOptional()
  accountId?: string;
}

export class AuditEventListQueryDto {
  @ApiPropertyOptional({ maxLength: 150, type: String })
  @IsString()
  @MaxLength(150)
  @IsOptional()
  action?: string;

  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsUUID('loose')
  @IsOptional()
  actorAccountId?: string;

  @ApiPropertyOptional({ format: 'date-time', type: String })
  @IsISO8601({ strict: true })
  @IsOptional()
  from?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1, type: Number })
  @IsInt()
  @Min(1)
  @Type(() => Number)
  @IsOptional()
  page = 1;

  @ApiPropertyOptional({ default: 25, maximum: 100, minimum: 1, type: Number })
  @IsInt()
  @Max(100)
  @Min(1)
  @Type(() => Number)
  @IsOptional()
  pageSize = 25;

  @ApiPropertyOptional({ maxLength: 150, type: String })
  @IsString()
  @MaxLength(150)
  @IsOptional()
  targetType?: string;

  @ApiPropertyOptional({ format: 'date-time', type: String })
  @IsISO8601({ strict: true })
  @IsOptional()
  to?: string;
}

export class SecurityRoleBriefDto implements SecurityRoleBrief {
  @ApiProperty({ type: String }) code!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: Boolean }) isAdministrative!: boolean;
  @ApiProperty({ type: String }) name!: string;
}

export class SecurityAccountDto implements SecurityAccount {
  @ApiProperty({ format: 'uuid', type: String }) accountId!: string;
  @ApiProperty({ minimum: 0, type: Number }) activeSessionCount!: number;
  @ApiProperty({ format: 'date-time', type: String }) createdAt!: string;
  @ApiProperty({ type: String }) displayName!: string;
  @ApiProperty({ type: String }) email!: string;
  @ApiProperty({ format: 'uuid', type: String }) employeeId!: string;
  @ApiProperty({ type: String }) employeeNumber!: string;
  @ApiProperty({ type: [SecurityRoleBriefDto] }) roles!: SecurityRoleBrief[];
  @ApiProperty({ enum: ['active', 'disabled', 'locked'] }) status!: SecurityAccountStatus;
  @ApiProperty({ type: Boolean }) twoFactorEnrolled!: boolean;
  @ApiProperty({ format: 'date-time', type: String }) updatedAt!: string;
  @ApiProperty({ minimum: 1, type: Number }) version!: number;
}

export class SecurityAccountPageDto implements SecurityAccountPage {
  @ApiProperty({ type: [SecurityAccountDto] }) items!: SecurityAccount[];
  @ApiProperty({ minimum: 1, type: Number }) page!: number;
  @ApiProperty({ minimum: 1, type: Number }) pageSize!: number;
  @ApiProperty({ minimum: 0, type: Number }) total!: number;
  @ApiProperty({ minimum: 0, type: Number }) totalPages!: number;
}

export class SecurityRoleDto implements SecurityRole {
  @ApiProperty({ type: String }) code!: string;
  @ApiPropertyOptional({ type: String }) description?: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: Boolean }) isAdministrative!: boolean;
  @ApiProperty({ type: Boolean }) isSystemRole!: boolean;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: [SecurityPermissionDto] }) permissions!: ApiPermission[];
  @ApiProperty({ minimum: 1, type: Number }) version!: number;
}

export class SecuritySessionDto implements SecuritySession {
  @ApiProperty({ format: 'uuid', type: String }) accountId!: string;
  @ApiProperty({ format: 'date-time', type: String }) createdAt!: string;
  @ApiProperty({ type: String }) displayName!: string;
  @ApiProperty({ type: String }) email!: string;
  @ApiProperty({ format: 'date-time', type: String }) expiresAt!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiPropertyOptional({ type: String }) ipAddress?: string;
  @ApiProperty({ format: 'date-time', type: String }) lastSeenAt!: string;
  @ApiPropertyOptional({ format: 'date-time', type: String }) revokedAt?: string;
  @ApiProperty({ type: Boolean }) twoFactorVerified!: boolean;
  @ApiPropertyOptional({ type: String }) userAgent?: string;
}

export class AuditEventRecordDto implements AuditEventRecord {
  @ApiProperty({ type: String }) action!: string;
  @ApiPropertyOptional({ format: 'uuid', type: String }) actorAccountId?: string;
  @ApiPropertyOptional({ type: String }) actorDisplayName?: string;
  @ApiPropertyOptional({ additionalProperties: true, type: Object }) after?: Record<
    string,
    unknown
  >;
  @ApiPropertyOptional({ additionalProperties: true, type: Object }) before?: Record<
    string,
    unknown
  >;
  @ApiProperty({ type: String }) correlationId!: string;
  @ApiProperty({ type: String }) eventHash!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ additionalProperties: true, type: Object }) metadata!: Record<string, unknown>;
  @ApiProperty({ format: 'date-time', type: String }) occurredAt!: string;
  @ApiPropertyOptional({ type: String }) previousEventHash?: string;
  @ApiPropertyOptional({ type: String }) sourceIp?: string;
  @ApiPropertyOptional({ format: 'uuid', type: String }) targetId?: string;
  @ApiProperty({ type: String }) targetType!: string;
  @ApiPropertyOptional({ type: String }) userAgent?: string;
}

export class AuditEventPageDto implements AuditEventPage {
  @ApiProperty({ type: [AuditEventRecordDto] }) items!: AuditEventRecord[];
  @ApiProperty({ minimum: 1, type: Number }) page!: number;
  @ApiProperty({ minimum: 1, type: Number }) pageSize!: number;
  @ApiProperty({ minimum: 0, type: Number }) total!: number;
  @ApiProperty({ minimum: 0, type: Number }) totalPages!: number;
}

export class AuditIntegrityResultDto implements AuditIntegrityResult {
  @ApiPropertyOptional({ format: 'uuid', type: String }) brokenEventId?: string;
  @ApiProperty({ minimum: 0, type: Number }) checkedEvents!: number;
  @ApiPropertyOptional({ type: String }) headHash?: string;
  @ApiProperty({ type: Boolean }) valid!: boolean;
}
