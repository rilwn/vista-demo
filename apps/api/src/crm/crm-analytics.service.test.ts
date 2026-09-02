import type { AppEnvironment } from '@vista/config';
import { describe, expect, it, vi } from 'vitest';

import type { DatabaseService } from '../database/database.service.js';
import { CrmAnalyticsService } from './crm-analytics.service.js';

describe('CRM analytics service', () => {
  it('maps reproducible customer, pipeline, employee, preference, and revenue metrics', async () => {
    const query = vi.fn(async (sql: string, parameters: unknown[]) => {
      await Promise.resolve();
      if (sql.includes('WITH invoice_activity')) {
        expect(parameters).toEqual([
          '2026-08-01',
          '2026-08-31',
          '2026-07-01',
          '2026-07-31',
          '2026-05-31',
          '2026-06-30',
        ]);
        return {
          rows: [
            {
              current_active_customers: '2',
              current_average_transaction_value_bgn: '72.00',
              current_churn_percent: '50.00',
              current_net_revenue_bgn: '120.00',
              current_observed_lifetime_value_bgn: '100.00',
              current_purchase_frequency: '1.50',
              current_retention_percent: '50.00',
              previous_active_customers: '2',
              previous_average_transaction_value_bgn: '60.00',
              previous_churn_percent: '0.00',
              previous_observed_lifetime_value_bgn: '80.00',
              previous_purchase_frequency: '1.00',
              previous_retention_percent: '100.00',
            },
          ],
        };
      }
      if (sql.includes('WITH stages')) {
        return {
          rows: [
            pipelineRow('new', '2', '0'),
            pipelineRow('qualified', '2', '1'),
            pipelineRow('quotation_sent', '1', '1'),
            pipelineRow('negotiation', '0', '0'),
            pipelineRow('won', '1', '1'),
            pipelineRow('lost', '0', '0'),
          ],
        };
      }
      if (sql.includes('WITH activity')) {
        return {
          rows: [
            {
              display_name: 'Vista Demo CRM Coordinator',
              requests_processed: '1',
              sales_completed: '2',
              tickets_resolved: '3',
            },
          ],
        };
      }
      if (sql.includes('product_preference')) {
        return {
          rows: [
            {
              document_count: '2',
              kind: 'product',
              label: 'Demo Fiscal Register X1',
              net_revenue_bgn: '100.00',
              quantity: '2.0000',
            },
          ],
        };
      }
      return {
        rows: [
          {
            dimension: 'customer',
            document_count: '2',
            key: 'customer-1',
            label: 'Alfa Market Demo Ltd.',
            net_revenue_bgn: '120.00',
          },
        ],
      };
    });
    const database = { getPool: () => ({ query }) } as unknown as DatabaseService;
    const environment = { BUSINESS_TIMEZONE: 'Europe/Sofia' } as AppEnvironment;
    const service = new CrmAnalyticsService(database, environment);

    const result = await service.overview('2026-08-01', '2026-08-31');

    expect(result).toMatchObject({
      customerMetrics: {
        activeCustomers: 2,
        averageTransactionValueBgn: '72.00',
        purchaseFrequency: '1.50',
        retentionPercent: '50.00',
      },
      employees: [
        {
          displayName: 'Vista Demo CRM Coordinator',
          requestsProcessed: 1,
          salesCompleted: 2,
          ticketsResolved: 3,
          totalCompleted: 6,
        },
      ],
      pipeline: {
        createdOpportunities: 2,
        winRatePercent: '100.00',
      },
      previousDateFrom: '2026-07-01',
      previousDateTo: '2026-07-31',
      preferences: [expect.objectContaining({ kind: 'product', quantity: '2.0000' })],
      revenue: [
        expect.objectContaining({
          dimension: 'customer',
          netRevenueBgn: '120.00',
          sharePercent: '100.00',
        }),
      ],
      timezone: 'Europe/Sofia',
      totalNetRevenueBgn: '120.00',
    });
    expect(result.pipeline.stages.find((stage) => stage.stage === 'new')).toMatchObject({
      enteredCount: 2,
    });
    expect(result.pipeline.stages.find((stage) => stage.stage === 'qualified')).toMatchObject({
      conversionFromPreviousPercent: '100.00',
    });
    expect(result.pipeline.stages.find((stage) => stage.stage === 'quotation_sent')).toMatchObject({
      conversionFromPreviousPercent: '50.00',
    });
    expect(result.definitions.map((definition) => definition.key)).toEqual(
      expect.arrayContaining([
        'customer-activity',
        'customer-retention',
        'observed-clv',
        'customer-preferences',
        'pipeline-conversion',
        'recorded-revenue',
        'employee-performance',
      ]),
    );
  });

  it('rejects reversed or missing reporting windows before database work', async () => {
    const query = vi.fn();
    const database = { getPool: () => ({ query }) } as unknown as DatabaseService;
    const service = new CrmAnalyticsService(database, {
      BUSINESS_TIMEZONE: 'Europe/Sofia',
    } as AppEnvironment);

    await expect(service.overview('2026-09-02', '2026-08-01')).rejects.toMatchObject({
      status: 400,
    });
    await expect(service.exportData('crm.customer-value', {})).rejects.toMatchObject({
      status: 400,
    });
    expect(query).not.toHaveBeenCalled();
  });
});

function pipelineRow(stage: string, enteredCount: string, currentCount: string) {
  return {
    current_count: currentCount,
    entered_count: enteredCount,
    estimated_revenue_bgn: '1800.00',
    lost_count: '0',
    open_pipeline_value_bgn: '800.00',
    stage,
    total_opportunities: '2',
    won_count: '1',
  };
}
