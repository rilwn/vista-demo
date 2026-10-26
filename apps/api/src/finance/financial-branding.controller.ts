import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  ParseUUIDPipe,
  Put,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiHeader,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermissions } from '../auth/auth.decorators.js';
import type { AuthenticatedRequest } from '../auth/authentication.types.js';
import { RateLimitPolicy } from '../security/rate-limit.decorator.js';
import {
  FinancialBrandingSettingsDto,
  SaveFinancialBrandingDto,
} from './financial-branding.dto.js';
import { FinancialBrandingService } from './financial-branding.service.js';

@ApiTags('finance-document-branding')
@ApiBearerAuth()
@Controller('finance/document-branding')
export class FinancialBrandingController {
  constructor(
    @Inject(FinancialBrandingService) private readonly branding: FinancialBrandingService,
  ) {}
  @Get(':id')
  @RateLimitPolicy('read')
  @RequirePermissions({ module: 'erp.finance', action: 'view' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: FinancialBrandingSettingsDto })
  get(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.branding.settings(id);
  }
  @Put(':id')
  @RateLimitPolicy('write')
  @RequirePermissions(
    { module: 'erp.finance', action: 'view' },
    { module: 'erp.finance', action: 'edit' },
  )
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiBody({ type: SaveFinancialBrandingDto })
  @ApiOkResponse({ type: FinancialBrandingSettingsDto })
  save(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: SaveFinancialBrandingDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.branding.save(id, input, key, request.authentication, {
      correlationId: request.correlationId,
    });
  }
}
