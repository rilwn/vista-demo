import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiHeader,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type {
  AuditEventPage,
  AuditIntegrityResult,
  SecurityAccount,
  SecurityAccountPage,
  SecurityRole,
  SecuritySession,
} from '@vista/contracts';
import type { Request } from 'express';

import { RequirePermissions } from '../auth/auth.decorators.js';
import type {
  AuthenticatedRequest,
  RequestSecurityMetadata,
} from '../auth/authentication.types.js';
import type { CorrelatedRequest } from '../common/correlation-id.middleware.js';
import { RateLimitPolicy } from '../security/rate-limit.decorator.js';
import {
  AuditEventListQueryDto,
  AuditEventPageDto,
  AuditIntegrityResultDto,
  ChangeAccountStatusDto,
  AccountRecoveryHandoffDto,
  CreateSecurityAccountDto,
  CreateSecurityRoleDto,
  UpdateSecurityRoleDto,
  ReplaceAccountRolesDto,
  IssueAccountRecoveryHandoffDto,
  SecurityAccountDto,
  SecurityAccountListQueryDto,
  SecurityAccountPageDto,
  SecurityRoleDto,
  SecuritySessionDto,
  SecuritySessionListQueryDto,
} from './security-administration.dto.js';
import { SecurityAdministrationService } from './security-administration.service.js';

@ApiTags('security administration')
@ApiBearerAuth()
@RateLimitPolicy('sensitive')
@Controller('platform/security')
export class SecurityAdministrationController {
  constructor(
    @Inject(SecurityAdministrationService)
    private readonly security: SecurityAdministrationService,
  ) {}

  @Get('accounts')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'platform' })
  @ApiQuery({ minimum: 1, name: 'page', required: false, type: Number })
  @ApiQuery({ maximum: 100, minimum: 1, name: 'pageSize', required: false, type: Number })
  @ApiQuery({ maxLength: 200, name: 'search', required: false, type: String })
  @ApiQuery({ enum: ['active', 'disabled', 'locked'], name: 'status', required: false })
  @ApiOkResponse({ type: SecurityAccountPageDto })
  listAccounts(@Query() query: SecurityAccountListQueryDto): Promise<SecurityAccountPage> {
    return this.security.listAccounts(query);
  }

  @Post('accounts')
  @RequirePermissions({ action: 'create', module: 'platform' })
  @ApiBody({ type: CreateSecurityAccountDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ type: SecurityAccountDto })
  createAccount(
    @Body() input: CreateSecurityAccountDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<SecurityAccount> {
    return this.security.createAccount(
      input,
      key,
      request.authentication,
      requestMetadata(request),
    );
  }

  @Post('accounts/:id/disable')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ action: 'approve', module: 'platform' })
  @ApiBody({ type: ChangeAccountStatusDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiParam({ format: 'uuid', name: 'id' })
  @ApiOkResponse({ type: SecurityAccountDto })
  disableAccount(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: ChangeAccountStatusDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<SecurityAccount> {
    return this.security.changeAccountStatus(
      id,
      'disabled',
      input.expectedVersion,
      key,
      request.authentication,
      requestMetadata(request),
    );
  }

  @Post('accounts/:id/reactivate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ action: 'approve', module: 'platform' })
  @ApiBody({ type: ChangeAccountStatusDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiParam({ format: 'uuid', name: 'id' })
  @ApiOkResponse({ type: SecurityAccountDto })
  reactivateAccount(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: ChangeAccountStatusDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<SecurityAccount> {
    return this.security.changeAccountStatus(
      id,
      'active',
      input.expectedVersion,
      key,
      request.authentication,
      requestMetadata(request),
    );
  }

  @Post('accounts/:id/recovery-handoff')
  @RequirePermissions({ action: 'approve', module: 'platform' })
  @ApiBody({ type: IssueAccountRecoveryHandoffDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiParam({ format: 'uuid', name: 'id' })
  @ApiCreatedResponse({ type: AccountRecoveryHandoffDto })
  issueAccountRecoveryHandoff(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: IssueAccountRecoveryHandoffDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<AccountRecoveryHandoffDto> {
    return this.security.issueAccountRecoveryHandoff(
      id,
      input,
      key,
      request.authentication,
      requestMetadata(request),
    );
  }

  @Put('accounts/:id/roles')
  @RequirePermissions({ action: 'approve', module: 'platform' })
  @ApiBody({ type: ReplaceAccountRolesDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiParam({ format: 'uuid', name: 'id' })
  @ApiOkResponse({ type: SecurityAccountDto })
  replaceRoles(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: ReplaceAccountRolesDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<SecurityAccount> {
    return this.security.replaceAccountRoles(
      id,
      input,
      key,
      request.authentication,
      requestMetadata(request),
    );
  }

  @Get('roles')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'platform' })
  @ApiOkResponse({ type: [SecurityRoleDto] })
  listRoles(): Promise<SecurityRole[]> {
    return this.security.listRoles();
  }

  @Post('roles')
  @RequirePermissions({ action: 'create', module: 'platform' })
  @ApiBody({ type: CreateSecurityRoleDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ type: SecurityRoleDto })
  createRole(
    @Body() input: CreateSecurityRoleDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<SecurityRole> {
    return this.security.createRole(input, key, request.authentication, requestMetadata(request));
  }

  @Put('roles/:id')
  @RequirePermissions({ action: 'approve', module: 'platform' })
  @ApiParam({ format: 'uuid', name: 'id', type: String })
  @ApiBody({ type: UpdateSecurityRoleDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ type: SecurityRoleDto })
  updateRole(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: UpdateSecurityRoleDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<SecurityRole> {
    return this.security.updateRole(
      id,
      input,
      key,
      request.authentication,
      requestMetadata(request),
    );
  }

  @Get('sessions')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'platform' })
  @ApiQuery({ format: 'uuid', name: 'accountId', required: false, type: String })
  @ApiOkResponse({ type: [SecuritySessionDto] })
  listSessions(@Query() query: SecuritySessionListQueryDto): Promise<SecuritySession[]> {
    return this.security.listSessions(query);
  }

  @Post('sessions/:id/revoke')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions({ action: 'approve', module: 'platform' })
  @ApiParam({ format: 'uuid', name: 'id' })
  @ApiNoContentResponse({ description: 'The selected login session is revoked.' })
  async revokeSession(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    await this.security.revokeSession(id, request.authentication, requestMetadata(request));
  }

  @Get('audit-events')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'platform' })
  @ApiQuery({ maxLength: 150, name: 'action', required: false, type: String })
  @ApiQuery({ format: 'uuid', name: 'actorAccountId', required: false, type: String })
  @ApiQuery({ format: 'date-time', name: 'from', required: false, type: String })
  @ApiQuery({ minimum: 1, name: 'page', required: false, type: Number })
  @ApiQuery({ maximum: 100, minimum: 1, name: 'pageSize', required: false, type: Number })
  @ApiQuery({ format: 'date-time', name: 'to', required: false, type: String })
  @ApiQuery({ maxLength: 150, name: 'targetType', required: false, type: String })
  @ApiOkResponse({ type: AuditEventPageDto })
  listAuditEvents(@Query() query: AuditEventListQueryDto): Promise<AuditEventPage> {
    return this.security.listAuditEvents(query);
  }

  @Get('audit-integrity')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'platform' })
  @ApiOkResponse({ type: AuditIntegrityResultDto })
  verifyAuditIntegrity(): Promise<AuditIntegrityResult> {
    return this.security.verifyAuditIntegrity();
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
