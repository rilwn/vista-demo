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
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import { RequirePermissions } from '../auth/auth.decorators.js';
import type {
  AuthenticatedRequest,
  RequestSecurityMetadata,
} from '../auth/authentication.types.js';
import type { CorrelatedRequest } from '../common/correlation-id.middleware.js';
import { RateLimitPolicy } from '../security/rate-limit.decorator.js';
import {
  BusinessBranchDto,
  BusinessLocationDto,
  BusinessOperatorDto,
  CashRegisterDto,
  CreateBusinessBranchDto,
  CreateBusinessLocationDto,
  CreateBusinessOperatorDto,
  CreateCashRegisterDto,
  CreateLegalBusinessEntityDto,
  LegalBusinessEntityDto,
  OrganizationMemberDto,
  OrganizationTopologyDto,
} from './organization.dto.js';
import { OrganizationService } from './organization.service.js';

@ApiTags('organization topology')
@ApiBearerAuth()
@RateLimitPolicy('write')
@Controller('organization')
export class OrganizationController {
  constructor(@Inject(OrganizationService) private readonly organization: OrganizationService) {}

  @Get('topology')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'platform.organization' })
  @ApiOkResponse({ type: OrganizationTopologyDto })
  topology(): Promise<OrganizationTopologyDto> {
    return this.organization.topology();
  }

  @Get('members')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'platform.organization' })
  @ApiOkResponse({ isArray: true, type: OrganizationMemberDto })
  members(): Promise<OrganizationMemberDto[]> {
    return this.organization.members();
  }

  @Post('legal-entities')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ action: 'create', module: 'platform.organization' })
  @ApiBody({ type: CreateLegalBusinessEntityDto })
  @ApiCreatedResponse({ type: LegalBusinessEntityDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  createLegalEntity(
    @Body() input: CreateLegalBusinessEntityDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<LegalBusinessEntityDto> {
    return this.organization.createLegalEntity(
      input,
      key,
      request.authentication,
      metadata(request),
    );
  }

  @Post('legal-entities/:entityId/branches')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ action: 'create', module: 'platform.organization' })
  @ApiBody({ type: CreateBusinessBranchDto })
  @ApiCreatedResponse({ type: BusinessBranchDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiParam({ format: 'uuid', name: 'entityId' })
  createBranch(
    @Param('entityId', new ParseUUIDPipe()) entityId: string,
    @Body() input: CreateBusinessBranchDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<BusinessBranchDto> {
    return this.organization.createBranch(
      entityId,
      input,
      key,
      request.authentication,
      metadata(request),
    );
  }

  @Post('branches/:branchId/locations')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ action: 'create', module: 'platform.organization' })
  @ApiBody({ type: CreateBusinessLocationDto })
  @ApiCreatedResponse({ type: BusinessLocationDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiParam({ format: 'uuid', name: 'branchId' })
  createLocation(
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Body() input: CreateBusinessLocationDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<BusinessLocationDto> {
    return this.organization.createLocation(
      branchId,
      input,
      key,
      request.authentication,
      metadata(request),
    );
  }

  @Post('locations/:locationId/operators')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ action: 'create', module: 'platform.organization' })
  @ApiBody({ type: CreateBusinessOperatorDto })
  @ApiCreatedResponse({ type: BusinessOperatorDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiParam({ format: 'uuid', name: 'locationId' })
  createOperator(
    @Param('locationId', new ParseUUIDPipe()) locationId: string,
    @Body() input: CreateBusinessOperatorDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<BusinessOperatorDto> {
    return this.organization.createOperator(
      locationId,
      input,
      key,
      request.authentication,
      metadata(request),
    );
  }

  @Post('locations/:locationId/registers')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ action: 'create', module: 'platform.organization' })
  @ApiBody({ type: CreateCashRegisterDto })
  @ApiCreatedResponse({ type: CashRegisterDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiParam({ format: 'uuid', name: 'locationId' })
  createRegister(
    @Param('locationId', new ParseUUIDPipe()) locationId: string,
    @Body() input: CreateCashRegisterDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<CashRegisterDto> {
    return this.organization.createRegister(
      locationId,
      input,
      key,
      request.authentication,
      metadata(request),
    );
  }
}

function metadata(request: AuthenticatedRequest): RequestSecurityMetadata {
  const correlated = request as CorrelatedRequest;
  const userAgent = request.header('user-agent');
  return {
    correlationId: correlated.correlationId,
    ...(request.ip ? { sourceIp: request.ip } : {}),
    ...(userAgent ? { userAgent } : {}),
  };
}
