import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import type {
  BackupDrTest,
  BackupDrTestPage,
  BackupArtifactDeletionRequest,
  BackupArtifactDeletionRequestPage,
  BackupPlanReview,
  BackupPlanReviewPage,
  BackupDataClassification,
  ActivateBackupPolicyRequest,
  BackupExecutionRun,
  BackupExecutionRunPage,
  BackupFileRestoreOption,
  BackupFileRestoreOptions,
  BackupEmployeeOption,
  BackupPolicy,
  BackupPolicyApprovalPage,
  BackupPolicyApprovalRequest,
  BackupProtectedSource,
  BackupRecordPage,
  BackupReferenceData,
  BackupRestoreRequest,
  BackupRestoreRequestPage,
  BackupSourceType,
  CreateBackupPolicyRequest,
  CreateBackupProtectedSourceRequest,
  DecideBackupPolicyApprovalRequest,
  DecideBackupArtifactDeletionRequest,
  DecideBackupRestoreApprovalRequest,
  RequestBackupRestoreRequest,
  RequestBackupArtifactDeletionRequest,
  RequestBackupPolicyApprovalRequest,
  RequestBackupRetentionReductionRequest,
  UpdateBackupPolicyRequest,
  UpdateBackupProtectedSourceRequest,
  PlanBackupDrTestRequest,
  RecordBackupDrTestRequest,
  RecordBackupPlanReviewRequest,
} from '@vista/contracts';

export const backupSourceTypes: readonly BackupSourceType[] = [
  'cloud_service',
  'database',
  'email',
  'file',
  'file_share',
  'mobile_device',
  'object_storage',
  'other',
  'server',
  'workstation',
];

export const backupClassifications: readonly BackupDataClassification[] = [
  'critical',
  'important',
  'standard',
];

const backupTypes: readonly BackupPolicy['backupType'][] = [
  'database_snapshot',
  'differential',
  'full',
  'incremental',
  'system_image',
];

const backupFrequencies: readonly BackupPolicy['frequency'][] = [
  'daily',
  'hourly',
  'monthly',
  'weekly',
];

export class BackupPageQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1, type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 50, maximum: 100, minimum: 1, type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 50;
}

export class BackupFileRestoreOptionsQueryDto {
  @ApiProperty({ maxLength: 200, minLength: 2, type: String })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  search!: string;
}

export class BackupFileRestoreOptionDto implements BackupFileRestoreOption {
  @ApiProperty({ maxLength: 1024, type: String })
  key!: string;

  @ApiPropertyOptional({ maxLength: 500, type: String })
  label?: string;

  @ApiProperty({ type: String })
  sizeBytes!: string;
}

export class BackupFileRestoreOptionsDto implements BackupFileRestoreOptions {
  @ApiProperty({ isArray: true, type: BackupFileRestoreOptionDto })
  items!: BackupFileRestoreOptions['items'];

  @ApiProperty({ type: Number })
  total!: number;
}

export class BackupEmployeeOptionDto implements BackupEmployeeOption {
  @ApiProperty({ type: String }) displayName!: string;
  @ApiProperty({ type: String }) employeeNumber!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
}

export class BackupReferenceDataDto implements BackupReferenceData {
  @ApiProperty({ isArray: true, type: BackupEmployeeOptionDto }) employees!: BackupEmployeeOption[];
}

export class CreateBackupProtectedSourceDto implements CreateBackupProtectedSourceRequest {
  @ApiPropertyOptional({ maxLength: 12, pattern: '^\\d{1,10}(\\.\\d{1,2})?$', type: String })
  @IsOptional()
  @Matches(/^\d{1,10}(?:\.\d{1,2})?$/u)
  annualGrowthPercent?: string;

