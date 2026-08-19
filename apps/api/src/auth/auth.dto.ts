import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type {
  ApiPermission,
  AuthenticationAccountSummary,
  AuthenticationContextResponse,
  CompleteAccountRecoveryRequest,
  CompleteAccountRecoveryResponse,
  ChangePasswordRequest,
  ChangePasswordResponse,
  DisableTotpRequest,
  DisableTotpResponse,
  LoginRequest,
  LoginResponse,
  PasswordPolicyResponse,
  StartTotpEnrollmentRequest,
  StartTotpEnrollmentResponse,
  StartAccountRecoveryTotpRequest,
  StartAccountRecoveryTotpResponse,
  TotpEnrollmentStatus,
  VerifyAccountRecoveryTotpRequest,
  VerifyAccountRecoveryTotpResponse,
  VerifyTotpEnrollmentRequest,
  VerifyTotpEnrollmentResponse,
} from '@vista/contracts';
import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class LoginRequestDto implements LoginRequest {
  @ApiProperty({ example: 'employee@example.invalid', maxLength: 320, type: String })
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @ApiProperty({ format: 'password', maxLength: 128, type: String, writeOnly: true })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;

  @ApiPropertyOptional({
    example: '123456',
    pattern: '^\\d{6}$',
    type: String,
    writeOnly: true,
  })
  @IsOptional()
  @Matches(/^\d{6}$/u)
  totpCode?: string;
}

export class LoginAccountDto implements AuthenticationAccountSummary {
  @ApiProperty({ type: String })
  displayName!: string;

  @ApiProperty({ type: String })
  email!: string;

  @ApiProperty({ format: 'uuid', type: String })
  id!: string;

  @ApiProperty({ type: Boolean })
  isAdministrative!: boolean;
}

export class LoginResponseDto implements LoginResponse {
  @ApiProperty({ type: () => LoginAccountDto })
  account!: LoginAccountDto;

  @ApiProperty({ format: 'date-time', type: String })
  expiresAt!: string;

  @ApiProperty({ description: 'Opaque bearer token. It is returned only once.', type: String })
  sessionToken!: string;
}

export class ApiPermissionDto implements ApiPermission {
  @ApiProperty({ enum: ['view', 'create', 'edit', 'delete', 'approve', '*'] })
  action!: ApiPermission['action'];

  @ApiProperty({
    enum: [
      'platform',
      'platform.organization',
      'erp.finance',
      'erp.procurement',
      'erp.warehouse',
      'erp.sales',
      'erp.service',
      'erp.logistics',
      'reports',
      'crm',
      'pos',
      'backup',
      '*',
    ],
  })
  module!: ApiPermission['module'];
}

export class AuthenticationContextDto implements AuthenticationContextResponse {
  @ApiProperty({ format: 'uuid', type: String })
  accountId!: string;

  @ApiProperty({ type: String })
  displayName!: string;

  @ApiProperty({ type: String })
  email!: string;

  @ApiProperty({ format: 'uuid', type: String })
  employeeId!: string;

  @ApiProperty({ type: Boolean })
  isAdministrative!: boolean;

  @ApiProperty({ type: [ApiPermissionDto] })
  permissions!: ApiPermissionDto[];

  @ApiProperty({ format: 'uuid', type: String })
  sessionId!: string;

  @ApiProperty({ type: Boolean })
  twoFactorVerified!: boolean;
}

export class ChangePasswordRequestDto implements ChangePasswordRequest {
  @ApiProperty({ format: 'password', maxLength: 128, type: String, writeOnly: true })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  currentPassword!: string;

  @ApiProperty({ format: 'password', maxLength: 128, type: String, writeOnly: true })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  newPassword!: string;
}

export class ChangePasswordResponseDto implements ChangePasswordResponse {
  @ApiProperty({ format: 'date-time', type: String })
  changedAt!: string;

  @ApiPropertyOptional({ format: 'date-time', type: String })
  expiresAt?: string;

  @ApiProperty({ minimum: 0, type: Number })
  revokedOtherSessionCount!: number;
}

export class PasswordPolicyResponseDto implements PasswordPolicyResponse {
  @ApiProperty({ minimum: 0, type: Number })
  expirationDays!: number;

  @ApiProperty({ minimum: 1, type: Number })
  historyCount!: number;

  @ApiProperty({ minimum: 8, type: Number })
  minimumLength!: number;

  @ApiProperty({ type: Boolean })
  requireLowercase!: boolean;

  @ApiProperty({ type: Boolean })
  requireNumber!: boolean;

