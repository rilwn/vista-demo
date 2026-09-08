import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { FinanceReportExportDto } from './finance-report-exports.dto.js';
export class LibraryExportDto extends OmitType(FinanceReportExportDto, ['definitionKey'] as const) {
  @ApiProperty({ type: String }) definitionKey!: LibraryView['configuration']['definitionKey'];
}
class LibraryConfigurationDto {
  @ApiProperty({ type: String }) definitionKey!: string;
  @ApiProperty({ enum: ['csv', 'xlsx', 'pdf'] }) format!: string;
  @ApiPropertyOptional({ type: [String] }) columns?: string[];
  @ApiPropertyOptional({ type: String, format: 'date' }) dateFrom?: string;
  @ApiPropertyOptional({ type: String, format: 'date' }) dateTo?: string;
  @ApiPropertyOptional({ type: String }) search?: string;
  @ApiPropertyOptional({ type: String, format: 'uuid' }) businessLocationId?: string;
  @ApiPropertyOptional({ type: String, format: 'uuid' }) cashRegisterId?: string;
  @ApiPropertyOptional({ type: String, format: 'uuid' }) operatorId?: string;
  @ApiPropertyOptional({ type: String, format: 'uuid' }) shiftId?: string;
}
class ReportRunDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'date-time' }) scheduledFor!: string;
  @ApiProperty({ type: LibraryExportDto }) export!: LibraryExportDto;
}
import {
  IsUUID,
  IsIn,
  IsString,
  Length,
  Matches,
  IsBoolean,
  IsInt,
  Min,
  Max,
  IsArray,
  ArrayMaxSize,
  ArrayUnique,
} from 'class-validator';
import {
  reportingScopes,
  reportCadences,
  reportPeriods,
  type ReportScheduleInput,
  type ReportingScope,
  type ReportSchedule,
  type LibraryView,
  type LibraryDefinition,
  type LibraryViewPage,
  type ReportSchedulePage,
  type ReportRunPage,
  type ReportDashboardPreferences,
} from '@vista/contracts';
export class ReportScheduleInputDto implements ReportScheduleInput {
  @ApiProperty({ type: String, format: 'uuid' }) @IsUUID() id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) @IsUUID() viewId!: string;
  @ApiProperty({ enum: reportingScopes }) @IsIn(reportingScopes) scope!: ReportingScope;
  @ApiProperty({ type: String, maxLength: 100 })
  @IsString()
  @Length(1, 100)
  @Matches(/\S/)
  name!: string;
  @ApiProperty({ enum: reportCadences })
  @IsIn(reportCadences)
  cadence!: ReportScheduleInput['cadence'];
  @ApiProperty({ enum: reportPeriods }) @IsIn(reportPeriods) period!: ReportScheduleInput['period'];
  @ApiProperty({ type: String, example: '2026-09-09T09:00' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  firstRunLocal!: string;
}
export class ReportScheduleDto extends ReportScheduleInputDto implements ReportSchedule {
  @ApiProperty({ type: Boolean }) enabled!: boolean;
  @ApiProperty({ type: Number }) version!: number;
  @ApiProperty({ type: String, format: 'date-time' }) nextRunAt!: string;
  @ApiProperty({ type: String }) timezone!: string;
  @ApiPropertyOptional({ type: String }) errorCode?: string;
}
export class ReportScheduleStateDto {
  @ApiProperty({ type: Boolean }) @IsBoolean() enabled!: boolean;
  @ApiProperty({ type: Number }) @IsInt() @Min(0) @Max(2147483646) version!: number;
}
export class LibraryDefinitionDto implements LibraryDefinition {
  @ApiProperty({ type: String }) key!: LibraryDefinition['key'];
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: String }) description!: string;
  @ApiProperty({ enum: reportingScopes }) scope!: ReportingScope;
  @ApiProperty({ type: Boolean }) canCreate!: boolean;
  @ApiProperty({ type: Boolean }) requiresDateRange!: boolean;
  @ApiProperty({ type: [String] }) formats!: LibraryDefinition['formats'];
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
  columns?: NonNullable<LibraryDefinition['columns']>;
}
export class LibraryViewDto implements LibraryView {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ enum: reportingScopes }) scope!: ReportingScope;
  @ApiProperty({ type: Boolean }) canCreate!: boolean;
  @ApiProperty({ type: LibraryConfigurationDto }) configuration!: LibraryView['configuration'];
}
export class LibraryViewPageDto implements LibraryViewPage {
  @ApiProperty({ type: [LibraryViewDto] }) items!: LibraryView[];
  @ApiProperty({ type: Number }) page!: number;
  @ApiProperty({ type: Number }) total!: number;
  @ApiProperty({ type: Number }) totalPages!: number;
}
export class ReportSchedulePageDto implements ReportSchedulePage {
  @ApiProperty({ type: [ReportScheduleDto] }) items!: ReportSchedule[];
  @ApiProperty({ type: Number }) page!: number;
  @ApiProperty({ type: Number }) total!: number;
  @ApiProperty({ type: Number }) totalPages!: number;
}
export class ReportRunPageDto implements ReportRunPage {
  @ApiProperty({ type: [ReportRunDto] }) items!: ReportRunPage['items'];
  @ApiProperty({ type: Number }) page!: number;
  @ApiProperty({ type: Number }) total!: number;
  @ApiProperty({ type: Number }) totalPages!: number;
}
export class ReportDashboardPreferencesDto implements ReportDashboardPreferences {
  @ApiProperty({ type: [String], maxItems: 6 })
  @IsArray()
  @ArrayMaxSize(6)
  @ArrayUnique()
  @IsString({ each: true })
  hiddenCards!: string[];
  @ApiProperty({ type: Number }) @IsInt() @Min(0) @Max(2147483646) version!: number;
}
