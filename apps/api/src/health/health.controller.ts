import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { HealthResponse } from '@vista/contracts';
import type { Response } from 'express';

import { Public } from '../auth/auth.decorators.js';
import { HealthCheckDto, HealthResponseDto } from './health.dto.js';
import { HealthService } from './health.service.js';

@ApiTags('health')
@ApiExtraModels(HealthCheckDto)
@SkipThrottle()
@Public()
@Controller('health')
export class HealthController {
  constructor(@Inject(HealthService) private readonly health: HealthService) {}

  @Get('live')
  @ApiOkResponse({ description: 'The API process is alive.', type: HealthResponseDto })
  liveness(): HealthResponse {
    return this.health.liveness();
  }

  @Get('ready')
  @ApiOkResponse({ description: 'The API dependencies are reachable.', type: HealthResponseDto })
  @ApiServiceUnavailableResponse({
    description: 'One or more dependencies are unavailable.',
    type: HealthResponseDto,
  })
  async readiness(@Res({ passthrough: true }) response: Response): Promise<HealthResponse> {
    const result = await this.health.readiness();
    if (result.status === 'degraded') {
      response.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return result;
  }
}
