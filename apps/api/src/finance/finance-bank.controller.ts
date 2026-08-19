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
  ApiTags,
} from '@nestjs/swagger';

import { RequirePermissions } from '../auth/auth.decorators.js';
import type { AuthenticatedRequest } from '../auth/authentication.types.js';
import type { CorrelatedRequest } from '../common/correlation-id.middleware.js';
import { RateLimitPolicy } from '../security/rate-limit.decorator.js';
import {
  CreateFinanceBankStatementDto,
  FinanceBankMatchCandidateDto,
  FinanceBankStatementDto,
  FinanceBankStatementListQueryDto,
  FinanceBankStatementPageDto,
  MatchFinanceBankTransactionDto,
} from './finance-bank.dto.js';
import { FinanceBankService } from './finance-bank.service.js';

@ApiTags('finance-bank')
@ApiBearerAuth()
@RateLimitPolicy('write')
@Controller('finance')
export class FinanceBankController {
  constructor(@Inject(FinanceBankService) private readonly bank: FinanceBankService) {}

  @Get('bank-statements')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'erp.finance' })
  @ApiOkResponse({ type: FinanceBankStatementPageDto })
  statements(
    @Query() query: FinanceBankStatementListQueryDto,
  ): Promise<FinanceBankStatementPageDto> {
    return this.bank.statements(query);
  }

  @Get('bank-statements/:id')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'erp.finance' })
  @ApiOkResponse({ type: FinanceBankStatementDto })
  @ApiParam({ format: 'uuid', name: 'id' })
  statement(@Param('id') id: string): Promise<FinanceBankStatementDto> {
    return this.bank.statement(id);
  }

  @Post('bank-statements')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ action: 'create', module: 'erp.finance' })
  @ApiBody({ type: CreateFinanceBankStatementDto })
  @ApiCreatedResponse({ type: FinanceBankStatementDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  create(
    @Body() input: CreateFinanceBankStatementDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<FinanceBankStatementDto> {
    return this.bank.createStatement(input, key, request.authentication, metadata(request));
  }

  @Get('bank-transactions/:id/match-candidates')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'erp.finance' })
  @ApiOkResponse({ isArray: true, type: FinanceBankMatchCandidateDto })
  @ApiParam({ format: 'uuid', name: 'id' })
  candidates(@Param('id') id: string): Promise<FinanceBankMatchCandidateDto[]> {
    return this.bank.matchCandidates(id);
  }

  @Post('bank-transactions/:id/match')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ action: 'edit', module: 'erp.finance' })
  @ApiBody({ type: MatchFinanceBankTransactionDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ type: FinanceBankStatementDto })
  @ApiParam({ format: 'uuid', name: 'id' })
  match(
    @Param('id') id: string,
    @Body() input: MatchFinanceBankTransactionDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<FinanceBankStatementDto> {
    return this.bank.matchTransaction(id, input, key, request.authentication, metadata(request));
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
