import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
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
  IsInt,
  Min,
  Max,
  MaxLength,
  IsUUID,
  Length,
} from 'class-validator';
import {
  erpReportScopes,
  reportExportFormats,
  reportExportStatuses,
  erpReportDefinitionKeys,
  type ErpReportRequest,
  type ErpReportDefinition,
  type ErpReportExport,
  type ErpReportExportPage,
} from '@vista/contracts';

export class CreateErpReportExportDto implements ErpReportRequest {
  @ApiPropertyOptional({ type: String, maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
  @ApiPropertyOptional({ type: [String], minItems: 1, maxItems: 30 })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ArrayUnique()
  @IsString({ each: true })
  columns?: string[];

  @ApiPropertyOptional({ format: 'date', type: String })
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/u)
  @IsOptional()
  dateFrom?: string;

  @ApiPropertyOptional({ format: 'date', type: String })
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/u)
  @IsOptional()
  dateTo?: string;

  @ApiProperty({ enum: erpReportDefinitionKeys })
  @IsIn(erpReportDefinitionKeys)
  definitionKey!: ErpReportRequest['definitionKey'];

  @ApiProperty({ enum: reportExportFormats })
  @IsIn(reportExportFormats)
  format!: ErpReportRequest['format'];
}

export class ErpReportDefinitionDto implements ErpReportDefinition {
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
  columns!: NonNullable<ErpReportDefinition['columns']>;
  @ApiProperty({ type: String }) description!: string;
  @ApiProperty({ enum: reportExportFormats, isArray: true })
  formats!: ErpReportDefinition['formats'];
  @ApiProperty({ enum: erpReportDefinitionKeys }) key!: ErpReportDefinition['key'];
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: Boolean }) requiresDateRange!: boolean;
}

export class ErpReportExportDto implements ErpReportExport {
  @ApiProperty({ minimum: 0, type: Number }) attemptCount!: number;
  @ApiPropertyOptional({ format: 'date-time', type: String }) completedAt?: string;
  @ApiProperty({ format: 'date-time', type: String }) createdAt!: string;
  @ApiProperty({ enum: erpReportDefinitionKeys })
  definitionKey!: ErpReportExport['definitionKey'];
  @ApiPropertyOptional({ type: String }) errorCode?: string;
  @ApiPropertyOptional({ type: String }) fileName?: string;
  @ApiProperty({ enum: reportExportFormats }) format!: ErpReportExport['format'];
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiPropertyOptional({ minimum: 0, type: Number }) rowCount?: number;
  @ApiPropertyOptional({ minimum: 0, type: Number }) sizeBytes?: number;
  @ApiProperty({ enum: reportExportStatuses }) status!: ErpReportExport['status'];
}

export class ErpReportExportPageDto implements ErpReportExportPage {
  @ApiProperty({ type: [ErpReportExportDto] }) items!: ErpReportExport[];
  @ApiProperty({ minimum: 1, type: Number }) page!: number;
  @ApiProperty({ minimum: 1, type: Number }) pageSize!: number;
  @ApiProperty({ minimum: 0, type: Number }) total!: number;
  @ApiProperty({ minimum: 0, type: Number }) totalPages!: number;
}

export class ErpReportScopeDto {
  @ApiProperty({ enum: erpReportScopes })
  @IsIn(erpReportScopes)
  scope!: (typeof erpReportScopes)[number];
}
export class ErpReportPreviewQueryDto extends OmitType(CreateErpReportExportDto, [
  'format',
  'columns',
] as const) {
  @ApiPropertyOptional({ type: Number, minimum: 1, default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000000)
  page = 1;
}
export class ErpReportPreviewDto {
  @ApiProperty({
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
  columns!: NonNullable<ErpReportDefinition['columns']>;
  @ApiProperty({
    type: 'array',
    items: {
      type: 'object',
      additionalProperties: { oneOf: [{ type: 'string' }, { type: 'number' }] },
    },
  })
  rows!: Record<string, string | number>[];
  @ApiProperty({ type: Number }) page!: number;
  @ApiProperty({ type: Number }) total!: number;
  @ApiProperty({ type: Number }) totalPages!: number;
  @ApiProperty({ type: String }) generatedAt!: string;
}
export class SavedErpReportDto extends CreateErpReportExportDto {
  @ApiProperty({ type: String, format: 'uuid' }) @IsUUID() id!: string;
  @ApiProperty({ type: String, minLength: 1, maxLength: 100 })
  @IsString()
  @Length(1, 100)
  @Matches(/\S/u)
  name!: string;
}
export class SavedErpReportPageDto {
  @ApiProperty({ type: [SavedErpReportDto] }) items!: SavedErpReportDto[];
  @ApiProperty({ type: Number }) page!: number;
  @ApiProperty({ type: Number }) total!: number;
  @ApiProperty({ type: Number }) totalPages!: number;
}
