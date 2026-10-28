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
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiParam,
  ApiProduces,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { pipeline } from 'node:stream/promises';

import { RequirePermissions } from '../auth/auth.decorators.js';
import type { AuthenticatedRequest } from '../auth/authentication.types.js';
import { RateLimitPolicy } from '../security/rate-limit.decorator.js';
import { BackupMfaGuard } from './backup-mfa.guard.js';
import {
  ActivateBackupPolicyDto,
  BackupPageQueryDto,
  BackupDrTestDto,
  BackupDrTestPageDto,
  BackupPlanReviewDto,
  BackupPlanReviewPageDto,
  BackupExecutionRunPageDto,
  BackupArtifactDeletionRequestDto,
  BackupArtifactDeletionRequestPageDto,
  BackupFileRestoreOptionsDto,
  BackupFileRestoreOptionsQueryDto,
  BackupRestoreRequestDto,
  BackupRestoreRequestPageDto,
  BackupPolicyApprovalPageDto,
  BackupPolicyDto,
  BackupPolicyPageDto,
  BackupProtectedSourceDto,
  BackupProtectedSourcePageDto,
  BackupReferenceDataDto,
  DecideBackupPolicyApprovalDto,
  DecideBackupArtifactDeletionDto,
  DecideBackupRestoreApprovalDto,
  CreateBackupPolicyDto,
  CreateBackupProtectedSourceDto,
  PlanBackupDrTestDto,
  RecordBackupDrTestDto,
  RecordBackupPlanReviewDto,
  RequestBackupPolicyApprovalDto,
  RequestBackupRetentionReductionDto,
  RequestBackupArtifactDeletionDto,
  RequestBackupRestoreDto,
  UpdateBackupPolicyDto,
  UpdateBackupProtectedSourceDto,
} from './backup.dto.js';
import { BackupService } from './backup.service.js';
import { BackupDatabaseRecoveryService } from './backup-database-recovery.service.js';
import {
  BackupDatabaseRecordRecoveryDto,
  BackupDatabaseRecordRecoveryRequestDto,
  BackupDatabaseRecoveryTablePageDto,
} from './backup-database-recovery.dto.js';

@ApiTags('backup and recovery')
@ApiBearerAuth()
@RateLimitPolicy('write')
@UseGuards(BackupMfaGuard)
@Controller('backup')
export class BackupController {
  constructor(
    @Inject(BackupService) private readonly backup: BackupService,
    @Inject(BackupDatabaseRecoveryService)
    private readonly databaseRecovery: BackupDatabaseRecoveryService,
  ) {}

