import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn } from 'class-validator';
import {
  reportExportFormats,
  reportExportStatuses,
  serviceReportDefinitionKeys,
  type CreateServiceReportExportRequest,
  type ServiceReportDefinition,
  type ServiceReportExport,
  type ServiceReportExportPage,
} from '@vista/contracts';

export class CreateServiceReportExportDto implements CreateServiceReportExportRequest {
  @ApiProperty({ format: 'date', type: String })
  @IsDateString()
  dateFrom!: string;

  @ApiProperty({ format: 'date', type: String })
  @IsDateString()
  dateTo!: string;

  @ApiProperty({ enum: serviceReportDefinitionKeys })
  @IsIn(serviceReportDefinitionKeys)
  definitionKey!: CreateServiceReportExportRequest['definitionKey'];

  @ApiProperty({ enum: reportExportFormats })
  @IsIn(reportExportFormats)
  format!: CreateServiceReportExportRequest['format'];
}

export class ServiceReportDefinitionDto implements ServiceReportDefinition {
  @ApiProperty({ type: String }) description!: string;
  @ApiProperty({ enum: reportExportFormats, isArray: true })
  formats!: ServiceReportDefinition['formats'];
  @ApiProperty({ enum: serviceReportDefinitionKeys }) key!: ServiceReportDefinition['key'];
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ enum: [true], type: Boolean }) requiresDateRange!: true;
}

export class ServiceReportExportDto implements ServiceReportExport {
  @ApiProperty({ minimum: 0, type: Number }) attemptCount!: number;
  @ApiPropertyOptional({ format: 'date-time', type: String }) completedAt?: string;
  @ApiProperty({ format: 'date-time', type: String }) createdAt!: string;
  @ApiProperty({ enum: serviceReportDefinitionKeys })
  definitionKey!: ServiceReportExport['definitionKey'];
  @ApiPropertyOptional({ type: String }) errorCode?: string;
  @ApiPropertyOptional({ type: String }) fileName?: string;
  @ApiProperty({ enum: reportExportFormats }) format!: ServiceReportExport['format'];
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiPropertyOptional({ minimum: 0, type: Number }) rowCount?: number;
  @ApiPropertyOptional({ minimum: 0, type: Number }) sizeBytes?: number;
  @ApiProperty({ enum: reportExportStatuses }) status!: ServiceReportExport['status'];
}

export class ServiceReportExportPageDto implements ServiceReportExportPage {
  @ApiProperty({ type: [ServiceReportExportDto] }) items!: ServiceReportExport[];
  @ApiProperty({ minimum: 1, type: Number }) page!: number;
  @ApiProperty({ minimum: 1, type: Number }) pageSize!: number;
  @ApiProperty({ minimum: 0, type: Number }) total!: number;
  @ApiProperty({ minimum: 0, type: Number }) totalPages!: number;
}
