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
  Put,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';

import { RequirePermissions } from '../auth/auth.decorators.js';
import type {
  AuthenticatedRequest,
  RequestSecurityMetadata,
} from '../auth/authentication.types.js';
import type { CorrelatedRequest } from '../common/correlation-id.middleware.js';
import { RateLimitPolicy } from '../security/rate-limit.decorator.js';
import {
  CreateCustomerEquipmentDto,
  CreateCustomerLocationDto,
  CustomerEquipmentDto,
  CustomerLocationDto,
  CustomerLocationProfileDto,
  CustomerAssetVersionDto,
  UpdateCustomerEquipmentDto,
  UpdateCustomerLocationDto,
} from './customer-assets.dto.js';
import { CustomerAssetsService } from './customer-assets.service.js';

@ApiTags('customer locations and equipment')
@ApiBearerAuth()
@RateLimitPolicy('write')
@Controller('master-data/partners/:partnerId/locations')
export class CustomerAssetsController {
  constructor(@Inject(CustomerAssetsService) private readonly assets: CustomerAssetsService) {}

  @Get()
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'crm' })
  @ApiOkResponse({ isArray: true, type: CustomerLocationProfileDto })
  list(
    @Param('partnerId', new ParseUUIDPipe({ version: '4' })) partnerId: string,
  ): Promise<CustomerLocationProfileDto[]> {
    return this.assets.list(partnerId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ action: 'edit', module: 'crm' })
  @ApiBody({ type: CreateCustomerLocationDto })
  @ApiCreatedResponse({ type: CustomerLocationDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  createLocation(
    @Param('partnerId', new ParseUUIDPipe({ version: '4' })) partnerId: string,
    @Body() input: CreateCustomerLocationDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<CustomerLocationDto> {
    return this.assets.createLocation(
      partnerId,
      input,
      key,
      request.authentication,
      metadata(request),
    );
  }

  @Post(':locationId/equipment')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ action: 'edit', module: 'crm' })
  @ApiBody({ type: CreateCustomerEquipmentDto })
  @ApiCreatedResponse({ type: CustomerEquipmentDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  createEquipment(
    @Param('partnerId', new ParseUUIDPipe({ version: '4' })) partnerId: string,
    @Param('locationId', new ParseUUIDPipe({ version: '4' })) locationId: string,
    @Body() input: CreateCustomerEquipmentDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<CustomerEquipmentDto> {
    return this.assets.createEquipment(
      partnerId,
      locationId,
      input,
      key,
      request.authentication,
      metadata(request),
    );
  }

  @Put(':locationId')
  @RequirePermissions({ action: 'edit', module: 'crm' })
  @ApiBody({ type: UpdateCustomerLocationDto })
  @ApiOkResponse({ type: CustomerLocationDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  updateLocation(
    @Param('partnerId', new ParseUUIDPipe({ version: '4' })) partnerId: string,
    @Param('locationId', new ParseUUIDPipe({ version: '4' })) locationId: string,
    @Body() input: UpdateCustomerLocationDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<CustomerLocationDto> {
    return this.assets.updateLocation(
      partnerId,
      locationId,
      input,
      key,
      request.authentication,
      metadata(request),
    );
  }

  @Post(':locationId/deactivate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ action: 'delete', module: 'crm' })
  @ApiBody({ type: CustomerAssetVersionDto })
  @ApiOkResponse({ type: CustomerLocationDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  deactivateLocation(
    @Param('partnerId', new ParseUUIDPipe({ version: '4' })) partnerId: string,
    @Param('locationId', new ParseUUIDPipe({ version: '4' })) locationId: string,
    @Body() input: CustomerAssetVersionDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<CustomerLocationDto> {
    return this.assets.setLocationActive(
      partnerId,
      locationId,
      false,
      input,
      key,
      request.authentication,
      metadata(request),
    );
  }

  @Post(':locationId/reactivate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ action: 'edit', module: 'crm' })
  @ApiBody({ type: CustomerAssetVersionDto })
  @ApiOkResponse({ type: CustomerLocationDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  reactivateLocation(
    @Param('partnerId', new ParseUUIDPipe({ version: '4' })) partnerId: string,
    @Param('locationId', new ParseUUIDPipe({ version: '4' })) locationId: string,
    @Body() input: CustomerAssetVersionDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<CustomerLocationDto> {
    return this.assets.setLocationActive(
      partnerId,
      locationId,
      true,
      input,
      key,
      request.authentication,
      metadata(request),
    );
  }

  @Put(':locationId/equipment/:equipmentId')
  @RequirePermissions({ action: 'edit', module: 'crm' })
  @ApiBody({ type: UpdateCustomerEquipmentDto })
  @ApiOkResponse({ type: CustomerEquipmentDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  updateEquipment(
    @Param('partnerId', new ParseUUIDPipe({ version: '4' })) partnerId: string,
    @Param('locationId', new ParseUUIDPipe({ version: '4' })) locationId: string,
    @Param('equipmentId', new ParseUUIDPipe({ version: '4' })) equipmentId: string,
    @Body() input: UpdateCustomerEquipmentDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<CustomerEquipmentDto> {
    return this.assets.updateEquipment(
      partnerId,
      locationId,
      equipmentId,
      input,
      key,
      request.authentication,
      metadata(request),
    );
  }

  @Post(':locationId/equipment/:equipmentId/deactivate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ action: 'delete', module: 'crm' })
  @ApiBody({ type: CustomerAssetVersionDto })
  @ApiOkResponse({ type: CustomerEquipmentDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  deactivateEquipment(
    @Param('partnerId', new ParseUUIDPipe({ version: '4' })) partnerId: string,
    @Param('locationId', new ParseUUIDPipe({ version: '4' })) locationId: string,
    @Param('equipmentId', new ParseUUIDPipe({ version: '4' })) equipmentId: string,
    @Body() input: CustomerAssetVersionDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<CustomerEquipmentDto> {
    return this.assets.setEquipmentActive(
      partnerId,
      locationId,
      equipmentId,
      false,
      input,
      key,
      request.authentication,
      metadata(request),
    );
  }

  @Post(':locationId/equipment/:equipmentId/reactivate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ action: 'edit', module: 'crm' })
  @ApiBody({ type: CustomerAssetVersionDto })
  @ApiOkResponse({ type: CustomerEquipmentDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  reactivateEquipment(
    @Param('partnerId', new ParseUUIDPipe({ version: '4' })) partnerId: string,
    @Param('locationId', new ParseUUIDPipe({ version: '4' })) locationId: string,
    @Param('equipmentId', new ParseUUIDPipe({ version: '4' })) equipmentId: string,
    @Body() input: CustomerAssetVersionDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<CustomerEquipmentDto> {
    return this.assets.setEquipmentActive(
      partnerId,
      locationId,
      equipmentId,
      true,
      input,
      key,
      request.authentication,
      metadata(request),
    );
  }
}

function metadata(request: AuthenticatedRequest): RequestSecurityMetadata {
  const correlated = request as CorrelatedRequest;
  const userAgent = request.header('user-agent');
  return {
    correlationId: correlated.correlationId,
    ...(request.ip ? { sourceIp: request.ip } : {}),
    ...(userAgent ? { userAgent } : {}),
  };
}
