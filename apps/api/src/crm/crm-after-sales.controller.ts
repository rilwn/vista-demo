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

import { Public, RequirePermissions } from '../auth/auth.decorators.js';
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
  CrmPublicSurveyDto,
  CrmWarrantyCardReconciliationResultDto,
  CrmCustomerSurveyDto,
  CrmReferralDto,
  CrmWarrantyCardDto,
  CrmWarrantyCoverageOfferDto,
  CreateCrmWarrantyCoverageOfferDto,
  RecordCrmSurveyResponseDto,
  SendCrmCustomerSurveyDto,
  TransitionCrmWarrantyCoverageOfferDto,
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

  @Post('warranty-cards/reconcile')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ action: 'edit', module: 'crm' })
  @RateLimitPolicy('write')
  @ApiOkResponse({ type: CrmWarrantyCardReconciliationResultDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  reconcileWarrantyCards(
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<CrmWarrantyCardReconciliationResultDto> {
    return this.afterSales.reconcileWarrantyCards(key, request.authentication, metadata(request));
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

  @Post('warranty-cards/:id/coverage-offers')
  @RequirePermissions({ action: 'create', module: 'crm' })
  @RateLimitPolicy('write')
  @ApiBody({ type: CreateCrmWarrantyCoverageOfferDto })
  @ApiCreatedResponse({ type: CrmWarrantyCoverageOfferDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiParam({ format: 'uuid', name: 'id' })
  createWarrantyCoverageOffer(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: CreateCrmWarrantyCoverageOfferDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<CrmWarrantyCoverageOfferDto> {
    return this.afterSales.createWarrantyCoverageOffer(
      id,
      input,
      key,
      request.authentication,
      metadata(request),
    );
  }

  @Post('coverage-offers/:id/status')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ action: 'edit', module: 'crm' })
  @RateLimitPolicy('write')
  @ApiBody({ type: TransitionCrmWarrantyCoverageOfferDto })
  @ApiOkResponse({ type: CrmWarrantyCoverageOfferDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiParam({ format: 'uuid', name: 'id' })
  transitionWarrantyCoverageOffer(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: TransitionCrmWarrantyCoverageOfferDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<CrmWarrantyCoverageOfferDto> {
    return this.afterSales.transitionWarrantyCoverageOffer(
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

function metadata(request: CorrelatedRequest) {
  const userAgent = request.header('user-agent');
  return {
    correlationId: request.correlationId,
    ...(request.ip ? { sourceIp: request.ip } : {}),
    ...(userAgent ? { userAgent } : {}),
  };
}

@ApiTags('crm public surveys')
@Controller('crm/public-surveys')
export class CrmPublicSurveyController {
  constructor(@Inject(CrmAfterSalesService) private readonly afterSales: CrmAfterSalesService) {}

  @Get(':token')
  @Public()
  @RateLimitPolicy('public')
  @ApiOkResponse({ type: CrmPublicSurveyDto })
  @ApiParam({ name: 'token', type: String })
  getSurvey(@Param('token') token: string): Promise<CrmPublicSurveyDto> {
    return this.afterSales.publicSurvey(token);
  }

  @Post(':token/response')
  @Public()
  @RateLimitPolicy('public')
  @HttpCode(HttpStatus.OK)
  @ApiBody({ type: RecordCrmSurveyResponseDto })
  @ApiOkResponse({ type: CrmPublicSurveyDto })
  @ApiParam({ name: 'token', type: String })
  submitResponse(
    @Param('token') token: string,
    @Body() input: RecordCrmSurveyResponseDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<CrmPublicSurveyDto> {
    return this.afterSales.submitPublicSurvey(token, input, metadata(request));
  }
}
