import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
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
  ValidateNested,
} from 'class-validator';
import {
  servicePriorities,
  serviceRequestChannels,
  serviceTypes,
  type AssignServiceWorkOrderRequest,
  type CancelServiceRequest,
  type CompleteServiceWorkOrderRequest,
  type CreateServiceRequest,
  type ServiceEquipmentHistory,
  type ServiceEquipmentHistoryEvent,
  type ServicePartUsageInput,
  type ServiceReferenceData,
  type ServiceRequest,
  type ServiceRequestPage,
  type ServiceRequestStatus,
  type ServiceTechnicianReference,
  type ServiceWorkOrder,
  type ServiceWorkOrderHistoryEntry,
  type ServiceWorkOrderPartUsage,
  type ServiceWorkOrderPage,
  type ServiceWorkOrderPhoto,
  type ServiceWorkOrderSignature,
  type ServiceWorkOrderTimeEntry,
  type StartServiceWorkOrderRequest,
  type ServiceWorkTimeEntryInput,
} from '@vista/contracts';

const decimalPattern = /^\d+(\.\d{1,4})?$/u;

export class CreateServiceRequestDto implements CreateServiceRequest {
  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('4')
  customerEquipmentId!: string;

  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('4')
  customerLocationId!: string;

  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('4')
  customerPartnerId!: string;

  @ApiProperty({ enum: servicePriorities })
  @IsIn(servicePriorities)
  priority!: CreateServiceRequest['priority'];

  @ApiProperty({ maxLength: 4000, minLength: 1, type: String })
  @IsString()
  @MaxLength(4000)
  problemDescription!: string;

  @ApiProperty({ enum: serviceRequestChannels })
  @IsIn(serviceRequestChannels)
  sourceChannel!: CreateServiceRequest['sourceChannel'];

  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID('4')
  subscriptionContractId?: string;

  @ApiProperty({ enum: serviceTypes })
  @IsIn(serviceTypes)
  serviceType!: CreateServiceRequest['serviceType'];
}

