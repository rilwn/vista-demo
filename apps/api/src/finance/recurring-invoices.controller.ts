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
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiHeader,
  ApiOkResponse,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermissions } from '../auth/auth.decorators.js';
import type { AuthenticatedRequest } from '../auth/authentication.types.js';
import { RateLimitPolicy } from '../security/rate-limit.decorator.js';
import {
  RecurringInvoiceContractDto,
  RecurringInvoicePageDto,
  RecurringInvoiceProcessResultDto,
  RecurringInvoiceProfileInputDto,
  RecurringInvoiceQueryDto,
} from './recurring-invoices.dto.js';
import { RecurringInvoicesService } from './recurring-invoices.service.js';

@ApiTags('finance-recurring-invoices')
@ApiBearerAuth()
@Controller('finance/recurring-invoices')
export class RecurringInvoicesController {
  constructor(
    @Inject(RecurringInvoicesService) private readonly invoices: RecurringInvoicesService,
  ) {}

  @Get()
  @RateLimitPolicy('read')
  @RequirePermissions({ module: 'erp.finance', action: 'view' })
  @ApiOkResponse({ type: RecurringInvoicePageDto })
  @ApiQuery({ name: 'page', type: Number, required: false })
  @ApiQuery({ name: 'pageSize', type: Number, required: false })
  @ApiQuery({ name: 'search', type: String, required: false })
  list(@Query() query: RecurringInvoiceQueryDto) {
    return this.invoices.list(query);
  }

  @Get(':id')
  @RateLimitPolicy('read')
  @RequirePermissions({ module: 'erp.finance', action: 'view' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: RecurringInvoiceContractDto })
  record(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.invoices.record(id);
  }

  @Put(':id')
  @RateLimitPolicy('write')
  @RequirePermissions(
    { module: 'erp.finance', action: 'create' },
    { module: 'erp.finance', action: 'edit' },
  )
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ type: RecurringInvoiceContractDto })
  @ApiBody({ type: RecurringInvoiceProfileInputDto })
  save(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: RecurringInvoiceProfileInputDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.invoices.save(id, input, key, request.authentication, {
      correlationId: request.correlationId,
    });
  }

  @Post(':id/run')
  @HttpCode(HttpStatus.OK)
  @RateLimitPolicy('write')
  @RequirePermissions(
    { module: 'erp.finance', action: 'create' },
    { module: 'erp.finance', action: 'edit' },
  )
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ type: RecurringInvoiceProcessResultDto })
  run(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.invoices.runNext(id, key, request.authentication, {
      correlationId: request.correlationId,
    });
  }
}