  @ApiPropertyOptional({ maxLength: 1000, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  credentialCustody?: string;

  @ApiProperty({ enum: backupClassifications })
  @IsIn(backupClassifications)
  dataClassification!: BackupDataClassification;

  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID('4')
  dataStewardEmployeeId?: string;

  @ApiPropertyOptional({ maxLength: 2000, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  dependencies?: string;

  @ApiProperty({ type: Boolean })
  @IsBoolean()
  encryptedAtSource!: boolean;

  @ApiPropertyOptional({ maxLength: 16, pattern: '^\\d{1,10}(\\.\\d{1,2})?$', type: String })
  @IsOptional()
  @Matches(/^\d{1,10}(?:\.\d{1,2})?$/u)
  estimatedSizeGib?: string;

  @ApiProperty({ maxLength: 255, minLength: 1, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  location!: string;

  @ApiProperty({ maxLength: 180, minLength: 1, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(180)
  name!: string;

  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID('4')
  ownerEmployeeId?: string;

  @ApiPropertyOptional({ maxLength: 2000, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  restorePrerequisites?: string;

  @ApiProperty({ maxLength: 80, minLength: 1, pattern: '^[A-Za-z0-9._-]+$', type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  @Matches(/^[A-Za-z0-9._-]+$/u)
  sourceCode!: string;

  @ApiProperty({ enum: backupSourceTypes })
  @IsIn(backupSourceTypes)
  sourceType!: BackupSourceType;
}

export class UpdateBackupProtectedSourceDto
  extends CreateBackupProtectedSourceDto
  implements UpdateBackupProtectedSourceRequest
{
  @ApiProperty({ minimum: 1, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class CreateBackupPolicyDto implements CreateBackupPolicyRequest {
  @ApiProperty({ enum: backupTypes })
  @IsIn(backupTypes)
  backupType!: BackupPolicy['backupType'];

  @ApiPropertyOptional({ default: true, type: Boolean })
  @IsOptional()
  @IsBoolean()
  compressionEnabled?: boolean;

  @ApiPropertyOptional({ maximum: 28, minimum: 1, type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(28)
  dayOfMonth?: number;

  @ApiPropertyOptional({ maximum: 6, minimum: 0, type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek?: number;

  @ApiPropertyOptional({ default: true, type: Boolean })
  @IsOptional()
  @IsBoolean()
  encryptionRequired?: boolean;

  @ApiProperty({ enum: backupFrequencies })
  @IsIn(backupFrequencies)
  frequency!: BackupPolicy['frequency'];

  @ApiProperty({ maxLength: 180, minLength: 1, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(180)
  name!: string;

  @ApiProperty({ maxLength: 80, minLength: 1, pattern: '^[A-Za-z0-9._-]+$', type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  @Matches(/^[A-Za-z0-9._-]+$/u)
  policyCode!: string;

  @ApiPropertyOptional({ default: 35, maximum: 3650, minimum: 1, type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  retentionDailyCopies?: number;

  @ApiPropertyOptional({ default: 12, maximum: 120, minimum: 1, type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(120)
  retentionMonthlyCopies?: number;

  @ApiProperty({ minimum: 1, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  rpoMinutes!: number;

  @ApiProperty({ minimum: 1, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  rtoMinutes!: number;

  @ApiPropertyOptional({ example: '02:00', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$', type: String })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/u)
  runTimeLocal?: string;

  @ApiProperty({ isArray: true, maxItems: 100, minItems: 1, type: String, format: 'uuid' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  sourceIds!: string[];

  @ApiPropertyOptional({ default: true, type: Boolean })
  @IsOptional()
  @IsBoolean()
  verificationRequired?: boolean;
}

export class UpdateBackupPolicyDto
  extends CreateBackupPolicyDto
  implements UpdateBackupPolicyRequest
{
  @ApiProperty({ minimum: 1, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class RequestBackupPolicyApprovalDto implements RequestBackupPolicyApprovalRequest {
  @ApiProperty({ minimum: 1, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiProperty({ maxLength: 1000, minLength: 10, type: String })
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  justification!: string;
}

export class RequestBackupRetentionReductionDto
  extends RequestBackupPolicyApprovalDto
  implements RequestBackupRetentionReductionRequest
{
  @ApiProperty({ maximum: 3650, minimum: 1, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  retentionDailyCopies!: number;

  @ApiProperty({ maximum: 120, minimum: 1, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(120)
  retentionMonthlyCopies!: number;
}

export class DecideBackupPolicyApprovalDto implements DecideBackupPolicyApprovalRequest {
  @ApiPropertyOptional({ maxLength: 1000, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;

  @ApiProperty({ enum: ['approve', 'reject'] })
  @IsIn(['approve', 'reject'])
  decision!: 'approve' | 'reject';
}

export class ActivateBackupPolicyDto implements ActivateBackupPolicyRequest {
  @ApiProperty({ minimum: 1, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class RequestBackupRestoreDto implements RequestBackupRestoreRequest {
  @ApiPropertyOptional({ maxLength: 1024, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  objectKey?: string;

  @ApiProperty({ maxLength: 1000, minLength: 10, type: String })
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  reason!: string;
}

export class DecideBackupRestoreApprovalDto implements DecideBackupRestoreApprovalRequest {
  @ApiPropertyOptional({ maxLength: 500, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;

  @ApiProperty({ enum: ['approve', 'reject'] })
  @IsIn(['approve', 'reject'])
  decision!: 'approve' | 'reject';
}

export class BackupRestoreRequestDto implements BackupRestoreRequest {
  @ApiPropertyOptional({ type: String }) approvedByName?: string;
  @ApiProperty({ type: Number }) attemptCount!: number;
  @ApiPropertyOptional({ format: 'date-time', type: String }) completedAt?: string;
  @ApiProperty({ format: 'date-time', type: String }) createdAt!: string;
  @ApiPropertyOptional({ type: String }) errorCode?: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) policyCode!: string;
  @ApiProperty({ type: String }) policyName!: string;
  @ApiProperty({ type: String }) reason!: string;
  @ApiPropertyOptional({ maxLength: 1024, type: String }) restoreObjectKey?: string;
  @ApiProperty({ format: 'uuid', type: String }) requestedBy!: string;
  @ApiProperty({ type: String }) requestedByName!: string;
  @ApiProperty({ format: 'uuid', type: String }) runId!: string;
  @ApiProperty({ format: 'date-time', type: String }) scheduledFor!: string;
  @ApiProperty({
    enum: ['cloud_service', 'database', 'email', 'file', 'file_share', 'object_storage'],
  })
  sourceType!: BackupRestoreRequest['sourceType'];
  @ApiProperty({
    enum: ['approved', 'completed', 'expired', 'failed', 'pending_approval', 'rejected', 'running'],
  })
  status!: BackupRestoreRequest['status'];
  @ApiPropertyOptional({ type: String }) targetDatabaseName?: string;
  @ApiPropertyOptional({ type: String }) targetStorageBucket?: string;
  @ApiPropertyOptional({ type: String }) targetStoragePrefix?: string;
}

export class BackupRestoreRequestPageDto implements BackupRestoreRequestPage {
  @ApiProperty({ isArray: true, type: BackupRestoreRequestDto }) items!: BackupRestoreRequest[];
  @ApiProperty({ type: Number }) total!: number;
}

export class BackupDrTestDto implements BackupDrTest {
  @ApiProperty({ format: 'uuid', type: String }) backupRunId!: string;
  @ApiProperty({ format: 'date-time', type: String }) backupScheduledFor!: string;
  @ApiPropertyOptional({ format: 'date-time', type: String }) completedAt?: string;
  @ApiPropertyOptional({ type: String }) correctiveActions?: string;
  @ApiProperty({ format: 'date-time', type: String }) createdAt!: string;
  @ApiProperty({ type: String }) createdByName!: string;
  @ApiPropertyOptional({ format: 'uuid', type: String }) evidenceFileId?: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiPropertyOptional({ type: String }) nonConformities?: string;
  @ApiPropertyOptional({ enum: ['failed', 'passed'] }) outcome?: 'failed' | 'passed';
  @ApiProperty({ format: 'date-time', type: String }) plannedFor!: string;
  @ApiProperty({ type: String }) policyCode!: string;
  @ApiProperty({ type: String }) policyName!: string;
  @ApiPropertyOptional({ format: 'date-time', type: String }) protocolSignedAt?: string;
  @ApiPropertyOptional({ type: String }) protocolSignedBy?: string;
  @ApiPropertyOptional({ format: 'uuid', type: String }) restoreRequestId?: string;
  @ApiPropertyOptional({
    enum: ['approved', 'completed', 'expired', 'failed', 'pending_approval', 'rejected', 'running'],
  })
  restoreStatus?: NonNullable<BackupDrTest['restoreStatus']>;
  @ApiPropertyOptional({ type: String }) resultSummary?: string;
  @ApiPropertyOptional({ type: Boolean }) rpoMet?: boolean;
  @ApiProperty({ type: Number }) rpoTargetMinutes!: number;
  @ApiPropertyOptional({ type: Boolean }) rtoMet?: boolean;
  @ApiProperty({ type: Number }) rtoTargetMinutes!: number;
  @ApiProperty({ type: String }) scope!: string;
  @ApiProperty({ enum: ['planned', 'recorded'] }) status!: 'planned' | 'recorded';
  @ApiProperty({ type: String }) testCode!: string;
  @ApiPropertyOptional({ type: Number }) actualRpoMinutes?: number;
  @ApiPropertyOptional({ type: Number }) actualRtoMinutes?: number;
}

export class BackupDrTestPageDto implements BackupDrTestPage {
  @ApiProperty({ isArray: true, type: BackupDrTestDto }) items!: BackupDrTest[];
  @ApiProperty({ type: Number }) total!: number;
}

export class BackupPlanReviewSourceSnapshotDto {
  @ApiProperty({ type: String }) classification!: string;
  @ApiProperty({ type: String }) location!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiPropertyOptional({ type: String }) ownerName?: string;
  @ApiProperty({ type: String }) sourceCode!: string;
  @ApiProperty({ type: String }) sourceType!: string;
  @ApiProperty({ type: String }) status!: string;
  @ApiPropertyOptional({ type: String }) stewardName?: string;
  @ApiProperty({ type: Number }) version!: number;
}

export class BackupPlanReviewPolicySnapshotDto {
  @ApiProperty({ type: String }) backupType!: string;
  @ApiProperty({ type: Boolean }) compressionEnabled!: boolean;
  @ApiPropertyOptional({ type: Number }) dayOfMonth?: number;
  @ApiPropertyOptional({ type: Number }) dayOfWeek?: number;
  @ApiProperty({ type: Boolean }) encryptionRequired!: boolean;
  @ApiProperty({ type: String }) frequency!: string;
  @ApiProperty({ type: String }) policyCode!: string;
  @ApiProperty({ type: Number }) retentionDailyCopies!: number;
  @ApiProperty({ type: Number }) retentionMonthlyCopies!: number;
  @ApiProperty({ type: Number }) rpoMinutes!: number;
  @ApiProperty({ type: Number }) rtoMinutes!: number;
  @ApiPropertyOptional({ type: String }) runTimeLocal?: string;
  @ApiProperty({ isArray: true, type: String }) sourceCodes!: string[];
  @ApiProperty({ type: String }) status!: string;
  @ApiProperty({ type: Boolean }) verificationRequired!: boolean;
  @ApiProperty({ type: Number }) version!: number;
}

export class BackupPlanReviewSnapshotDto {
  @ApiProperty({ isArray: true, type: BackupPlanReviewPolicySnapshotDto })
  policies!: BackupPlanReview['planSnapshot']['policies'];
  @ApiProperty({ isArray: true, type: BackupPlanReviewSourceSnapshotDto })
  protectedSources!: BackupPlanReview['planSnapshot']['protectedSources'];
  @ApiProperty({ type: String }) storageTarget!: string;
}

export class BackupPlanReviewDto implements BackupPlanReview {
  @ApiPropertyOptional({ type: String }) correctiveActions?: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ format: 'date-time', type: String }) nextReviewDueAt!: string;
  @ApiProperty({ enum: ['approved', 'changes_required'] })
  outcome!: BackupPlanReview['outcome'];
  @ApiProperty({ type: BackupPlanReviewSnapshotDto })
  planSnapshot!: BackupPlanReview['planSnapshot'];
  @ApiProperty({ type: Number }) policyCount!: number;
  @ApiProperty({ type: Number }) protectedSourceCount!: number;
  @ApiProperty({ type: String }) reviewCode!: string;
  @ApiProperty({ format: 'date-time', type: String }) reviewedAt!: string;
  @ApiProperty({ type: String }) reviewedByName!: string;
  @ApiProperty({ type: String }) snapshotSha256!: string;
  @ApiProperty({ type: String }) summary!: string;
}

export class BackupPlanReviewPageDto implements BackupPlanReviewPage {
  @ApiProperty({ type: BackupPlanReviewSnapshotDto })
  currentPlanSnapshot!: BackupPlanReviewPage['currentPlanSnapshot'];
  @ApiProperty({ type: String }) currentSnapshotSha256!: string;
  @ApiProperty({ isArray: true, type: BackupPlanReviewDto }) items!: BackupPlanReview[];
  @ApiProperty({ type: Boolean }) reviewRequired!: boolean;
  @ApiProperty({ type: Number }) total!: number;
}

export class RecordBackupPlanReviewDto implements RecordBackupPlanReviewRequest {
  @ApiPropertyOptional({ maxLength: 4000, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  correctiveActions?: string;

  @ApiProperty({ enum: ['approved', 'changes_required'] })
  @IsIn(['approved', 'changes_required'])
  outcome!: RecordBackupPlanReviewRequest['outcome'];

  @ApiProperty({ maxLength: 2000, minLength: 10, type: String })
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  summary!: string;
}

export class PlanBackupDrTestDto implements PlanBackupDrTestRequest {
  @ApiProperty({ format: 'date-time', type: String })
  @IsDateString()
  plannedFor!: string;

  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('4')
  runId!: string;

  @ApiProperty({ maxLength: 2000, minLength: 10, type: String })
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  scope!: string;
}

export class RecordBackupDrTestDto implements RecordBackupDrTestRequest {
  @ApiProperty({ minimum: 0, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  actualRpoMinutes!: number;

  @ApiProperty({ minimum: 0, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  actualRtoMinutes!: number;

  @ApiPropertyOptional({ maxLength: 4000, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  correctiveActions?: string;

  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('4')
  evidenceFileId!: string;

  @ApiPropertyOptional({ maxLength: 4000, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  nonConformities?: string;

  @ApiProperty({ format: 'date-time', type: String })
  @IsDateString()
  protocolSignedAt!: string;

  @ApiProperty({ maxLength: 180, minLength: 2, type: String })
  @IsString()
  @MinLength(2)
  @MaxLength(180)
  protocolSignedBy!: string;

  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('4')
  restoreRequestId!: string;

  @ApiProperty({ maxLength: 4000, minLength: 10, type: String })
  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  resultSummary!: string;
}

export class BackupProtectedSourceDto implements BackupProtectedSource {
  @ApiPropertyOptional({ type: String }) annualGrowthPercent?: string;
  @ApiProperty({ format: 'date-time', type: String }) createdAt!: string;
  @ApiProperty({ type: String }) credentialCustody!: string;
  @ApiProperty({ enum: backupClassifications }) dataClassification!: BackupDataClassification;
  @ApiPropertyOptional({ format: 'uuid', type: String }) dataStewardEmployeeId?: string;
  @ApiPropertyOptional({ type: String }) dataStewardName?: string;
  @ApiProperty({ type: String }) dependencies!: string;
  @ApiProperty({ type: Boolean }) encryptedAtSource!: boolean;
  @ApiPropertyOptional({ type: String }) estimatedSizeGib?: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) location!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiPropertyOptional({ format: 'uuid', type: String }) ownerEmployeeId?: string;
  @ApiPropertyOptional({ type: String }) ownerName?: string;
  @ApiProperty({ type: String }) restorePrerequisites!: string;
  @ApiProperty({ type: String }) sourceCode!: string;
  @ApiProperty({ enum: backupSourceTypes }) sourceType!: BackupSourceType;
  @ApiProperty({ enum: ['active', 'inactive'] }) status!: BackupProtectedSource['status'];
  @ApiProperty({ format: 'date-time', type: String }) updatedAt!: string;
  @ApiProperty({ minimum: 1, type: Number }) version!: number;
}

export class BackupPolicySourceDto {
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: String }) sourceCode!: string;
}

export class BackupPolicyDto implements BackupPolicy {
  @ApiProperty({ enum: backupTypes }) backupType!: BackupPolicy['backupType'];
  @ApiProperty({ type: Boolean }) compressionEnabled!: boolean;
  @ApiProperty({ format: 'date-time', type: String }) createdAt!: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 28, type: Number }) dayOfMonth?: number;
  @ApiPropertyOptional({ minimum: 0, maximum: 6, type: Number }) dayOfWeek?: number;
  @ApiProperty({ type: Boolean }) encryptionRequired!: boolean;
  @ApiProperty({ enum: backupFrequencies }) frequency!: BackupPolicy['frequency'];
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiPropertyOptional({ type: Boolean }) pauseRequestPending?: boolean;
  @ApiProperty({ type: String }) policyCode!: string;
  @ApiProperty({ type: Number }) retentionDailyCopies!: number;
  @ApiProperty({ type: Number }) retentionMonthlyCopies!: number;
  @ApiProperty({ type: Number }) rpoMinutes!: number;
  @ApiProperty({ type: Number }) rtoMinutes!: number;
  @ApiPropertyOptional({ type: String }) runTimeLocal?: string;
  @ApiProperty({ isArray: true, type: BackupPolicySourceDto }) sources!: BackupPolicy['sources'];
  @ApiProperty({ enum: ['active', 'approved', 'draft', 'paused', 'pending_approval'] })
  status!: BackupPolicy['status'];
  @ApiProperty({ format: 'date-time', type: String }) updatedAt!: string;
  @ApiProperty({ type: Boolean }) verificationRequired!: boolean;
  @ApiProperty({ minimum: 1, type: Number }) version!: number;
}

export class BackupPolicyApprovalRequestDto implements BackupPolicyApprovalRequest {
  @ApiProperty({ enum: ['disable_job', 'modify_policy', 'reduce_retention'] })
  action!: BackupPolicyApprovalRequest['action'];
  @ApiProperty({ format: 'date-time', type: String }) createdAt!: string;
  @ApiProperty({ format: 'date-time', type: String }) expiresAt!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) justification!: string;
  @ApiProperty({ type: String }) policyCode!: string;
  @ApiProperty({ format: 'uuid', type: String }) policyId!: string;
  @ApiProperty({ type: String }) policyName!: string;
  @ApiProperty({ type: String }) requestedBy!: string;
  @ApiProperty({ type: String }) requestedByName!: string;
  @ApiPropertyOptional({ minimum: 1, type: Number }) previousDailyCopies?: number;
  @ApiPropertyOptional({ minimum: 1, type: Number }) previousMonthlyCopies?: number;
  @ApiPropertyOptional({ minimum: 1, type: Number }) proposedDailyCopies?: number;
  @ApiPropertyOptional({ minimum: 1, type: Number }) proposedMonthlyCopies?: number;
  @ApiProperty({ enum: ['pending'] }) status!: 'pending';
  @ApiProperty({ minimum: 1, type: Number }) version!: number;
}

export class BackupPolicyApprovalPageDto implements BackupPolicyApprovalPage {
  @ApiProperty({ isArray: true, type: BackupPolicyApprovalRequestDto })
  items!: BackupPolicyApprovalRequest[];

  @ApiProperty({ minimum: 0, type: Number }) total!: number;
}

export class BackupExecutionRunDto implements BackupExecutionRun {
  @ApiProperty({ type: Boolean }) artifactAvailable!: boolean;
  @ApiPropertyOptional({ enum: ['approved_retention_policy', 'approved_restore_point_deletion'] })
  artifactDeletedReason?: 'approved_retention_policy' | 'approved_restore_point_deletion';
  @ApiPropertyOptional({
    enum: ['approved', 'completed', 'expired', 'failed', 'pending_approval', 'rejected', 'running'],
  })
  artifactDeletionStatus?:
    'approved' | 'completed' | 'expired' | 'failed' | 'pending_approval' | 'rejected' | 'running';
  @ApiPropertyOptional({ type: String }) artifactSizeBytes?: string;
  @ApiProperty({ minimum: 1, type: Number }) attemptCount!: number;
  @ApiProperty({ enum: backupTypes }) backupType!: BackupExecutionRun['backupType'];
  @ApiProperty({ enum: ['gzip', 'none', 'postgres_custom'] })
  compressionAlgorithm!: BackupExecutionRun['compressionAlgorithm'];
  @ApiPropertyOptional({ type: String }) errorCode?: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ enum: ['failed', 'not_configured', 'pending', 'running', 'verified'] })
  independentCopyStatus!: BackupExecutionRun['independentCopyStatus'];
  @ApiPropertyOptional({ type: String }) independentCopyTargetCode?: string;
  @ApiPropertyOptional({ type: String }) independentCopyErrorCode?: string;
  @ApiPropertyOptional({ format: 'date-time', type: String }) independentCopyVerifiedAt?: string;
  @ApiProperty({ type: String }) policyCode!: string;
  @ApiProperty({ type: String }) policyName!: string;
  @ApiProperty({ type: Boolean }) restoreAvailable!: boolean;
  @ApiProperty({ format: 'date-time', type: String }) scheduledFor!: string;
  @ApiProperty({
    enum: ['cloud_service', 'database', 'email', 'file', 'file_share', 'object_storage'],
  })
  sourceType!: BackupExecutionRun['sourceType'];
  @ApiProperty({ format: 'date-time', type: String }) startedAt!: string;
  @ApiProperty({ enum: ['failed', 'running', 'stored', 'verified'] })
  status!: BackupExecutionRun['status'];
  @ApiPropertyOptional({ format: 'date-time', type: String }) storedAt?: string;
  @ApiProperty({ minimum: 0, type: Number }) verificationAttemptCount!: number;
  @ApiProperty({ enum: ['failed', 'pending', 'running', 'verified'] })
  verificationStatus!: BackupExecutionRun['verificationStatus'];
  @ApiPropertyOptional({ type: String }) uncompressedSizeBytes?: string;
  @ApiPropertyOptional({ format: 'date-time', type: String }) verifiedAt?: string;
}

export class BackupExecutionRunPageDto implements BackupExecutionRunPage {
  @ApiProperty({ isArray: true, type: BackupExecutionRunDto }) items!: BackupExecutionRun[];
  @ApiProperty({ minimum: 1, type: Number }) page!: number;
  @ApiProperty({ minimum: 1, type: Number }) pageSize!: number;
  @ApiProperty({ type: Boolean }) restoreAvailable!: boolean;
  @ApiProperty({ minimum: 0, type: Number }) total!: number;
}

export class RequestBackupArtifactDeletionDto implements RequestBackupArtifactDeletionRequest {
  @ApiProperty({ maxLength: 1000, minLength: 10, type: String })
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  reason!: string;
}

export class DecideBackupArtifactDeletionDto implements DecideBackupArtifactDeletionRequest {
  @ApiPropertyOptional({ maxLength: 1000, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;

  @ApiProperty({ enum: ['approve', 'reject'] })
  @IsIn(['approve', 'reject'])
  decision!: 'approve' | 'reject';
}

export class BackupArtifactDeletionRequestDto implements BackupArtifactDeletionRequest {
  @ApiPropertyOptional({ type: String }) approvedByName?: string;
  @ApiPropertyOptional({ format: 'date-time', type: String }) completedAt?: string;
  @ApiProperty({ format: 'date-time', type: String }) createdAt!: string;
  @ApiPropertyOptional({ type: String }) errorCode?: string;
  @ApiProperty({ format: 'date-time', type: String }) expiresAt!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) policyCode!: string;
  @ApiProperty({ type: String }) policyName!: string;
  @ApiProperty({ type: String }) reason!: string;
  @ApiProperty({ format: 'uuid', type: String }) requestedBy!: string;
  @ApiProperty({ type: String }) requestedByName!: string;
  @ApiProperty({ format: 'uuid', type: String }) runId!: string;
  @ApiProperty({ format: 'date-time', type: String }) scheduledFor!: string;
  @ApiProperty({
    enum: ['approved', 'completed', 'expired', 'failed', 'pending_approval', 'rejected', 'running'],
  })
  status!: BackupArtifactDeletionRequest['status'];
}

export class BackupArtifactDeletionRequestPageDto implements BackupArtifactDeletionRequestPage {
  @ApiProperty({ isArray: true, type: BackupArtifactDeletionRequestDto })
  items!: BackupArtifactDeletionRequest[];

  @ApiProperty({ minimum: 0, type: Number })
  total!: number;
}

export class BackupProtectedSourcePageDto implements BackupRecordPage<BackupProtectedSource> {
  @ApiProperty({ isArray: true, type: BackupProtectedSourceDto }) items!: BackupProtectedSource[];
  @ApiProperty({ minimum: 1, type: Number }) page!: number;
  @ApiProperty({ minimum: 1, maximum: 100, type: Number }) pageSize!: number;
  @ApiProperty({ minimum: 0, type: Number }) total!: number;
}

export class BackupPolicyPageDto implements BackupRecordPage<BackupPolicy> {
  @ApiProperty({ isArray: true, type: BackupPolicyDto }) items!: BackupPolicy[];
  @ApiProperty({ minimum: 1, type: Number }) page!: number;
  @ApiProperty({ minimum: 1, maximum: 100, type: Number }) pageSize!: number;
  @ApiProperty({ minimum: 0, type: Number }) total!: number;
}
