import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsString,
  Matches,
  IsDateString,
  IsIn,
  IsOptional,
  IsUUID,
} from 'class-validator';
import {
  posReportDefinitionKeys,
  reportExportFormats,
  reportExportStatuses,
  type CreatePosReportExportRequest,
  type PosReportDefinition,
  type PosReportExport,
  type PosReportExportPage,
} from '@vista/contracts';

export class CreatePosReportExportDto implements CreatePosReportExportRequest {
  @ApiPropertyOptional({ type: [String], minItems: 1, maxItems: 30 })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ArrayUnique()
  @IsString({ each: true })
  columns?: string[];
  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID('loose')
  businessLocationId?: string;

  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID('loose')
  cashRegisterId?: string;

  @ApiPropertyOptional({ format: 'date', type: String })
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/u)
  dateFrom?: string;

  @ApiPropertyOptional({ format: 'date', type: String })
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/u)
  dateTo?: string;

  @ApiProperty({ enum: posReportDefinitionKeys })
  @IsIn(posReportDefinitionKeys)
  definitionKey!: CreatePosReportExportRequest['definitionKey'];

  @ApiProperty({ enum: reportExportFormats })
  @IsIn(reportExportFormats)
  format!: CreatePosReportExportRequest['format'];

  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID('loose')
  operatorId?: string;

  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID('loose')
  shiftId?: string;
}

export class PosReportDefinitionDto implements PosReportDefinition {
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
  columns?: PosReportDefinition['columns'];
  @ApiProperty({ type: String }) description!: string;
  @ApiProperty({ enum: reportExportFormats, isArray: true })
  formats!: PosReportDefinition['formats'];
  @ApiProperty({ enum: posReportDefinitionKeys }) key!: PosReportDefinition['key'];
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: Boolean }) requiresDateRange!: boolean;
  @ApiProperty({ type: Boolean }) requiresShift!: boolean;
}

export class PosReportExportDto implements PosReportExport {
  @ApiProperty({ minimum: 0, type: Number }) attemptCount!: number;
  @ApiPropertyOptional({ format: 'date-time', type: String }) completedAt?: string;
  @ApiProperty({ format: 'date-time', type: String }) createdAt!: string;
  @ApiProperty({ enum: posReportDefinitionKeys })
  definitionKey!: PosReportExport['definitionKey'];
  @ApiPropertyOptional({ type: String }) errorCode?: string;
  @ApiPropertyOptional({ type: String }) fileName?: string;
  @ApiProperty({ enum: reportExportFormats }) format!: PosReportExport['format'];
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiPropertyOptional({ minimum: 0, type: Number }) rowCount?: number;
  @ApiPropertyOptional({ minimum: 0, type: Number }) sizeBytes?: number;
  @ApiProperty({ enum: reportExportStatuses }) status!: PosReportExport['status'];
}

export class PosReportExportPageDto implements PosReportExportPage {
  @ApiProperty({ type: [PosReportExportDto] }) items!: PosReportExport[];
  @ApiProperty({ minimum: 1, type: Number }) page!: number;
  @ApiProperty({ minimum: 1, type: Number }) pageSize!: number;
  @ApiProperty({ minimum: 0, type: Number }) total!: number;
  @ApiProperty({ minimum: 0, type: Number }) totalPages!: number;
}
