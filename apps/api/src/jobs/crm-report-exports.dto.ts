import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn } from 'class-validator';
import {
  crmReportDefinitionKeys,
  reportExportFormats,
  reportExportStatuses,
  type CreateCrmReportExportRequest,
  type CrmReportDefinition,
  type CrmReportExport,
  type CrmReportExportPage,
} from '@vista/contracts';

export class CreateCrmReportExportDto implements CreateCrmReportExportRequest {
  @ApiProperty({ format: 'date', type: String })
  @IsDateString({ strict: true })
  dateFrom!: string;

  @ApiProperty({ format: 'date', type: String })
  @IsDateString({ strict: true })
  dateTo!: string;

  @ApiProperty({ enum: crmReportDefinitionKeys })
  @IsIn(crmReportDefinitionKeys)
  definitionKey!: CreateCrmReportExportRequest['definitionKey'];

  @ApiProperty({ enum: reportExportFormats })
  @IsIn(reportExportFormats)
  format!: CreateCrmReportExportRequest['format'];
}

export class CrmReportDefinitionDto implements CrmReportDefinition {
  @ApiProperty({ type: String }) description!: string;
  @ApiProperty({ enum: reportExportFormats, isArray: true })
  formats!: CrmReportDefinition['formats'];
  @ApiProperty({ enum: crmReportDefinitionKeys }) key!: CrmReportDefinition['key'];
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ enum: [true], type: Boolean }) requiresDateRange!: true;
}

export class CrmReportExportDto implements CrmReportExport {
  @ApiProperty({ minimum: 0, type: Number }) attemptCount!: number;
  @ApiPropertyOptional({ format: 'date-time', type: String }) completedAt?: string;
  @ApiProperty({ format: 'date-time', type: String }) createdAt!: string;
  @ApiProperty({ enum: crmReportDefinitionKeys })
  definitionKey!: CrmReportExport['definitionKey'];
  @ApiPropertyOptional({ type: String }) errorCode?: string;
  @ApiPropertyOptional({ type: String }) fileName?: string;
  @ApiProperty({ enum: reportExportFormats }) format!: CrmReportExport['format'];
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiPropertyOptional({ minimum: 0, type: Number }) rowCount?: number;
  @ApiPropertyOptional({ minimum: 0, type: Number }) sizeBytes?: number;
  @ApiProperty({ enum: reportExportStatuses }) status!: CrmReportExport['status'];
}

export class CrmReportExportPageDto implements CrmReportExportPage {
  @ApiProperty({ type: [CrmReportExportDto] }) items!: CrmReportExport[];
  @ApiProperty({ minimum: 1, type: Number }) page!: number;
  @ApiProperty({ minimum: 1, type: Number }) pageSize!: number;
  @ApiProperty({ minimum: 0, type: Number }) total!: number;
  @ApiProperty({ minimum: 0, type: Number }) totalPages!: number;
}