export class AssignServiceWorkOrderDto implements AssignServiceWorkOrderRequest {
  @ApiProperty({ minimum: 1, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiProperty({ format: 'date-time', type: String })
  @IsDateString()
  scheduledEnd!: string;

  @ApiProperty({ format: 'date-time', type: String })
  @IsDateString()
  scheduledStart!: string;

  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('4')
  technicianAccountId!: string;

  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('4')
  technicianWarehouseId!: string;
}

export class StartServiceWorkOrderDto implements StartServiceWorkOrderRequest {
  @ApiProperty({ minimum: 1, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class ServiceWorkTimeEntryInputDto implements ServiceWorkTimeEntryInput {
  @ApiProperty({ maximum: 1440, minimum: 1, type: Number })
  @Type(() => Number)
  @IsInt()
  @Max(1440)
  @Min(1)
  minutes!: number;

  @ApiPropertyOptional({ maxLength: 1000, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @ApiProperty({ format: 'date', type: String })
  @IsDateString()
  workDate!: string;
}

export class ServicePartUsageInputDto implements ServicePartUsageInput {
  @ApiPropertyOptional({ maxLength: 100, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  batchNumber?: string;

  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('4')
  productId!: string;

  @ApiProperty({ example: '1.0000', type: String })
  @IsString()
  @Matches(decimalPattern)
  quantity!: string;

  @ApiPropertyOptional({ isArray: true, maxItems: 100, type: String })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  serialNumbers?: string[];
}

export class CompleteServiceWorkOrderDto implements CompleteServiceWorkOrderRequest {
  @ApiProperty({ maxLength: 4000, minLength: 1, type: String })
  @IsString()
  @MaxLength(4000)
  completionNotes!: string;

  @ApiProperty({ minimum: 1, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiProperty({ example: '60.0000', type: String })
  @IsString()
  @Matches(decimalPattern)
  laborCostBgn!: string;

  @ApiProperty({ isArray: true, maxItems: 50, type: ServicePartUsageInputDto })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ServicePartUsageInputDto)
  parts!: ServicePartUsageInput[];

  @ApiProperty({
    description: 'PNG data URL produced by the customer signature pad.',
    maxLength: 140000,
    type: String,
  })
  @IsString()
  @MaxLength(140000)
  signatureImageDataUrl!: string;

  @ApiProperty({ maxLength: 255, minLength: 1, type: String })
  @IsString()
  @MaxLength(255)
  signerName!: string;

  @ApiProperty({ isArray: true, maxItems: 50, minItems: 1, type: ServiceWorkTimeEntryInputDto })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ServiceWorkTimeEntryInputDto)
  timeEntries!: ServiceWorkTimeEntryInput[];

  @ApiProperty({ example: '10.0000', type: String })
  @IsString()
  @Matches(decimalPattern)
  transportCostBgn!: string;
}

export class CancelServiceRequestDto implements CancelServiceRequest {
  @ApiProperty({ maxLength: 1000, minLength: 1, type: String })
  @IsString()
  @MaxLength(1000)
  cancellationReason!: string;

  @ApiProperty({ minimum: 1, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class ListServiceRequestsQueryDto {
  @ApiProperty({ default: 1, minimum: 1, type: Number })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page = 1;

  @ApiProperty({ default: 25, maximum: 100, minimum: 1, type: Number })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Max(100)
  @Min(1)
  pageSize = 25;

  @ApiPropertyOptional({ enum: ['new', 'scheduled', 'in_progress', 'completed', 'cancelled'] })
  @IsOptional()
  @IsIn(['new', 'scheduled', 'in_progress', 'completed', 'cancelled'])
  status?: ServiceRequestStatus;
}

export class ListServiceWorkOrdersQueryDto {
  @ApiProperty({ default: 1, minimum: 1, type: Number })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page = 1;

  @ApiProperty({ default: 25, maximum: 100, minimum: 1, type: Number })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Max(100)
  @Min(1)
  pageSize = 25;

  @ApiPropertyOptional({ enum: ['scheduled', 'in_progress', 'completed', 'cancelled'] })
  @IsOptional()
  @IsIn(['scheduled', 'in_progress', 'completed', 'cancelled'])
  status?: ServiceWorkOrder['status'];
}

class ServiceCustomerReferenceDto {
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) name!: string;
}

class ServiceLocationReferenceDto {
  @ApiProperty({ format: 'uuid', type: String }) customerPartnerId!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) name!: string;
}

class ServiceEquipmentReferenceDto {
  @ApiProperty({ type: Boolean }) active!: boolean;
  @ApiProperty({ format: 'uuid', type: String }) customerLocationId!: string;
  @ApiProperty({ format: 'uuid', type: String }) customerPartnerId!: string;
  @ApiProperty({ type: String }) deviceName!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) serialNumber!: string;
  @ApiProperty({ enum: ['active', 'under_repair', 'retired'] }) status!: string;
  @ApiPropertyOptional({ format: 'date', type: String }) warrantyEndsOn?: string;
}

class ServiceTechnicianReferenceDto {
  @ApiProperty({ format: 'uuid', type: String }) accountId!: string;
  @ApiProperty({ type: String }) displayName!: string;
  @ApiProperty({ type: String }) email!: string;
  @ApiProperty({ format: 'uuid', type: String }) warehouseId!: string;
  @ApiProperty({ type: String }) warehouseName!: string;
}

class ServicePartReferenceDto {
  @ApiProperty({ type: String }) availableQuantity!: string;
  @ApiProperty({ type: String }) productCode!: string;
  @ApiProperty({ format: 'uuid', type: String }) productId!: string;
  @ApiProperty({ type: String }) productName!: string;
  @ApiProperty({ enum: ['none', 'serial', 'batch'] }) trackingMode!: string;
  @ApiProperty({ format: 'uuid', type: String }) warehouseId!: string;
}

class ServiceSubscriptionReferenceDto {
  @ApiProperty({ format: 'uuid', isArray: true, type: String }) customerEquipmentIds!: string[];
  @ApiProperty({ format: 'uuid', type: String }) customerLocationId!: string;
  @ApiProperty({ format: 'uuid', type: String }) customerPartnerId!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) number!: string;
}

export class ServiceReferenceDataDto implements ServiceReferenceData {
  @ApiProperty({ example: 'Europe/Sofia', type: String }) businessTimezone!: string;
  @ApiProperty({ isArray: true, type: ServiceCustomerReferenceDto })
  customers!: ServiceReferenceData['customers'];
  @ApiProperty({ isArray: true, type: ServiceEquipmentReferenceDto })
  equipment!: ServiceReferenceData['equipment'];
  @ApiProperty({ isArray: true, type: ServiceLocationReferenceDto })
  locations!: ServiceReferenceData['locations'];
  @ApiProperty({ isArray: true, type: ServicePartReferenceDto })
  parts!: ServiceReferenceData['parts'];
  @ApiProperty({ isArray: true, type: ServiceSubscriptionReferenceDto })
  subscriptions!: ServiceReferenceData['subscriptions'];
  @ApiProperty({ isArray: true, type: ServiceTechnicianReferenceDto })
  technicians!: ServiceReferenceData['technicians'];
}

class ServiceTechnicianDto extends ServiceTechnicianReferenceDto {}

export class ServiceRequestDto implements ServiceRequest {
  @ApiPropertyOptional({ type: ServiceTechnicianDto })
  assignedTechnician?: ServiceTechnicianReference;
  @ApiPropertyOptional({ format: 'date-time', type: String }) completedAt?: string;
  @ApiProperty({ format: 'date-time', type: String }) createdAt!: string;
  @ApiProperty({ format: 'uuid', type: String }) customerEquipmentId!: string;
  @ApiProperty({ format: 'uuid', type: String }) customerLocationId!: string;
  @ApiProperty({ type: String }) customerLocationName!: string;
  @ApiProperty({ type: String }) customerName!: string;
  @ApiProperty({ format: 'uuid', type: String }) customerPartnerId!: string;
  @ApiProperty({ type: String }) deviceName!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) number!: string;
  @ApiProperty({ enum: servicePriorities }) priority!: ServiceRequest['priority'];
  @ApiProperty({ type: String }) problemDescription!: string;
  @ApiPropertyOptional({ format: 'date-time', type: String }) scheduledEnd?: string;
  @ApiPropertyOptional({ format: 'date-time', type: String }) scheduledStart?: string;
  @ApiProperty({ type: String }) serialNumber!: string;
  @ApiProperty({ enum: serviceTypes }) serviceType!: ServiceRequest['serviceType'];
  @ApiProperty({ enum: serviceRequestChannels }) sourceChannel!: ServiceRequest['sourceChannel'];
  @ApiProperty({ enum: ['new', 'scheduled', 'in_progress', 'completed', 'cancelled'] })
  status!: ServiceRequest['status'];
  @ApiPropertyOptional({ format: 'uuid', type: String }) subscriptionContractId?: string;
  @ApiProperty({ format: 'date-time', type: String }) updatedAt!: string;
  @ApiProperty({ minimum: 1, type: Number }) version!: number;
  @ApiPropertyOptional({ format: 'uuid', type: String }) workOrderId?: string;
  @ApiPropertyOptional({ type: String }) workOrderNumber?: string;
}

class ServiceRequestSummaryDto {
  @ApiProperty({ minimum: 0, type: Number }) completed!: number;
  @ApiProperty({ minimum: 0, type: Number }) inProgress!: number;
  @ApiProperty({ minimum: 0, type: Number }) new!: number;
  @ApiProperty({ minimum: 0, type: Number }) scheduled!: number;
}

export class ServiceRequestPageDto implements ServiceRequestPage {
  @ApiProperty({ isArray: true, type: ServiceRequestDto }) items!: ServiceRequest[];
  @ApiProperty({ minimum: 1, type: Number }) page!: number;
  @ApiProperty({ minimum: 1, type: Number }) pageSize!: number;
  @ApiProperty({ type: ServiceRequestSummaryDto })
  summary!: ServiceRequestPage['summary'];
  @ApiProperty({ minimum: 0, type: Number }) total!: number;
  @ApiProperty({ minimum: 0, type: Number }) totalPages!: number;
}

class ServiceWorkOrderTimeEntryDto implements ServiceWorkOrderTimeEntry {
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: Number }) minutes!: number;
  @ApiPropertyOptional({ type: String }) note?: string;
  @ApiProperty({ format: 'date-time', type: String }) recordedAt!: string;
  @ApiProperty({ format: 'date', type: String }) workDate!: string;
}

class ServiceWorkOrderPartUsageDto implements ServiceWorkOrderPartUsage {
  @ApiPropertyOptional({ type: String }) batchNumber?: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ format: 'uuid', type: String }) productId!: string;
  @ApiProperty({ type: String }) productName!: string;
  @ApiProperty({ type: String }) quantity!: string;
  @ApiProperty({ isArray: true, type: String }) serialNumbers!: string[];
  @ApiProperty({ format: 'uuid', type: String }) stockIssueId!: string;
  @ApiProperty({ type: String }) totalCostBgn!: string;
  @ApiProperty({ type: String }) unitCostBgn!: string;
  @ApiProperty({ format: 'uuid', type: String }) warehouseId!: string;
  @ApiProperty({ type: String }) warehouseName!: string;
}

export class ServiceWorkOrderPhotoDto implements ServiceWorkOrderPhoto {
  @ApiProperty({ format: 'date-time', type: String }) capturedAt!: string;
  @ApiProperty({ type: String }) fileName!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ enum: ['image/jpeg', 'image/png', 'image/webp'] })
  mediaType!: ServiceWorkOrderPhoto['mediaType'];
  @ApiProperty({ type: Number }) sizeBytes!: number;
}

class ServiceWorkOrderSignatureDto implements ServiceWorkOrderSignature {
  @ApiProperty({ format: 'date-time', type: String }) signedAt!: string;
  @ApiProperty({ type: String }) signerName!: string;
}

class ServiceWorkOrderHistoryEntryDto implements ServiceWorkOrderHistoryEntry {
  @ApiProperty({ format: 'date-time', type: String }) changedAt!: string;
  @ApiPropertyOptional({ type: String }) changedByName?: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ enum: ['scheduled', 'in_progress', 'completed', 'cancelled'] })
  nextStatus!: ServiceWorkOrderHistoryEntry['nextStatus'];
  @ApiPropertyOptional({ enum: ['scheduled', 'in_progress', 'completed', 'cancelled'] })
  previousStatus?: NonNullable<ServiceWorkOrderHistoryEntry['previousStatus']>;
  @ApiProperty({ type: String }) reason!: string;
}

