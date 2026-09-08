import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { AppEnvironment } from '@vista/config';

import { APP_ENVIRONMENT } from '../config/config.module.js';
import { StructuredLogger } from '../logging/structured-logger.service.js';
import { FinanceReportExportsService } from './finance-report-exports.service.js';
import { ReportingHubService } from './reporting-hub.service.js';

@Injectable()
export class FinanceReportExportDispatcherService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private timer: NodeJS.Timeout | undefined;
  private dispatching = false;

  constructor(
    @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
    @Inject(FinanceReportExportsService) private readonly exports: FinanceReportExportsService,
    @Inject(StructuredLogger) private readonly logger: StructuredLogger,
    @Inject(ReportingHubService) private readonly schedules: ReportingHubService,
  ) {}

  onApplicationBootstrap(): void {
    if (this.environment.NODE_ENV === 'test') return;
    void this.dispatch();
    this.timer = setInterval(() => void this.dispatch(), 5_000);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async dispatch(): Promise<void> {
    if (this.dispatching) return;
    this.dispatching = true;
    try {
      try {
        await this.schedules.dispatchDue();
      } catch (error) {
        this.logger.event('error', 'report.schedules.dispatch_failed', {
          errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
        });
      }
      const count = await this.exports.dispatchPending();
      if (count > 0) this.logger.event('info', 'report.exports.dispatched', { count });
    } catch (error) {
      this.logger.event('error', 'report.exports.dispatch_failed', {
        errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
      });
    } finally {
      this.dispatching = false;
    }
  }
}
