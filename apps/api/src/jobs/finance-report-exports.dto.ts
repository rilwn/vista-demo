import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsString,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  Matches,
  Max,
  Min,
} from 'class-validator';
import {
  financeReportDefinitionKeys,
  reportExportFormats,
  reportExportStatuses,
  type CreateFinanceReportExportRequest,
  type FinanceReportDefinition,
  type FinanceReportExport,
  type FinanceReportExportPage,
} from '@vista/contracts';

export class CreateFinanceReportExportDto implements CreateFinanceReportExportRequest {
  @ApiPropertyOptional({ type: [String], minItems: 1, maxItems: 30 })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ArrayUnique()
  @IsString({ each: true })
  columns?: string[];

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

  @ApiProperty({ enum: financeReportDefinitionKeys })
  @IsIn(financeReportDefinitionKeys)
  definitionKey!: CreateFinanceReportExportRequest['definitionKey'];

  @ApiProperty({ enum: reportExportFormats })
  @IsIn(reportExportFormats)
  format!: CreateFinanceReportExportRequest['format'];
}

export class FinanceReportExportPageQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20, maximum: 100, minimum: 1, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}

export class FinanceReportDefinitionDto implements FinanceReportDefinition {
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
  columns?: NonNullable<FinanceReportDefinition['columns']>;
  @ApiProperty({ type: String }) description!: string;
  @ApiProperty({ enum: reportExportFormats, isArray: true })
  formats!: FinanceReportDefinition['formats'];
  @ApiProperty({ enum: financeReportDefinitionKeys }) key!: FinanceReportDefinition['key'];
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: Boolean }) requiresDateRange!: boolean;
}

export class FinanceReportExportDto implements FinanceReportExport {
  @ApiProperty({ minimum: 0, type: Number }) attemptCount!: number;
  @ApiPropertyOptional({ format: 'date-time', type: String }) completedAt?: string;
  @ApiProperty({ format: 'date-time', type: String }) createdAt!: string;
  @ApiProperty({ enum: financeReportDefinitionKeys })
  definitionKey!: FinanceReportExport['definitionKey'];
  @ApiPropertyOptional({ type: String }) errorCode?: string;
  @ApiPropertyOptional({ type: String }) fileName?: string;
  @ApiProperty({ enum: reportExportFormats }) format!: FinanceReportExport['format'];
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiPropertyOptional({ minimum: 0, type: Number }) rowCount?: number;
  @ApiPropertyOptional({ minimum: 0, type: Number }) sizeBytes?: number;
  @ApiProperty({ enum: reportExportStatuses }) status!: FinanceReportExport['status'];
}

export class FinanceReportExportPageDto implements FinanceReportExportPage {
  @ApiProperty({ type: [FinanceReportExportDto] }) items!: FinanceReportExport[];
  @ApiProperty({ minimum: 1, type: Number }) page!: number;
  @ApiProperty({ minimum: 1, type: Number }) pageSize!: number;
  @ApiProperty({ minimum: 0, type: Number }) total!: number;
  @ApiProperty({ minimum: 0, type: Number }) totalPages!: number;
}
