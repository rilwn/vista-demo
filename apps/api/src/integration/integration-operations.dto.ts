import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type {
  IntegrationDeliveryStatus,
  IntegrationDeliverySummary,
  IntegrationEventDetail,
  IntegrationEventPage,
  IntegrationEventStatus,
  IntegrationEventSummary,
  IntegrationEventTelemetry,
  ReplayIntegrationEventRequest,
} from '@vista/contracts';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

const eventStatuses: IntegrationEventStatus[] = [
  'pending',
  'publishing',
  'published',
  'completed',
  'dead_letter',
];

export class IntegrationEventListQueryDto {
  @ApiPropertyOptional({ maxLength: 255, type: String })
  @IsString()
  @Matches(/^[a-z][a-z0-9._-]+$/u)
  @MaxLength(255)
  @IsOptional()
  eventType?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1, type: Number })
  @IsInt()
  @Min(1)
  @Type(() => Number)
  @IsOptional()
  page = 1;

  @ApiPropertyOptional({ default: 25, maximum: 100, minimum: 1, type: Number })
  @IsInt()
  @Max(100)
  @Min(1)
  @Type(() => Number)
  @IsOptional()
  pageSize = 25;

  @ApiPropertyOptional({ enum: eventStatuses })
  @IsIn(eventStatuses)
  @IsOptional()
  status?: IntegrationEventStatus;
}

export class ReplayIntegrationEventDto implements ReplayIntegrationEventRequest {
  @ApiProperty({ minimum: 0, type: Number })
  @IsInt()
  @Min(0)
  expectedReplayCount!: number;
}

export class IntegrationDeliverySummaryDto implements IntegrationDeliverySummary {
  @ApiProperty({ minimum: 0, type: Number }) attemptCount!: number;
  @ApiPropertyOptional({ format: 'date-time', type: String }) completedAt?: string;
  @ApiProperty({ type: String }) consumer!: string;
  @ApiProperty({ minimum: 0, type: Number }) cycleAttemptCount!: number;
  @ApiPropertyOptional({ format: 'date-time', type: String }) deadLetteredAt?: string;
  @ApiPropertyOptional({ format: 'date-time', type: String }) failedAt?: string;
  @ApiPropertyOptional({ type: String }) lastErrorCode?: string;
  @ApiProperty({ minimum: 0, type: Number }) replayCount!: number;
  @ApiProperty({ enum: ['pending', 'processing', 'completed', 'failed', 'dead_letter'] })
  status!: IntegrationDeliveryStatus;
}

export class IntegrationEventSummaryDto implements IntegrationEventSummary {
  @ApiProperty({ format: 'uuid', type: String }) aggregateId!: string;
  @ApiProperty({ type: String }) aggregateType!: string;
  @ApiProperty({ minimum: 0, type: Number }) attemptCount!: number;
  @ApiProperty({ format: 'date-time', type: String }) availableAt!: string;
  @ApiPropertyOptional({ format: 'date-time', type: String }) completedAt?: string;
  @ApiProperty({ type: String }) correlationId!: string;
  @ApiPropertyOptional({ format: 'date-time', type: String }) deadLetteredAt?: string;
  @ApiProperty({ type: String }) eventType!: string;
  @ApiProperty({ format: 'uuid', type: String }) id!: string;
  @ApiPropertyOptional({ type: String }) lastErrorCode?: string;
  @ApiProperty({ format: 'date-time', type: String }) occurredAt!: string;
  @ApiProperty({ minimum: 0, type: Number }) publicationAttemptCount!: number;
  @ApiPropertyOptional({ format: 'date-time', type: String }) publishedAt?: string;
  @ApiProperty({ minimum: 0, type: Number }) replayCount!: number;
  @ApiProperty({ pattern: '^[1-9][0-9]*$', type: String }) sequenceNumber!: string;
  @ApiProperty({ enum: eventStatuses }) status!: IntegrationEventStatus;
}

export class IntegrationEventDetailDto
  extends IntegrationEventSummaryDto
  implements IntegrationEventDetail
{
  @ApiProperty({ type: [IntegrationDeliverySummaryDto] })
  deliveries!: IntegrationDeliverySummary[];
}

export class IntegrationEventPageDto implements IntegrationEventPage {
  @ApiProperty({ type: [IntegrationEventSummaryDto] }) items!: IntegrationEventSummary[];
  @ApiProperty({ minimum: 1, type: Number }) page!: number;
  @ApiProperty({ minimum: 1, type: Number }) pageSize!: number;
  @ApiProperty({ minimum: 0, type: Number }) total!: number;
  @ApiProperty({ minimum: 0, type: Number }) totalPages!: number;
}

export class IntegrationEventTelemetryDto implements IntegrationEventTelemetry {
  @ApiProperty({ minimum: 0, type: Number }) completed!: number;
  @ApiProperty({ minimum: 0, type: Number }) deadLetter!: number;
  @ApiProperty({ minimum: 0, type: Number }) failedDeliveries!: number;
  @ApiPropertyOptional({ format: 'date-time', type: String }) oldestPendingAt?: string;
  @ApiProperty({ minimum: 0, type: Number }) pending!: number;
  @ApiProperty({ minimum: 0, type: Number }) published!: number;
  @ApiProperty({ minimum: 0, type: Number }) publishing!: number;
  @ApiProperty({ format: 'date-time', type: String }) timestamp!: string;
}
