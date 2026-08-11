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
  CreatePurchaseOrderDto,
  CreateSupplierClaimDto,
  CreateSupplierEvaluationDto,
  CreateSupplierInvoiceDto,
  GoodsReceiptDto,
  ListPurchaseOrdersQueryDto,
  PurchaseOrderDto,
  PurchaseOrderPageDto,
  ProcurementReferenceDataDto,
  ProcurementSupplierRecordDto,
  ReceivePurchaseOrderDto,
  SupplierClaimDto,
  SupplierCommercialProfileDto,
  SupplierEvaluationDto,
  SupplierInvoiceDto,
  UpdateSupplierClaimStatusDto,
  UpdateSupplierCommercialProfileDto,
} from './procurement.dto.js';
import { ProcurementService } from './procurement.service.js';
import { SupplierProcurementService } from './supplier-procurement.service.js';

@ApiTags('procurement')
@ApiBearerAuth()
@RateLimitPolicy('write')
@Controller('procurement')
export class ProcurementController {
  constructor(
    @Inject(ProcurementService) private readonly procurement: ProcurementService,
    @Inject(SupplierProcurementService)
    private readonly supplierProcurement: SupplierProcurementService,
  ) {}

  @Get('reference-data')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'erp.procurement' })
  @ApiOkResponse({ type: ProcurementReferenceDataDto })
  referenceData(): Promise<ProcurementReferenceDataDto> {
    return this.procurement.referenceData();
  }

  @Get('purchase-orders')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'erp.procurement' })
  @ApiOkResponse({ type: PurchaseOrderPageDto })
  @ApiQuery({ minimum: 1, name: 'page', required: false, type: Number })
  @ApiQuery({ maximum: 100, minimum: 1, name: 'pageSize', required: false, type: Number })
  @ApiQuery({ enum: ['open', 'partially_received', 'received'], name: 'status', required: false })
  @ApiQuery({ format: 'uuid', name: 'supplierPartnerId', required: false, type: String })
  purchaseOrders(@Query() query: ListPurchaseOrdersQueryDto): Promise<PurchaseOrderPageDto> {
    return this.procurement.purchaseOrders(query);
  }

  @Get('purchase-orders/:id')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'erp.procurement' })
  @ApiOkResponse({ type: PurchaseOrderDto })
  @ApiParam({ format: 'uuid', name: 'id' })
  purchaseOrder(@Param('id') id: string): Promise<PurchaseOrderDto> {
    return this.procurement.purchaseOrder(id);
  }

  @Post('purchase-orders')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ action: 'create', module: 'erp.procurement' })
  @ApiBody({ type: CreatePurchaseOrderDto })
  @ApiCreatedResponse({ type: PurchaseOrderDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  createPurchaseOrder(
    @Body() input: CreatePurchaseOrderDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<PurchaseOrderDto> {
    return this.procurement.createPurchaseOrder(
      input,
      key,
      request.authentication,
      metadata(request),
    );
  }

  @Post('purchase-orders/:id/receipts')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ action: 'create', module: 'erp.procurement' })
  @ApiBody({ type: ReceivePurchaseOrderDto })
  @ApiCreatedResponse({ type: GoodsReceiptDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiParam({ format: 'uuid', name: 'id' })
  receivePurchaseOrder(
    @Body() input: ReceivePurchaseOrderDto,
    @Headers('idempotency-key') key: string | undefined,
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<GoodsReceiptDto> {
    return this.procurement.receivePurchaseOrder(
      id,
      input,
      key,
      request.authentication,
      metadata(request),
    );
  }

  @Get('suppliers')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'erp.procurement' })
  @ApiOkResponse({ isArray: true, type: ProcurementSupplierRecordDto })
  suppliers(): Promise<ProcurementSupplierRecordDto[]> {
    return this.supplierProcurement.suppliers();
  }

  @Get('suppliers/:id')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'erp.procurement' })
  @ApiOkResponse({ type: ProcurementSupplierRecordDto })
  @ApiParam({ format: 'uuid', name: 'id' })
  supplier(@Param('id') id: string): Promise<ProcurementSupplierRecordDto> {
    return this.supplierProcurement.supplier(id);
  }

  @Put('suppliers/:id/commercial-profile')
  @RequirePermissions({ action: 'edit', module: 'erp.procurement' })
  @ApiBody({ type: UpdateSupplierCommercialProfileDto })
  @ApiOkResponse({ type: SupplierCommercialProfileDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiParam({ format: 'uuid', name: 'id' })
  updateSupplierProfile(
    @Body() input: UpdateSupplierCommercialProfileDto,
    @Headers('idempotency-key') key: string | undefined,
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<SupplierCommercialProfileDto> {
    return this.supplierProcurement.updateProfile(
      id,
      input,
      key,
      request.authentication,
      metadata(request),
    );
  }

  @Post('suppliers/:id/evaluations')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ action: 'edit', module: 'erp.procurement' })
  @ApiBody({ type: CreateSupplierEvaluationDto })
  @ApiCreatedResponse({ type: SupplierEvaluationDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiParam({ format: 'uuid', name: 'id' })
  evaluateSupplier(
    @Body() input: CreateSupplierEvaluationDto,
    @Headers('idempotency-key') key: string | undefined,
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<SupplierEvaluationDto> {
    return this.supplierProcurement.createEvaluation(
      id,
      input,
      key,
      request.authentication,
      metadata(request),
    );
  }

  @Get('supplier-invoices')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'erp.procurement' })
  @ApiOkResponse({ isArray: true, type: SupplierInvoiceDto })
  supplierInvoices(): Promise<SupplierInvoiceDto[]> {
    return this.supplierProcurement.invoices();
  }

  @Post('supplier-invoices')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ action: 'create', module: 'erp.procurement' })
  @ApiBody({ type: CreateSupplierInvoiceDto })
  @ApiCreatedResponse({ type: SupplierInvoiceDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  createSupplierInvoice(
    @Body() input: CreateSupplierInvoiceDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<SupplierInvoiceDto> {
    return this.supplierProcurement.createInvoice(
      input,
      key,
      request.authentication,
      metadata(request),
    );
  }

  @Get('supplier-claims')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'erp.procurement' })
  @ApiOkResponse({ isArray: true, type: SupplierClaimDto })
  supplierClaims(): Promise<SupplierClaimDto[]> {
    return this.supplierProcurement.claims();
  }

  @Post('supplier-claims')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ action: 'create', module: 'erp.procurement' })
  @ApiBody({ type: CreateSupplierClaimDto })
  @ApiCreatedResponse({ type: SupplierClaimDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  createSupplierClaim(
    @Body() input: CreateSupplierClaimDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<SupplierClaimDto> {
    return this.supplierProcurement.createClaim(
      input,
      key,
      request.authentication,
      metadata(request),
    );
  }

  @Post('supplier-claims/:id/status')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ action: 'edit', module: 'erp.procurement' })
  @ApiBody({ type: UpdateSupplierClaimStatusDto })
  @ApiOkResponse({ type: SupplierClaimDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiParam({ format: 'uuid', name: 'id' })
  updateSupplierClaimStatus(
    @Body() input: UpdateSupplierClaimStatusDto,
    @Headers('idempotency-key') key: string | undefined,
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<SupplierClaimDto> {
    return this.supplierProcurement.updateClaimStatus(
      id,
      input,
      key,
      request.authentication,
      metadata(request),
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
