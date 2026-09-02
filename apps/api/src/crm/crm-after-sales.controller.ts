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
import type { AuthenticatedRequest } from '../auth/authentication.types.js';
import type { CorrelatedRequest } from '../common/correlation-id.middleware.js';
import { RateLimitPolicy } from '../security/rate-limit.decorator.js';
import {
  CreateWarrantyClaimDto,
  TransitionWarrantyClaimDto,
  WarrantyClaimDto,
} from '../service/service.dto.js';
import {
  CreateCrmReferralDto,
  CrmAfterSalesOverviewDto,
  CrmCustomerSurveyDto,
  CrmReferralDto,
  CrmWarrantyCardDto,
  RecordCrmSurveyResponseDto,
  SendCrmCustomerSurveyDto,
  UpdateCrmWarrantyOfferDto,
} from './crm-after-sales.dto.js';
import { CrmAfterSalesService } from './crm-after-sales.service.js';

@ApiTags('crm after-sales')
@ApiBearerAuth()
@Controller('crm/after-sales')
export class CrmAfterSalesController {
  constructor(@Inject(CrmAfterSalesService) private readonly afterSales: CrmAfterSalesService) {}

  @Get()
  @RequirePermissions({ action: 'view', module: 'crm' })
  @RateLimitPolicy('read')
  @ApiOkResponse({ type: CrmAfterSalesOverviewDto })
  overview(@Req() request: AuthenticatedRequest): Promise<CrmAfterSalesOverviewDto> {
    return this.afterSales.overview(request.authentication);
  }

  @Post('warranty-cards/:id/offer')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ action: 'edit', module: 'crm' })
  @RateLimitPolicy('write')
  @ApiBody({ type: UpdateCrmWarrantyOfferDto })
  @ApiOkResponse({ type: CrmWarrantyCardDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiParam({ format: 'uuid', name: 'id' })
  updateWarrantyOffer(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: UpdateCrmWarrantyOfferDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<CrmWarrantyCardDto> {
    return this.afterSales.updateWarrantyOffer(
      id,
      input,
      key,
      request.authentication,
      metadata(request),
    );
  }

  @Post('warranty-claims')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ action: 'create', module: 'crm' })
  @RateLimitPolicy('write')
  @ApiBody({ type: CreateWarrantyClaimDto })
  @ApiCreatedResponse({ type: WarrantyClaimDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  createWarrantyClaim(
    @Body() input: CreateWarrantyClaimDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<WarrantyClaimDto> {
    return this.afterSales.createClaim(input, key, request.authentication, metadata(request));
  }

  @Post('warranty-claims/:id/transition')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ action: 'edit', module: 'crm' })
  @RateLimitPolicy('write')
  @ApiBody({ type: TransitionWarrantyClaimDto })
  @ApiOkResponse({ type: WarrantyClaimDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiParam({ format: 'uuid', name: 'id' })
  transitionWarrantyClaim(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: TransitionWarrantyClaimDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<WarrantyClaimDto> {
    return this.afterSales.transitionClaim(
      id,
      input,
      key,
      request.authentication,
      metadata(request),
    );
  }

  @Post('surveys')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ action: 'create', module: 'crm' })
  @RateLimitPolicy('write')
  @ApiBody({ type: SendCrmCustomerSurveyDto })
  @ApiCreatedResponse({ type: CrmCustomerSurveyDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  sendSurvey(
    @Body() input: SendCrmCustomerSurveyDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<CrmCustomerSurveyDto> {
    return this.afterSales.sendSurvey(input, key, request.authentication, metadata(request));
  }

  @Post('surveys/:id/response')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ action: 'edit', module: 'crm' })
  @RateLimitPolicy('write')
  @ApiBody({ type: RecordCrmSurveyResponseDto })
  @ApiOkResponse({ type: CrmCustomerSurveyDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiParam({ format: 'uuid', name: 'id' })
  recordSurveyResponse(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: RecordCrmSurveyResponseDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<CrmCustomerSurveyDto> {
    return this.afterSales.recordSurveyResponse(
      id,
      input,
      key,
      request.authentication,
      metadata(request),
    );
  }

  @Post('referrals')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ action: 'create', module: 'crm' })
  @RateLimitPolicy('write')
  @ApiBody({ type: CreateCrmReferralDto })
  @ApiCreatedResponse({ type: CrmReferralDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  createReferral(
    @Body() input: CreateCrmReferralDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<CrmReferralDto> {
    return this.afterSales.createReferral(input, key, request.authentication, metadata(request));
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
