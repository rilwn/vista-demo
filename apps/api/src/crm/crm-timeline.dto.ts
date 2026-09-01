import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type {
  CreateCrmInteractionRequest,
  CreateCrmTaskRequest,
  CrmInteraction,
  CrmInteractionType,
  CrmTask,
  CrmTaskPriority,
  CrmTaskStatus,
  CrmTimelineItem,
  CrmTimelinePage,
  CrmTimelineReferenceData,
  TransitionCrmTaskRequest,
} from '@vista/contracts';
import { crmInteractionTypes, crmTaskPriorities, crmTaskStatuses } from '@vista/contracts';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const uuid = 'loose' as const;

export class CreateCrmInteractionDto implements CreateCrmInteractionRequest {
  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID(uuid)
  contactPersonId?: string;

  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID(uuid)
  customerLocationId?: string;

  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID(uuid)
  customerPartnerId!: string;

  @ApiProperty({ enum: crmInteractionTypes })
  @IsIn(crmInteractionTypes)
  interactionType!: CrmInteractionType;

  @ApiProperty({ maxLength: 4000, minLength: 1, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  notes!: string;

  @ApiProperty({ format: 'date-time', type: String })
  @IsDateString({ strict: true })
  occurredAt!: string;

  @ApiProperty({ maxLength: 255, minLength: 1, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  subject!: string;
}

export class CreateCrmTaskDto implements CreateCrmTaskRequest {
  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID(uuid)
  assignedToAccountId!: string;

  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID(uuid)
  customerLocationId?: string;

  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID(uuid)
  customerPartnerId!: string;

  @ApiProperty({ format: 'date-time', type: String })
  @IsDateString({ strict: true })
  dueAt!: string;

  @ApiPropertyOptional({ maxLength: 4000, minLength: 1, type: String })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  notes?: string;

  @ApiProperty({ enum: crmTaskPriorities })
  @IsIn(crmTaskPriorities)
  priority!: CrmTaskPriority;

  @ApiPropertyOptional({ format: 'date-time', type: String })
  @IsOptional()
  @IsDateString({ strict: true })
  reminderAt?: string;

  @ApiProperty({ maxLength: 255, minLength: 1, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title!: string;
}

export class TransitionCrmTaskDto implements TransitionCrmTaskRequest {
  @ApiProperty({ minimum: 1, type: Number })
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiPropertyOptional({ maxLength: 2000, minLength: 1, type: String })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  note?: string;

  @ApiProperty({ enum: ['completed', 'cancelled'] })
  @IsIn(['completed', 'cancelled'])
  status!: 'completed' | 'cancelled';
}

export class ListCrmTimelineQueryDto {
  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID(uuid)
  customerPartnerId!: string;

  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID(uuid)
  customerLocationId?: string;

  @ApiPropertyOptional({ format: 'date-time', type: String })
  @IsOptional()
  @IsDateString({ strict: true })
  dateFrom?: string;

  @ApiPropertyOptional({ format: 'date-time', type: String })
  @IsOptional()
  @IsDateString({ strict: true })
  dateTo?: string;

  @ApiPropertyOptional({ minimum: 1, type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ maximum: 100, minimum: 1, type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

class CrmReferenceDto {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  name!: string;
}

class CrmLocationReferenceDto extends CrmReferenceDto {
  @ApiProperty({ format: 'uuid', type: String })
  customerPartnerId!: string;
}

class CrmContactReferenceDto {
  @ApiProperty({ format: 'uuid', type: String })
  customerPartnerId!: string;
  @ApiProperty({ type: String })
  displayName!: string;
  @ApiProperty({ format: 'uuid', type: String })
  id!: string;
}

class CrmAssigneeReferenceDto {
  @ApiProperty({ type: String })
  displayName!: string;
  @ApiProperty({ format: 'uuid', type: String })
  id!: string;
}

export class CrmTimelineReferenceDataDto implements CrmTimelineReferenceData {
  @ApiProperty({ isArray: true, type: () => CrmAssigneeReferenceDto })
  assignees!: CrmTimelineReferenceData['assignees'];
  @ApiProperty({ type: String })
  businessTimezone!: string;
  @ApiProperty({ isArray: true, type: () => CrmContactReferenceDto })
  contacts!: CrmTimelineReferenceData['contacts'];
  @ApiProperty({ isArray: true, type: () => CrmReferenceDto })
  customers!: CrmTimelineReferenceData['customers'];
  @ApiProperty({ isArray: true, type: () => CrmLocationReferenceDto })
  locations!: CrmTimelineReferenceData['locations'];
}

class CrmInteractionDto implements CrmInteraction {
  @ApiPropertyOptional({ type: String })
  contactName?: string;
  @ApiPropertyOptional({ format: 'uuid', type: String })
  contactPersonId?: string;
  @ApiProperty({ format: 'date-time', type: String })
  createdAt!: string;
  @ApiProperty({ type: String })
  createdByName!: string;
  @ApiPropertyOptional({ format: 'uuid', type: String })
  customerLocationId?: string;
  @ApiProperty({ type: String })
  customerName!: string;
  @ApiProperty({ format: 'uuid', type: String })
  customerPartnerId!: string;
  @ApiProperty({ format: 'uuid', type: String })
  id!: string;
  @ApiProperty({ enum: crmInteractionTypes })
  interactionType!: CrmInteractionType;
  @ApiPropertyOptional({ type: String })
  locationName?: string;
  @ApiProperty({ type: String })
  notes!: string;
  @ApiProperty({ format: 'date-time', type: String })
  occurredAt!: string;
  @ApiProperty({ type: String })
  subject!: string;
}

class CrmTaskHistoryEntryDto {
  @ApiProperty({ format: 'date-time', type: String })
  changedAt!: string;
  @ApiProperty({ type: String })
  changedByName!: string;
  @ApiProperty({ format: 'uuid', type: String })
  id!: string;
  @ApiPropertyOptional({ type: String })
  note?: string;
  @ApiProperty({ enum: crmTaskStatuses })
  status!: CrmTaskStatus;
  @ApiProperty({ enum: ['created', 'completed', 'cancelled'] })
  type!: 'created' | 'completed' | 'cancelled';
}

export class CrmTaskDto implements CrmTask {
  @ApiProperty({ type: () => CrmAssigneeReferenceDto })
  assignedTo!: CrmTask['assignedTo'];
  @ApiPropertyOptional({ format: 'date-time', type: String })
  cancelledAt?: string;
  @ApiPropertyOptional({ format: 'date-time', type: String })
  completedAt?: string;
  @ApiProperty({ format: 'date-time', type: String })
  createdAt!: string;
  @ApiPropertyOptional({ format: 'uuid', type: String })
  customerLocationId?: string;
  @ApiProperty({ type: String })
  customerName!: string;
  @ApiProperty({ format: 'uuid', type: String })
  customerPartnerId!: string;
  @ApiProperty({ format: 'date-time', type: String })
  dueAt!: string;
  @ApiProperty({ isArray: true, type: () => CrmTaskHistoryEntryDto })
  history!: CrmTask['history'];
  @ApiProperty({ format: 'uuid', type: String })
  id!: string;
  @ApiPropertyOptional({ type: String })
  locationName?: string;
  @ApiPropertyOptional({ type: String })
  notes?: string;
  @ApiProperty({ enum: crmTaskPriorities })
  priority!: CrmTaskPriority;
  @ApiPropertyOptional({ format: 'date-time', type: String })
  reminderAt?: string;
  @ApiProperty({ enum: crmTaskStatuses })
  status!: CrmTaskStatus;
  @ApiProperty({ type: String })
  title!: string;
  @ApiProperty({ format: 'date-time', type: String })
  updatedAt!: string;
  @ApiProperty({ type: Number })
  version!: number;
}

class CrmTimelineItemDto {
  @ApiPropertyOptional({ type: () => CrmInteractionDto })
  interaction?: CrmInteraction;
  @ApiProperty({ enum: ['interaction', 'task_event'] })
  kind!: CrmTimelineItem['kind'];
  @ApiProperty({ format: 'date-time', type: String })
  occurredAt!: string;
  @ApiPropertyOptional({ type: () => CrmTaskDto })
  task?: CrmTask;
  @ApiPropertyOptional({ type: () => CrmTaskHistoryEntryDto })
  taskEvent?: CrmTask['history'][number];
}

class CrmTimelineSummaryDto {
  @ApiProperty({ type: Number })
  interactions!: number;
  @ApiProperty({ type: Number })
  openTasks!: number;
  @ApiProperty({ type: Number })
  overdueTasks!: number;
}

export class CrmTimelinePageDto implements CrmTimelinePage {
  @ApiProperty({ isArray: true, type: () => CrmTimelineItemDto })
  items!: CrmTimelineItem[];
  @ApiProperty({ isArray: true, type: () => CrmTaskDto })
  openTasks!: CrmTask[];
  @ApiProperty({ type: Number })
  page!: number;
  @ApiProperty({ type: Number })
  pageSize!: number;
  @ApiProperty({ type: () => CrmTimelineSummaryDto })
  summary!: CrmTimelinePage['summary'];
  @ApiProperty({ type: Number })
  total!: number;
  @ApiProperty({ type: Number })
  totalPages!: number;
}

export class CrmInteractionResponseDto extends CrmInteractionDto {}