export class ServiceWorkOrderDto implements ServiceWorkOrder {
  @ApiPropertyOptional({ type: ServiceTechnicianDto })
  assignedTechnician?: ServiceTechnicianReference;
  @ApiPropertyOptional({ format: 'date-time', type: String }) completedAt?: string;
  @ApiPropertyOptional({ type: String }) completionNotes?: string;
  @ApiProperty({ format: 'date-time', type: String }) createdAt!: string;
  @ApiProperty({ format: 'uuid', type: String }) customerEquipmentId!: string;
  @ApiProperty({ format: 'uuid', type: String }) customerLocationId!: string;
  @ApiProperty({ type: String }) customerLocationName!: string;
  @ApiProperty({ type: String }) customerName!: string;
  @ApiProperty({ format: 'uuid', type: String }) customerPartnerId!: string;
  @ApiProperty({ type: String }) deviceName!: string;
  @ApiProperty({ isArray: true, type: ServiceWorkOrderHistoryEntryDto })
  history!: ServiceWorkOrder['history'];
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) laborCostBgn!: string;
  @ApiProperty({ type: Number }) laborMinutes!: number;
  @ApiProperty({ type: String }) number!: string;
  @ApiProperty({ isArray: true, type: ServiceWorkOrderPartUsageDto })
  parts!: ServiceWorkOrder['parts'];
  @ApiProperty({ type: String }) partsCostBgn!: string;
  @ApiProperty({ isArray: true, type: ServiceWorkOrderPhotoDto })
  photos!: ServiceWorkOrder['photos'];
  @ApiProperty({ enum: servicePriorities }) priority!: ServiceWorkOrder['priority'];
  @ApiProperty({ type: String }) problemDescription!: string;
  @ApiProperty({ format: 'uuid', type: String }) requestId!: string;
  @ApiProperty({ type: String }) requestNumber!: string;
  @ApiPropertyOptional({ format: 'date-time', type: String }) scheduledEnd?: string;
  @ApiPropertyOptional({ format: 'date-time', type: String }) scheduledStart?: string;
  @ApiProperty({ type: String }) serialNumber!: string;
  @ApiProperty({ enum: serviceTypes }) serviceType!: ServiceWorkOrder['serviceType'];
  @ApiPropertyOptional({ type: ServiceWorkOrderSignatureDto }) signature?: NonNullable<
    ServiceWorkOrder['signature']
  >;
  @ApiPropertyOptional({ format: 'date-time', type: String }) startedAt?: string;
  @ApiProperty({ enum: ['scheduled', 'in_progress', 'completed', 'cancelled'] })
  status!: ServiceWorkOrder['status'];
  @ApiPropertyOptional({ format: 'uuid', type: String }) subscriptionContractId?: string;
  @ApiProperty({ isArray: true, type: ServiceWorkOrderTimeEntryDto })
  timeEntries!: ServiceWorkOrder['timeEntries'];
  @ApiProperty({ type: String }) totalCostBgn!: string;
  @ApiProperty({ type: String }) transportCostBgn!: string;
  @ApiProperty({ format: 'date-time', type: String }) updatedAt!: string;
  @ApiProperty({ minimum: 1, type: Number }) version!: number;
}

