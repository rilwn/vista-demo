import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import type { HealthResponse } from '@vista/contracts';
import type { Response } from 'express';

import { HealthService } from './health.service.js';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(@Inject(HealthService) private readonly health: HealthService) {}

  @Get('live')
  @ApiOkResponse({ description: 'The API process is alive.' })
  liveness(): HealthResponse {
    return this.health.liveness();
  }

  @Get('ready')
  @ApiOkResponse({ description: 'The API dependencies are reachable.' })
  @ApiServiceUnavailableResponse({ description: 'One or more dependencies are unavailable.' })
  async readiness(@Res({ passthrough: true }) response: Response): Promise<HealthResponse> {
    const result = await this.health.readiness();
    if (result.status === 'degraded') {
      response.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return result;
  }
}
