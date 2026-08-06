import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { AuthenticationAccountSummary, LoginRequest, LoginResponse } from '@vista/contracts';
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
