import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type {
  CreateCrmTicketFromServiceRequestRequest,
  CreateCrmTicketRequest,
  CreateServiceRequestFromCrmTicketRequest,
  CrmTicket,
  CrmTicketChannel,
  CrmTicketPage,
  CrmTicketPriority,
  CrmTicketReferenceData,
  CrmTicketStatus,
  RecordCrmTicketResponseRequest,
  ServiceType,
  TransitionCrmTicketRequest,
} from '@vista/contracts';
import {
  crmTicketChannels,
  crmTicketPriorities,
  crmTicketStatuses,
  serviceTypes,
} from '@vista/contracts';
import { Type } from 'class-transformer';
import {
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

export class CreateCrmTicketDto implements CreateCrmTicketRequest {
  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID(uuid)
  assignedToAccountId?: string;

  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID(uuid)
  categoryId!: string;

  @ApiProperty({ enum: crmTicketChannels })
  @IsIn(crmTicketChannels)
  channel!: CrmTicketChannel;

  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID(uuid)
  customerEquipmentId?: string;

  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID(uuid)
  customerLocationId?: string;

  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID(uuid)
  customerPartnerId!: string;

  @ApiProperty({ maxLength: 4000, minLength: 1, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  description!: string;

  @ApiProperty({ enum: crmTicketPriorities })
  @IsIn(crmTicketPriorities)
  priority!: CrmTicketPriority;

  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID(uuid)
  serviceSubscriptionContractId?: string;

  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID(uuid)
  slaPolicyId!: string;

  @ApiProperty({ maxLength: 255, minLength: 1, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  subject!: string;
}

export class RecordCrmTicketResponseDto implements RecordCrmTicketResponseRequest {
  @ApiProperty({ minimum: 1, type: Number })
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiProperty({ maxLength: 2000, minLength: 1, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  note!: string;
}

export class TransitionCrmTicketDto implements TransitionCrmTicketRequest {
  @ApiProperty({ minimum: 1, type: Number })
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiProperty({ maxLength: 2000, minLength: 1, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  note!: string;

  @ApiProperty({ enum: crmTicketStatuses })
  @IsIn(crmTicketStatuses)
  status!: CrmTicketStatus;
}

export class CreateServiceRequestFromCrmTicketDto implements CreateServiceRequestFromCrmTicketRequest {
  @ApiProperty({ minimum: 1, type: Number })
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiProperty({ enum: serviceTypes })
  @IsIn(serviceTypes)
  serviceType!: ServiceType;

  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID(uuid)
  subscriptionContractId?: string;
}

export class CreateCrmTicketFromServiceRequestDto implements CreateCrmTicketFromServiceRequestRequest {
  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID(uuid)
  assignedToAccountId?: string;

  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID(uuid)
  categoryId!: string;

  @ApiProperty({ enum: crmTicketPriorities })
  @IsIn(crmTicketPriorities)
  priority!: CrmTicketPriority;

  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID(uuid)
  slaPolicyId!: string;
}

export class ListCrmTicketsQueryDto {
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

  @ApiPropertyOptional({ enum: crmTicketPriorities })
  @IsOptional()
  @IsIn(crmTicketPriorities)
  priority?: CrmTicketPriority;

  @ApiPropertyOptional({ maxLength: 100, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ enum: crmTicketStatuses })
  @IsOptional()
  @IsIn(crmTicketStatuses)
  status?: CrmTicketStatus;
}

class CrmTicketCategoryDto {
  @ApiProperty({ type: String })
  code!: string;
  @ApiProperty({ format: 'uuid', type: String })
  id!: string;
  @ApiProperty({ type: String })
  name!: string;
}

class CrmTicketAssigneeDto {
  @ApiProperty({ type: String })
  displayName!: string;
  @ApiProperty({ format: 'uuid', type: String })
  id!: string;
}

class CrmSlaPolicyReferenceDto {
  @ApiPropertyOptional({ format: 'uuid', type: String })
  customerPartnerId?: string;
  @ApiProperty({ format: 'uuid', type: String })
  id!: string;
  @ApiProperty({ type: String })
  name!: string;
  @ApiPropertyOptional({ enum: crmTicketPriorities })
  priority?: CrmTicketPriority;
  @ApiProperty({ type: Number })
  responseMinutes!: number;
  @ApiProperty({ type: Number })
  resolutionMinutes!: number;
  @ApiPropertyOptional({ format: 'uuid', type: String })
  serviceSubscriptionContractId?: string;
}

class CrmTicketHistoryEntryDto {
  @ApiProperty({ format: 'date-time', type: String })
  changedAt!: string;
  @ApiPropertyOptional({ type: String })
  changedByName?: string;
  @ApiProperty({ format: 'uuid', type: String })
  id!: string;
  @ApiPropertyOptional({ type: String })
  note?: string;
  @ApiProperty({ enum: crmTicketStatuses })
  status!: CrmTicketStatus;
  @ApiProperty({ enum: ['created', 'response', 'status_change', 'service_link'] })
  type!: CrmTicket['history'][number]['type'];
}

class CrmTicketServiceLinkDto {
  @ApiProperty({ format: 'uuid', type: String })
  correlationId!: string;
  @ApiProperty({ format: 'uuid', type: String })
  serviceRequestId!: string;
  @ApiProperty({ type: String })
  serviceRequestNumber!: string;
}

export class CrmTicketDto implements CrmTicket {
  @ApiPropertyOptional({ type: () => CrmTicketAssigneeDto })
  assignedTo?: CrmTicketAssigneeDto;
  @ApiProperty({ type: () => CrmTicketCategoryDto })
  category!: CrmTicketCategoryDto;
  @ApiProperty({ enum: crmTicketChannels })
  channel!: CrmTicketChannel;
  @ApiProperty({ format: 'date-time', type: String })
  createdAt!: string;
  @ApiPropertyOptional({ format: 'uuid', type: String })
  customerEquipmentId?: string;
  @ApiPropertyOptional({ format: 'uuid', type: String })
  customerLocationId?: string;
  @ApiProperty({ type: String })
  customerName!: string;
  @ApiProperty({ format: 'uuid', type: String })
  customerPartnerId!: string;
  @ApiProperty({ type: String })
  description!: string;
  @ApiPropertyOptional({ type: String })
  equipmentName?: string;
  @ApiProperty({ isArray: true, type: () => CrmTicketHistoryEntryDto })
  history!: CrmTicketHistoryEntryDto[];
  @ApiProperty({ format: 'uuid', type: String })
  id!: string;
  @ApiPropertyOptional({ type: String })
  locationName?: string;
  @ApiProperty({ type: String })
  number!: string;
  @ApiProperty({ enum: crmTicketPriorities })
  priority!: CrmTicketPriority;
  @ApiPropertyOptional({ format: 'date-time', type: String })
  respondedAt?: string;
  @ApiProperty({ format: 'date-time', type: String })
  responseDueAt!: string;
  @ApiProperty({ enum: ['on_track', 'at_risk', 'breached', 'met'] })
  responseState!: CrmTicket['responseState'];
  @ApiProperty({ format: 'date-time', type: String })
  resolutionDueAt!: string;
  @ApiProperty({ enum: ['on_track', 'at_risk', 'breached', 'met'] })
  resolutionState!: CrmTicket['resolutionState'];
  @ApiPropertyOptional({ format: 'date-time', type: String })
  resolvedAt?: string;
  @ApiPropertyOptional({ type: () => CrmTicketServiceLinkDto })
  serviceLink?: CrmTicketServiceLinkDto;
  @ApiPropertyOptional({ format: 'uuid', type: String })
  serviceSubscriptionContractId?: string;
  @ApiProperty({ type: () => CrmSlaPolicyReferenceDto })
  slaPolicy!: CrmSlaPolicyReferenceDto;
  @ApiProperty({ enum: crmTicketStatuses })
  status!: CrmTicketStatus;
  @ApiProperty({ type: String })
  subject!: string;
  @ApiProperty({ format: 'date-time', type: String })
  updatedAt!: string;
  @ApiProperty({ type: Number })
  version!: number;
}

class CrmTicketSummaryDto {
  @ApiProperty({ type: Number })
  atRisk!: number;
  @ApiProperty({ type: Number })
  breached!: number;
  @ApiProperty({ type: Number })
  open!: number;
  @ApiProperty({ type: Number })
  unassigned!: number;
}

export class CrmTicketPageDto implements CrmTicketPage {
  @ApiProperty({ isArray: true, type: () => CrmTicketDto })
  items!: CrmTicket[];
  @ApiProperty({ type: Number })
  page!: number;
  @ApiProperty({ type: Number })
  pageSize!: number;
  @ApiProperty({ type: () => CrmTicketSummaryDto })
  summary!: CrmTicketPage['summary'];
  @ApiProperty({ type: Number })
  total!: number;
  @ApiProperty({ type: Number })
  totalPages!: number;
}
export class CrmTicketReferenceDataDto implements CrmTicketReferenceData {
  @ApiProperty({ isArray: true, type: () => CrmTicketAssigneeDto })
  assignees!: CrmTicketReferenceData['assignees'];
  @ApiProperty({ type: String })
  businessTimezone!: string;
  @ApiProperty({ isArray: true, type: () => CrmTicketCategoryDto })
  categories!: CrmTicketReferenceData['categories'];
  @ApiProperty({ isArray: true, type: Object })
  customers!: CrmTicketReferenceData['customers'];
  @ApiProperty({ isArray: true, type: Object })
  equipment!: CrmTicketReferenceData['equipment'];
  @ApiProperty({ isArray: true, type: Object })
  locations!: CrmTicketReferenceData['locations'];
  @ApiProperty({ isArray: true, type: () => CrmSlaPolicyReferenceDto })
  slaPolicies!: CrmTicketReferenceData['slaPolicies'];
  @ApiProperty({ isArray: true, type: Object })
  subscriptions!: CrmTicketReferenceData['subscriptions'];
}