export class ServiceWorkOrderPageDto implements ServiceWorkOrderPage {
  @ApiProperty({ isArray: true, type: ServiceWorkOrderDto }) items!: ServiceWorkOrder[];
  @ApiProperty({ minimum: 1, type: Number }) page!: number;
  @ApiProperty({ minimum: 1, type: Number }) pageSize!: number;
  @ApiProperty({ minimum: 0, type: Number }) total!: number;
  @ApiProperty({ minimum: 0, type: Number }) totalPages!: number;
}

class ServiceEquipmentHistoryEventDto implements ServiceEquipmentHistoryEvent {
  @ApiPropertyOptional({ format: 'date-time', type: String }) completedAt?: string;
  @ApiProperty({ type: String }) description!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ format: 'date-time', type: String }) occurredAt!: string;
  @ApiProperty({ isArray: true, type: ServiceWorkOrderPartUsageDto })
  parts!: ServiceEquipmentHistoryEvent['parts'];
  @ApiProperty({ enum: serviceTypes }) serviceType!: ServiceEquipmentHistoryEvent['serviceType'];
  @ApiProperty({ enum: ['scheduled', 'in_progress', 'completed', 'cancelled'] })
  status!: ServiceEquipmentHistoryEvent['status'];
  @ApiPropertyOptional({ type: String }) technicianName?: string;
  @ApiProperty({ type: String }) workOrderNumber!: string;
}

export class ServiceEquipmentHistoryDto implements ServiceEquipmentHistory {
  @ApiProperty({ type: String }) deviceName!: string;
  @ApiProperty({ format: 'uuid', type: String }) equipmentId!: string;
  @ApiProperty({ isArray: true, type: ServiceEquipmentHistoryEventDto })
  events!: ServiceEquipmentHistory['events'];
  @ApiProperty({ type: String }) serialNumber!: string;
  @ApiPropertyOptional({ format: 'date', type: String }) warrantyEndsOn?: string;
}