  @ApiProperty({ type: Boolean })
  requireSymbol!: boolean;

  @ApiProperty({ type: Boolean })
  requireUppercase!: boolean;
}

export class TotpEnrollmentStatusDto implements TotpEnrollmentStatus {
  @ApiProperty({ type: Boolean })
  enrolled!: boolean;

  @ApiPropertyOptional({ format: 'date-time', type: String })
  enrolledAt?: string;
}

export class StartTotpEnrollmentRequestDto implements StartTotpEnrollmentRequest {
  @ApiProperty({ format: 'password', maxLength: 128, type: String, writeOnly: true })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  currentPassword!: string;
}

export class StartTotpEnrollmentResponseDto implements StartTotpEnrollmentResponse {
  @ApiProperty({ format: 'uuid', type: String })
  enrollmentId!: string;

  @ApiProperty({ format: 'date-time', type: String })
  expiresAt!: string;

  @ApiProperty({ description: 'One-time manual key for the employee authenticator.', type: String })
  manualEntryKey!: string;

  @ApiProperty({ description: 'One-time TOTP provisioning URI.', type: String })
  provisioningUri!: string;
}

export class VerifyTotpEnrollmentRequestDto implements VerifyTotpEnrollmentRequest {
  @ApiProperty({ example: '123456', pattern: '^\\d{6}$', type: String, writeOnly: true })
  @IsString()
  @Matches(/^\d{6}$/u)
  code!: string;
}

export class VerifyTotpEnrollmentResponseDto
  extends TotpEnrollmentStatusDto
  implements VerifyTotpEnrollmentResponse
{
  @ApiProperty({ minimum: 0, type: Number })
  revokedOtherSessionCount!: number;
}

export class DisableTotpRequestDto implements DisableTotpRequest {
  @ApiProperty({ example: '123456', pattern: '^\\d{6}$', type: String, writeOnly: true })
  @IsString()
  @Matches(/^\d{6}$/u)
  code!: string;

  @ApiProperty({ format: 'password', maxLength: 128, type: String, writeOnly: true })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  currentPassword!: string;
}

export class DisableTotpResponseDto extends TotpEnrollmentStatusDto implements DisableTotpResponse {
  @ApiProperty({ minimum: 0, type: Number })
  revokedOtherSessionCount!: number;
}

export class CompleteAccountRecoveryRequestDto implements CompleteAccountRecoveryRequest {
  @ApiProperty({ format: 'email', maxLength: 320, type: String })
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @ApiProperty({ format: 'password', maxLength: 128, type: String, writeOnly: true })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  newPassword!: string;

  @ApiProperty({ format: 'password', maxLength: 128, minLength: 43, type: String, writeOnly: true })
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/u)
  recoveryCode!: string;
}

export class CompleteAccountRecoveryResponseDto implements CompleteAccountRecoveryResponse {
  @ApiPropertyOptional({ format: 'date-time', type: String })
  expiresAt?: string;

  @ApiProperty({ type: Boolean })
  requiresTotpEnrollment!: boolean;
}

export class StartAccountRecoveryTotpRequestDto implements StartAccountRecoveryTotpRequest {
  @ApiProperty({ format: 'email', maxLength: 320, type: String })
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @ApiProperty({ format: 'password', maxLength: 128, minLength: 43, type: String, writeOnly: true })
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/u)
  recoveryCode!: string;
}

export class StartAccountRecoveryTotpResponseDto implements StartAccountRecoveryTotpResponse {
  @ApiProperty({ format: 'uuid', type: String })
  enrollmentId!: string;

  @ApiProperty({ format: 'date-time', type: String })
  expiresAt!: string;

  @ApiProperty({ description: 'One-time manual key for the employee authenticator.', type: String })
  manualEntryKey!: string;

  @ApiProperty({ description: 'One-time TOTP provisioning URI.', type: String })
  provisioningUri!: string;
}

export class VerifyAccountRecoveryTotpRequestDto implements VerifyAccountRecoveryTotpRequest {
  @ApiProperty({ example: '123456', pattern: '^\\d{6}$', type: String, writeOnly: true })
  @IsString()
  @Matches(/^\d{6}$/u)
  code!: string;

  @ApiProperty({ format: 'email', maxLength: 320, type: String })
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @ApiProperty({ format: 'password', maxLength: 128, minLength: 43, type: String, writeOnly: true })
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/u)
  recoveryCode!: string;
}

export class VerifyAccountRecoveryTotpResponseDto
  extends TotpEnrollmentStatusDto
  implements VerifyAccountRecoveryTotpResponse {}
