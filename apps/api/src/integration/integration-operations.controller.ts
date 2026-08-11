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
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type {
  IntegrationEventDetail,
  IntegrationEventPage,
  IntegrationEventTelemetry,
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
  IntegrationEventDetailDto,
  IntegrationEventListQueryDto,
  IntegrationEventPageDto,
  IntegrationEventTelemetryDto,
  ReplayIntegrationEventDto,
} from './integration-operations.dto.js';
import { IntegrationOperationsService } from './integration-operations.service.js';

@ApiTags('platform operations')
@ApiBearerAuth()
@RateLimitPolicy('read')
@Controller('platform/integrations')
export class IntegrationOperationsController {
  constructor(
    @Inject(IntegrationOperationsService)
    private readonly integrations: IntegrationOperationsService,
  ) {}

  @Get('metrics')
  @RequirePermissions({ action: 'view', module: 'platform' })
  @ApiOkResponse({ type: IntegrationEventTelemetryDto })
  metrics(): Promise<IntegrationEventTelemetry> {
    return this.integrations.telemetry();
  }

  @Get('events')
  @RequirePermissions({ action: 'view', module: 'platform' })
  @ApiQuery({ maxLength: 255, name: 'eventType', required: false, type: String })
  @ApiQuery({ minimum: 1, name: 'page', required: false, type: Number })
  @ApiQuery({ maximum: 100, minimum: 1, name: 'pageSize', required: false, type: Number })
  @ApiQuery({
    enum: ['pending', 'publishing', 'published', 'completed', 'dead_letter'],
    name: 'status',
    required: false,
  })
  @ApiOkResponse({ type: IntegrationEventPageDto })
  list(@Query() query: IntegrationEventListQueryDto): Promise<IntegrationEventPage> {
    return this.integrations.list(query);
  }

  @Get('events/:id')
  @RequirePermissions({ action: 'view', module: 'platform' })
  @ApiParam({ format: 'uuid', name: 'id' })
  @ApiOkResponse({ type: IntegrationEventDetailDto })
  @ApiNotFoundResponse({ description: 'The integration event does not exist.' })
  detail(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<IntegrationEventDetail> {
    return this.integrations.detail(id);
  }

  @Post('events/:id/replay')
  @HttpCode(HttpStatus.OK)
  @RateLimitPolicy('sensitive')
  @RequirePermissions({ action: 'edit', module: 'platform' })
  @ApiBody({ type: ReplayIntegrationEventDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiParam({ format: 'uuid', name: 'id' })
  @ApiOkResponse({ type: IntegrationEventDetailDto })
  replay(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: ReplayIntegrationEventDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<IntegrationEventDetail> {
    return this.integrations.replay(
      id,
      input,
      key,
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
