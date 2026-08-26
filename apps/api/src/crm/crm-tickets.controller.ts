import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import { RequirePermissions } from '../auth/auth.decorators.js';
import type { AuthenticatedRequest } from '../auth/authentication.types.js';
import type { CorrelatedRequest } from '../common/correlation-id.middleware.js';
import { RateLimitPolicy } from '../security/rate-limit.decorator.js';
import {
  CreateCrmTicketDto,
  CreateCrmTicketFromServiceRequestDto,
  CreateServiceRequestFromCrmTicketDto,
  CrmTicketDto,
  CrmTicketPageDto,
  CrmTicketReferenceDataDto,
  ListCrmTicketsQueryDto,
  RecordCrmTicketResponseDto,
  TransitionCrmTicketDto,
} from './crm-tickets.dto.js';
import { CrmTicketsService } from './crm-tickets.service.js';

@ApiTags('crm tickets')
@ApiBearerAuth()
@Controller('crm/tickets')
export class CrmTicketsController {
  constructor(@Inject(CrmTicketsService) private readonly tickets: CrmTicketsService) {}

  @Get('reference-data')
  @RequirePermissions({ action: 'view', module: 'crm' })
  @RateLimitPolicy('read')
  @ApiOkResponse({ type: CrmTicketReferenceDataDto })
  referenceData(): Promise<CrmTicketReferenceDataDto> {
    return this.tickets.referenceData();
  }

  @Get()
  @RequirePermissions({ action: 'view', module: 'crm' })
  @RateLimitPolicy('read')
  @ApiOkResponse({ type: CrmTicketPageDto })
  @ApiQuery({ minimum: 1, name: 'page', required: false, type: Number })
  @ApiQuery({ maximum: 100, minimum: 1, name: 'pageSize', required: false, type: Number })
  @ApiQuery({ enum: ['low', 'normal', 'high', 'urgent'], name: 'priority', required: false })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({
    enum: ['new', 'in_progress', 'waiting_customer', 'resolved', 'closed', 'cancelled'],
    name: 'status',
    required: false,
  })
  list(@Query() query: ListCrmTicketsQueryDto): Promise<CrmTicketPageDto> {
    return this.tickets.list(query);
  }

  @Get(':id')
  @RequirePermissions({ action: 'view', module: 'crm' })
  @RateLimitPolicy('read')
  @ApiOkResponse({ type: CrmTicketDto })
  @ApiParam({ format: 'uuid', name: 'id' })
  get(@Param('id') id: string): Promise<CrmTicketDto> {
    return this.tickets.get(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ action: 'create', module: 'crm' })
  @RateLimitPolicy('write')
  @ApiBody({ type: CreateCrmTicketDto })
  @ApiCreatedResponse({ type: CrmTicketDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  create(
    @Body() input: CreateCrmTicketDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<CrmTicketDto> {
    return this.tickets.create(input, key, request.authentication, metadata(request));
  }

  @Post(':id/respond')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ action: 'edit', module: 'crm' })
  @RateLimitPolicy('write')
  @ApiBody({ type: RecordCrmTicketResponseDto })
  @ApiOkResponse({ type: CrmTicketDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiParam({ format: 'uuid', name: 'id' })
  respond(
    @Param('id') id: string,
    @Body() input: RecordCrmTicketResponseDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<CrmTicketDto> {
    return this.tickets.respond(id, input, key, request.authentication, metadata(request));
  }

  @Post(':id/transition')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ action: 'edit', module: 'crm' })
  @RateLimitPolicy('write')
  @ApiBody({ type: TransitionCrmTicketDto })
  @ApiOkResponse({ type: CrmTicketDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiParam({ format: 'uuid', name: 'id' })
  transition(
    @Param('id') id: string,
    @Body() input: TransitionCrmTicketDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<CrmTicketDto> {
    return this.tickets.transition(id, input, key, request.authentication, metadata(request));
  }

  @Post(':id/service-request')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(
    { action: 'edit', module: 'crm' },
    { action: 'create', module: 'erp.service' },
  )
  @RateLimitPolicy('write')
  @ApiBody({ type: CreateServiceRequestFromCrmTicketDto })
  @ApiCreatedResponse({ type: CrmTicketDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiParam({ format: 'uuid', name: 'id' })
  createServiceRequest(
    @Param('id') id: string,
    @Body() input: CreateServiceRequestFromCrmTicketDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<CrmTicketDto> {
    return this.tickets.createServiceRequest(
      id,
      input,
      key,
      request.authentication,
      metadata(request),
    );
  }

  @Post('from-service-request/:serviceRequestId')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(
    { action: 'create', module: 'crm' },
    { action: 'view', module: 'erp.service' },
  )
  @RateLimitPolicy('write')
  @ApiBody({ type: CreateCrmTicketFromServiceRequestDto })
  @ApiCreatedResponse({ type: CrmTicketDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiParam({ format: 'uuid', name: 'serviceRequestId' })
  createFromServiceRequest(
    @Param('serviceRequestId') serviceRequestId: string,
    @Body() input: CreateCrmTicketFromServiceRequestDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<CrmTicketDto> {
    return this.tickets.createFromServiceRequest(
      serviceRequestId,
      input,
      key,
      request.authentication,
      metadata(request),
    );
  }
}

function metadata(request: AuthenticatedRequest) {
  const correlated = request as CorrelatedRequest;
  const userAgent = request.header('user-agent');
  return {
    correlationId: correlated.correlationId,
    ...(request.ip ? { sourceIp: request.ip } : {}),
    ...(userAgent ? { userAgent } : {}),
  };
}
