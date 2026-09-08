import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  ArrayMaxSize,
  ArrayUnique,
  IsIn,
  IsDateString,
  IsInt,
  Matches,
  Max,
  Min,
} from 'class-validator';
import {
  overviewMetricKeys,
  type OverviewMetricKey,
  type OverviewPreferences,
  type OperationsOverview,
} from '@vista/contracts';

export class OverviewPreferencesDto implements OverviewPreferences {
  @ApiProperty({ type: [String], enum: overviewMetricKeys })
  @IsArray()
  @ArrayMaxSize(4)
  @ArrayUnique()
  @IsIn(overviewMetricKeys, { each: true })
  hiddenCards!: OverviewMetricKey[];

  @ApiProperty({ type: Number, minimum: 0 })
  @IsInt()
  @Min(0)
  @Max(2147483646)
  version!: number;
}

export class OperationsOverviewQueryDto {
  @ApiProperty({ format: 'date', type: String })
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/u)
  dateFrom!: string;
  @ApiProperty({ format: 'date', type: String })
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/u)
  dateTo!: string;
  @ApiPropertyOptional({ default: 30, minimum: 1, maximum: 365, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  warrantyDays = 30;
}

export class OperationsOverviewDto implements OperationsOverview {
  @ApiPropertyOptional({ type: OverviewPreferencesDto }) preferences?: OverviewPreferencesDto;
  @ApiProperty({ format: 'date', type: String }) asOf!: string;
  @ApiProperty({ format: 'date', type: String }) dateFrom!: string;
  @ApiProperty({ format: 'date', type: String }) dateTo!: string;
  @ApiProperty({ type: Number }) warrantyDays!: number;
  @ApiPropertyOptional({ type: String }) recordedRevenueBgn?: string;
  @ApiPropertyOptional({ type: String }) overdueReceivablesBgn?: string;
  @ApiPropertyOptional({ type: Number }) activeServiceRequests?: number;
  @ApiPropertyOptional({ type: Number }) expiringWarranties?: number;
}
