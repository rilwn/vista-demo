import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiParam,
  ApiResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Permission } from '@vista/auth';
import type { AppEnvironment } from '@vista/config';
import type { Request, Response as ExpressResponse } from 'express';

import type { CorrelatedRequest } from '../common/correlation-id.middleware.js';
import { ApiErrorException } from '../common/api-error.exception.js';
import { APP_ENVIRONMENT } from '../config/config.module.js';
import { RateLimitPolicy } from '../security/rate-limit.decorator.js';
import { Public, RequirePermissions } from './auth.decorators.js';
import {
  ApiPermissionDto,
  AuthenticationContextDto,
  ChangePasswordRequestDto,
  ChangePasswordResponseDto,
  CompleteAccountRecoveryRequestDto,
  CompleteAccountRecoveryResponseDto,
  DisableTotpRequestDto,
  DisableTotpResponseDto,
  DirectoryLoginExchangeRequestDto,
  DirectoryLoginStartRequestDto,
  DirectoryLoginStartResponseDto,
  DirectorySignInOptionsDto,
  DirectorySamlCallbackDto,
  LoginRequestDto,
  LoginResponseDto,
  PasswordPolicyResponseDto,
  StartTotpEnrollmentRequestDto,
  StartTotpEnrollmentResponseDto,
  StartAccountRecoveryTotpRequestDto,
  StartAccountRecoveryTotpResponseDto,
  TotpEnrollmentStatusDto,
  VerifyAccountRecoveryTotpRequestDto,
  VerifyAccountRecoveryTotpResponseDto,
  VerifyTotpEnrollmentRequestDto,
  VerifyTotpEnrollmentResponseDto,
} from './auth.dto.js';
import { AccountRecoveryService } from './account-recovery.service.js';
import { AuthService } from './auth.service.js';
import type { AuthenticatedRequest, RequestSecurityMetadata } from './authentication.types.js';
import { LoginRateLimitGuard } from './login-rate-limit.guard.js';
import { SessionService } from './session.service.js';
import { DirectoryAuthenticationService } from './directory-authentication.service.js';

