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
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import { RequirePermissions } from '../auth/auth.decorators.js';
import type { AuthenticatedRequest } from '../auth/authentication.types.js';
import type { CorrelatedRequest } from '../common/correlation-id.middleware.js';
import { RateLimitPolicy } from '../security/rate-limit.decorator.js';
import {
  CreateCrmInteractionDto,
  CreateCrmTaskDto,
  CrmInteractionResponseDto,
  CrmTaskDto,
  CrmTimelinePageDto,
  CrmTimelineReferenceDataDto,
  ListCrmTimelineQueryDto,
  TransitionCrmTaskDto,
} from './crm-timeline.dto.js';
import { CrmTimelineService } from './crm-timeline.service.js';

@ApiTags('crm timeline')
@ApiBearerAuth()
@Controller('crm')
export class CrmTimelineController {
  constructor(@Inject(CrmTimelineService) private readonly timeline: CrmTimelineService) {}

  @Get('timeline/reference-data')
  @RequirePermissions({ action: 'view', module: 'crm' })
  @RateLimitPolicy('read')
  @ApiOkResponse({ type: CrmTimelineReferenceDataDto })
  referenceData(): Promise<CrmTimelineReferenceDataDto> {
    return this.timeline.referenceData();
  }

  @Get('timeline')
  @RequirePermissions({ action: 'view', module: 'crm' })
  @RateLimitPolicy('read')
  @ApiOkResponse({ type: CrmTimelinePageDto })
  list(@Query() query: ListCrmTimelineQueryDto): Promise<CrmTimelinePageDto> {
    return this.timeline.list(query);
  }

  @Post('interactions')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ action: 'create', module: 'crm' })
  @RateLimitPolicy('write')
  @ApiBody({ type: CreateCrmInteractionDto })
  @ApiCreatedResponse({ type: CrmInteractionResponseDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  createInteraction(
    @Body() input: CreateCrmInteractionDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<CrmInteractionResponseDto> {
    return this.timeline.createInteraction(input, key, request.authentication, metadata(request));
  }

  @Post('tasks')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ action: 'create', module: 'crm' })
  @RateLimitPolicy('write')
  @ApiBody({ type: CreateCrmTaskDto })
  @ApiCreatedResponse({ type: CrmTaskDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  createTask(
    @Body() input: CreateCrmTaskDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<CrmTaskDto> {
    return this.timeline.createTask(input, key, request.authentication, metadata(request));
  }

  @Post('tasks/:id/transition')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ action: 'edit', module: 'crm' })
  @RateLimitPolicy('write')
  @ApiBody({ type: TransitionCrmTaskDto })
  @ApiOkResponse({ type: CrmTaskDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiParam({ format: 'uuid', name: 'id' })
  transitionTask(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: TransitionCrmTaskDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<CrmTaskDto> {
    return this.timeline.transitionTask(id, input, key, request.authentication, metadata(request));
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
