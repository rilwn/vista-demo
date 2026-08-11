import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Permission } from '@vista/auth';
import type { Request } from 'express';

import type { CorrelatedRequest } from '../common/correlation-id.middleware.js';
import { RateLimitPolicy } from '../security/rate-limit.decorator.js';
import { Public, RequirePermissions } from './auth.decorators.js';
import {
  ApiPermissionDto,
  AuthenticationContextDto,
  ChangePasswordRequestDto,
  ChangePasswordResponseDto,
  LoginRequestDto,
  LoginResponseDto,
  PasswordPolicyResponseDto,
} from './auth.dto.js';
import { AuthService } from './auth.service.js';
import type { AuthenticatedRequest, RequestSecurityMetadata } from './authentication.types.js';
import { LoginRateLimitGuard } from './login-rate-limit.guard.js';
import { SessionService } from './session.service.js';

@ApiTags('authentication')
@RateLimitPolicy('read')
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly authentication: AuthService,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  @Public()
  @RateLimitPolicy('public')
  @Post('login')
  @UseGuards(LoginRateLimitGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBody({ type: LoginRequestDto })
  @ApiOkResponse({ type: LoginResponseDto })
  @ApiUnauthorizedResponse({ description: 'Credentials or a required factor are invalid.' })
  @ApiForbiddenResponse({ description: 'Password or mandatory factor enrollment blocks login.' })
  @ApiTooManyRequestsResponse({ description: 'Too many attempts for this client/account pair.' })
  login(@Body() input: LoginRequestDto, @Req() request: Request): Promise<LoginResponseDto> {
    return this.authentication.login(input, requestMetadata(request));
  }

  @Post('logout')
  @RateLimitPolicy('sensitive')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiNoContentResponse({ description: 'The current session was revoked.' })
  async logout(@Req() request: AuthenticatedRequest): Promise<void> {
    await this.sessions.revoke(request.authentication, requestMetadata(request));
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOkResponse({
    description: 'The current authenticated employee account.',
    type: AuthenticationContextDto,
  })
  me(@Req() request: AuthenticatedRequest): AuthenticatedRequest['authentication'] {
    return request.authentication;
  }

  @Get('me/permissions')
  @RequirePermissions({ action: 'view', module: 'platform' })
  @ApiBearerAuth()
  @ApiOkResponse({
    description: 'The current account effective permissions.',
    type: [ApiPermissionDto],
  })
  permissions(@Req() request: AuthenticatedRequest): Permission[] {
    return request.authentication.permissions;
  }

  @Get('me/password-policy')
  @ApiBearerAuth()
  @ApiOkResponse({ type: PasswordPolicyResponseDto })
  passwordPolicy(): PasswordPolicyResponseDto {
    return this.authentication.passwordPolicy();
  }

  @Post('me/password')
  @RateLimitPolicy('sensitive')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiBody({ type: ChangePasswordRequestDto })
  @ApiOkResponse({ type: ChangePasswordResponseDto })
  @ApiBadRequestResponse({
    description: 'The current password, password policy, or recent-password rule was not met.',
  })
  changePassword(
    @Body() input: ChangePasswordRequestDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<ChangePasswordResponseDto> {
    return this.authentication.changePassword(
      input,
      request.authentication,
      requestMetadata(request),
    );
  }
}

function requestMetadata(request: Request): RequestSecurityMetadata {
  const correlated = request as CorrelatedRequest;
  const userAgent = request.header('user-agent');
  return {
    correlationId: correlated.correlationId,
    ...(request.ip ? { sourceIp: request.ip } : {}),
    ...(userAgent ? { userAgent } : {}),
  };
}
