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
  Put,
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
  CreateCustomerPriceGroupDto,
  CreatePriceListDto,
  CreatePosCommercialRuleDto,
  CreatePromotionalCampaignDto,
  CustomerPriceGroupDto,
  PriceListDto,
  PosCommercialRuleDto,
  PromotionalCampaignDto,
  ResolveSalesPriceQueryDto,
  SalesPricingReferenceDataDto,
  SalesResolvedPriceDto,
  UpdateCustomerPriceGroupDto,
  UpdatePriceListDto,
  UpdatePosCommercialRuleDto,
  UpdatePromotionalCampaignDto,
} from './sales-pricing.dto.js';
import { SalesPricingService } from './sales-pricing.service.js';
import {
  AcceptSalesHandoverDto,
  ConfirmSalesQuotationDto,
  CreateSalesQuotationDto,
  CreateSalesShipmentDto,
  SalesReferenceDataDto,
  SalesWorkflowDto,
} from './sales.dto.js';
import {
  CreateServiceSubscriptionDto,
  SalesSubscriptionReferenceDataDto,
  ServiceSubscriptionContractDto,
  UpdateServiceSubscriptionDto,
} from './sales-subscriptions.dto.js';
import { SalesSubscriptionsService } from './sales-subscriptions.service.js';
import { SalesService } from './sales.service.js';

@ApiTags('sales')
@ApiBearerAuth()
@RateLimitPolicy('write')
@Controller('sales')
export class SalesController {
  constructor(
    @Inject(SalesService) private readonly sales: SalesService,
    @Inject(SalesPricingService) private readonly pricing: SalesPricingService,
    @Inject(SalesSubscriptionsService) private readonly subscriptions: SalesSubscriptionsService,
  ) {}

