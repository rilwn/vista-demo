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
  CompleteLogisticsDeliveryDto,
  CreateLogisticsDeliveryDto,
  CreateLogisticsReturnDto,
  CreateLogisticsRouteDto,
  ListLogisticsDeliveriesQueryDto,
  ListLogisticsReturnsQueryDto,
  ListLogisticsRoutesQueryDto,
  LogisticsDeliveryDto,
  LogisticsDeliveryPageDto,
  LogisticsReferenceDataDto,
  LogisticsReturnDto,
  LogisticsReturnPageDto,
  LogisticsRoutePlanDto,
  LogisticsRoutePlanPageDto,
  ReceiveLogisticsReturnDto,
  ReportLogisticsDeliveryExceptionDto,
  UpdateLogisticsDeliveryStatusDto,
} from './logistics.dto.js';
import { LogisticsService } from './logistics.service.js';

@ApiTags('logistics')
@ApiBearerAuth()
@RateLimitPolicy('write')
@Controller('logistics')
export class LogisticsController {
  constructor(@Inject(LogisticsService) private readonly logistics: LogisticsService) {}

  @Get('reference-data')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'erp.logistics' })
  @ApiOkResponse({ type: LogisticsReferenceDataDto })
  referenceData(): Promise<LogisticsReferenceDataDto> {
    return this.logistics.referenceData();
  }

  @Get('deliveries')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'erp.logistics' })
  @ApiOkResponse({ type: LogisticsDeliveryPageDto })
  @ApiQuery({ minimum: 1, name: 'page', required: false, type: Number })
  @ApiQuery({ maximum: 100, minimum: 1, name: 'pageSize', required: false, type: Number })
  @ApiQuery({
    enum: ['planned', 'in_transit', 'delivered', 'exception', 'cancelled'],
    name: 'status',
    required: false,
  })
  deliveries(@Query() query: ListLogisticsDeliveriesQueryDto): Promise<LogisticsDeliveryPageDto> {
    return this.logistics.deliveries(query);
  }

  @Get('deliveries/:id')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'erp.logistics' })
  @ApiOkResponse({ type: LogisticsDeliveryDto })
  @ApiParam({ format: 'uuid', name: 'id' })
  delivery(@Param('id') id: string): Promise<LogisticsDeliveryDto> {
    return this.logistics.delivery(id);
  }

  @Post('deliveries')
  @RequirePermissions({ action: 'create', module: 'erp.logistics' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiBody({ type: CreateLogisticsDeliveryDto })
  @ApiCreatedResponse({ type: LogisticsDeliveryDto })
  createDelivery(
    @Body() input: CreateLogisticsDeliveryDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest & CorrelatedRequest,
  ): Promise<LogisticsDeliveryDto> {
    return this.logistics.createDelivery(input, key, request.authentication, metadata(request));
  }

  @Post('deliveries/:id/dispatch')
  @RequirePermissions({ action: 'edit', module: 'erp.logistics' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiBody({ type: UpdateLogisticsDeliveryStatusDto })
  @ApiCreatedResponse({ type: LogisticsDeliveryDto })
  @ApiParam({ format: 'uuid', name: 'id' })
  dispatchDelivery(
    @Param('id') id: string,
    @Body() input: UpdateLogisticsDeliveryStatusDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest & CorrelatedRequest,
  ): Promise<LogisticsDeliveryDto> {
    return this.logistics.dispatchDelivery(
      id,
      input,
      key,
      request.authentication,
      metadata(request),
    );
  }

  @Post('deliveries/:id/complete')
  @RequirePermissions({ action: 'edit', module: 'erp.logistics' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiBody({ type: CompleteLogisticsDeliveryDto })
  @ApiCreatedResponse({ type: LogisticsDeliveryDto })
  @ApiParam({ format: 'uuid', name: 'id' })
  completeDelivery(
    @Param('id') id: string,
    @Body() input: CompleteLogisticsDeliveryDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest & CorrelatedRequest,
  ): Promise<LogisticsDeliveryDto> {
    return this.logistics.completeDelivery(
      id,
      input,
      key,
      request.authentication,
      metadata(request),
    );
  }

  @Post('deliveries/:id/exception')
  @RequirePermissions({ action: 'edit', module: 'erp.logistics' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiBody({ type: ReportLogisticsDeliveryExceptionDto })
  @ApiCreatedResponse({ type: LogisticsDeliveryDto })
  @ApiParam({ format: 'uuid', name: 'id' })
  reportDeliveryException(
    @Param('id') id: string,
    @Body() input: ReportLogisticsDeliveryExceptionDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest & CorrelatedRequest,
  ): Promise<LogisticsDeliveryDto> {
    return this.logistics.reportDeliveryException(
      id,
      input,
      key,
      request.authentication,
      metadata(request),
    );
  }

  @Post('deliveries/:id/cancel')
  @RequirePermissions({ action: 'edit', module: 'erp.logistics' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiBody({ type: UpdateLogisticsDeliveryStatusDto })
  @ApiCreatedResponse({ type: LogisticsDeliveryDto })
  @ApiParam({ format: 'uuid', name: 'id' })
  cancelDelivery(
    @Param('id') id: string,
    @Body() input: UpdateLogisticsDeliveryStatusDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest & CorrelatedRequest,
  ): Promise<LogisticsDeliveryDto> {
    return this.logistics.cancelDelivery(id, input, key, request.authentication, metadata(request));
  }

  @Get('returns')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'erp.logistics' })
  @ApiOkResponse({ type: LogisticsReturnPageDto })
  @ApiQuery({ minimum: 1, name: 'page', required: false, type: Number })
  @ApiQuery({ maximum: 100, minimum: 1, name: 'pageSize', required: false, type: Number })
  @ApiQuery({ enum: ['registered', 'received', 'cancelled'], name: 'status', required: false })
  returns(@Query() query: ListLogisticsReturnsQueryDto): Promise<LogisticsReturnPageDto> {
    return this.logistics.returns(query);
  }

  @Get('returns/:id')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'erp.logistics' })
  @ApiOkResponse({ type: LogisticsReturnDto })
  @ApiParam({ format: 'uuid', name: 'id' })
  returnRecord(@Param('id') id: string): Promise<LogisticsReturnDto> {
    return this.logistics.returnRecord(id);
  }

  @Post('returns')
  @RequirePermissions({ action: 'create', module: 'erp.logistics' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiBody({ type: CreateLogisticsReturnDto })
  @ApiCreatedResponse({ type: LogisticsReturnDto })
  createReturn(
    @Body() input: CreateLogisticsReturnDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest & CorrelatedRequest,
  ): Promise<LogisticsReturnDto> {
    return this.logistics.createReturn(input, key, request.authentication, metadata(request));
  }

  @Post('returns/:id/receive')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ action: 'edit', module: 'erp.logistics' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiBody({ type: ReceiveLogisticsReturnDto })
  @ApiCreatedResponse({ type: LogisticsReturnDto })
  @ApiParam({ format: 'uuid', name: 'id' })
  receiveReturn(
    @Param('id') id: string,
    @Body() input: ReceiveLogisticsReturnDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest & CorrelatedRequest,
  ): Promise<LogisticsReturnDto> {
    return this.logistics.receiveReturn(id, input, key, request.authentication, metadata(request));
  }

  @Get('routes')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'erp.logistics' })
  @ApiOkResponse({ type: LogisticsRoutePlanPageDto })
  @ApiQuery({ format: 'date', name: 'dateFrom', type: String })
  @ApiQuery({ format: 'date', name: 'dateTo', type: String })
  @ApiQuery({ minimum: 1, name: 'page', required: false, type: Number })
  @ApiQuery({ maximum: 100, minimum: 1, name: 'pageSize', required: false, type: Number })
  routes(@Query() query: ListLogisticsRoutesQueryDto): Promise<LogisticsRoutePlanPageDto> {
    return this.logistics.routes(query);
  }

  @Get('routes/:id')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'erp.logistics' })
  @ApiOkResponse({ type: LogisticsRoutePlanDto })
  @ApiParam({ format: 'uuid', name: 'id' })
  route(@Param('id') id: string): Promise<LogisticsRoutePlanDto> {
    return this.logistics.route(id);
  }

  @Post('routes')
  @RequirePermissions({ action: 'create', module: 'erp.logistics' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiBody({ type: CreateLogisticsRouteDto })
  @ApiCreatedResponse({ type: LogisticsRoutePlanDto })
  createRoute(
    @Body() input: CreateLogisticsRouteDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest & CorrelatedRequest,
  ): Promise<LogisticsRoutePlanDto> {
    return this.logistics.createRoute(input, key, request.authentication, metadata(request));
  }
}

function metadata(request: AuthenticatedRequest & CorrelatedRequest) {
  const userAgent = request.get('user-agent');
  return {
    correlationId: request.correlationId,
    ...(request.ip ? { sourceIp: request.ip } : {}),
    ...(userAgent ? { userAgent } : {}),
  };
}
