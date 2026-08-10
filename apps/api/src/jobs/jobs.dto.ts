import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type {
  BackgroundJobState,
  BackgroundJobSummary,
  BackgroundJobTelemetry,
} from '@vista/contracts';

export class BackgroundJobTelemetryDto implements BackgroundJobTelemetry {
  @ApiProperty({ minimum: 0, type: Number }) active!: number;
  @ApiProperty({ minimum: 0, type: Number }) completed!: number;
  @ApiProperty({ minimum: 0, type: Number }) delayed!: number;
  @ApiProperty({ minimum: 0, type: Number }) failed!: number;
  @ApiProperty({ type: Boolean }) paused!: boolean;
  @ApiProperty({ format: 'date-time', type: String }) timestamp!: string;
  @ApiProperty({ minimum: 0, type: Number }) waiting!: number;
}

export class BackgroundJobSummaryDto implements BackgroundJobSummary {
  @ApiProperty({ minimum: 0, type: Number }) attemptsMade!: number;
  @ApiProperty({ format: 'date-time', type: String }) createdAt!: string;
  @ApiPropertyOptional({ format: 'date-time', type: String }) failedAt?: string;
  @ApiPropertyOptional({ format: 'date-time', type: String }) finishedAt?: string;
  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ example: 'notification.dispatch', type: String }) name!: string;
  @ApiPropertyOptional({ format: 'date-time', type: String }) processedAt?: string;
  @ApiProperty({
    enum: [
      'active',
      'completed',
      'delayed',
      'failed',
      'prioritized',
      'unknown',
      'waiting',
      'waiting-children',
    ],
  })
  state!: BackgroundJobState;
}
