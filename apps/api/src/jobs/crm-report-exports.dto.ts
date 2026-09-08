import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsString,
  IsOptional,
  Matches,
  IsDateString,
  IsIn,
} from 'class-validator';
import {
  reportExportFormats,
  reportExportStatuses,
  crmReportDefinitionKeys,
  type CreateCrmReportExportRequest,
  type CrmReportDefinition,
  type CrmReportExport,
  type CrmReportExportPage,
} from '@vista/contracts';

export class CreateCrmReportExportDto implements CreateCrmReportExportRequest {
  @ApiPropertyOptional({ type: [String], minItems: 1, maxItems: 30 })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ArrayUnique()
  @IsString({ each: true })
  columns?: string[];

  @ApiProperty({ format: 'date', type: String })
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/u)
  dateFrom!: string;

  @ApiProperty({ format: 'date', type: String })
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/u)
  dateTo!: string;

  @ApiProperty({ enum: crmReportDefinitionKeys })
  @IsIn(crmReportDefinitionKeys)
  definitionKey!: CreateCrmReportExportRequest['definitionKey'];

  @ApiProperty({ enum: reportExportFormats })
  @IsIn(reportExportFormats)
  format!: CreateCrmReportExportRequest['format'];
}

export class CrmReportDefinitionDto implements CrmReportDefinition {
  @ApiPropertyOptional({
    type: 'array',
    items: {
      type: 'object',
      required: ['key', 'label', 'type'],
      properties: {
        key: { type: 'string' },
        label: { type: 'string' },
        type: { type: 'string', enum: ['date', 'money', 'number', 'text'] },
      },
    },
  })
  columns?: CrmReportDefinition['columns'];
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
