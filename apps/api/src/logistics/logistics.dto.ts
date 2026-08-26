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
  logisticsDeliveryMethods,
  logisticsDeliveryStatuses,
  logisticsReturnDispositions,
  logisticsReturnStatuses,
  logisticsReturnTransportMethods,
  type CompleteLogisticsDeliveryRequest,
  type CreateLogisticsDeliveryRequest,
  type CreateLogisticsReturnLineRequest,
  type CreateLogisticsReturnRequest,
  type CreateLogisticsRouteRequest,
  type CreateLogisticsRouteStopRequest,
  type LogisticsDelivery,
  type LogisticsDeliveryHistoryEntry,
  type LogisticsDeliveryPage,
  type LogisticsReferenceData,
  type LogisticsReturn,
  type LogisticsReturnLine,
  type LogisticsReturnPage,
  type LogisticsRoutePlan,
  type LogisticsRoutePlanPage,
  type LogisticsRouteStop,
  type ReceiveLogisticsReturnRequest,
  type ReportLogisticsDeliveryExceptionRequest,
  type UpdateLogisticsDeliveryStatusRequest,
} from '@vista/contracts';

const decimalPattern = /^\d+(\.\d{1,4})?$/u;

export class ListLogisticsDeliveriesQueryDto {
  @ApiPropertyOptional({ minimum: 1, type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ maximum: 100, minimum: 1, type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 50;

  @ApiPropertyOptional({ enum: logisticsDeliveryStatuses })
  @IsOptional()
  @IsIn(logisticsDeliveryStatuses)
  status?: LogisticsDelivery['status'];
}

export class ListLogisticsReturnsQueryDto {
  @ApiPropertyOptional({ minimum: 1, type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ maximum: 100, minimum: 1, type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 50;

  @ApiPropertyOptional({ enum: logisticsReturnStatuses })
  @IsOptional()
  @IsIn(logisticsReturnStatuses)
  status?: LogisticsReturn['status'];
}

export class ListLogisticsRoutesQueryDto {
  @ApiProperty({ format: 'date', type: String })
  @IsDateString()
  dateFrom!: string;

  @ApiProperty({ format: 'date', type: String })
  @IsDateString()
  dateTo!: string;

  @ApiPropertyOptional({ minimum: 1, type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ maximum: 100, minimum: 1, type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 50;
}

export class CreateLogisticsDeliveryDto implements CreateLogisticsDeliveryRequest {
  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('loose')
  customerLocationId!: string;

  @ApiProperty({ enum: logisticsDeliveryMethods })
  @IsIn(logisticsDeliveryMethods)
  deliveryMethod!: CreateLogisticsDeliveryRequest['deliveryMethod'];

  @ApiPropertyOptional({ maxLength: 2000, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  instructions?: string;

  @ApiProperty({ format: 'date-time', type: String })
  @IsDateString()
  scheduledEnd!: string;

  @ApiProperty({ format: 'date-time', type: String })
  @IsDateString()
  scheduledStart!: string;

  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('loose')
  shipmentId!: string;
}

export class UpdateLogisticsDeliveryStatusDto implements UpdateLogisticsDeliveryStatusRequest {
  @ApiProperty({ minimum: 1, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiPropertyOptional({ maxLength: 1000, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class CompleteLogisticsDeliveryDto implements CompleteLogisticsDeliveryRequest {
  @ApiProperty({ format: 'date-time', type: String })
  @IsDateString()
  deliveredAt!: string;

  @ApiProperty({ minimum: 1, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiPropertyOptional({ maxLength: 2000, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  proofNotes?: string;

  @ApiProperty({ maxLength: 255, type: String })
  @IsString()
  @MaxLength(255)
  recipientName!: string;
}

export class ReportLogisticsDeliveryExceptionDto implements ReportLogisticsDeliveryExceptionRequest {
  @ApiProperty({ minimum: 1, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiProperty({ maxLength: 1000, type: String })
  @IsString()
  @MaxLength(1000)
  reason!: string;
}

export class CreateLogisticsReturnLineDto {
  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID('loose')
  customerEquipmentId?: string;

  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('loose')
  destinationWarehouseId!: string;

  @ApiProperty({ enum: logisticsReturnDispositions })
  @IsIn(logisticsReturnDispositions)
  disposition!: CreateLogisticsReturnLineRequest['disposition'];

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

  @ApiPropertyOptional({ enum: ['warranty', 'out_of_warranty'] })
  @IsOptional()
  @IsIn(['warranty', 'out_of_warranty'])
  serviceType?: CreateLogisticsReturnLineRequest['serviceType'];

  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('loose')
  shipmentLineId!: string;
}

export class CreateLogisticsReturnDto implements CreateLogisticsReturnRequest {
  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('loose')
  customerLocationId!: string;

  @ApiProperty({ isArray: true, maxItems: 50, minItems: 1, type: CreateLogisticsReturnLineDto })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CreateLogisticsReturnLineDto)
  lines!: CreateLogisticsReturnLineRequest[];

  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('loose')
  originalShipmentId!: string;

  @ApiProperty({ maxLength: 2000, type: String })
  @IsString()
  @MaxLength(2000)
  reason!: string;

  @ApiPropertyOptional({ format: 'date-time', type: String })
  @IsOptional()
  @IsDateString()
  scheduledPickupAt?: string;

  @ApiProperty({ enum: logisticsReturnTransportMethods })
  @IsIn(logisticsReturnTransportMethods)
  transportMethod!: CreateLogisticsReturnRequest['transportMethod'];
}

export class ReceiveLogisticsReturnDto implements ReceiveLogisticsReturnRequest {
  @ApiProperty({ minimum: 1, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class CreateLogisticsRouteStopDto implements CreateLogisticsRouteStopRequest {
  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID('loose')
  deliveryId?: string;

  @ApiProperty({ format: 'date-time', type: String })
  @IsDateString()
  plannedArrival!: string;

  @ApiProperty({ maximum: 1440, minimum: 5, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(1440)
  plannedDurationMinutes!: number;

  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID('loose')
  serviceWorkOrderId?: string;

  @ApiProperty({ enum: ['delivery', 'service'] })
  @IsIn(['delivery', 'service'])
  stopType!: CreateLogisticsRouteStopRequest['stopType'];
}

export class CreateLogisticsRouteDto implements CreateLogisticsRouteRequest {
  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID('loose')
  assignedAccountId!: string;

  @ApiPropertyOptional({ maxLength: 2000, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiProperty({ format: 'date', type: String })
  @IsDateString()
  routeDate!: string;

  @ApiProperty({ isArray: true, maxItems: 50, minItems: 1, type: CreateLogisticsRouteStopDto })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CreateLogisticsRouteStopDto)
  stops!: CreateLogisticsRouteStopRequest[];

  @ApiProperty({ maxLength: 255, type: String })
  @IsString()
  @MaxLength(255)
  title!: string;
}

class LogisticsShipmentLineReferenceDto {
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ format: 'uuid', type: String }) originalIssueMovementId!: string;
  @ApiProperty({ format: 'uuid', type: String }) productId!: string;
  @ApiProperty({ type: String }) productName!: string;
  @ApiProperty({ type: String }) quantity!: string;
  @ApiProperty({ isArray: true, type: String }) serialNumbers!: string[];
  @ApiProperty({ enum: ['none', 'serial', 'batch'] }) trackingMode!: 'none' | 'serial' | 'batch';
}

class LogisticsShipmentReferenceDto {
  @ApiProperty({ format: 'uuid', type: String }) customerId!: string;
  @ApiProperty({ type: String }) customerName!: string;
  @ApiProperty({ format: 'uuid', type: String }) handoverCertificateId!: string;
  @ApiProperty({ enum: ['prepared', 'accepted'] }) handoverStatus!: 'prepared' | 'accepted';
  @ApiProperty({ minimum: 1, type: Number }) handoverVersion!: number;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ isArray: true, type: LogisticsShipmentLineReferenceDto })
  lines!: LogisticsReferenceData['shipments'][number]['lines'];
  @ApiProperty({ type: String }) number!: string;
  @ApiProperty({ format: 'date-time', type: String }) shippedAt!: string;
}

class LogisticsLocationReferenceDto {
  @ApiProperty({ type: String }) addressLine1!: string;
  @ApiPropertyOptional({ type: String }) addressLine2?: string;
  @ApiProperty({ type: String }) city!: string;
  @ApiProperty({ type: String }) countryCode!: string;
  @ApiProperty({ format: 'uuid', type: String }) customerId!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiPropertyOptional({ type: String }) postalCode?: string;
}

class LogisticsWarehouseReferenceDto {
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: String }) type!: string;
}

class LogisticsEquipmentReferenceDto {
  @ApiProperty({ format: 'uuid', type: String }) customerId!: string;
  @ApiProperty({ format: 'uuid', type: String }) customerLocationId!: string;
  @ApiProperty({ type: String }) deviceName!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) serialNumber!: string;
  @ApiPropertyOptional({ format: 'date', type: String }) warrantyEndsOn?: string;
}

class LogisticsAssigneeReferenceDto {
  @ApiProperty({ format: 'uuid', type: String }) accountId!: string;
  @ApiProperty({ type: String }) displayName!: string;
  @ApiProperty({ type: String }) email!: string;
}

class LogisticsServiceStopReferenceDto {
  @ApiProperty({ type: String }) addressLine!: string;
  @ApiProperty({ format: 'uuid', type: String }) assignedAccountId!: string;
  @ApiProperty({ type: String }) assignedTo!: string;
  @ApiProperty({ type: String }) city!: string;
  @ApiProperty({ type: String }) customerName!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) label!: string;
  @ApiProperty({ format: 'date-time', type: String }) scheduledEnd!: string;
  @ApiProperty({ format: 'date-time', type: String }) scheduledStart!: string;
}

class LogisticsCourierConnectionDto {
  @ApiProperty({ type: Boolean }) connected!: boolean;
  @ApiProperty({ enum: ['econt', 'speedy'] }) provider!: 'econt' | 'speedy';
}

export class LogisticsReferenceDataDto implements LogisticsReferenceData {
  @ApiProperty({ isArray: true, type: LogisticsAssigneeReferenceDto })
  assignees!: LogisticsReferenceData['assignees'];
  @ApiProperty({ type: String }) businessTimezone!: string;
  @ApiProperty({ isArray: true, type: LogisticsCourierConnectionDto })
  courierConnections!: LogisticsReferenceData['courierConnections'];
  @ApiProperty({ isArray: true, type: LogisticsEquipmentReferenceDto })
  equipment!: LogisticsReferenceData['equipment'];
  @ApiProperty({ isArray: true, type: LogisticsLocationReferenceDto })
  locations!: LogisticsReferenceData['locations'];
  @ApiProperty({ isArray: true, type: LogisticsServiceStopReferenceDto })
  serviceStops!: LogisticsReferenceData['serviceStops'];
  @ApiProperty({ isArray: true, type: LogisticsShipmentReferenceDto })
  shipments!: LogisticsReferenceData['shipments'];
  @ApiProperty({ isArray: true, type: LogisticsWarehouseReferenceDto })
  warehouses!: LogisticsReferenceData['warehouses'];
}

export class LogisticsDeliveryHistoryEntryDto implements LogisticsDeliveryHistoryEntry {
  @ApiProperty({ format: 'date-time', type: String }) changedAt!: string;
  @ApiProperty({ type: String }) changedBy!: string;
  @ApiProperty({ enum: logisticsDeliveryStatuses }) nextStatus!: LogisticsDelivery['status'];
  @ApiPropertyOptional({ type: String }) note?: string;
  @ApiPropertyOptional({ enum: logisticsDeliveryStatuses })
  previousStatus?: LogisticsDelivery['status'];
}

export class LogisticsDeliveryDto implements LogisticsDelivery {
  @ApiProperty({ type: String }) addressLine1!: string;
  @ApiPropertyOptional({ type: String }) addressLine2?: string;
  @ApiProperty({ type: String }) city!: string;
  @ApiProperty({ type: String }) countryCode!: string;
  @ApiProperty({ format: 'date-time', type: String }) createdAt!: string;
  @ApiProperty({ format: 'uuid', type: String }) customerId!: string;
  @ApiProperty({ format: 'uuid', type: String }) customerLocationId!: string;
  @ApiProperty({ type: String }) customerLocationName!: string;
  @ApiProperty({ type: String }) customerName!: string;
  @ApiPropertyOptional({ format: 'date-time', type: String }) deliveredAt?: string;
  @ApiProperty({ enum: logisticsDeliveryMethods })
  deliveryMethod!: LogisticsDelivery['deliveryMethod'];
  @ApiPropertyOptional({ type: String }) exceptionReason?: string;
  @ApiProperty({ format: 'uuid', type: String }) handoverCertificateId!: string;
  @ApiProperty({ enum: ['prepared', 'accepted'] })
  handoverStatus!: LogisticsDelivery['handoverStatus'];
  @ApiProperty({ isArray: true, type: LogisticsDeliveryHistoryEntryDto })
  history!: LogisticsDeliveryHistoryEntry[];
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiPropertyOptional({ type: String }) instructions?: string;
  @ApiProperty({ type: String }) number!: string;
  @ApiPropertyOptional({ type: String }) postalCode?: string;
  @ApiPropertyOptional({ type: String }) proofNotes?: string;
  @ApiPropertyOptional({ type: String }) recipientName?: string;
  @ApiProperty({ format: 'date-time', type: String }) scheduledEnd!: string;
  @ApiProperty({ format: 'date-time', type: String }) scheduledStart!: string;
  @ApiProperty({ format: 'uuid', type: String }) shipmentId!: string;
  @ApiProperty({ type: String }) shipmentNumber!: string;
  @ApiProperty({ enum: logisticsDeliveryStatuses }) status!: LogisticsDelivery['status'];
  @ApiProperty({ type: Number }) version!: number;
}

export class LogisticsDeliveryPageDto implements LogisticsDeliveryPage {
  @ApiProperty({ isArray: true, type: LogisticsDeliveryDto }) items!: LogisticsDelivery[];
  @ApiProperty({ type: Number }) page!: number;
  @ApiProperty({ type: Number }) pageSize!: number;
  @ApiProperty({ type: Number }) total!: number;
  @ApiProperty({ type: Number }) totalPages!: number;
}

export class LogisticsReturnLineDto {
  @ApiPropertyOptional({ format: 'uuid', type: String }) customerEquipmentId?: string;
  @ApiPropertyOptional({ type: String }) customerEquipmentName?: string;
  @ApiProperty({ format: 'uuid', type: String }) destinationWarehouseId!: string;
  @ApiProperty({ type: String }) destinationWarehouseName!: string;
  @ApiProperty({ enum: logisticsReturnDispositions })
  disposition!: LogisticsReturnLine['disposition'];
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiPropertyOptional({ format: 'uuid', type: String }) inventoryReturnMovementId?: string;
  @ApiProperty({ format: 'uuid', type: String }) productId!: string;
  @ApiProperty({ type: String }) productName!: string;
  @ApiProperty({ type: String }) quantity!: string;
  @ApiProperty({ isArray: true, type: String }) serialNumbers!: string[];
  @ApiPropertyOptional({ format: 'uuid', type: String }) serviceRequestId?: string;
  @ApiPropertyOptional({ type: String }) serviceRequestNumber?: string;
  @ApiPropertyOptional({ enum: ['warranty', 'out_of_warranty'] })
  serviceType?: LogisticsReturnLine['serviceType'];
  @ApiProperty({ format: 'uuid', type: String }) shipmentLineId!: string;
}

export class LogisticsReturnDto implements LogisticsReturn {
  @ApiProperty({ format: 'date-time', type: String }) createdAt!: string;
  @ApiProperty({ format: 'uuid', type: String }) customerId!: string;
  @ApiProperty({ format: 'uuid', type: String }) customerLocationId!: string;
  @ApiProperty({ type: String }) customerLocationName!: string;
  @ApiProperty({ type: String }) customerName!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ isArray: true, type: LogisticsReturnLineDto }) lines!: LogisticsReturnLine[];
  @ApiProperty({ type: String }) number!: string;
  @ApiProperty({ format: 'uuid', type: String }) originalShipmentId!: string;
  @ApiProperty({ type: String }) originalShipmentNumber!: string;
  @ApiProperty({ type: String }) reason!: string;
  @ApiPropertyOptional({ format: 'date-time', type: String }) receivedAt?: string;
  @ApiPropertyOptional({ format: 'date-time', type: String }) scheduledPickupAt?: string;
  @ApiProperty({ enum: logisticsReturnStatuses }) status!: LogisticsReturn['status'];
  @ApiProperty({ enum: logisticsReturnTransportMethods })
  transportMethod!: LogisticsReturn['transportMethod'];
  @ApiProperty({ type: Number }) version!: number;
}

export class LogisticsReturnPageDto implements LogisticsReturnPage {
  @ApiProperty({ isArray: true, type: LogisticsReturnDto }) items!: LogisticsReturn[];
  @ApiProperty({ type: Number }) page!: number;
  @ApiProperty({ type: Number }) pageSize!: number;
  @ApiProperty({ type: Number }) total!: number;
  @ApiProperty({ type: Number }) totalPages!: number;
}

export class LogisticsRouteStopDto implements LogisticsRouteStop {
  @ApiProperty({ type: String }) addressLine!: string;
  @ApiProperty({ type: String }) city!: string;
  @ApiPropertyOptional({ format: 'uuid', type: String }) deliveryId?: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) label!: string;
  @ApiProperty({ format: 'date-time', type: String }) plannedArrival!: string;
  @ApiProperty({ type: Number }) plannedDurationMinutes!: number;
  @ApiProperty({ type: Number }) position!: number;
  @ApiPropertyOptional({ format: 'uuid', type: String }) serviceWorkOrderId?: string;
  @ApiProperty({ enum: ['delivery', 'service'] }) stopType!: LogisticsRouteStop['stopType'];
}

export class LogisticsRoutePlanDto implements LogisticsRoutePlan {
  @ApiProperty({ format: 'uuid', type: String }) assignedAccountId!: string;
  @ApiProperty({ type: String }) assignedTo!: string;
  @ApiProperty({ format: 'date-time', type: String }) createdAt!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiPropertyOptional({ type: String }) notes?: string;
  @ApiProperty({ type: String }) number!: string;
  @ApiProperty({ format: 'date', type: String }) routeDate!: string;
  @ApiProperty({ enum: ['planned', 'in_progress', 'completed', 'cancelled'] })
  status!: LogisticsRoutePlan['status'];
  @ApiProperty({ isArray: true, type: LogisticsRouteStopDto }) stops!: LogisticsRouteStop[];
  @ApiProperty({ type: String }) title!: string;
  @ApiProperty({ type: Number }) version!: number;
}

export class LogisticsRoutePlanPageDto implements LogisticsRoutePlanPage {
  @ApiProperty({ isArray: true, type: LogisticsRoutePlanDto }) items!: LogisticsRoutePlan[];
  @ApiProperty({ type: Number }) page!: number;
  @ApiProperty({ type: Number }) pageSize!: number;
  @ApiProperty({ type: Number }) total!: number;
  @ApiProperty({ type: Number }) totalPages!: number;
}
