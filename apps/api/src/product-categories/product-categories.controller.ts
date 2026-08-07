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
  ApiConflictResponse,
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
import { CreateProductCategoryDto, ProductCategoryDto } from './product-categories.dto.js';
import { ProductCategoriesService } from './product-categories.service.js';

@ApiTags('product category master data')
@ApiBearerAuth()
@Controller('master-data/product-categories')
export class ProductCategoriesController {
  constructor(
    @Inject(ProductCategoriesService) private readonly categories: ProductCategoriesService,
  ) {}

  @Get()
  @RequirePermissions({ action: 'view', module: 'erp.warehouse' })
  @ApiOkResponse({ isArray: true, type: ProductCategoryDto })
  list(): Promise<ProductCategoryDto[]> {
    return this.categories.list();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ action: 'create', module: 'erp.warehouse' })
  @ApiBody({ type: CreateProductCategoryDto })
  @ApiCreatedResponse({ type: ProductCategoryDto })
  @ApiConflictResponse({
    description: 'A category with this name already exists under its parent.',
  })
  @ApiHeader({
    description: 'Stable 8-128 character retry key. Replays return the original result.',
    name: 'Idempotency-Key',
    required: true,
  })
  create(
    @Body() input: CreateProductCategoryDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<ProductCategoryDto> {
    return this.categories.create(
      input,
      idempotencyKey,
      request.authentication,
      requestMetadata(request),
    );
  }
}

function requestMetadata(request: AuthenticatedRequest): RequestSecurityMetadata {
  const correlated = request as CorrelatedRequest;
  const userAgent = request.header('user-agent');
  return {
    correlationId: correlated.correlationId,
    ...(request.ip ? { sourceIp: request.ip } : {}),
    ...(userAgent ? { userAgent } : {}),
  };
}
