import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
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
import { CreateProductDto, CreateUnitDto, ProductSummaryDto, UnitDto } from './catalog.dto.js';
import { CatalogService } from './catalog.service.js';

@ApiTags('catalog master data')
@ApiBearerAuth()
@RateLimitPolicy('write')
@Controller('master-data/catalog')
export class CatalogController {
  constructor(@Inject(CatalogService) private readonly catalog: CatalogService) {}
  @Get('units')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'erp.warehouse' })
  @ApiOkResponse({ isArray: true, type: UnitDto })
  units(): Promise<UnitDto[]> {
    return this.catalog.units();
  }
  @Post('units')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ action: 'create', module: 'erp.warehouse' })
  @ApiBody({ type: CreateUnitDto })
  @ApiCreatedResponse({ type: UnitDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  createUnit(
    @Body() input: CreateUnitDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<UnitDto> {
    return this.catalog.createUnit(input, key, request.authentication, metadata(request));
  }
  @Get('products')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'erp.warehouse' })
  @ApiOkResponse({ isArray: true, type: ProductSummaryDto })
  products(): Promise<ProductSummaryDto[]> {
    return this.catalog.products();
  }
  @Post('products')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ action: 'create', module: 'erp.warehouse' })
  @ApiBody({ type: CreateProductDto })
  @ApiCreatedResponse({ type: ProductSummaryDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  createProduct(
    @Body() input: CreateProductDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<ProductSummaryDto> {
    return this.catalog.createProduct(input, key, request.authentication, metadata(request));
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
