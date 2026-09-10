import { Controller, Get, Header, HttpStatus, Inject, Param } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
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
  @Header('Cache-Control', 'no-store')
  async metrics(): Promise<BackgroundJobTelemetry> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.jobs.getTelemetry(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('Queue check timed out')), 5000);
        }),
      ]);
    } catch {
      throw new ApiErrorException(
        'JOB_MONITORING_UNAVAILABLE',
        'Background processing status is temporarily unavailable.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  @Get('metrics/prometheus')
  @RequirePermissions({ action: 'view', module: 'platform' })
  @Header('Cache-Control', 'no-store')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  @ApiProduces('text/plain')
  @ApiOkResponse({
    type: String,
    description: 'Current retained queue counts, not lifetime counters.',
  })
  async prometheus(): Promise<string> {
    const metrics = await this.metrics();
    return [
      '# HELP vista_jobs Retained jobs by current state.',
      '# TYPE vista_jobs gauge',
      ...(['waiting', 'active', 'delayed', 'completed', 'failed'] as const).map(
        (state) => `vista_jobs{state="${state}"} ${metrics[state]}`,
      ),
      '# HELP vista_jobs_paused Whether queue processing is paused.',
      '# TYPE vista_jobs_paused gauge',
      `vista_jobs_paused ${metrics.paused ? 1 : 0}`,
      '',
    ].join('\n');
  }

  @Get(':id')
  @RequirePermissions({ action: 'view', module: 'platform' })
  @ApiParam({ name: 'id', type: String })
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
