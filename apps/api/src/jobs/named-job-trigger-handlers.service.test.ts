import { describe, expect, it, vi } from 'vitest';

import type { DatabaseService } from '../database/database.service.js';
import type { CrmTicketsService } from '../crm/crm-tickets.service.js';
import type { FinanceService } from '../finance/finance.service.js';
import type { StructuredLogger } from '../logging/structured-logger.service.js';
import type { SalesSubscriptionsService } from '../sales/sales-subscriptions.service.js';
import type { ServiceCareService } from '../service/service-care.service.js';
import { JobHandlerRegistry } from './job-handler-registry.service.js';
import type { FinanceReportExportsService } from './finance-report-exports.service.js';
import { namedBackgroundJobs } from './named-background-jobs.js';
import { NamedJobTriggerHandlersService } from './named-job-trigger-handlers.service.js';

describe('NamedJobTriggerHandlersService', () => {
  it('registers every scheduled responsibility named by the specification', () => {
    const { registry, service } = createSubject();
    service.onModuleInit();

    expect(registry.registeredNames()).toEqual([...namedBackgroundJobs].sort());
  });

  it('publishes a stable outbox trigger and safely deduplicates a replay', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 0 });
    const { registry, service } = createSubject(query);
    service.onModuleInit();
    const context = {
      attemptNumber: 1,
      correlationId: 'correlation-1',
      enqueuedAt: '2026-08-10T08:00:00.000Z',
      idempotencyKey: '2026-08-10',
      jobId: 'job-1',
      maxAttempts: 5,
      name: 'backup.verify',
      payload: { scheduledFor: '2026-08-10T08:00:00.000Z' },
      retryAllowed: true,
    } as const;

    await expect(registry.execute(context)).resolves.toMatchObject({ deduplicated: false });
    await expect(registry.execute(context)).resolves.toMatchObject({ deduplicated: true });

    expect(query).toHaveBeenCalledTimes(2);
    const firstParameters = query.mock.calls[0]?.[1] as unknown[];
    const replayParameters = query.mock.calls[1]?.[1] as unknown[];
    expect(firstParameters[0]).toBe(replayParameters[0]);
    expect(firstParameters[1]).toBe('scheduler.backup.verify.requested');
    expect(firstParameters[3]).toBe(replayParameters[3]);
    expect(firstParameters[4]).toEqual({
      input: { scheduledFor: '2026-08-10T08:00:00.000Z' },
      jobName: 'backup.verify',
      queuedAt: '2026-08-10T08:00:00.000Z',
    });
  });

  it('runs overdue detection before recording the durable scheduled-job handoff', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1 });
    const detectPaymentStatuses = vi.fn().mockResolvedValue({
      asOf: '2026-08-10',
      documentIds: ['document-1'],
      updatedCount: 1,
    });
    const { registry, service } = createSubject(query, detectPaymentStatuses);
    service.onModuleInit();
    const context = {
      attemptNumber: 1,
      correlationId: 'finance-correlation-1',
      enqueuedAt: '2026-08-10T01:25:00.000Z',
      idempotencyKey: 'finance-2026-08-10',
      jobId: 'finance-job-1',
      maxAttempts: 5,
      name: 'finance.payment-status.detect',
      payload: { scheduledFor: '2026-08-10T01:25:00.000Z' },
      retryAllowed: true,
    } as const;

    await expect(registry.execute(context)).resolves.toMatchObject({
      asOf: '2026-08-10',
      updatedCount: 1,
    });
    expect(detectPaymentStatuses).toHaveBeenCalledWith(context);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('completes a requested report before recording the durable handoff', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1 });
    const generateReport = vi.fn().mockResolvedValue({
      exportId: 'c25ae021-f68a-4b8a-83db-ecf9a5ca9196',
      rowCount: 4,
    });
    const { registry, service } = createSubject(query, undefined, generateReport);
    service.onModuleInit();
    const context = {
      attemptNumber: 1,
      correlationId: 'report-correlation-1',
      enqueuedAt: '2026-08-25T10:00:00.000Z',
      idempotencyKey: 'finance-report-export:c25ae021-f68a-4b8a-83db-ecf9a5ca9196',
      jobId: 'report-job-1',
      maxAttempts: 5,
      name: 'report.generate',
      payload: { exportId: 'c25ae021-f68a-4b8a-83db-ecf9a5ca9196' },
      retryAllowed: true,
    } as const;

    await expect(registry.execute(context)).resolves.toMatchObject({ rowCount: 4 });
    expect(generateReport).toHaveBeenCalledWith(context);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['service.inspection-reminder.prepare', 'prepareInspectionReminders'],
    ['service.plan-visit.generate', 'generateServicePlanVisits'],
    ['crm.warranty-expiration.prepare', 'prepareWarrantyReminders'],
  ] as const)('runs %s as domain work before its durable handoff', async (name, method) => {
    const { registry, service, serviceCare } = createSubject();
    service.onModuleInit();
    const context = {
      attemptNumber: 1,
      correlationId: `correlation-${name}`,
      enqueuedAt: '2026-08-26T01:35:00.000Z',
      idempotencyKey: `scheduled-${name}-2026-08-26`,
      jobId: `job-${name}`,
      maxAttempts: 5,
      name,
      payload: { asOf: '2026-08-26' },
      retryAllowed: true,
    } as const;

    await registry.execute(context);

    expect(serviceCare[method]).toHaveBeenCalledWith(context);
  });

  it('evaluates CRM ticket SLAs before recording the durable handoff', async () => {
    const { crmTickets, registry, service } = createSubject();
    service.onModuleInit();
    const context = {
      attemptNumber: 1,
      correlationId: 'crm-sla-correlation',
      enqueuedAt: '2026-08-26T10:00:00.000Z',
      idempotencyKey: 'crm-sla-2026-08-26T10:00',
      jobId: 'crm-sla-job',
      maxAttempts: 5,
      name: 'crm.sla.evaluate',
      payload: { asOf: '2026-08-26T10:00:00.000Z' },
      retryAllowed: true,
    } as const;

    await registry.execute(context);

    expect(crmTickets.evaluateSla).toHaveBeenCalledWith(context);
  });
});

