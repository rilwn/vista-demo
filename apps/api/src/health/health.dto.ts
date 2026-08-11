import { ApiProperty, ApiPropertyOptional, getSchemaPath } from '@nestjs/swagger';
import type { HealthCheck, HealthResponse } from '@vista/contracts';

export class HealthCheckDto implements HealthCheck {
  @ApiPropertyOptional({ type: String })
  detail?: string;

  @ApiPropertyOptional({ minimum: 0, type: Number })
  latencyMs?: number;

  @ApiProperty({ enum: ['up', 'down'] })
  status!: 'up' | 'down';
}

export class HealthResponseDto implements HealthResponse {
  @ApiProperty({
    additionalProperties: { $ref: getSchemaPath(HealthCheckDto) },
    type: 'object',
  })
  checks!: Record<string, HealthCheckDto>;

  @ApiProperty({ enum: ['ok', 'degraded'] })
  status!: 'ok' | 'degraded';

  @ApiProperty({ format: 'date-time', type: String })
  timestamp!: string;

  @ApiProperty({ type: String })
  version!: string;
}
