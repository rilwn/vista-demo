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
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import { RequirePermissions } from '../auth/auth.decorators.js';
import type {
  AuthenticatedRequest,
  RequestSecurityMetadata,
} from '../auth/authentication.types.js';
import type { CorrelatedRequest } from '../common/correlation-id.middleware.js';
import {
  CreatePartnerDto,
  CreatePartnerAddressDto,
  CreatePartnerBankAccountDto,
  CreatePartnerContactDto,
  PartnerAddressDto,
  PartnerBankAccountDto,
  PartnerContactDto,
  PartnerDuplicateQueryDto,
  PartnerDuplicateResponseDto,
  PartnerListQueryDto,
  PartnerPageDto,
  PartnerProfileDto,
  PartnerSummaryDto,
} from './partners.dto.js';
import { PartnersService } from './partners.service.js';

@ApiTags('partner master data')
@ApiBearerAuth()
@Controller('master-data/partners')
export class PartnersController {
  constructor(@Inject(PartnersService) private readonly partners: PartnersService) {}

  @Get()
  @RequirePermissions({ action: 'view', module: 'crm' })
  @ApiQuery({ enum: ['asc', 'desc'], name: 'direction', required: false })
  @ApiQuery({ enum: ['legal_entity', 'individual'], name: 'kind', required: false })
  @ApiQuery({ minimum: 1, name: 'page', required: false, type: Number })
  @ApiQuery({ maximum: 100, minimum: 1, name: 'pageSize', required: false, type: Number })
  @ApiQuery({ enum: ['customer', 'supplier', 'partner'], name: 'role', required: false })
  @ApiQuery({ maxLength: 255, name: 'search', required: false, type: String })
  @ApiQuery({
    enum: ['createdAt', 'displayName', 'updatedAt'],
    name: 'sortBy',
    required: false,
  })
  @ApiOkResponse({ type: PartnerPageDto })
  list(@Query() query: PartnerListQueryDto): Promise<PartnerPageDto> {
    return this.partners.list(query);
  }

  @Get('duplicates')
  @RequirePermissions({ action: 'view', module: 'crm' })
  @ApiOperation({
    description: 'Warns about exact normalized-name or UIC candidates. It never merges records.',
  })
  @ApiQuery({ maxLength: 255, name: 'name', required: false, type: String })
  @ApiQuery({ maxLength: 50, name: 'uic', required: false, type: String })
  @ApiOkResponse({ type: PartnerDuplicateResponseDto })
  duplicates(@Query() query: PartnerDuplicateQueryDto): Promise<PartnerDuplicateResponseDto> {
    return this.partners.findDuplicates(query);
  }

  @Get(':id/profile')
  @RequirePermissions({ action: 'view', module: 'crm' })
  @ApiOkResponse({ type: PartnerProfileDto })
  profile(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<PartnerProfileDto> {
    return this.partners.getProfile(id);
  }

  @Get(':id')
  @RequirePermissions({ action: 'view', module: 'crm' })
  @ApiOkResponse({ type: PartnerSummaryDto })
  get(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string): Promise<PartnerSummaryDto> {
    return this.partners.get(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ action: 'create', module: 'crm' })
  @ApiBody({ type: CreatePartnerDto })
  @ApiCreatedResponse({ type: PartnerSummaryDto })
  @ApiConflictResponse({
    description: 'A duplicate candidate or conflicting idempotency key exists.',
  })
  @ApiHeader({
    description: 'Stable 8-128 character retry key. Replays return the original result.',
    name: 'Idempotency-Key',
    required: true,
  })
  create(
    @Body() input: CreatePartnerDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<PartnerSummaryDto> {
    return this.partners.create(
      input,
      idempotencyKey,
      request.authentication,
      requestMetadata(request),
    );
  }

  @Post(':id/addresses')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ action: 'edit', module: 'crm' })
  @ApiBody({ type: CreatePartnerAddressDto })
  @ApiCreatedResponse({ type: PartnerAddressDto })
  @ApiHeader({
    description: 'Stable 8-128 character retry key. Replays return the original result.',
    name: 'Idempotency-Key',
    required: true,
  })
  createAddress(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: CreatePartnerAddressDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<PartnerAddressDto> {
    return this.partners.createAddress(
      id,
      input,
      idempotencyKey,
      request.authentication,
      requestMetadata(request),
    );
  }

  @Post(':id/contacts')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ action: 'edit', module: 'crm' })
  @ApiBody({ type: CreatePartnerContactDto })
  @ApiCreatedResponse({ type: PartnerContactDto })
  @ApiHeader({
    description: 'Stable 8-128 character retry key. Replays return the original result.',
    name: 'Idempotency-Key',
    required: true,
  })
  createContact(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: CreatePartnerContactDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<PartnerContactDto> {
    return this.partners.createContact(
      id,
      input,
      idempotencyKey,
      request.authentication,
      requestMetadata(request),
    );
  }

  @Post(':id/bank-accounts')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ action: 'edit', module: 'crm' })
  @ApiBody({ type: CreatePartnerBankAccountDto })
  @ApiCreatedResponse({ type: PartnerBankAccountDto })
  @ApiHeader({
    description: 'Stable 8-128 character retry key. Replays return the original result.',
    name: 'Idempotency-Key',
    required: true,
  })
  createBankAccount(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: CreatePartnerBankAccountDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<PartnerBankAccountDto> {
    return this.partners.createBankAccount(
      id,
      input,
      idempotencyKey,
      request.authentication,
      requestMetadata(request),
    );
  }
}

function requestMetadata(request: AuthenticatedRequest): RequestSecurityMetadata {
  const correlated = request as CorrelatedRequest;
  const userAgent = request.header('user-agent');
  return {
    correlationId: correlated.correlationId,
    ...(request.ip ? { sourceIp: request.ip } : {}),
    ...(userAgent ? { userAgent } : {}),
  };
}