function createSubject(
  query = vi.fn().mockResolvedValue({ rowCount: 1 }),
  detectPaymentStatuses = vi.fn().mockResolvedValue({
    asOf: '2026-08-10',
    documentIds: [],
    updatedCount: 0,
  }),
  generateReport = vi.fn(),
) {
  const registry = new JobHandlerRegistry();
  const database = { getPool: () => ({ query }) } as unknown as DatabaseService;
  const logger = { event: vi.fn() } as unknown as StructuredLogger;
  const subscriptions = {
    generateDueInvoiceDrafts: vi.fn().mockResolvedValue({
      asOf: '2026-08-10',
      draftIds: [],
      generatedCount: 0,
    }),
  } as unknown as SalesSubscriptionsService;
  const finance = { detectPaymentStatuses } as unknown as FinanceService;
  const reportExports = { generate: generateReport } as unknown as FinanceReportExportsService;
  const serviceCareSpies = {
    generateServicePlanVisits: vi.fn(),
    prepareInspectionReminders: vi.fn(),
    prepareWarrantyReminders: vi.fn(),
  };
  const serviceCare = serviceCareSpies as unknown as ServiceCareService;
  const crmTicketSpies = { evaluateSla: vi.fn() };
  const crmTickets = crmTicketSpies as unknown as CrmTicketsService;
  return {
    crmTickets: crmTicketSpies,
    registry,
    serviceCare: serviceCareSpies,
    service: new NamedJobTriggerHandlersService(
      database,
      registry,
      logger,
      subscriptions,
      finance,
      reportExports,
      serviceCare,
      crmTickets,
    ),
  };
}