  @Get('reference-data')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'backup' })
  @ApiOkResponse({ type: BackupReferenceDataDto })
  referenceData(): Promise<BackupReferenceDataDto> {
    return this.backup.referenceData();
  }

  @Get('dr-tests')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'backup' })
  @ApiOkResponse({ type: BackupDrTestPageDto })
  drTests(): Promise<BackupDrTestPageDto> {
    return this.backup.drTests();
  }

  @Get('plan-reviews')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'backup' })
  @ApiOkResponse({ type: BackupPlanReviewPageDto })
  planReviews(): Promise<BackupPlanReviewPageDto> {
    return this.backup.planReviews();
  }

  @Post('plan-reviews')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ action: 'approve', module: 'backup' })
  @ApiBody({ type: RecordBackupPlanReviewDto })
  @ApiCreatedResponse({ type: BackupPlanReviewDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  recordPlanReview(
    @Body() input: RecordBackupPlanReviewDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<BackupPlanReviewDto> {
    return this.backup.recordPlanReview(
      input,
      idempotencyKey,
      request.authentication,
      metadata(request),
    );
  }

  @Post('dr-tests')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ action: 'create', module: 'backup' })
  @ApiBody({ type: PlanBackupDrTestDto })
  @ApiCreatedResponse({ type: BackupDrTestDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  planDrTest(
    @Body() input: PlanBackupDrTestDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<BackupDrTestDto> {
    return this.backup.planDrTest(input, idempotencyKey, request.authentication, metadata(request));
  }

  @Post('dr-tests/:id/result')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ action: 'create', module: 'backup' })
  @ApiBody({ type: RecordBackupDrTestDto })
  @ApiOkResponse({ type: BackupDrTestDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiParam({ format: 'uuid', name: 'id' })
  recordDrTestResult(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: RecordBackupDrTestDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<BackupDrTestDto> {
    return this.backup.recordDrTest(
      id,
      input,
      idempotencyKey,
      request.authentication,
      metadata(request),
    );
  }

  @Get('sources')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'backup' })
  @ApiOkResponse({ type: BackupProtectedSourcePageDto })
  sources(@Query() query: BackupPageQueryDto): Promise<BackupProtectedSourcePageDto> {
    return this.backup.sources(query);
  }

  @Post('sources')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ action: 'create', module: 'backup' })
  @ApiBody({ type: CreateBackupProtectedSourceDto })
  @ApiCreatedResponse({ type: BackupProtectedSourceDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  createSource(
    @Body() input: CreateBackupProtectedSourceDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<BackupProtectedSourceDto> {
    return this.backup.createSource(
      input,
      idempotencyKey,
      request.authentication,
      metadata(request),
    );
  }

  @Put('sources/:id')
  @RequirePermissions({ action: 'edit', module: 'backup' })
  @ApiBody({ type: UpdateBackupProtectedSourceDto })
  @ApiOkResponse({ type: BackupProtectedSourceDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiParam({ format: 'uuid', name: 'id' })
  updateSource(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: UpdateBackupProtectedSourceDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<BackupProtectedSourceDto> {
    return this.backup.updateSource(
      id,
      input,
      idempotencyKey,
      request.authentication,
      metadata(request),
    );
  }

  @Get('policies')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'backup' })
  @ApiOkResponse({ type: BackupPolicyPageDto })
  policies(@Query() query: BackupPageQueryDto): Promise<BackupPolicyPageDto> {
    return this.backup.policies(query);
  }

  @Get('approval-requests')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'backup' })
  @ApiOkResponse({ type: BackupPolicyApprovalPageDto })
  policyApprovalRequests(): Promise<BackupPolicyApprovalPageDto> {
    return this.backup.policyApprovalRequests();
  }

  @Post('policies')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ action: 'create', module: 'backup' })
  @ApiBody({ type: CreateBackupPolicyDto })
  @ApiCreatedResponse({ type: BackupPolicyDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  createPolicy(
    @Body() input: CreateBackupPolicyDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<BackupPolicyDto> {
    return this.backup.createPolicy(
      input,
      idempotencyKey,
      request.authentication,
      metadata(request),
    );
  }

  @Put('policies/:id')
  @RequirePermissions({ action: 'edit', module: 'backup' })
  @ApiBody({ type: UpdateBackupPolicyDto })
  @ApiOkResponse({ type: BackupPolicyDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiParam({ format: 'uuid', name: 'id' })
  updatePolicy(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: UpdateBackupPolicyDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<BackupPolicyDto> {
    return this.backup.updatePolicy(
      id,
      input,
      idempotencyKey,
      request.authentication,
      metadata(request),
    );
  }

  @Post('policies/:id/approval')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ action: 'edit', module: 'backup' })
  @ApiBody({ type: RequestBackupPolicyApprovalDto })
  @ApiOkResponse({ type: BackupPolicyDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiParam({ format: 'uuid', name: 'id' })
  requestPolicyApproval(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: RequestBackupPolicyApprovalDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<BackupPolicyDto> {
    return this.backup.requestPolicyApproval(
      id,
      input,
      idempotencyKey,
      request.authentication,
      metadata(request),
    );
  }

  @Post('policies/:id/pause-requests')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ action: 'edit', module: 'backup' })
  @ApiBody({ type: RequestBackupPolicyApprovalDto })
  @ApiOkResponse({ type: BackupPolicyDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiParam({ format: 'uuid', name: 'id' })
  requestPolicyPause(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: RequestBackupPolicyApprovalDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<BackupPolicyDto> {
    return this.backup.requestPolicyPause(
      id,
      input,
      idempotencyKey,
      request.authentication,
      metadata(request),
    );
  }

  @Post('policies/:id/retention-reduction-requests')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ action: 'edit', module: 'backup' })
  @ApiBody({ type: RequestBackupRetentionReductionDto })
  @ApiOkResponse({ type: BackupPolicyDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiParam({ format: 'uuid', name: 'id' })
  requestPolicyRetentionReduction(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: RequestBackupRetentionReductionDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<BackupPolicyDto> {
    return this.backup.requestPolicyRetentionReduction(
      id,
      input,
      idempotencyKey,
      request.authentication,
      metadata(request),
    );
  }

  @Post('approval-requests/:id/decision')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ action: 'approve', module: 'backup' })
  @ApiBody({ type: DecideBackupPolicyApprovalDto })
  @ApiOkResponse({ type: BackupPolicyDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiParam({ format: 'uuid', name: 'id' })
  decidePolicyApproval(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: DecideBackupPolicyApprovalDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<BackupPolicyDto> {
    return this.backup.decidePolicyApproval(
      id,
      input,
      idempotencyKey,
      request.authentication,
      metadata(request),
    );
  }

  @Get('runs')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'backup' })
  @ApiOkResponse({ type: BackupExecutionRunPageDto })
  runs(@Query() query: BackupPageQueryDto): Promise<BackupExecutionRunPageDto> {
    return this.backup.executionRuns(query);
  }

  @Get('runs/:id/file-restore-options')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'backup' })
  @ApiOkResponse({ type: BackupFileRestoreOptionsDto })
  @ApiParam({ format: 'uuid', name: 'id' })
  @ApiQuery({ maxLength: 200, minLength: 2, name: 'search', required: true, type: String })
  fileRestoreOptions(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: BackupFileRestoreOptionsQueryDto,
  ): Promise<BackupFileRestoreOptionsDto> {
    return this.backup.fileRestoreOptions(id, query.search);
  }

  @Get('artifact-deletion-requests')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'backup' })
  @ApiOkResponse({ type: BackupArtifactDeletionRequestPageDto })
  artifactDeletionRequests(): Promise<BackupArtifactDeletionRequestPageDto> {
    return this.backup.artifactDeletionRequests();
  }

  @Post('runs/:id/deletion-requests')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ action: 'edit', module: 'backup' })
  @ApiBody({ type: RequestBackupArtifactDeletionDto })
  @ApiCreatedResponse({ type: BackupArtifactDeletionRequestDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiParam({ format: 'uuid', name: 'id' })
  requestArtifactDeletion(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: RequestBackupArtifactDeletionDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<BackupArtifactDeletionRequestDto> {
    return this.backup.requestArtifactDeletion(
      id,
      input,
      idempotencyKey,
      request.authentication,
      metadata(request),
    );
  }

  @Post('artifact-deletion-requests/:id/decision')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ action: 'approve', module: 'backup' })
  @ApiBody({ type: DecideBackupArtifactDeletionDto })
  @ApiOkResponse({ type: BackupArtifactDeletionRequestDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiParam({ format: 'uuid', name: 'id' })
  decideArtifactDeletion(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: DecideBackupArtifactDeletionDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<BackupArtifactDeletionRequestDto> {
    return this.backup.decideArtifactDeletion(
      id,
      input,
      idempotencyKey,
      request.authentication,
      metadata(request),
    );
  }

  @Get('restore-requests')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'backup' })
  @ApiOkResponse({ type: BackupRestoreRequestPageDto })
  restoreRequests(): Promise<BackupRestoreRequestPageDto> {
    return this.backup.restoreRequests();
  }

  @Get('restore-requests/:id/download')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'backup' })
  @ApiParam({ format: 'uuid', name: 'id' })
  @ApiProduces('application/octet-stream')
  @ApiOkResponse({ schema: { format: 'binary', type: 'string' } })
  async downloadRestoredFile(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
  ): Promise<void> {
    const file = await this.backup.restoredFileContent(
      id,
      request.authentication,
      metadata(request),
    );
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    );
    response.setHeader('Content-Length', String(file.size));
    response.setHeader('Content-Type', 'application/octet-stream');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    await pipeline(file.body, response);
  }

  @Get('restore-requests/:id/database/tables')
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'backup' })
  @ApiParam({ format: 'uuid', name: 'id' })
  @ApiOkResponse({ type: BackupDatabaseRecoveryTablePageDto })
  databaseRecoveryTables(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.databaseRecovery.tables(id);
  }

  @Post('restore-requests/:id/database/record')
  @HttpCode(HttpStatus.OK)
  @RateLimitPolicy('read')
  @RequirePermissions({ action: 'view', module: 'backup' })
  @ApiParam({ format: 'uuid', name: 'id' })
  @ApiBody({ type: BackupDatabaseRecordRecoveryRequestDto })
  @ApiOkResponse({ type: BackupDatabaseRecordRecoveryDto })
  recoverDatabaseRecord(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: BackupDatabaseRecordRecoveryRequestDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.databaseRecovery.recoverRecord(
      id,
      input,
      request.authentication,
      metadata(request),
    );
  }

  @Post('runs/:id/restore-requests')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ action: 'create', module: 'backup' })
  @ApiBody({ type: RequestBackupRestoreDto })
  @ApiCreatedResponse({ type: BackupRestoreRequestDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiParam({ format: 'uuid', name: 'id' })
  requestRestore(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: RequestBackupRestoreDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<BackupRestoreRequestDto> {
    return this.backup.requestRestore(
      id,
      input,
      idempotencyKey,
      request.authentication,
      metadata(request),
    );
  }

  @Post('restore-requests/:id/decision')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ action: 'approve', module: 'backup' })
  @ApiBody({ type: DecideBackupRestoreApprovalDto })
  @ApiOkResponse({ type: BackupRestoreRequestDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiParam({ format: 'uuid', name: 'id' })
  decideRestoreApproval(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: DecideBackupRestoreApprovalDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<BackupRestoreRequestDto> {
    return this.backup.decideRestoreApproval(
      id,
      input,
      idempotencyKey,
      request.authentication,
      metadata(request),
    );
  }

  @Post('policies/:id/activate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ action: 'edit', module: 'backup' })
  @ApiBody({ type: ActivateBackupPolicyDto })
  @ApiOkResponse({ type: BackupPolicyDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiParam({ format: 'uuid', name: 'id' })
  activatePolicy(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: ActivateBackupPolicyDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<BackupPolicyDto> {
    return this.backup.activatePolicy(
      id,
      input,
      idempotencyKey,
      request.authentication,
      metadata(request),
    );
  }

  @Post('policies/:id/resume')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ action: 'edit', module: 'backup' })
  @ApiBody({ type: ActivateBackupPolicyDto })
  @ApiOkResponse({ type: BackupPolicyDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiParam({ format: 'uuid', name: 'id' })
  resumePolicy(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: ActivateBackupPolicyDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<BackupPolicyDto> {
    return this.backup.resumePolicy(
      id,
      input,
      idempotencyKey,
      request.authentication,
      metadata(request),
    );
  }
}

function metadata(request: AuthenticatedRequest) {
  const userAgent = request.header('user-agent');
  return {
    correlationId: request.correlationId,
    ...(request.ip ? { sourceIp: request.ip } : {}),
    ...(userAgent ? { userAgent } : {}),
  };
}