  @Get('reference-data')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'erp.sales' })
  @ApiOkResponse({ type: SalesReferenceDataDto })
  referenceData(): Promise<SalesReferenceDataDto> {
    return this.sales.referenceData();
  }

  @Get('workflows')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'erp.sales' })
  @ApiOkResponse({ isArray: true, type: SalesWorkflowDto })
  workflows(): Promise<SalesWorkflowDto[]> {
    return this.sales.workflows();
  }

  @Get('workflows/:id')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'erp.sales' })
  @ApiOkResponse({ type: SalesWorkflowDto })
  @ApiParam({ format: 'uuid', name: 'id' })
  workflow(@Param('id') id: string): Promise<SalesWorkflowDto> {
    return this.sales.workflow(id);
  }

  @Post('quotations')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ action: 'create', module: 'erp.sales' })
  @ApiBody({ type: CreateSalesQuotationDto })
  @ApiCreatedResponse({ type: SalesWorkflowDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  createQuotation(
    @Body() input: CreateSalesQuotationDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<SalesWorkflowDto> {
    return this.sales.createQuotation(input, key, request.authentication, metadata(request));
  }

  @Post('quotations/:id/confirm')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ action: 'create', module: 'erp.sales' })
  @ApiBody({ type: ConfirmSalesQuotationDto })
  @ApiCreatedResponse({ type: SalesWorkflowDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiParam({ format: 'uuid', name: 'id' })
  confirmQuotation(
    @Param('id') id: string,
    @Body() input: ConfirmSalesQuotationDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<SalesWorkflowDto> {
    return this.sales.confirmQuotation(id, input, key, request.authentication, metadata(request));
  }

  @Post('orders/:id/shipments')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ action: 'create', module: 'erp.sales' })
  @ApiBody({ type: CreateSalesShipmentDto })
  @ApiCreatedResponse({ type: SalesWorkflowDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiParam({ format: 'uuid', name: 'id' })
  createShipment(
    @Param('id') id: string,
    @Body() input: CreateSalesShipmentDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<SalesWorkflowDto> {
    return this.sales.createShipment(id, input, key, request.authentication, metadata(request));
  }

  @Post('orders/:id/invoice-draft')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ action: 'create', module: 'erp.sales' })
  @ApiCreatedResponse({ type: SalesWorkflowDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiParam({ format: 'uuid', name: 'id' })
  createDraftInvoice(
    @Param('id') id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<SalesWorkflowDto> {
    return this.sales.createDraftInvoice(id, key, request.authentication, metadata(request));
  }

  @Post('handover-certificates/:id/accept')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ action: 'edit', module: 'erp.sales' })
  @ApiBody({ type: AcceptSalesHandoverDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ type: SalesWorkflowDto })
  @ApiParam({ format: 'uuid', name: 'id' })
  acceptHandover(
    @Param('id') id: string,
    @Body() input: AcceptSalesHandoverDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<SalesWorkflowDto> {
    return this.sales.acceptHandover(id, input, key, request.authentication, metadata(request));
  }

  @Get('subscriptions/reference-data')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'erp.sales' })
  @ApiOkResponse({ type: SalesSubscriptionReferenceDataDto })
  subscriptionReferenceData(): Promise<SalesSubscriptionReferenceDataDto> {
    return this.subscriptions.referenceData();
  }

  @Get('subscriptions')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'erp.sales' })
  @ApiOkResponse({ isArray: true, type: ServiceSubscriptionContractDto })
  subscriptionContracts(): Promise<ServiceSubscriptionContractDto[]> {
    return this.subscriptions.contracts();
  }

  @Get('subscriptions/:id')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'erp.sales' })
  @ApiOkResponse({ type: ServiceSubscriptionContractDto })
  @ApiParam({ format: 'uuid', name: 'id' })
  subscriptionContract(@Param('id') id: string): Promise<ServiceSubscriptionContractDto> {
    return this.subscriptions.contract(id);
  }

  @Post('subscriptions')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ action: 'create', module: 'erp.sales' })
  @ApiBody({ type: CreateServiceSubscriptionDto })
  @ApiCreatedResponse({ type: ServiceSubscriptionContractDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  createSubscription(
    @Body() input: CreateServiceSubscriptionDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<ServiceSubscriptionContractDto> {
    return this.subscriptions.create(input, key, request.authentication, metadata(request));
  }

  @Put('subscriptions/:id')
  @RequirePermissions({ action: 'edit', module: 'erp.sales' })
  @ApiBody({ type: UpdateServiceSubscriptionDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ type: ServiceSubscriptionContractDto })
  @ApiParam({ format: 'uuid', name: 'id' })
  updateSubscription(
    @Param('id') id: string,
    @Body() input: UpdateServiceSubscriptionDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<ServiceSubscriptionContractDto> {
    return this.subscriptions.update(id, input, key, request.authentication, metadata(request));
  }

  @Get('pricing/reference-data')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'erp.sales' })
  @ApiOkResponse({ type: SalesPricingReferenceDataDto })
  pricingReferenceData(): Promise<SalesPricingReferenceDataDto> {
    return this.pricing.referenceData();
  }

  @Get('customer-groups')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'erp.sales' })
  @ApiOkResponse({ isArray: true, type: CustomerPriceGroupDto })
  customerGroups(): Promise<CustomerPriceGroupDto[]> {
    return this.pricing.customerGroups();
  }

  @Post('customer-groups')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ action: 'create', module: 'erp.sales' })
  @ApiBody({ type: CreateCustomerPriceGroupDto })
  @ApiCreatedResponse({ type: CustomerPriceGroupDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  createCustomerGroup(
    @Body() input: CreateCustomerPriceGroupDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<CustomerPriceGroupDto> {
    return this.pricing.createCustomerGroup(input, key, request.authentication, metadata(request));
  }

  @Put('customer-groups/:id')
  @RequirePermissions({ action: 'edit', module: 'erp.sales' })
  @ApiBody({ type: UpdateCustomerPriceGroupDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ type: CustomerPriceGroupDto })
  @ApiParam({ format: 'uuid', name: 'id' })
  updateCustomerGroup(
    @Param('id') id: string,
    @Body() input: UpdateCustomerPriceGroupDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<CustomerPriceGroupDto> {
    return this.pricing.updateCustomerGroup(
      id,
      input,
      key,
      request.authentication,
      metadata(request),
    );
  }

  @Get('promotional-campaigns')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'erp.sales' })
  @ApiOkResponse({ isArray: true, type: PromotionalCampaignDto })
  promotionalCampaigns(): Promise<PromotionalCampaignDto[]> {
    return this.pricing.campaigns();
  }

  @Post('promotional-campaigns')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ action: 'create', module: 'erp.sales' })
  @ApiBody({ type: CreatePromotionalCampaignDto })
  @ApiCreatedResponse({ type: PromotionalCampaignDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  createPromotionalCampaign(
    @Body() input: CreatePromotionalCampaignDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<PromotionalCampaignDto> {
    return this.pricing.createCampaign(input, key, request.authentication, metadata(request));
  }

  @Put('promotional-campaigns/:id')
  @RequirePermissions({ action: 'edit', module: 'erp.sales' })
  @ApiBody({ type: UpdatePromotionalCampaignDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ type: PromotionalCampaignDto })
  @ApiParam({ format: 'uuid', name: 'id' })
  updatePromotionalCampaign(
    @Param('id') id: string,
    @Body() input: UpdatePromotionalCampaignDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<PromotionalCampaignDto> {
    return this.pricing.updateCampaign(id, input, key, request.authentication, metadata(request));
  }

  @Get('price-lists')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'erp.sales' })
  @ApiOkResponse({ isArray: true, type: PriceListDto })
  priceLists(): Promise<PriceListDto[]> {
    return this.pricing.priceLists();
  }

  @Post('price-lists')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ action: 'create', module: 'erp.sales' })
  @ApiBody({ type: CreatePriceListDto })
  @ApiCreatedResponse({ type: PriceListDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  createPriceList(
    @Body() input: CreatePriceListDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<PriceListDto> {
    return this.pricing.createPriceList(input, key, request.authentication, metadata(request));
  }

  @Put('price-lists/:id')
  @RequirePermissions({ action: 'edit', module: 'erp.sales' })
  @ApiBody({ type: UpdatePriceListDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ type: PriceListDto })
  @ApiParam({ format: 'uuid', name: 'id' })
  updatePriceList(
    @Param('id') id: string,
    @Body() input: UpdatePriceListDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<PriceListDto> {
    return this.pricing.updatePriceList(id, input, key, request.authentication, metadata(request));
  }

  @Get('pos-commercial-rules')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'erp.sales' })
  @ApiOkResponse({ isArray: true, type: PosCommercialRuleDto })
  posCommercialRules(): Promise<PosCommercialRuleDto[]> {
    return this.pricing.posCommercialRules();
  }

  @Post('pos-commercial-rules')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ action: 'create', module: 'erp.sales' })
  @ApiBody({ type: CreatePosCommercialRuleDto })
  @ApiCreatedResponse({ type: PosCommercialRuleDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  createPosCommercialRule(
    @Body() input: CreatePosCommercialRuleDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<PosCommercialRuleDto> {
    return this.pricing.createPosCommercialRule(
      input,
      key,
      request.authentication,
      metadata(request),
    );
  }

  @Put('pos-commercial-rules/:id')
  @RequirePermissions({ action: 'edit', module: 'erp.sales' })
  @ApiBody({ type: UpdatePosCommercialRuleDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ type: PosCommercialRuleDto })
  @ApiParam({ format: 'uuid', name: 'id' })
  updatePosCommercialRule(
    @Param('id') id: string,
    @Body() input: UpdatePosCommercialRuleDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<PosCommercialRuleDto> {
    return this.pricing.updatePosCommercialRule(
      id,
      input,
      key,
      request.authentication,
      metadata(request),
    );
  }

  @Get('prices/resolve')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'erp.sales' })
  @ApiOkResponse({ type: SalesResolvedPriceDto })
  @ApiQuery({ format: 'date', name: 'asOf', type: String })
  @ApiQuery({ format: 'uuid', name: 'customerPartnerId', type: String })
  @ApiQuery({ example: 'BGN', name: 'currencyCode', type: String })
  @ApiQuery({ format: 'uuid', name: 'productId', type: String })
  resolvePrice(@Query() query: ResolveSalesPriceQueryDto): Promise<SalesResolvedPriceDto> {
    return this.pricing.resolvePrice(
      query.customerPartnerId,
      query.productId,
      query.asOf,
      query.currencyCode,
    );
  }
}

function metadata(request: CorrelatedRequest) {
  return {
    correlationId: request.correlationId,
    ...(request.ip ? { sourceIp: request.ip } : {}),
    ...(request.headers['user-agent'] ? { userAgent: request.headers['user-agent'] } : {}),
  };
}
