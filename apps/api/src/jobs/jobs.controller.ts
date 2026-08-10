import { Controller, Get, Inject, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiNotFoundResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { BackgroundJobSummary, BackgroundJobTelemetry } from '@vista/contracts';

import { RequirePermissions } from '../auth/auth.decorators.js';
import { ApiErrorException } from '../common/api-error.exception.js';
import { RateLimitPolicy } from '../security/rate-limit.decorator.js';
import { BackgroundJobSummaryDto, BackgroundJobTelemetryDto } from './jobs.dto.js';
import { JobQueueService } from './job-queue.service.js';

@ApiTags('platform operations')
@ApiBearerAuth()
@RateLimitPolicy('read')
@Controller('platform/jobs')
export class JobsController {
  constructor(@Inject(JobQueueService) private readonly jobs: JobQueueService) {}

  @Get('metrics')
  @RequirePermissions({ action: 'view', module: 'platform' })
  @ApiOkResponse({ type: BackgroundJobTelemetryDto })
  metrics(): Promise<BackgroundJobTelemetry> {
    return this.jobs.getTelemetry();
  }

  @Get(':id')
  @RequirePermissions({ action: 'view', module: 'platform' })
  @ApiOkResponse({ type: BackgroundJobSummaryDto })
  @ApiNotFoundResponse({ description: 'The background job no longer exists.' })
  async summary(@Param('id') id: string): Promise<BackgroundJobSummary> {
    const job = await this.jobs.getSummary(id);
    if (!job) {
      throw new ApiErrorException('BACKGROUND_JOB_NOT_FOUND', 'Background job was not found', 404);
    }
    return job;
  }
}
