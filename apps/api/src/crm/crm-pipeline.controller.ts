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
  ConvertCrmLeadDto,
  ConvertCrmLeadResultDto,
  CreateCrmLeadDto,
  CreateCrmOpportunityDto,
  CrmLeadDto,
  CrmLeadPageDto,
  CrmOpportunityDto,
  CrmOpportunityPageDto,
  CrmPipelineReferenceDataDto,
  LinkCrmOpportunityQuotationDto,
  ListCrmLeadsQueryDto,
  ListCrmOpportunitiesQueryDto,
  MoveCrmOpportunityDto,
  QualifyCrmLeadDto,
} from './crm-pipeline.dto.js';
import { CrmPipelineService } from './crm-pipeline.service.js';

@ApiTags('crm pipeline')
@ApiBearerAuth()
@Controller('crm')
export class CrmPipelineController {
  constructor(@Inject(CrmPipelineService) private readonly pipeline: CrmPipelineService) {}

  @Get('pipeline/reference-data')
  @RequirePermissions({ action: 'view', module: 'crm' })
  @RateLimitPolicy('read')
  @ApiOkResponse({ type: CrmPipelineReferenceDataDto })
  referenceData(): Promise<CrmPipelineReferenceDataDto> {
    return this.pipeline.referenceData();
  }

  @Get('leads')
  @RequirePermissions({ action: 'view', module: 'crm' })
  @RateLimitPolicy('read')
  @ApiOkResponse({ type: CrmLeadPageDto })
  leads(@Query() query: ListCrmLeadsQueryDto): Promise<CrmLeadPageDto> {
    return this.pipeline.listLeads(query);
  }

  @Post('leads')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ action: 'create', module: 'crm' })
  @RateLimitPolicy('write')
  @ApiBody({ type: CreateCrmLeadDto })
  @ApiCreatedResponse({ type: CrmLeadDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  createLead(
    @Body() input: CreateCrmLeadDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<CrmLeadDto> {
    return this.pipeline.createLead(input, key, request.authentication, metadata(request));
  }

  @Post('leads/:id/qualify')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ action: 'edit', module: 'crm' })
  @RateLimitPolicy('write')
  @ApiBody({ type: QualifyCrmLeadDto })
  @ApiOkResponse({ type: CrmLeadDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiParam({ format: 'uuid', name: 'id' })
  qualifyLead(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: QualifyCrmLeadDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<CrmLeadDto> {
    return this.pipeline.qualifyLead(id, input, key, request.authentication, metadata(request));
  }

  @Post('leads/:id/convert')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ action: 'edit', module: 'crm' })
  @RateLimitPolicy('write')
  @ApiBody({ type: ConvertCrmLeadDto })
  @ApiOkResponse({ type: ConvertCrmLeadResultDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiParam({ format: 'uuid', name: 'id' })
  convertLead(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: ConvertCrmLeadDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<ConvertCrmLeadResultDto> {
    return this.pipeline.convertLead(id, input, key, request.authentication, metadata(request));
  }

  @Get('opportunities')
  @RequirePermissions({ action: 'view', module: 'crm' })
  @RateLimitPolicy('read')
  @ApiOkResponse({ type: CrmOpportunityPageDto })
  opportunities(@Query() query: ListCrmOpportunitiesQueryDto): Promise<CrmOpportunityPageDto> {
    return this.pipeline.listOpportunities(query);
  }

  @Get('opportunities/:id')
  @RequirePermissions({ action: 'view', module: 'crm' })
  @RateLimitPolicy('read')
  @ApiOkResponse({ type: CrmOpportunityDto })
  @ApiParam({ format: 'uuid', name: 'id' })
  opportunity(@Param('id', new ParseUUIDPipe()) id: string): Promise<CrmOpportunityDto> {
    return this.pipeline.getOpportunity(id);
  }

  @Post('opportunities')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ action: 'create', module: 'crm' })
  @RateLimitPolicy('write')
  @ApiBody({ type: CreateCrmOpportunityDto })
  @ApiCreatedResponse({ type: CrmOpportunityDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  createOpportunity(
    @Body() input: CreateCrmOpportunityDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<CrmOpportunityDto> {
    return this.pipeline.createOpportunity(input, key, request.authentication, metadata(request));
  }

  @Post('opportunities/:id/stage')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ action: 'edit', module: 'crm' })
  @RateLimitPolicy('write')
  @ApiBody({ type: MoveCrmOpportunityDto })
  @ApiOkResponse({ type: CrmOpportunityDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiParam({ format: 'uuid', name: 'id' })
  moveOpportunity(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: MoveCrmOpportunityDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<CrmOpportunityDto> {
    return this.pipeline.moveOpportunity(id, input, key, request.authentication, metadata(request));
  }

  @Post('opportunities/:id/quotations')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ action: 'edit', module: 'crm' })
  @RateLimitPolicy('write')
  @ApiBody({ type: LinkCrmOpportunityQuotationDto })
  @ApiOkResponse({ type: CrmOpportunityDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiParam({ format: 'uuid', name: 'id' })
  linkQuotation(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: LinkCrmOpportunityQuotationDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<CrmOpportunityDto> {
    return this.pipeline.linkQuotation(id, input, key, request.authentication, metadata(request));
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
