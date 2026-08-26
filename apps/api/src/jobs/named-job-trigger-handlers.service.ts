import { createHash } from 'node:crypto';

import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';

import { DatabaseService } from '../database/database.service.js';
import { FinanceService } from '../finance/finance.service.js';
import { StructuredLogger } from '../logging/structured-logger.service.js';
import { SalesSubscriptionsService } from '../sales/sales-subscriptions.service.js';
import { ServiceCareService } from '../service/service-care.service.js';
import { FinanceReportExportsService } from './finance-report-exports.service.js';
import { type BackgroundJobContext, JobHandlerRegistry } from './job-handler-registry.service.js';
import { namedBackgroundJobs } from './named-background-jobs.js';

interface TriggerResult {
  deduplicated: boolean;
  eventId: string;
  [key: string]: unknown;
}

/**
 * Registers the platform's named scheduled responsibilities. Implemented domains
 * complete their transactional work before the durable trigger marker is written;
 * later domains retain that marker as an explicit handoff boundary.
 */
@Injectable()
export class NamedJobTriggerHandlersService implements OnModuleInit {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(JobHandlerRegistry) private readonly registry: JobHandlerRegistry,
    @Inject(StructuredLogger) private readonly logger: StructuredLogger,
    @Inject(SalesSubscriptionsService) private readonly subscriptions: SalesSubscriptionsService,
    @Inject(FinanceService) private readonly finance: FinanceService,
    @Inject(FinanceReportExportsService)
    private readonly reportExports: FinanceReportExportsService,
    @Inject(ServiceCareService) private readonly serviceCare: ServiceCareService,
  ) {}

  onModuleInit(): void {
    for (const name of namedBackgroundJobs) {
      this.registry.register(name, { handle: (context) => this.handle(context) });
    }
  }

  async handle(context: BackgroundJobContext): Promise<TriggerResult> {
    const domainResult =
      context.name === 'sales.subscription-invoice.generate'
        ? await this.subscriptions.generateDueInvoiceDrafts(context)
        : context.name === 'finance.payment-status.detect'
          ? await this.finance.detectPaymentStatuses(context)
          : context.name === 'report.generate' && typeof context.payload['exportId'] === 'string'
            ? await this.reportExports.generate(context)
            : context.name === 'service.inspection-reminder.prepare'
              ? await this.serviceCare.prepareInspectionReminders(context)
              : context.name === 'service.plan-visit.generate'
                ? await this.serviceCare.generateServicePlanVisits(context)
                : context.name === 'crm.warranty-expiration.prepare'
                  ? await this.serviceCare.prepareWarrantyReminders(context)
                  : undefined;
    const eventId = deterministicUuid(`${context.name}\u0000${context.idempotencyKey}`);
    const outboxIdempotencyKey = `scheduled:${createHash('sha256')
      .update(`${context.name}\u0000${context.idempotencyKey}`)
      .digest('hex')}`;
    const result = await this.database.getPool().query(
      `INSERT INTO integration.outbox_events (
         id, aggregate_type, aggregate_id, event_type, event_version,
         correlation_id, idempotency_key, payload
       ) VALUES ($1, 'scheduled_job', $1, $2, 1, $3, $4, $5)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [
        eventId,
        `scheduler.${context.name}.requested`,
        context.correlationId,
        outboxIdempotencyKey,
        {
          input: context.payload,
          jobName: context.name,
          queuedAt: context.enqueuedAt,
        },
      ],
    );
    const deduplicated = result.rowCount === 0;
    this.logger.event(
      'info',
      deduplicated ? 'scheduled_job.deduplicated' : 'scheduled_job.queued',
      {
        eventId,
        jobName: context.name,
      },
    );
    return { deduplicated, eventId, ...(domainResult ?? {}) };
  }
}

function deterministicUuid(value: string): string {
  const hex = createHash('sha256').update(value).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(
    17,
    20,
  )}-${hex.slice(20, 32)}`;
}