@ApiTags('authentication')
@RateLimitPolicy('read')
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly authentication: AuthService,
    @Inject(AccountRecoveryService) private readonly recovery: AccountRecoveryService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(DirectoryAuthenticationService)
    private readonly directory: DirectoryAuthenticationService,
    @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
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

  @Public()
  @RateLimitPolicy('read')
  @Get('directory/options')
  @ApiOkResponse({ type: DirectorySignInOptionsDto })
  directoryOptions(): DirectorySignInOptionsDto {
    return this.directory.options();
  }

  @Public()
  @RateLimitPolicy('sensitive')
  @Post('directory/start')
  @HttpCode(HttpStatus.OK)
  @ApiBody({ type: DirectoryLoginStartRequestDto })
  @ApiOkResponse({ type: DirectoryLoginStartResponseDto })
  startDirectoryLogin(
    @Body() input: DirectoryLoginStartRequestDto,
  ): Promise<DirectoryLoginStartResponseDto> {
    return this.directory.startLogin(input.app);
  }

  @Public()
  @RateLimitPolicy('sensitive')
  @Get('directory/oidc/callback')
  @ApiResponse({
    status: 303,
    description: 'The verified identity returns to the selected Vista app.',
  })
  async completeOidcLogin(
    @Req() request: Request,
    @Res() response: ExpressResponse,
  ): Promise<void> {
    const callbackUrl = new URL(this.environment.DIRECTORY_OIDC_CALLBACK_URL);
    callbackUrl.search = new URL(request.originalUrl, 'http://vista.invalid').search;
    const completed = await this.directory.completeOidcCallback(callbackUrl);
    response.redirect(303, completed.redirectUrl);
  }

  @Public()
  @RateLimitPolicy('sensitive')
  @Post('directory/saml/callback')
  @ApiResponse({
    status: 303,
    description: 'The verified identity returns to the selected Vista app.',
  })
  async completeSamlLogin(
    @Body() input: DirectorySamlCallbackDto,
    @Res() response: ExpressResponse,
  ): Promise<void> {
    const completed = await this.directory.completeSamlCallback(
      input.SAMLResponse,
      input.RelayState,
    );
    response.redirect(303, completed.redirectUrl);
  }

  @Public()
  @RateLimitPolicy('read')
  @Get('directory/saml/metadata')
  @ApiOkResponse({ description: 'SAML service-provider metadata XML.', schema: { type: 'string' } })
  samlMetadata(@Res() response: ExpressResponse): void {
    response.type('application/xml').send(this.directory.samlMetadata());
  }

  @Public()
  @RateLimitPolicy('sensitive')
  @Post('directory/exchange')
  @HttpCode(HttpStatus.OK)
  @ApiBody({ type: DirectoryLoginExchangeRequestDto })
  @ApiOkResponse({ type: LoginResponseDto })
  async exchangeDirectoryLogin(
    @Body() input: DirectoryLoginExchangeRequestDto,
    @Req() request: Request,
  ): Promise<LoginResponseDto> {
    const claim = await this.directory.claimTicket(input.ticket);
    if (!claim) {
      throw new ApiErrorException(
        'DIRECTORY_SIGN_IN_FAILED',
        'Organization sign-in expired or is already being completed. Start again.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    let consumed = false;
    try {
      const identity = await this.directory.readTicket(input.ticket);
      const result = await this.authentication.loginWithDirectoryIdentity(
        identity,
        input.totpCode,
        requestMetadata(request),
      );
      consumed = true;
      return result;
    } finally {
      await this.directory.finishTicket(input.ticket, claim, consumed);
    }
  }

  @Public()
  @RateLimitPolicy('sensitive')
  @Post('recovery/complete')
  @HttpCode(HttpStatus.OK)
  @ApiBody({ type: CompleteAccountRecoveryRequestDto })
  @ApiOkResponse({ type: CompleteAccountRecoveryResponseDto })
  @ApiBadRequestResponse({ description: 'The recovery code or replacement password is invalid.' })
  completeRecovery(
    @Body() input: CompleteAccountRecoveryRequestDto,
    @Req() request: Request,
  ): Promise<CompleteAccountRecoveryResponseDto> {
    return this.recovery.completeRecovery(input, requestMetadata(request));
  }

  @Public()
  @RateLimitPolicy('sensitive')
  @Post('recovery/totp/enrollment')
  @HttpCode(HttpStatus.CREATED)
  @ApiBody({ type: StartAccountRecoveryTotpRequestDto })
  @ApiCreatedResponse({ type: StartAccountRecoveryTotpResponseDto })
  @ApiBadRequestResponse({ description: 'The recovery code is invalid or unavailable.' })
  startRecoveryTotpEnrollment(
    @Body() input: StartAccountRecoveryTotpRequestDto,
    @Req() request: Request,
  ): Promise<StartAccountRecoveryTotpResponseDto> {
    return this.recovery.startTotpEnrollment(input, requestMetadata(request));
  }

  @Public()
  @RateLimitPolicy('sensitive')
  @Post('recovery/totp/enrollment/:enrollmentId/verify')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ format: 'uuid', name: 'enrollmentId' })
  @ApiBody({ type: VerifyAccountRecoveryTotpRequestDto })
  @ApiOkResponse({ type: VerifyAccountRecoveryTotpResponseDto })
  @ApiBadRequestResponse({ description: 'The recovery code or authenticator code is invalid.' })
  verifyRecoveryTotpEnrollment(
    @Param('enrollmentId', new ParseUUIDPipe()) enrollmentId: string,
    @Body() input: VerifyAccountRecoveryTotpRequestDto,
    @Req() request: Request,
  ): Promise<VerifyAccountRecoveryTotpResponseDto> {
    return this.recovery.verifyTotpEnrollment(enrollmentId, input, requestMetadata(request));
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

  @Get('me/totp')
  @ApiBearerAuth()
  @ApiOkResponse({ type: TotpEnrollmentStatusDto })
  totpStatus(@Req() request: AuthenticatedRequest): Promise<TotpEnrollmentStatusDto> {
    return this.authentication.totpStatus(request.authentication);
  }

  @Post('me/totp/enrollment')
  @RateLimitPolicy('sensitive')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiBody({ type: StartTotpEnrollmentRequestDto })
  @ApiCreatedResponse({ type: StartTotpEnrollmentResponseDto })
  @ApiBadRequestResponse({ description: 'The current password must be confirmed.' })
  @ApiConflictResponse({ description: 'An authenticator is already enrolled.' })
  startTotpEnrollment(
    @Body() input: StartTotpEnrollmentRequestDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<StartTotpEnrollmentResponseDto> {
    return this.authentication.startTotpEnrollment(
      input,
      request.authentication,
      requestMetadata(request),
    );
  }

  @Post('me/totp/enrollment/:enrollmentId/verify')
  @RateLimitPolicy('sensitive')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiParam({ format: 'uuid', name: 'enrollmentId' })
  @ApiBody({ type: VerifyTotpEnrollmentRequestDto })
  @ApiOkResponse({ type: VerifyTotpEnrollmentResponseDto })
  @ApiBadRequestResponse({ description: 'The six-digit authenticator code is invalid.' })
  @ApiConflictResponse({ description: 'The authenticator setup expired.' })
  verifyTotpEnrollment(
    @Param('enrollmentId', new ParseUUIDPipe()) enrollmentId: string,
    @Body() input: VerifyTotpEnrollmentRequestDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<VerifyTotpEnrollmentResponseDto> {
    return this.authentication.verifyTotpEnrollment(
      enrollmentId,
      input,
      request.authentication,
      requestMetadata(request),
    );
  }

  @Post('me/totp/disable')
  @RateLimitPolicy('sensitive')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiBody({ type: DisableTotpRequestDto })
  @ApiOkResponse({ type: DisableTotpResponseDto })
  @ApiBadRequestResponse({ description: 'The current password or authenticator code is invalid.' })
  @ApiConflictResponse({ description: 'An administrative account must retain an authenticator.' })
  disableTotp(
    @Body() input: DisableTotpRequestDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<DisableTotpResponseDto> {
    return this.authentication.disableTotp(input, request.authentication, requestMetadata(request));
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
